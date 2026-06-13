#!/usr/bin/env bun
/**
 * @file patch-review orchestrator (TypeScript / Bun)
 *
 * Subcommands:
 *   gather <SPEC>                       — find commits + diff + write gather bundle
 *   gates  <SPEC> --gather-dir <path>   — run typecheck + tests, append to bundle
 *   record <SPEC> <done|failed>         — update .spec-loop/progress.json
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
 * Run with: bun .claude/skills/patch-review/scripts/audit.ts <subcommand> [args]
 */

import { $, file, write, Glob } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";

const SCRIPT_DIR: string = import.meta.dir;
const SKILL_DIR: string = path.resolve(SCRIPT_DIR, "..");
const PROJECT_ROOT: string = path.resolve(SKILL_DIR, "../../..");

const SPECS_DIR = path.join(PROJECT_ROOT, "docs/specs");
const REVIEWS_DIR = path.join(PROJECT_ROOT, ".patch-reviews");
const STATE_DIR = path.join(PROJECT_ROOT, ".spec-loop");
const PROGRESS_FILE = path.join(STATE_DIR, "progress.json");

const DAEMON_SCRIPTS_DIR = path.resolve(
  SKILL_DIR,
  "..",
  "tmax-daemon",
  "scripts",
);

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

function log(msg: string): void {
  process.stderr.write(`[patch-review] ${msg}\n`);
}

function die(msg: string): never {
  log(`ERROR: ${msg}`);
  process.exit(1);
}

function ts(): string {
  return new Date().toISOString();
}

function stampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function ensureDirs(): Promise<void> {
  if (!existsSync(REVIEWS_DIR)) mkdirSync(REVIEWS_DIR, { recursive: true });
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

async function ensureProgressFile(): Promise<void> {
  if (!existsSync(PROGRESS_FILE)) {
    const seed: Progress = { version: 1, entries: [] };
    await write(PROGRESS_FILE, JSON.stringify(seed, null, 2) + "\n");
  }
}

async function readProgress(): Promise<Progress> {
  try {
    return JSON.parse(await file(PROGRESS_FILE).text());
  } catch {
    return { version: 1, entries: [] };
  }
}

async function writeProgress(p: Progress): Promise<void> {
  await write(PROGRESS_FILE, JSON.stringify(p, null, 2) + "\n");
}

// --- SPEC argument normalization ---

function normalizeSpecArg(arg: string): string {
  // Accept "039", "SPEC-039", "docs/specs/SPEC-039-foo.md", etc.
  const pathBasename = path.basename(arg);
  const m = pathBasename.match(/^SPEC-([0-9]{3,})/);
  if (m) return m[1];
  if (/^[0-9]{3,}$/.test(arg)) return arg.replace(/^0+/, (s) => (s.length > 1 ? s.slice(0, -1) : s)).padStart(3, "0");
  if (/^[0-9]+$/.test(arg)) return arg.padStart(3, "0");
  die(`Cannot parse SPEC ID from argument: ${arg}`);
}

async function specFileForId(id: string): Promise<string | null> {
  if (!existsSync(SPECS_DIR)) return null;
  const g = new Glob(`SPEC-${id}*.md`);
  for await (const rel of g.scan({ cwd: SPECS_DIR, onlyFiles: true })) {
    return path.join(SPECS_DIR, rel);
  }
  return null;
}

async function specTitleFromFile(filePath: string): Promise<string> {
  try {
    const text = await file(filePath).text();
    for (const line of text.split("\n")) {
      if (line.startsWith("# ")) return line.slice(2).slice(0, 200);
    }
  } catch {
    // ignore
  }
  return "";
}

// --- Shell helper ---

interface ShellResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function sh(cmd: string[], opts: { cwd?: string } = {}): Promise<ShellResult> {
  const r = await $`${cmd}`.cwd(opts.cwd ?? PROJECT_ROOT).nothrow().quiet();
  return {
    ok: r.exitCode === 0,
    exitCode: r.exitCode,
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
  };
}

// --- Subcommand: gather ---

interface CommitInfo {
  sha: string;
  subject: string;
  files: string[];
  stat: string;
}

async function findImplementingCommits(specId: string): Promise<CommitInfo[]> {
  // Match SPEC-NNN as a word-boundary token in the SUBJECT line only.
  // Commit bodies often reference other SPECs ("mirrors SPEC-041 pattern")
  // which would produce false positives if we grepped the whole message.
  const bareId = specId.replace(/^0+/, "") || "0";
  // Build a regex that matches "SPEC-<id>" where <id> is the digits with
  // optional leading zeros, followed by a non-digit boundary.
  const subjRe = new RegExp(`SPEC-0*${bareId}([^0-9]|$)`, "i");

  const r = await sh([
    "git", "log", "--pretty=format:%H%x09%s", "--name-only",
  ]);
  if (!r.ok || !r.stdout.trim()) return [];

  const commits: CommitInfo[] = [];
  const blocks = r.stdout.split("\n\n");
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    const [shaTab, ...rest] = lines;
    const sha = (shaTab ?? "").split("\t")[0] ?? "";
    const subject = (shaTab ?? "").split("\t")[1] ?? "";
    if (!sha) continue;
    if (!subjRe.test(subject)) continue;
    const files = rest.filter((l) => l && !l.startsWith("\t"));
    commits.push({ sha: sha.slice(0, 12), subject, files, stat: "" });
  }

  // For each commit, fetch a one-line --stat summary.
  for (const c of commits) {
    const s = await sh(["git", "show", "--stat", "--format=", c.sha]);
    c.stat = s.stdout.trim();
  }

  return commits;
}

async function cmdGather(specArg: string): Promise<void> {
  await ensureDirs();
  const id = normalizeSpecArg(specArg);
  const specPath = await specFileForId(id);
  if (!specPath) die(`SPEC file not found for ID ${id} in ${SPECS_DIR}`);
  const title = await specTitleFromFile(specPath);

  const commits = await findImplementingCommits(id);
  if (commits.length === 0) {
    console.log("NO IMPLEMENTATION FOUND");
    console.log(`No commits found matching "SPEC-${id}" in git log.`);
    return;
  }

  const allFiles = new Set<string>();
  for (const c of commits) for (const f of c.files) allFiles.add(f);
  const filesArray = Array.from(allFiles).sort();
  const daemonTouched = filesArray.some(
    (f) => f.startsWith("src/server/") || f.startsWith("src/tlisp/"),
  );

  const stamp = stampForPath();
  const gatherDir = path.join(REVIEWS_DIR, `SPEC-${id}-${stamp}`);
  if (!existsSync(gatherDir)) mkdirSync(gatherDir, { recursive: true });

  const gatherPath = path.join(gatherDir, "gather.md");
  const lines: string[] = [];
  lines.push(`# Gather bundle — SPEC-${id}`);
  lines.push(`Generated: ${ts()}`);
  lines.push("");
  lines.push("## SPEC");
  lines.push(`- Path: ${specPath}`);
  lines.push(`- Title: ${title}`);
  lines.push("");
  lines.push("## Implementing commits");
  for (const c of commits) {
    lines.push(`- ${c.sha} ${c.subject}`);
  }
  lines.push("");
  lines.push(`## Files changed (${filesArray.length} files)`);
  for (const f of filesArray) lines.push(`- ${f}`);
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
  lines.push("## Diff (consolidated, may be large — also readable via git show <sha>)");
  lines.push("```diff");
  for (const c of commits) {
    const d = await sh(["git", "show", "--format=", "--no-color", c.sha]);
    lines.push(d.stdout);
  }
  lines.push("```");

  await write(gatherPath, lines.join("\n") + "\n");

  console.log(`SPEC_ID=${id}`);
  console.log(`SPEC_PATH=${specPath}`);
  console.log(`GATHER_DIR=${gatherDir}`);
  console.log(`GATHER_PATH=${gatherPath}`);
  console.log(`COMMITS=${commits.map((c) => c.sha).join(",")}`);
  console.log(`FILES_CHANGED=${filesArray.length}`);
  console.log(`DAEMON_TOUCHED=${daemonTouched ? "true" : "false"}`);
}

// --- Subcommand: gates ---

async function cmdGates(specArg: string, gatherDir: string): Promise<void> {
  const id = normalizeSpecArg(specArg);
  if (!gatherDir || !existsSync(gatherDir)) {
    die(`--gather-dir required and must exist: ${gatherDir}`);
  }
  const gatherPath = path.join(gatherDir, "gather.md");
  if (!existsSync(gatherPath)) die(`Gather bundle not found: ${gatherPath}`);

  // Re-derive daemonTouched by reading it from the gather bundle.
  const text = await file(gatherPath).text();
  const dm = text.match(/^## Daemon-touched:\s*(true|false)/m);
  const daemonTouched = dm ? dm[1] === "true" : false;

  let failed = "";
  const runGate = async (label: string, cmd: string[]): Promise<boolean> => {
    const header = `\n## Gate: ${label}\n\n\`\`\`\n`;
    const r = await sh(cmd);
    const body = r.stdout + r.stderr + (r.ok ? "" : `\n[exit ${r.exitCode}]\n`);
    await appendFile(gatherPath, header + body + "```\n");
    if (!r.ok) {
      failed = failed ? `${failed}, ${label}` : label;
      return false;
    }
    return true;
  };

  await runGate("typecheck:src", ["bun", "run", "typecheck:src"]);
  await runGate("test:unit", ["bun", "run", "test:unit"]);
  if (daemonTouched) {
    const stopScript = path.join(DAEMON_SCRIPTS_DIR, "stop_daemon.py");
    const startScript = path.join(DAEMON_SCRIPTS_DIR, "start_daemon.py");
    await runGate("daemon-restart", ["uv", "run", stopScript]);
    await runGate("daemon-start", ["uv", "run", startScript, PROJECT_ROOT]);
    await runGate("test:daemon", ["bun", "run", "test:daemon"]);
  }

  if (failed) {
    console.log(`GATES_FAILED: ${failed}`);
    process.exit(1);
  }
  console.log("GATES_PASS");
}

// --- Subcommand: record ---

async function writeEntry(
  id: string,
  update: (e: ProgressEntry) => ProgressEntry,
): Promise<void> {
  await ensureProgressFile();
  const progress = await readProgress();
  const now = ts();
  const idx = progress.entries.findIndex((e) => e.spec_id === id);
  if (idx === -1) {
    const fresh: ProgressEntry = {
      spec_id: id,
      status: "not_started",
      created_at: now,
      updated_at: now,
    };
    progress.entries.push({ ...update(fresh), updated_at: now });
  } else {
    progress.entries[idx] = { ...update(progress.entries[idx]!), updated_at: now };
  }
  await writeProgress(progress);
}

async function cmdRecord(specArg: string, status: string): Promise<void> {
  const id = normalizeSpecArg(specArg);
  if (status !== "done" && status !== "failed") {
    die(`status must be done or failed, got: ${status}`);
  }
  await ensureProgressFile();
  const commit = await sh(["git", "rev-parse", "--short", "HEAD"]);
  const commitSha = commit.stdout.trim();
  await writeEntry(id, (e) => ({
    ...e,
    status: status as EntryStatus,
    commit: commitSha,
    completed_at: ts(),
    last_error: status === "failed" ? "patch-review found gaps" : null,
  }));
  console.log(`RECORDED id=${id} status=${status} commit=${commitSha}`);
}

// --- Dispatch ---

const sub = process.argv[2] ?? "";
const args = process.argv.slice(3);

try {
  switch (sub) {
    case "gather":
      if (!args[0]) die("Usage: gather <SPEC>");
      await cmdGather(args[0]);
      break;
    case "gates": {
      if (!args[0]) die("Usage: gates <SPEC> --gather-dir <path>");
      const specArg = args[0];
      const dirFlag = args.indexOf("--gather-dir");
      const gatherDir = dirFlag !== -1 ? args[dirFlag + 1] : "";
      await cmdGates(specArg, gatherDir ?? "");
      break;
    }
    case "record":
      if (!args[0] || !args[1]) die("Usage: record <SPEC> <done|failed>");
      await cmdRecord(args[0], args[1]);
      break;
    default:
      die(`Unknown subcommand: ${sub}. Try: gather | gates | record`);
  }
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
