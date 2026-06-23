#!/usr/bin/env bun
/**
 * adw-watchdog.ts — Layer 2 of the adw watchdog (SPEC-066).
 *
 * Long-lived external monitor that catches what Layer 1 (the in-process stall
 * detector in spawnStage) structurally cannot: an orchestrator that has parked
 * after a `stage-error` (returned from runPipeline, status=failed, no process
 * alive) or an orchestrator whose spawnStage promise never resolves.
 *
 * Every `--poll-ms` (default 60s) the watchdog scans all `adw-state.json` files
 * under <agents-root>:
 *   - healthy              → no-op
 *   - stale-dead           → auto-resume via `bun adws/adw-plan-review-build-patch.ts
 *                             --resume <id>` in a fresh tmux window (capped by
 *                             --max-resumes per 24h per workspace)
 *   - stale-alive          → alarm + desktop notification (NEVER auto-kill — too risky)
 *   - not-running          → no-op (completed/cancelled/missing)
 *   - not-resumable-failed → no-op (resume counter exhausted or non-stage failure)
 *
 *   bun adws/adw-watchdog.ts                                   # default poll loop
 *   bun adws/adw-watchdog.ts --once                            # dry-run single scan
 *   bun adws/adw-watchdog.ts --poll-ms 30000 --stale-ms 600000
 *   bun adws/adw-watchdog.ts --stage-stale-ms build=7200000    # per-stage override
 *   bun adws/adw-watchdog.ts --max-resumes 5
 *   bun adws/adw-watchdog.ts --agents-root /tmp/adw-agents
 *
 * Watchdog events (separate from orchestrator events) live at
 * `agents/<id>/watchdog/events.jsonl`. The resume counter lives at
 * `agents/<id>/watchdog/resume-count.json`.
 *
 * Exit codes: 0 = --once scan complete or poll loop terminated cleanly; 1 =
 * usage error. The poll loop runs forever (until tmux window killed).
 */
import { spawnSync } from "child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { Either } from "../src/utils/task-either.ts";

const PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."));
const DEFAULT_AGENTS_ROOT = join(PROJECT_ROOT, "agents");

const DEFAULT_POLL_MS = 60_000;
const DEFAULT_STALE_MS = 600_000; // 10 min — parked or between-stage stale
const DEFAULT_MAX_RESUMES = 3;
const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

/** Per-stage stale thresholds — `events.jsonl` can be quiet for 15-78 min during a real run. */
const DEFAULT_STAGE_STALE_MS: Record<StageName, number> = {
  plan: 1_800_000, // 30 min
  review: 1_800_000, // 30 min
  build: 5_400_000, // 90 min
  test: 5_400_000, // 90 min
  "patch-review": 5_400_000, // 90 min
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StageName = "plan" | "review" | "build" | "test" | "patch-review";
const STAGE_NAMES: readonly StageName[] = ["plan", "review", "build", "test", "patch-review"];

function isStageName(s: string): s is StageName {
  return s === "plan" || s === "review" || s === "build" || s === "test" || s === "patch-review";
}

export type WorkspaceStatus =
  | { kind: "healthy"; id: string; lastActivityMs: number }
  | { kind: "stale-dead"; id: string; lastActivityMs: number; orchestratorPid: number | null }
  | { kind: "stale-alive"; id: string; lastActivityMs: number; orchestratorPid: number }
  | { kind: "not-running"; id: string; status: string }
  | { kind: "not-resumable-failed"; id: string };

export interface WatchdogArgs {
  pollMs: number;
  staleMs: number;
  stageStaleMs: Partial<Record<StageName, number>>;
  once: boolean;
  maxResumes: number;
  agentsRoot: string;
}

/** Injectable pid identity probe — production wraps `ps -o lstart=`; tests pass fakes. */
export type PidIdentityProbe = (pid: number, startedAtMs: number) => boolean;

// ---------------------------------------------------------------------------
// Usage / arg parsing
// ---------------------------------------------------------------------------

const USAGE = `Usage: bun adws/adw-watchdog.ts [options]

Long-lived monitor that auto-resumes parked adw workspaces and alarms on
live-but-stuck orchestrators. Launched by adw-launch.ts in a tmux window named
\`adw-watchdog\`; runs forever scanning every workspace under <agents-root>.

Options:

      --poll-ms <ms>           Poll interval (default 60000).
      --stale-ms <ms>          Stale threshold for failed workspaces and running
                               workspaces with no active stage (default 600000 = 10 min).
      --stage-stale-ms <s=ms>  Per-stage stale override. Repeatable. Stage is one
                               of plan, review, build, test, patch-review.
                               Defaults: plan/spec-review=1800000 (30 min),
                               build/test/patch-review=5400000 (90 min).
      --once                   Dry-run: single scan, print classifications + intended
                               actions, then exit. No resumes, no alarms, no events
                               written, no notifications, no counter increments.
      --max-resumes <N>        Max auto-resumes per workspace per 24h (default 3).
      --agents-root <path>     Workspace root (default: agents). Bare/path →
                               PROJECT_ROOT-relative; absolute → as-is.
  -h, --help                   Show this help.

Watchdog events: agents/<id>/watchdog/events.jsonl
Resume counter:   agents/<id>/watchdog/resume-count.json`;

export function parseArgs(argv: string[], defaults?: Partial<WatchdogArgs>): Either<string, WatchdogArgs> {
  const opts: WatchdogArgs = {
    pollMs: defaults?.pollMs ?? DEFAULT_POLL_MS,
    staleMs: defaults?.staleMs ?? DEFAULT_STALE_MS,
    stageStaleMs: { ...(defaults?.stageStaleMs ?? {}) },
    once: defaults?.once ?? false,
    maxResumes: defaults?.maxResumes ?? DEFAULT_MAX_RESUMES,
    agentsRoot: defaults?.agentsRoot ?? DEFAULT_AGENTS_ROOT,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") return Either.left(`__help__:${USAGE}`);
    else if (a === "--poll-ms") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--poll-ms requires a value.");
      const n = parseInt(val, 10);
      if (isNaN(n) || n <= 0) return Either.left(`--poll-ms must be a positive integer (got "${val}").`);
      opts.pollMs = n;
    } else if (a === "--stale-ms") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--stale-ms requires a value.");
      const n = parseInt(val, 10);
      if (isNaN(n) || n <= 0) return Either.left(`--stale-ms must be a positive integer (got "${val}").`);
      opts.staleMs = n;
    } else if (a === "--stage-stale-ms") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--stage-stale-ms requires a value.");
      const eq = val.indexOf("=");
      if (eq < 0) return Either.left(`--stage-stale-ms must be "<stage>=<ms>" (got "${val}").`);
      const stage = val.slice(0, eq);
      const msStr = val.slice(eq + 1);
      if (!isStageName(stage)) {
        return Either.left(`--stage-stale-ms stage must be one of ${STAGE_NAMES.join(", ")} (got "${stage}").`);
      }
      const n = parseInt(msStr, 10);
      if (isNaN(n) || n <= 0) return Either.left(`--stage-stale-ms ms must be a positive integer (got "${msStr}").`);
      opts.stageStaleMs[stage] = n;
    } else if (a === "--once") {
      opts.once = true;
    } else if (a === "--max-resumes") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--max-resumes requires a value.");
      const n = parseInt(val, 10);
      if (isNaN(n) || n < 0) return Either.left(`--max-resumes must be a non-negative integer (got "${val}").`);
      opts.maxResumes = n;
    } else if (a === "--agents-root") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--agents-root requires a value.");
      opts.agentsRoot = val;
    } else {
      return Either.left(`Unexpected argument: ${a}`);
    }
  }

  return Either.right(opts);
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

const ADW_ID_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/** Resolve --agents-root value to an absolute path (bare relative to PROJECT_ROOT). */
export function resolveAgentsRoot(root: string): string {
  if (root.startsWith("/")) return root;
  return join(PROJECT_ROOT, root);
}

/** List workspace ids (10-char ULID-timestamp dirs) under agentsRoot. */
function listWorkspaces(agentsRoot: string): string[] {
  if (!existsSync(agentsRoot)) return [];
  try {
    return readdirSync(agentsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && ADW_ID_RE.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a)); // newest first (ULID = chronological)
  } catch {
    return [];
  }
}

/** Recursive walk — all file paths under `root`. Best-effort; bad entries skipped. */
function walkFiles(root: string): string[] {
  const out: string[] = [];
  function recurse(dir: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      try {
        if (ent.isDirectory()) recurse(full);
        else if (ent.isFile()) out.push(full);
      } catch { /* skip */ }
    }
  }
  recurse(root);
  return out;
}

/** File mtime in ms, or null if unreadable. */
function mtimeMs(path: string): number | null {
  try { return statSync(path).mtimeMs; } catch { return null; }
}

/**
 * Find the newest activity mtime across the workspace's explicit activity files:
 * `adw-state.json`, every `events.jsonl`, every `raw-output.jsonl`. Heartbeat-only
 * streams are excluded — there is no `heartbeat.jsonl` and the orchestrator's
 * status lines do not land in these files.
 */
function findNewestActivityMs(agentsRoot: string, id: string): number {
  const wsDir = join(agentsRoot, id);
  let newest = 0;
  const stateFile = join(wsDir, "adw-state.json");
  const stateM = mtimeMs(stateFile);
  if (stateM !== null) newest = Math.max(newest, stateM);

  for (const file of walkFiles(wsDir)) {
    const base = file.split("/").pop() ?? file;
    if (base === "events.jsonl" || base === "raw-output.jsonl") {
      const m = mtimeMs(file);
      if (m !== null) newest = Math.max(newest, m);
    }
  }
  return newest;
}

// ---------------------------------------------------------------------------
// Orchestrator event inspection — detect active stage + last terminal event
// ---------------------------------------------------------------------------

interface TerminalEvent {
  event: string;
  stage?: string;
}

/**
 * Read the orchestrator's events.jsonl backward; return the last terminal event
 * (`stage-error` or `pipeline-failed`). Returns null if the file is missing or
 * no terminal event exists.
 */
function findLastTerminalEvent(agentsRoot: string, id: string): TerminalEvent | null {
  const eventsFile = join(agentsRoot, id, "orchestrator", "events.jsonl");
  if (!existsSync(eventsFile)) return null;
  let lines: string[];
  try {
    lines = readFileSync(eventsFile, "utf8").split("\n").filter((l) => l.trim());
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const d = JSON.parse(lines[i]!) as Record<string, unknown>;
      if (d.event === "stage-error" || d.event === "pipeline-failed") {
        return { event: d.event as string, stage: typeof d.stage === "string" ? d.stage : undefined };
      }
    } catch { /* skip */ }
  }
  return null;
}

/** Map an agent-dir stage label to the watchdog's StageName vocabulary. */
function normalizeStage(s: string): StageName | null {
  if (isStageName(s)) return s;
  // The orchestrator's resume event emits from_stage as the StageName already,
  // but be defensive about "spec-review" / "patch-review" spellings.
  if (s === "spec-review") return "review";
  return null;
}

/**
 * Determine the active stage from the orchestrator event log. The most recent
 * stage-related event identifies where the orchestrator is: `loop-retry.to`,
 * `stage-error.stage`, `resume.from_stage`, or `start`→plan. `stage-complete`
 * means we're between stages → null (no active stage → use staleMs). Returns
 * null if no active stage can be determined.
 */
function detectActiveStage(agentsRoot: string, id: string): StageName | null {
  const eventsFile = join(agentsRoot, id, "orchestrator", "events.jsonl");
  if (!existsSync(eventsFile)) return null;
  let lines: string[];
  try {
    lines = readFileSync(eventsFile, "utf8").split("\n").filter((l) => l.trim());
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const d = JSON.parse(lines[i]!) as Record<string, unknown>;
      if (d.event === "loop-retry" && typeof d.to === "string") {
        return normalizeStage(d.to);
      }
      if (d.event === "stage-error" && typeof d.stage === "string") {
        return normalizeStage(d.stage);
      }
      if (d.event === "resume" && typeof d.from_stage === "string") {
        return normalizeStage(d.from_stage);
      }
      if (d.event === "start") {
        return "plan";
      }
    } catch { /* skip */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resume counter
// ---------------------------------------------------------------------------

interface ResumeCounter {
  count: number;
  window_start: number;
}

function resumeCounterPath(agentsRoot: string, id: string): string {
  return join(agentsRoot, id, "watchdog", "resume-count.json");
}

/**
 * Read the per-workspace resume counter. Returns a fresh counter (count=0,
 * window_start=now) if the file is missing, unparseable, or the window has
 * expired (24h). Does NOT write — the caller increments + persists on action.
 */
function readResumeCounter(counterPath: string, now: number): ResumeCounter {
  if (!existsSync(counterPath)) return { count: 0, window_start: now };
  try {
    const raw = JSON.parse(readFileSync(counterPath, "utf8")) as Partial<ResumeCounter>;
    const count = typeof raw.count === "number" ? raw.count : 0;
    const windowStart = typeof raw.window_start === "number" ? raw.window_start : now;
    if (now - windowStart >= RESUME_WINDOW_MS) return { count: 0, window_start: now };
    return { count, window_start: windowStart };
  } catch {
    return { count: 0, window_start: now };
  }
}

function writeResumeCounter(counterPath: string, counter: ResumeCounter): void {
  try {
    mkdirSync(join(counterPath, ".."), { recursive: true });
    writeFileSync(counterPath, JSON.stringify(counter, null, 2) + "\n");
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Classifier (pure over filesystem + pid identity probe)
// ---------------------------------------------------------------------------

export interface ClassifierDeps {
  agentsRoot: string;
  stageStaleMs: Partial<Record<StageName, number>>;
  maxResumes: number;
  isSameProcess: PidIdentityProbe;
}

/**
 * Build a classifier with the given deps. The returned function has the
 * signature `(statePath, now, staleMs) => WorkspaceStatus` — pure over the
 * filesystem + the injected pid probe. Unit-testable with a temp dir + fake probe.
 */
export function makeClassifier(deps: ClassifierDeps): (statePath: string, now: number, staleMs: number) => WorkspaceStatus {
  return (statePath: string, now: number, staleMs: number): WorkspaceStatus => {
    const id = statePath.split("/").slice(-2, -1)[0] ?? "";
    let state: Record<string, unknown>;
    try {
      state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
    } catch {
      return { kind: "not-running", id, status: "unparseable" };
    }
    const status = typeof state.status === "string" ? state.status : "unknown";
    if (status !== "running" && status !== "failed") {
      return { kind: "not-running", id, status };
    }

    // Failed workspaces: gate on resumability before considering staleness.
    if (status === "failed") {
      const terminal = findLastTerminalEvent(deps.agentsRoot, id);
      const resumableTerminal =
        terminal !== null &&
        (terminal.event === "stage-error" || terminal.event === "pipeline-failed") &&
        typeof terminal.stage === "string" &&
        terminal.stage.length > 0;
      if (!resumableTerminal) {
        return { kind: "not-resumable-failed", id };
      }
      const counter = readResumeCounter(resumeCounterPath(deps.agentsRoot, id), now);
      if (counter.count >= deps.maxResumes) {
        return { kind: "not-resumable-failed", id };
      }
    }

    const lastActivityMs = findNewestActivityMs(deps.agentsRoot, id);
    let threshold = staleMs;
    if (status === "running") {
      const activeStage = detectActiveStage(deps.agentsRoot, id);
      if (activeStage !== null) {
        threshold = deps.stageStaleMs[activeStage] ?? DEFAULT_STAGE_STALE_MS[activeStage] ?? staleMs;
      }
    }
    if (now - lastActivityMs < threshold) {
      return { kind: "healthy", id, lastActivityMs };
    }

    const orchestratorPid = typeof state.orchestrator_pid === "number" ? state.orchestrator_pid : null;
    const startedAtMs = typeof state.orchestrator_started_at_ms === "number" ? state.orchestrator_started_at_ms : null;
    if (
      orchestratorPid !== null &&
      startedAtMs !== null &&
      deps.isSameProcess(orchestratorPid, startedAtMs)
    ) {
      return { kind: "stale-alive", id, lastActivityMs, orchestratorPid };
    }
    return { kind: "stale-dead", id, lastActivityMs, orchestratorPid };
  };
}

// ---------------------------------------------------------------------------
// Watchdog event log + notifications
// ---------------------------------------------------------------------------

function appendWatchdogEvent(agentsRoot: string, id: string, event: Record<string, unknown>): void {
  const dir = join(agentsRoot, id, "watchdog");
  try {
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
    appendFileSync(join(dir, "events.jsonl"), line);
  } catch { /* best-effort */ }
}

/** Build the platform-native notify command argv. Returns null when unsupported. */
export function notifyArgv(kind: string, msg: string): [string, string[]] | null {
  const title = `adw-watchdog ${kind}`;
  if (process.platform === "darwin") {
    return ["osascript", ["-e", `display notification "${msg.replace(/"/g, '\\"')}" with title "${title}"`]];
  }
  if (process.platform === "linux") {
    return ["notify-send", [title, msg]];
  }
  return null;
}

/**
 * Fire a desktop notification best-effort. Never throws. Falls back to stderr
 * on unsupported platforms or spawn failure. Accepts an injected spawn so unit
 * tests can verify the argv without running osascript.
 */
export function notify(
  kind: string,
  msg: string,
  spawn: (cmd: string, args: string[]) => void = productionSpawn,
): void {
  const argv = notifyArgv(kind, msg);
  if (argv === null) {
    process.stderr.write(`[adw-watchdog] ${kind}: ${msg}\n`);
    return;
  }
  try {
    spawn(argv[0], argv[1]);
  } catch (e) {
    process.stderr.write(`[adw-watchdog] ${kind}: ${msg} (notify failed: ${(e as Error).message})\n`);
  }
}

function productionSpawn(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { stdio: "ignore", timeout: 5_000 });
  if (result.error) throw result.error;
}

// ---------------------------------------------------------------------------
// Production pid identity probe
// ---------------------------------------------------------------------------

/**
 * Production pid identity probe: confirms `pid` is alive AND its OS process
 * start time matches `startedAtMs` (within 5s — ps lstart has 1s resolution).
 * Returns false on ESRCH, unreadable start time, or mismatch. A reused PID
 * with a mismatched start time is not the same orchestrator.
 */
export function isSameProcessProduction(pid: number, startedAtMs: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false; // ESRCH or no permission — treat as dead/foreign
  }
  const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.error || result.status !== 0) return false;
  const startStr = (result.stdout ?? "").trim();
  if (!startStr) return false;
  const startMs = Date.parse(startStr);
  if (isNaN(startMs)) return false;
  return Math.abs(startMs - startedAtMs) <= 5_000;
}

// ---------------------------------------------------------------------------
// Actions: resume + alarm (one-shot per stale workspace per poll)
// ---------------------------------------------------------------------------

/** Build the resume shell command — separate so unit tests can verify the argv. */
export function buildResumeCommand(agentsRoot: string, id: string): { session: string; window: string; cmd: string } {
  const script = "adws/adw-plan-review-build-patch.ts";
  const scriptPath = join(PROJECT_ROOT, script);
  const target = ["bun", scriptPath, "--resume", id].map((s) => `'${s.replace(/'/g, `'\\''`)}'`).join(" ");
  return {
    session: "tmax",
    window: `adw-resume-${id}`,
    cmd: `cd '${PROJECT_ROOT}' && exec ${target}`,
  };
}

/** Check whether tmux is installed and the tmax session exists. */
function tmuxAvailable(spawnRun: (cmd: string, args: string[]) => { status: number | null; error?: Error }): boolean {
  const v = spawnRun("tmux", ["-V"]);
  if (v.error || v.status !== 0) return false;
  const has = spawnRun("tmux", ["has-session", "-t", "tmax"]);
  if (has.error) return false;
  if (has.status === 0) return true;
  // Session doesn't exist — would be created by new-window -t. Treat as available.
  return true;
}

function spawnTmuxResume(
  agentsRoot: string,
  id: string,
  spawn: (cmd: string, args: string[]) => { status: number | null; error?: Error },
): { ok: boolean; error?: string } {
  const spec = buildResumeCommand(agentsRoot, id);
  const r = spawn("tmux", ["new-window", "-t", `${spec.session}:`, "-n", spec.window, spec.cmd]);
  if (r.error || r.status !== 0) {
    return { ok: false, error: r.error ? r.error.message : `tmux exited ${r.status}` };
  }
  return { ok: true };
}

/** Injectable dependencies for `takeAction` — production wraps node primitives. */
export interface TakeActionDeps {
  /** Spawn used for tmux availability check AND tmux new-window resume. */
  spawn: (cmd: string, args: string[]) => { status: number | null; error?: Error };
  /** Pid identity probe — used for the pre-resume recheck (Gap #3 mitigation). */
  isSameProcess: PidIdentityProbe;
}

const defaultTakeActionDeps: TakeActionDeps = {
  spawn: (cmd, args) => {
    const r = spawnSync(cmd, args, { stdio: "ignore", timeout: 5_000 });
    return { status: r.status, error: r.error ?? undefined };
  },
  isSameProcess: isSameProcessProduction,
};

/**
 * Take action on a single classification. Returns the action taken for logging.
 * In dry-run mode (--once), the caller short-circuits before calling this.
 *
 * Pre-resume pid identity recheck (SPEC-066 edge case "Watchdog launches a
 * resume while a human is also resuming"): for `stale-dead`, re-read state and
 * re-probe `isSameProcess` immediately before spawning tmux. If the
 * orchestrator identity is suddenly alive again (a human resumed in the gap
 * between classify and action), emit a `pid-revived` alarm and skip the resume.
 * This prevents duplicate concurrent orchestrators on the same workspace.
 */
export function takeAction(
  status: WorkspaceStatus,
  agentsRoot: string,
  maxResumes: number,
  now: number,
  deps: TakeActionDeps = defaultTakeActionDeps,
): { action: "resume" | "alarm" | "noop"; detail?: string } {
  if (status.kind === "stale-dead") {
    const id = status.id;
    const counterPath = resumeCounterPath(agentsRoot, id);
    const counter = readResumeCounter(counterPath, now);
    if (counter.count >= maxResumes) {
      appendWatchdogEvent(agentsRoot, id, {
        action: "alarm",
        kind: "resume-limit",
        count: counter.count,
        max: maxResumes,
      });
      notify("resume-limit", `workspace ${id} hit resume cap (${counter.count}/${maxResumes})`);
      return { action: "alarm", detail: "resume-limit" };
    }
    // Pre-resume pid identity recheck: re-read state and re-probe. If the
    // orchestrator identity is alive again, a human (or another watchdog pass)
    // resumed in the gap — emit `pid-revived` and skip to avoid duplicate.
    const revived = readOrchestratorIdentity(agentsRoot, id);
    if (
      revived.pid !== null &&
      revived.startedAtMs !== null &&
      deps.isSameProcess(revived.pid, revived.startedAtMs)
    ) {
      appendWatchdogEvent(agentsRoot, id, {
        action: "alarm",
        kind: "pid-revived",
        orchestrator_pid: revived.pid,
      });
      notify("pid-revived", `workspace ${id} orchestrator ${revived.pid} revived post-classify — skipping resume`);
      return { action: "alarm", detail: "pid-revived" };
    }
    if (!tmuxAvailable(deps.spawn)) {
      appendWatchdogEvent(agentsRoot, id, { action: "alarm", kind: "tmux-missing" });
      notify("tmux-missing", `cannot resume ${id} — tmux not installed or no tmax session`);
      return { action: "alarm", detail: "tmux-missing" };
    }
    const r = spawnTmuxResume(agentsRoot, id, deps.spawn);
    if (!r.ok) {
      appendWatchdogEvent(agentsRoot, id, { action: "alarm", kind: "tmux-spawn-failed", error: r.error });
      notify("tmux-spawn-failed", `failed to resume ${id}: ${r.error}`);
      return { action: "alarm", detail: "tmux-spawn-failed" };
    }
    const next: ResumeCounter = { count: counter.count + 1, window_start: counter.window_start };
    writeResumeCounter(counterPath, next);
    appendWatchdogEvent(agentsRoot, id, {
      action: "resume",
      count: next.count,
      max: maxResumes,
      orchestrator_pid: status.orchestratorPid,
    });
    return { action: "resume", detail: `count=${next.count}/${maxResumes}` };
  }
  if (status.kind === "stale-alive") {
    const id = status.id;
    appendWatchdogEvent(agentsRoot, id, {
      action: "alarm",
      kind: "stuck-alive",
      orchestrator_pid: status.orchestratorPid,
      last_activity_ms: status.lastActivityMs,
    });
    notify("stuck-alive", `workspace ${id} stale but orchestrator ${status.orchestratorPid} alive — investigate`);
    return { action: "alarm", detail: "stuck-alive" };
  }
  return { action: "noop" };
}

/** Read orchestrator_pid + orchestrator_started_at_ms from a workspace state. */
function readOrchestratorIdentity(agentsRoot: string, id: string): { pid: number | null; startedAtMs: number | null } {
  try {
    const state = JSON.parse(readFileSync(join(agentsRoot, id, "adw-state.json"), "utf8")) as Record<string, unknown>;
    return {
      pid: typeof state.orchestrator_pid === "number" ? state.orchestrator_pid : null,
      startedAtMs: typeof state.orchestrator_started_at_ms === "number" ? state.orchestrator_started_at_ms : null,
    };
  } catch {
    return { pid: null, startedAtMs: null };
  }
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

/** Scan all workspaces under agentsRoot; classify each. */
export function scanAll(
  classify: (statePath: string, now: number, staleMs: number) => WorkspaceStatus,
  agentsRoot: string,
  now: number,
  staleMs: number,
): WorkspaceStatus[] {
  const ids = listWorkspaces(agentsRoot);
  const out: WorkspaceStatus[] = [];
  for (const id of ids) {
    const statePath = join(agentsRoot, id, "adw-state.json");
    if (!existsSync(statePath)) continue;
    out.push(classify(statePath, now, staleMs));
  }
  return out;
}

function formatRow(s: WorkspaceStatus, now: number): string {
  const ageSec = Math.floor((now - (s as { lastActivityMs?: number }).lastActivityMs!) / 1000);
  const ageStr = isNaN(ageSec) ? "?" : `${Math.floor(ageSec / 60)}m${ageSec % 60}s`;
  switch (s.kind) {
    case "healthy":
      return `${s.id}  healthy            (age ${ageStr})`;
    case "stale-dead":
      return `${s.id}  stale-dead         (age ${ageStr}, pid ${s.orchestratorPid ?? "—"}) → resume`;
    case "stale-alive":
      return `${s.id}  stale-alive        (age ${ageStr}, pid ${s.orchestratorPid}) → alarm`;
    case "not-running":
      return `${s.id}  not-running        (status=${s.status})`;
    case "not-resumable-failed":
      return `${s.id}  not-resumable-failed`;
  }
}

/** Run a single poll pass. In --once mode, prints + exits without side effects. */
function runPass(opts: WatchdogArgs, classify: (statePath: string, now: number, staleMs: number) => WorkspaceStatus): void {
  const agentsRoot = resolveAgentsRoot(opts.agentsRoot);
  const now = Date.now();
  const results = scanAll(classify, agentsRoot, now, opts.staleMs);

  if (results.length === 0) {
    process.stdout.write(`[adw-watchdog] no workspaces under ${agentsRoot}\n`);
  } else {
    process.stdout.write(`[adw-watchdog] ${results.length} workspace(s) under ${agentsRoot}:\n`);
    for (const s of results) {
      process.stdout.write(`  ${formatRow(s, now)}\n`);
    }
  }

  if (opts.once) {
    process.stdout.write(`[adw-watchdog] --once → dry-run, no side effects\n`);
    return;
  }

  for (const s of results) {
    takeAction(s, agentsRoot, opts.maxResumes, now);
  }
}

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (Either.isLeft(parsed)) {
    if (parsed.left.startsWith("__help__:")) {
      process.stdout.write(parsed.left.slice("__help__:".length) + "\n");
      return Promise.resolve(0);
    }
    process.stderr.write(`Error: ${parsed.left}\n`);
    return Promise.resolve(1);
  }

  const opts = parsed.right;
  const agentsRoot = resolveAgentsRoot(opts.agentsRoot);
  const classify = makeClassifier({
    agentsRoot,
    stageStaleMs: opts.stageStaleMs,
    maxResumes: opts.maxResumes,
    isSameProcess: isSameProcessProduction,
  });

  process.stderr.write(
    `[adw-watchdog] starting — poll ${opts.pollMs}ms, stale ${opts.staleMs}ms, ` +
    `max-resumes ${opts.maxResumes}/24h, agents-root ${agentsRoot}${opts.once ? ", --once" : ""}\n`,
  );

  if (opts.once) {
    runPass(opts, classify);
    return Promise.resolve(0);
  }

  // Long-lived poll loop. Survives across pipeline runs.
  const loop = () => {
    try {
      runPass(opts, classify);
    } catch (e) {
      process.stderr.write(`[adw-watchdog] poll error: ${(e as Error).message}\n`);
    }
  };
  loop();
  setInterval(loop, opts.pollMs);
  // Never resolves — the loop runs forever. tmux window kill is the exit path.
  return new Promise<number>(() => { /* until killed */ });
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
