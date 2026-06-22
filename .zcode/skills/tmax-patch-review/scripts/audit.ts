#!/usr/bin/env bun
/**
 * @file tmax-patch-review orchestrator (TypeScript / Bun, functional style)
 *
 * Subcommands:
 *   gather <SPEC>                       — find commits + diff + write gather bundle
 *   gates  <SPEC> --gather-dir <path>   — run typecheck + tests, append to bundle
 *   record <SPEC> <done|failed>         — update .spec-loop/progress.json
 *
 * All subcommands accept an optional --root <path> flag that re-points the
 * audit at a different project root (e.g. a git worktree on spec-loop/<id>).
 * When omitted, PROJECT_ROOT defaults to the skill's parent-parent-parent
 * (the main checkout). Used by tmax-spec-loop's audit gate to audit the
 * worktree's branch instead of main's git log.
 *
 * Output protocol (machine-readable lines the model parses):
 *   GATHER_DIR=<path>
 *   GATHER_PATH=<path>/gather.md
 *   COMMITS=<sha1>,<sha2>,...
 *   FILES_CHANGED=N
 *   DAEMON_TOUCHED=true|false
 *   GATES_PASS
 *   GATES_FAILED: <which>
 *   NO IMPLEMENTATION FOUND
 *   RECORDED id=<id> status=<status>
 *
 * Run with: bun .zcode/skills/tmax-patch-review/scripts/audit.ts <subcommand> [args] [--root <path>]
 */

import { $, file, write, Glob } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { Either, Left, Right, None, Option, TaskEither } from "./fp.ts";

// ──────────────────────────── Paths ────────────────────────────
// All paths derive from a parsed Opts record — no module-level mutation.
// The skill dir is the single anchor; the project root is the optional --root.

const SCRIPT_DIR: string = import.meta.dir;
const SKILL_DIR: string = path.resolve(SCRIPT_DIR, "..");

interface Paths {
  readonly skillDir: string;
  readonly projectRoot: string;
  readonly specsDir: string;
  readonly reviewsDir: string;
  readonly stateDir: string;
  readonly progressFile: string;
}

function makePaths(projectRoot: string): Paths {
  return {
    skillDir: SKILL_DIR,
    projectRoot,
    specsDir: path.join(projectRoot, "docs/specs"),
    reviewsDir: path.join(projectRoot, ".patch-reviews"),
    stateDir: path.join(projectRoot, ".spec-loop"),
    progressFile: path.join(projectRoot, ".spec-loop/progress.json"),
  };
}

// Default project root: parent of the skill dir.
const DEFAULT_PROJECT_ROOT: string = path.resolve(SKILL_DIR, "../../..");

// The tmax-daemon helper scripts (start/stop_daemon.py) ship ONLY under
// .claude/skills/tmax-daemon/scripts/ in the main checkout. Resolve once,
// anchored off the skill's own location (never off PROJECT_ROOT, which may be
// a worktree where .claude/skills/ does not exist).
const MAIN_CHECKOUT_ROOT: string = path.resolve(SKILL_DIR, "../../..");
const DAEMON_SCRIPTS_DIR: string = path.join(
  MAIN_CHECKOUT_ROOT,
  ".claude",
  "skills",
  "tmax-daemon",
  "scripts",
);

const daemonScript = (name: string): string => path.join(DAEMON_SCRIPTS_DIR, name);

// ──────────────────────────── CLI parsing ────────────────────────────

interface Opts {
  readonly sub: string;
  readonly positional: readonly string[];
  readonly projectRoot: string;
}

function parseArgs(argv: readonly string[]): Either<string, Opts> {
  const sub = argv[2] ?? "";
  const rest = argv.slice(3);
  const rootIdx = rest.indexOf("--root");
  if (rootIdx !== -1) {
    const rootVal = rest[rootIdx + 1];
    if (!rootVal) return Left("--root requires a path argument");
    const positional = rest.filter((_, i) => i !== rootIdx && i !== rootIdx + 1);
    return Right({ sub, positional, projectRoot: path.resolve(rootVal) });
  }
  return Right({ sub, positional: rest, projectRoot: DEFAULT_PROJECT_ROOT });
}

// ──────────────────────────── Errors / logging ────────────────────────────

const log = (msg: string): void => {
  process.stderr.write(`[patch-review] ${msg}\n`);
};

const die = (msg: string): never => {
  log(`ERROR: ${msg}`);
  process.exit(1);
};

// Crash with the Left message if a computation failed; otherwise unwrap Right.
const dieOnLeft = <L, R>(e: Either<L, R>): R =>
  Either.fold(
    e,
    (l) => die(typeof l === "string" ? l : String(l)),
    (r) => r,
  );

const ts = (): string => new Date().toISOString();
const stampForPath = (): string =>
  new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// ──────────────────────────── SPEC argument normalization ────────────────────────────

const normalizeSpecArg = (arg: string): Either<string, string> => {
  const basename = path.basename(arg);
  const m = basename.match(/^SPEC-([0-9]{3,})/);
  if (m) return Right(m[1]);
  if (/^[0-9]+$/.test(arg)) return Right(arg.padStart(3, "0"));
  return Left(`Cannot parse SPEC ID from argument: ${arg}`);
};

const specFileForId =
  (specsDir: string) =>
  async (id: string): Promise<Option<string>> => {
    if (!existsSync(specsDir)) return None;
    const g = new Glob(`SPEC-${id}*.md`);
    for await (const rel of g.scan({ cwd: specsDir, onlyFiles: true })) {
      return Option.fromNullable(path.join(specsDir, rel));
    }
    return None;
  };

const specTitleFromFile = async (filePath: string): Promise<string> =>
  TaskEither.tryCatch(
    async () => await file(filePath).text(),
    () => "",
  )
    .map((text) => {
      const line = text.split("\n").find((l) => l.startsWith("# "));
      return line ? line.slice(2).slice(0, 200) : "";
    })
    .run()
    .then((e) => Either.getOrElse(e, ""));

// ──────────────────────────── Shell helper ────────────────────────────

interface ShellResult {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const sh =
  (projectRoot: string) =>
  async (cmd: readonly string[], opts: { cwd?: string } = {}): Promise<ShellResult> => {
    const r = await $`${cmd}`.cwd(opts.cwd ?? projectRoot).nothrow().quiet();
    return {
      ok: r.exitCode === 0,
      exitCode: r.exitCode,
      stdout: r.stdout.toString(),
      stderr: r.stderr.toString(),
    };
  };

// ──────────────────────────── Progress store ────────────────────────────

type EntryStatus =
  | "not_started"
  | "in_progress"
  | "done"
  | "failed"
  | "skipped"
  | "blocked";

interface ProgressEntry {
  spec_id: string;
  status: EntryStatus;
  worktree?: string | null;
  branch?: string | null;
  commit?: string | null;
  attempts?: number;
  files_changed?: number;
  log?: string | null;
  last_error?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface Progress {
  version: number;
  entries: ProgressEntry[];
}

const EMPTY_PROGRESS: Progress = { version: 1, entries: [] };

const ensureDirs = async (paths: Paths): Promise<void> => {
  if (!existsSync(paths.reviewsDir)) mkdirSync(paths.reviewsDir, { recursive: true });
  if (!existsSync(paths.stateDir)) mkdirSync(paths.stateDir, { recursive: true });
};

const ensureProgressFile = async (paths: Paths): Promise<void> => {
  if (!existsSync(paths.progressFile)) {
    await write(paths.progressFile, JSON.stringify(EMPTY_PROGRESS, null, 2) + "\n");
  }
};

const readProgress = async (paths: Paths): Promise<Progress> =>
  TaskEither.tryCatch(
    async () => JSON.parse(await file(paths.progressFile).text()) as Progress,
    (e) => e,
  )
    .mapLeft(() => EMPTY_PROGRESS)
    .run()
    .then((e) => Either.getOrElse(e, EMPTY_PROGRESS));

const writeProgress = async (paths: Paths, p: Progress): Promise<void> => {
  await write(paths.progressFile, JSON.stringify(p, null, 2) + "\n");
};

// Pure upsert: returns a new entries array, leaves the input untouched.
const upsertEntry = (
  entries: readonly ProgressEntry[],
  id: string,
  now: string,
  update: (e: ProgressEntry) => ProgressEntry,
): ProgressEntry[] => {
  const idx = entries.findIndex((e) => e.spec_id === id);
  if (idx === -1) {
    const fresh: ProgressEntry = {
      spec_id: id,
      status: "not_started",
      created_at: now,
      updated_at: now,
    };
    return [...entries, { ...update(fresh), updated_at: now }];
  }
  return entries.map((e, i) => (i === idx ? { ...update(e), updated_at: now } : e));
};

// Collect uncommitted working-tree changes: modified (staged + unstaged) + untracked files.
// Returns the file list + a consolidated diff. This is the pre-commit fallback when no
// implementing commits exist yet (tmax-patch-review runs BEFORE committing).
interface WorkingTreeChanges {
  readonly files: readonly string[];
  readonly diff: string;
  readonly empty: boolean;
}

const collectWorkingTreeChanges = async (projectRoot: string): Promise<WorkingTreeChanges> => {
  const run = sh(projectRoot);
  // Tracked changes (staged + unstaged), names only.
  const tracked = await run(["git", "diff", "--name-only", "HEAD"]);
  // Untracked files (not yet in the index).
  const untracked = await run(["git", "ls-files", "--others", "--exclude-standard"]);
  const files = Array.from(
    new Set(
      [...tracked.stdout.split("\n"), ...untracked.stdout.split("\n")]
        .map((f) => f.trim())
        .filter((f) => f.length > 0),
    ),
  ).sort();
  // Consolidated diff: staged + unstaged for tracked files.
  const diffRes = await run(["git", "diff", "HEAD", "--no-color"]);
  const diff = diffRes.stdout;
  return { files, diff, empty: files.length === 0 };
};

// ──────────────────────────── Subcommand: gather ────────────────────────────

interface CommitInfo {
  readonly sha: string;
  readonly subject: string;
  readonly files: readonly string[];
  stat: string;
}

const findImplementingCommits = async (
  projectRoot: string,
  specId: string,
): Promise<CommitInfo[]> => {
  // Match "SPEC-<id>" in the SUBJECT line only (bodies reference other specs).
  const bareId = specId.replace(/^0+/, "") || "0";
  const subjRe = new RegExp(`SPEC-0*${bareId}([^0-9]|$)`, "i");
  const run = sh(projectRoot);

  const logRes = await run(["git", "log", "--pretty=format:%H%x09%s", "--name-only"]);
  if (!logRes.ok || !logRes.stdout.trim()) return [];

  const commits: CommitInfo[] = logRes.stdout
    .split("\n\n")
    .map((block) => block.split("\n").filter((l) => l.length > 0))
    .filter((lines) => lines.length > 0)
    .map((lines) => {
      const head = lines[0] ?? "";
      const [sha, subject] = head.split("\t");
      const files = lines.slice(1).filter((l) => l && !l.startsWith("\t"));
      return { sha: sha ?? "", subject: subject ?? "", files };
    })
    .filter((c) => c.sha && subjRe.test(c.subject))
    .map((c) => ({ ...c, sha: c.sha.slice(0, 12), stat: "" }));

  // Enrich each commit with a one-line --stat summary.
  for (const c of commits) {
    const s = await run(["git", "show", "--stat", "--format=", c.sha]);
    c.stat = s.stdout.trim();
  }
  return commits;
};

const renderGatherBundle = (
  id: string,
  specPath: string,
  title: string,
  commits: readonly CommitInfo[],
  files: readonly string[],
  daemonTouched: boolean,
  diffs: readonly string[],
  workingTree: { files: readonly string[]; diff: string; empty: boolean },
): string => {
  const lines: string[] = [];
  lines.push(`# Gather bundle — SPEC-${id}`);
  lines.push(`Generated: ${ts()}`);
  lines.push("");
  lines.push("## SPEC");
  lines.push(`- Path: ${specPath}`);
  lines.push(`- Title: ${title}`);
  lines.push("");
  lines.push("## Implementing commits");
  for (const c of commits) lines.push(`- ${c.sha} ${c.subject}`);
  lines.push("");
  lines.push(`## Files changed (${files.length} files)`);
  for (const f of files) lines.push(`- ${f}`);
  lines.push("");
  lines.push(`## Daemon-touched: ${daemonTouched ? "true" : "false"}`);
  lines.push("");
  lines.push("## Per-commit stat");
  for (const c of commits) {
    lines.push(`### ${c.sha} ${c.subject}`);
    lines.push("```");
    lines.push(c.stat);
    lines.push("```");
    lines.push("");
  }
  // Uncommitted working-tree changes (pre-commit mode).
  if (!workingTree.empty) {
    lines.push(`## Uncommitted working-tree changes (${workingTree.files.length} files)`);
    for (const f of workingTree.files) lines.push(`- ${f}`);
    lines.push("");
    lines.push("### Working-tree diff");
    lines.push("```diff");
    lines.push(workingTree.diff);
    lines.push("```");
    lines.push("");
  }
  lines.push("## Diff (consolidated, may be large — also readable via git show <sha>)");
  lines.push("```diff");
  for (const d of diffs) lines.push(d);
  lines.push("```");
  return lines.join("\n") + "\n";
};

const cmdGather = async (paths: Paths, specArg: string): Promise<void> => {
  const id = dieOnLeft(normalizeSpecArg(specArg));
  await ensureDirs(paths);
  const specPath = await specFileForId(paths.specsDir)(id);
  const resolvedSpec = Option.fold(
    specPath,
    () => die(`SPEC file not found for ID ${id} in ${paths.specsDir}`),
    (p) => p,
  );
  const title = await specTitleFromFile(resolvedSpec);

  const commits = await findImplementingCommits(paths.projectRoot, id);
  const workingTree = await collectWorkingTreeChanges(paths.projectRoot);
  if (commits.length === 0 && workingTree.empty) {
    console.log("NO IMPLEMENTATION FOUND");
    console.log(
      `No commits matching "SPEC-${id}" and no uncommitted working-tree changes found.`,
    );
    return;
  }

  const committedFiles = Array.from(new Set(commits.flatMap((c) => c.files))).sort();
  const allFiles = Array.from(
    new Set([...committedFiles, ...workingTree.files]),
  ).sort();
  const daemonTouched = allFiles.some(
    (f) => f.startsWith("src/server/") || f.startsWith("src/tlisp/"),
  );
  const run = sh(paths.projectRoot);
  const diffs = await TaskEither.sequence(
    commits.map((c) =>
      TaskEither.tryCatch(
        async () => (await run(["git", "show", "--format=", "--no-color", c.sha])).stdout,
        (e) => e,
      ),
    ),
  )
    .run()
    .then((e) =>
      Either.fold(
        e,
        () => die("git show failed"),
        (xs) => xs,
      ),
    );

  const gatherDir = path.join(paths.reviewsDir, `SPEC-${id}-${stampForPath()}`);
  if (!existsSync(gatherDir)) mkdirSync(gatherDir, { recursive: true });
  const gatherPath = path.join(gatherDir, "gather.md");
  await write(
    gatherPath,
    renderGatherBundle(id, resolvedSpec, title, commits, allFiles, daemonTouched, diffs, workingTree),
  );

  console.log(`SPEC_ID=${id}`);
  console.log(`SPEC_PATH=${resolvedSpec}`);
  console.log(`GATHER_DIR=${gatherDir}`);
  console.log(`GATHER_PATH=${gatherPath}`);
  console.log(`COMMITS=${commits.map((c) => c.sha).join(",")}`);
  console.log(`FILES_CHANGED=${allFiles.length}`);
  console.log(`DAEMON_TOUCHED=${daemonTouched ? "true" : "false"}`);
};

// ──────────────────────────── Subcommand: gates ────────────────────────────

const runGate = (
  appendTo: string,
  projectRoot: string,
  failedRef: { failed: string },
) => async (label: string, cmd: readonly string[]): Promise<boolean> => {
  const header = `\n## Gate: ${label}\n\n\`\`\`\n`;
  const r = await sh(projectRoot)(cmd);
  const body = r.stdout + r.stderr + (r.ok ? "" : `\n[exit ${r.exitCode}]\n`);
  await appendFile(appendTo, header + body + "```\n");
  if (!r.ok) {
    failedRef.failed = failedRef.failed ? `${failedRef.failed}, ${label}` : label;
    return false;
  }
  return true;
};

const cmdGates = async (paths: Paths, specArg: string, gatherDir: string): Promise<void> => {
  const id = dieOnLeft(normalizeSpecArg(specArg));
  if (!gatherDir || !existsSync(gatherDir)) {
    die(`--gather-dir required and must exist: ${gatherDir}`);
  }
  const gatherPath = path.join(gatherDir, "gather.md");
  if (!existsSync(gatherPath)) die(`Gather bundle not found: ${gatherPath}`);

  const failedRef = { failed: "" };
  const gate = runGate(gatherPath, paths.projectRoot, failedRef);

  await gate("typecheck:src", ["bun", "run", "typecheck:src"]);
  await gate("test:unit", ["bun", "run", "test:unit"]);

  if (failedRef.failed) {
    console.log(`GATES_FAILED: ${failedRef.failed}`);
    process.exit(1);
  }
  console.log("GATES_PASS");
};

// ──────────────────────────── Subcommand: record ────────────────────────────

const cmdRecord = async (paths: Paths, specArg: string, status: string): Promise<void> => {
  const id = dieOnLeft(normalizeSpecArg(specArg));
  if (status !== "done" && status !== "failed") {
    die(`status must be done or failed, got: ${status}`);
  }
  await ensureProgressFile(paths);
  const headRes = await sh(paths.projectRoot)(["git", "rev-parse", "--short", "HEAD"]);
  const commitSha = headRes.stdout.trim();

  const now = ts();
  const progress = await readProgress(paths);
  const updated: Progress = {
    ...progress,
    entries: upsertEntry(progress.entries, id, now, (e) => ({
      ...e,
      status: status as EntryStatus,
      commit: commitSha,
      completed_at: now,
      last_error: status === "failed" ? "patch-review found gaps" : null,
    })),
  };
  await writeProgress(paths, updated);
  console.log(`RECORDED id=${id} status=${status} commit=${commitSha}`);
};

// ──────────────────────────── Dispatch ────────────────────────────

const dispatch = (opts: Opts): Promise<void> => {
  const paths = makePaths(opts.projectRoot);
  const [a0, a1] = opts.positional;
  switch (opts.sub) {
    case "gather":
      if (!a0) die("Usage: gather <SPEC> [--root <path>]");
      return cmdGather(paths, a0);
    case "gates": {
      if (!a0) die("Usage: gates <SPEC> --gather-dir <path> [--root <path>]");
      const dirIdx = opts.positional.indexOf("--gather-dir");
      const gatherDir = dirIdx !== -1 ? opts.positional[dirIdx + 1] : "";
      return cmdGates(paths, a0, gatherDir ?? "");
    }
    case "record":
      if (!a0 || !a1) die("Usage: record <SPEC> <done|failed> [--root <path>]");
      return cmdRecord(paths, a0, a1);
    default:
      return die(`Unknown subcommand: ${opts.sub}. Try: gather | gates | record`);
  }
};

const opts = dieOnLeft(parseArgs(process.argv));
await dispatch(opts).catch((e) => die(e instanceof Error ? e.message : String(e)));
