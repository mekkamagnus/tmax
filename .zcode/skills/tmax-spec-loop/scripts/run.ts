#!/usr/bin/env bun
/**
 * @file tmax-spec-loop orchestrator (TypeScript / Bun)
 *
 * Subcommands: dry-run [SPEC_ID] | setup [SPEC_ID] | verify <ID> | record <ID> <status>
 *            | attempt-record <ID> <attempt_num> <gate_failed>
 *            | status | reset <ID> | skip <ID>
 *
 * Output protocol (machine-readable lines the model parses):
 *   WORKTREE_PATH=<path>
 *   SPEC_ID=<id>
 *   SPEC_PATH=<abspath>
 *   LOG_PATH=<path>
 *   BRANCH=<name>
 *   VERIFY OK
 *   VERIFY FAILED: <reason>
 *   FAILED_GATE=<label>           (emitted alongside VERIFY FAILED, for the reflect-refine loop)
 *   FAILURE_EXCERPT=<last 40 lines, one line, capped 2000 chars>
 *   PICKED=<id>          (from dry-run)
 *   NO PICK              (from dry-run when nothing to do)
 *   ATTEMPT_RECORDED id=<id> attempt=<n> gate=<label> commit=<sha|none>
 *
 * Run with: bun .zcode/skills/tmax-spec-loop/scripts/run.ts <subcommand> [args]
 */

import { $, file, write, Glob } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { appendFile, rm } from "node:fs/promises";
import path from "node:path";

const SCRIPT_DIR: string = import.meta.dir;
const SKILL_DIR: string = path.resolve(SCRIPT_DIR, "..");
const PROJECT_ROOT: string = path.resolve(SKILL_DIR, "../../..");

const SPECS_DIR = path.join(PROJECT_ROOT, "docs/specs");
const WORKTREES_DIR = path.join(PROJECT_ROOT, ".worktrees");
const STATE_DIR = path.join(PROJECT_ROOT, ".spec-loop");
const LOGS_DIR = path.join(STATE_DIR, "logs");
const PROGRESS_FILE = path.join(STATE_DIR, "progress.json");
const MAX_ATTEMPTS = 3;

type EntryStatus =
  | "not_started"
  | "in_progress"
  | "done"
  | "failed"
  | "skipped"
  | "blocked";

interface AttemptRecord {
  attempt: number;
  gate_failed: string;
  excerpt: string;
  commit?: string | null;
  recorded_at: string;
}

interface ProgressEntry {
  spec_id: string;
  status: EntryStatus;
  worktree?: string | null;
  branch?: string | null;
  commit?: string | null;
  attempts?: number;
  attempt_log?: AttemptRecord[];
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
  process.stderr.write(`[spec-loop] ${msg}\n`);
}

function die(msg: string): never {
  log(`ERROR: ${msg}`);
  process.exit(1);
}

function ts(): string {
  return new Date().toISOString();
}

function ensureDirs(): void {
  if (!existsSync(WORKTREES_DIR)) mkdirSync(WORKTREES_DIR, { recursive: true });
  if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
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

function specIdFromFile(filePath: string): string | null {
  const m = path.basename(filePath).match(/^SPEC-([0-9]+)/);
  return m ? m[1] : null;
}

// Accept "039", "SPEC-039", or a path like "docs/specs/SPEC-039-foo.md".
// Returns the zero-padded numeric ID, or dies with a clear error.
function normalizeSpecArg(arg: string): string {
  const m = path.basename(arg).match(/^SPEC-([0-9]{3,})/);
  if (m) return m[1];
  if (/^[0-9]+$/.test(arg)) return arg.padStart(3, "0");
  die(`Cannot parse SPEC ID from argument: ${arg}`);
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

async function allSpecFiles(): Promise<string[]> {
  if (!existsSync(SPECS_DIR)) return [];
  const g = new Glob("SPEC-*.md");
  const out: string[] = [];
  for await (const rel of g.scan({ cwd: SPECS_DIR, onlyFiles: true })) {
    out.push(path.join(SPECS_DIR, rel));
  }
  return out.sort();
}

async function specFileForId(id: string): Promise<string | null> {
  for (const f of await allSpecFiles()) {
    if (specIdFromFile(f) === id) return f;
  }
  return null;
}

async function pickNextSpecId(): Promise<string | null> {
  const progress = await readProgress();
  const terminal: EntryStatus[] = ["done", "skipped", "blocked", "in_progress"];
  const seen = new Set(
    progress.entries.filter((e) => terminal.includes(e.status)).map((e) => e.spec_id),
  );
  for (const f of await allSpecFiles()) {
    const id = specIdFromFile(f);
    if (!id) continue;
    if (seen.has(id)) continue;
    return id;
  }
  return null;
}

function currentAttempts(progress: Progress, id: string): number {
  return progress.entries.find((e) => e.spec_id === id)?.attempts ?? 0;
}

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
      status: "in_progress",
      created_at: now,
      updated_at: now,
    };
    progress.entries.push({ ...update(fresh), updated_at: now });
  } else {
    progress.entries[idx] = { ...update(progress.entries[idx]!), updated_at: now };
  }
  await writeProgress(progress);
}

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

// Resolve a daemon helper script. The skill ships at both .zcode/skills/
// and .claude/skills/, but only .claude/skills/tmax-daemon/ exists today.
// Check the sibling dir first, then fall back to the .claude/skills copy.
function resolveDaemonScript(name: string): string {
  const candidates = [
    path.join(SKILL_DIR, "..", "tmax-daemon", "scripts", name),
    path.join(PROJECT_ROOT, ".claude", "skills", "tmax-daemon", "scripts", name),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

// --- Subcommands ---

async function cmdDryRun(specArg?: string): Promise<void> {
  // Explicit SPEC ID bypasses the picker (mirrors setup <SPEC_ID>); omitted
  // arg falls back to pick-next. Useful when you intend to target a specific
  // SPEC that isn't the picker's first choice (e.g. it's lower-numbered than
  // another unstarted SPEC).
  let id: string | null;
  if (specArg) {
    id = normalizeSpecArg(specArg);
    if (!(await specFileForId(id))) die(`SPEC file for ${id} not found in ${SPECS_DIR}.`);
  } else {
    id = await pickNextSpecId();
  }
  if (!id) {
    console.log("NO PICK");
    console.log(`No unstarted SPEC found in ${SPECS_DIR}`);
    return;
  }
  const f = await specFileForId(id);
  if (!f) die(`SPEC file for ${id} not found`);
  console.log(`PICKED=${id}`);
  console.log(`TITLE=${await specTitleFromFile(f)}`);
  console.log(`PATH=${f}`);
}

async function cmdSetup(specArg?: string): Promise<void> {
  ensureDirs();
  await ensureProgressFile();

  const dirtyWT = await sh(["git", "diff", "--quiet", "HEAD", "--"]);
  const dirtyIdx = await sh(["git", "diff", "--cached", "--quiet", "HEAD", "--"]);
  if (!dirtyWT.ok || !dirtyIdx.ok) {
    die("Working tree not clean on main. Commit or stash first.");
  }

  // Explicit SPEC ID bypasses the picker; omitted arg falls back to pick-next.
  let id: string | null;
  if (specArg) {
    id = normalizeSpecArg(specArg);
    if (!(await specFileForId(id))) die(`SPEC file for ${id} not found in ${SPECS_DIR}.`);
  } else {
    id = await pickNextSpecId();
    if (!id) die("No unstarted SPEC found.");
  }
  const specPath = await specFileForId(id);
  if (!specPath) die(`SPEC file for ${id} not found.`);

  const wt = path.join(WORKTREES_DIR, `spec-${id}`);
  const branch = `spec-loop/${id}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(LOGS_DIR, `${id}-${stamp}.log`);

  if (existsSync(wt)) {
    die(`Worktree already exists for ${id} at ${wt}. Run reset ${id} or remove it manually.`);
  }

  const attempts = currentAttempts(await readProgress(), id) + 1;
  if (attempts > MAX_ATTEMPTS) {
    await writeEntry(id, (e) => ({ ...e, status: "blocked", last_error: "Exceeded max attempts" }));
    die(`SPEC ${id} exceeded ${MAX_ATTEMPTS} attempts. Marked blocked. Reset to retry.`);
  }

  const add = await sh(["git", "worktree", "add", "-b", branch, wt, "HEAD"]);
  if (!add.ok) die(`git worktree add failed: ${add.stderr}`);

  await writeEntry(id, (e) => ({
    ...e,
    status: "in_progress",
    worktree: wt,
    branch,
    attempts,
    log: logPath,
    started_at: ts(),
    last_error: null,
  }));

  console.log(`SPEC_ID=${id}`);
  console.log(`SPEC_PATH=${specPath}`);
  console.log(`WORKTREE_PATH=${wt}`);
  console.log(`BRANCH=${branch}`);
  console.log(`LOG_PATH=${logPath}`);
  console.log(`ATTEMPTS=${attempts}`);
}

async function cmdVerify(id: string): Promise<void> {
  if (!id) die("Usage: verify <SPEC_ID>");
  await ensureProgressFile();
  const progress = await readProgress();
  const entry = progress.entries.find((e) => e.spec_id === id);
  const wt = entry?.worktree;
  if (!wt || !existsSync(wt)) die(`No active worktree for ${id}. Run setup first.`);
  const logPath = entry?.log ?? "/dev/null";

  let verifyErr = "";
  let failedGate = "";
  let failureExcerpt = "";

  const verifyStep = async (label: string, cmd: string[], cwd?: string): Promise<boolean> => {
    const header = `\n=== ${label} ===\n`;
    const r = await sh(cmd, { cwd: cwd ?? PROJECT_ROOT });
    const combined =
      header +
      r.stdout +
      r.stderr +
      (r.ok ? "" : `\n[exit ${r.exitCode}]\n`);
    try {
      await appendFile(logPath, combined);
    } catch {
      // best-effort log
    }
    if (!r.ok) {
      verifyErr = `${label} failed (see ${logPath})`;
      failedGate = label;
      // Last 40 lines, joined to a single line, capped at 2000 chars.
      // The orchestrator feeds this back to the sub-agent on a reflect-refine retry.
      failureExcerpt = combined
        .split("\n")
        .slice(-40)
        .join(" | ")
        .slice(0, 2000);
      return false;
    }
    return true;
  };

  // Detect daemon-touching changes: diff branch tip against main merge-base.
  const mb = await sh(["git", "merge-base", "main", "HEAD"], { cwd: wt });
  const base = mb.stdout.trim();
  const diff = base
    ? await sh(["git", "diff", "--name-only", base, "HEAD"], { cwd: wt })
    : { stdout: "", ok: true, exitCode: 0, stderr: "" };
  const changedFiles = diff.stdout.split("\n").filter(Boolean);
  const daemonTouched = changedFiles.some(
    (f) => f.startsWith("src/server/") || f.startsWith("src/tlisp/"),
  );

  const failVerify = (): never => {
    console.log(`VERIFY FAILED: ${verifyErr}`);
    console.log(`FAILED_GATE=${failedGate}`);
    console.log(`FAILURE_EXCERPT=${failureExcerpt}`);
    process.exit(1);
  };

  if (!(await verifyStep("typecheck", ["bun", "run", "typecheck:src"]))) {
    failVerify();
  }
  if (!(await verifyStep("test:unit", ["bun", "run", "test:unit"]))) {
    failVerify();
  }
  if (daemonTouched) {
    const stopScript = resolveDaemonScript("stop_daemon.py");
    const startScript = resolveDaemonScript("start_daemon.py");
    if (!(await verifyStep("daemon-restart", ["uv", "run", stopScript]))) {
      failVerify();
    }
    // Best-effort start; not fatal if it warns.
    await verifyStep("daemon-start", ["uv", "run", startScript, PROJECT_ROOT]);
    if (!(await verifyStep("test:daemon", ["bun", "run", "test:daemon"]))) {
      failVerify();
    }
  }

  console.log("VERIFY OK");
}

async function cmdRecord(id: string, status: string): Promise<void> {
  if (!id || !status) die("Usage: record <SPEC_ID> <done|failed>");
  if (status !== "done" && status !== "failed") {
    die(`status must be done or failed, got: ${status}`);
  }
  await ensureProgressFile();
  const progress = await readProgress();
  const entry = progress.entries.find((e) => e.spec_id === id);
  const wt = entry?.worktree;

  let commit = "";
  let files = 0;
  let lastError: string | null = null;

  if (wt && existsSync(wt)) {
    const sha = await sh(["git", "rev-parse", "--short", "HEAD"], { cwd: wt });
    commit = sha.stdout.trim();
    const diff = await sh(["git", "diff", "--name-only", "HEAD~1", "HEAD"], { cwd: wt });
    files = diff.stdout.split("\n").filter(Boolean).length;
    if (status === "failed") lastError = "Verification failed";
  }

  await writeEntry(id, (e) => ({
    ...e,
    status: status as EntryStatus,
    commit: commit || null,
    files_changed: files,
    last_error: lastError,
    completed_at: ts(),
  }));

  console.log(
    `RECORDED id=${id} status=${status} commit=${commit || "none"} files=${files}`,
  );
}

async function cmdStatus(): Promise<void> {
  if (!existsSync(PROGRESS_FILE)) {
    console.log("No progress file yet. Run /tmax-spec-loop first.");
    return;
  }
  const progress = await readProgress();
  const header = ["ID", "STATUS", "ATT", "COMMIT", "TITLE"]
    .map((s) => s.padEnd(s === "TITLE" ? 40 : s === "STATUS" ? 12 : 8))
    .join(" ");
  console.log(header);
  for (const e of progress.entries) {
    const f = await specFileForId(e.spec_id);
    const title = f ? (await specTitleFromFile(f)).slice(0, 60) : "";
    console.log(
      [
        e.spec_id.padEnd(8),
        e.status.padEnd(12),
        String(e.attempts ?? 0).padEnd(8),
        (e.commit ?? "-").padEnd(8),
        title,
      ].join(" "),
    );
  }
  const total = progress.entries.length;
  const done = progress.entries.filter((e) => e.status === "done").length;
  const failed = progress.entries.filter((e) => e.status === "failed").length;
  const blocked = progress.entries.filter((e) => e.status === "blocked").length;
  console.log(
    `\nTotal entries: ${total} | done: ${done} | failed: ${failed} | blocked: ${blocked}`,
  );
}

async function cmdReset(id: string): Promise<void> {
  if (!id) die("Usage: reset <SPEC_ID>");
  await ensureProgressFile();
  const progress = await readProgress();
  const entry = progress.entries.find((e) => e.spec_id === id);
  const wt = entry?.worktree;

  if (wt && existsSync(wt)) {
    const clean = await sh(["git", "diff", "--quiet", "HEAD", "--"], { cwd: wt });
    if (!clean.ok) {
      die(
        `Worktree ${wt} has uncommitted changes. Resolve by hand or commit/discard, then re-run reset.`,
      );
    }
    await sh(["git", "worktree", "remove", wt, "--force"]);
    if (existsSync(wt)) await rm(wt, { recursive: true, force: true });
    log(`Removed worktree ${wt}`);
  }

  await writeEntry(id, (e) => ({
    ...e,
    status: "not_started",
    worktree: null,
    branch: null,
    commit: null,
    attempts: 0,
    attempt_log: [],
    last_error: null,
    completed_at: null,
  }));
  console.log(`RESET id=${id}`);
}

async function cmdAttemptRecord(id: string, attemptArg: string, gate: string): Promise<void> {
  if (!id || !attemptArg || !gate) {
    die("Usage: attempt-record <SPEC_ID> <attempt_num> <gate_failed>");
  }
  const attempt = Number.parseInt(attemptArg, 10);
  if (!Number.isFinite(attempt)) die(`attempt_num must be an integer, got: ${attemptArg}`);
  await ensureProgressFile();
  const progress = await readProgress();
  const entry = progress.entries.find((e) => e.spec_id === id);
  const wt = entry?.worktree;
  let commit: string | null = null;
  if (wt && existsSync(wt)) {
    const sha = await sh(["git", "rev-parse", "--short", "HEAD"], { cwd: wt });
    commit = sha.stdout.trim() || null;
  }
  const record: AttemptRecord = {
    attempt,
    gate_failed: gate,
    excerpt: "", // excerpt is read from the log by the orchestrator if needed; this keeps the ledger compact
    commit,
    recorded_at: ts(),
  };
  await writeEntry(id, (e) => ({
    ...e,
    attempt_log: [...(e.attempt_log ?? []), record],
  }));
  console.log(`ATTEMPT_RECORDED id=${id} attempt=${attempt} gate=${gate} commit=${commit ?? "none"}`);
}

async function cmdSkip(id: string): Promise<void> {
  if (!id) die("Usage: skip <SPEC_ID>");
  await writeEntry(id, (e) => ({ ...e, status: "skipped", last_error: "manually skipped" }));
  console.log(`SKIPPED id=${id}`);
}

// --- Dispatch ---

const sub = process.argv[2] ?? "next";
const args = process.argv.slice(3);

try {
  switch (sub) {
    case "dry-run":
      await cmdDryRun(args[0]);
      break;
    case "setup":
      await cmdSetup(args[0]);
      break;
    case "verify":
      await cmdVerify(args[0] ?? "");
      break;
    case "record":
      await cmdRecord(args[0] ?? "", args[1] ?? "");
      break;
    case "status":
      await cmdStatus();
      break;
    case "reset":
      await cmdReset(args[0] ?? "");
      break;
    case "attempt-record":
      await cmdAttemptRecord(args[0] ?? "", args[1] ?? "", args[2] ?? "");
      break;
    case "skip":
      await cmdSkip(args[0] ?? "");
      break;
    case "next":
      log(
        "'next' is the model's job: run dry-run -> setup -> dispatch -> verify -> record. Use dry-run to see the pick.",
      );
      break;
    default:
      die(`Unknown subcommand: ${sub}. Try: dry-run setup verify record status reset skip`);
  }
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
