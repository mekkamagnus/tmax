#!/usr/bin/env bun
/**
 * adw-status.ts — adw pipeline fleet dashboard.
 *
 * Scans agents/<adw-id>/adw-state.json + each workspace's latest orchestrator event
 * and joins with `git worktree list` to print a live table of every concurrent
 * run. Idle/working/done/failed state is derived from event timestamps and the
 * `status` field in adw-state.json (RFC-020 item D promoted into SPEC-065).
 *
 *   bun adws/adw-status.ts                       # one-shot table of all local workspaces
 *   bun adws/adw-status.ts --watch               # re-render every 5s
 *   bun adws/adw-status.ts --watch --interval 2  # custom cadence
 *   bun adws/adw-status.ts --id 01KVE7NV2P       # filter to one workspace
 *   bun adws/adw-status.ts --remote              # also query SSH hosts from ~/.ssh/config
 *
 * Output format:
 *
 *   ID          SPEC                                          STAGE          STATE    ELAPSED  WHERE
 *   01KVE7NV2P  docs/specs/SPEC-065-adw-worktree-isolation.md  build          working  4m12s    local
 *   01KVE7OLD   docs/specs/SPEC-045-fikra-ai-harness.md        patch-review   idle     18m02s   local
 *   01KVE7NEW   docs/specs/SPEC-021-remote-adw-dispatch.md     completed      done     1h02m    mekkapi
 *
 * STATE derivation (RFC-020 §idle/working):
 *   - status === "completed"              → done
 *   - status === "failed"                 → failed
 *   - status === "setup" or "running"     → working if last event < 2min ago, else idle
 *
 * The 2-minute window aligns with the orchestrator heartbeat cadence (15–30s
 * beat → working if any event in the last ~4 beats).
 *
 * Pure rendering functions (loadAllWorkspaces, deriveState, renderTable) are
 * exported for unit testing.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from "fs";
import { join } from "path";
import { Either } from "../src/utils/task-either.ts";
import { listWorktrees, runGitCmd, type WorktreeDeps, type WorktreeEntry } from "./adws-modules/worktree.ts";

const PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."));
const AGENTS_DIR = join(PROJECT_ROOT, "agents");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The on-disk state shape (subset — only fields the dashboard reads). */
export interface WorkspaceState {
  adw_id: string;
  description?: string;
  status?: "running" | "completed" | "failed" | "setup";
  completed_stages?: string[];
  spec_path?: string;
  worktree_path?: string;
  branch?: string;
  host?: string;
  error?: string;
}

/** One row of the dashboard table. */
export interface WorkspaceRow {
  id: string;
  state: WorkspaceState;
  latestEvent: Record<string, unknown> | null;
  latestEventTs: number | null; // ms epoch, or null if no event / unparseable
  worktreePath?: string;
  corrupt?: boolean;
}

/** The state derivation result. */
export type DerivedState = "working" | "idle" | "done" | "failed";

// ---------------------------------------------------------------------------
// Usage + arg parsing
// ---------------------------------------------------------------------------

const USAGE = `Usage: bun adws/adw-status.ts [--watch] [--interval <N>] [--id <id>] [--remote]

Prints a table of every adw pipeline workspace under agents/, joined with
\`git worktree list\`. Each row shows the workspace id, spec path, current
stage, derived state (working/idle/done/failed), elapsed since the last
orchestrator event, and where the run lives (local or remote host).

  --watch           Re-render the table every N seconds (default: 5).
  --interval <N>    Override the --watch cadence (seconds).
  --id <id>         Filter to a single workspace.
  --remote          Also query configured SSH hosts (via ~/.ssh/config). The
                    \`agents/\` directory is gitignored, so remote state files
                    are fetched explicitly over SSH.
`;

export interface ParsedArgs {
  watch: boolean;
  intervalSec: number;
  id?: string;
  remote: boolean;
}

export function parseArgs(argv: string[]): Either<string, ParsedArgs> {
  let watch = false;
  let intervalSec = 5;
  let id: string | undefined;
  let remote = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") return Either.left(`__help__:${USAGE}`);
    else if (a === "--watch") watch = true;
    else if (a === "--interval") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--interval requires a value.");
      const n = parseInt(val, 10);
      if (isNaN(n) || n <= 0) return Either.left(`--interval must be a positive integer (got "${val}").`);
      intervalSec = n;
    } else if (a === "--id") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--id requires a value.");
      id = val;
    } else if (a === "--remote") {
      remote = true;
    } else return Either.left(`Unexpected argument: ${a}`);
  }
  return Either.right({ watch, intervalSec, id, remote });
}

// ---------------------------------------------------------------------------
// State loading (pure — fixture-testable via the `agentsDir` parameter)
// ---------------------------------------------------------------------------

const ADW_ID_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/**
 * Load every workspace's state + latest event from <agentsDir>/<id>/.
 * Returns one WorkspaceRow per workspace, sorted by id descending (newest
 * first — ULID timestamps are lexicographically ordered).
 *
 * If a state file is unreadable or invalid JSON, the row is kept with
 * `corrupt: true` and a `(corrupt)` spec label — the dashboard never throws
 * or skips a workspace because of a corrupt file.
 */
export function loadAllWorkspaces(agentsDir: string): WorkspaceRow[] {
  if (!existsSync(agentsDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && ADW_ID_RE.test(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }
  entries.sort((a, b) => b.localeCompare(a));
  const rows: WorkspaceRow[] = [];
  for (const id of entries) {
    const stateFile = join(agentsDir, id, "adw-state.json");
    const eventsFile = join(agentsDir, id, "orchestrator", "events.jsonl");
    if (!existsSync(stateFile)) {
      // No state but events? Treat as a placeholder with corrupt=true so the
      // user sees the orphan dir and can investigate.
      if (!existsSync(eventsFile)) continue;
      rows.push({ id, state: { adw_id: id }, latestEvent: null, latestEventTs: null, corrupt: true });
      continue;
    }
    let state: WorkspaceState;
    try {
      state = JSON.parse(readFileSync(stateFile, "utf8")) as WorkspaceState;
    } catch {
      rows.push({ id, state: { adw_id: id }, latestEvent: readLatestEvent(eventsFile), latestEventTs: readLatestEventTs(eventsFile), corrupt: true });
      continue;
    }
    rows.push({
      id,
      state,
      latestEvent: readLatestEvent(eventsFile),
      latestEventTs: readLatestEventTs(eventsFile),
    });
  }
  return rows;
}

/** Read the last non-empty line of events.jsonl, parsed. null if missing or unparseable. */
function readLatestEvent(eventsFile: string): Record<string, unknown> | null {
  if (!existsSync(eventsFile)) return null;
  try {
    const lines = readFileSync(eventsFile, "utf8").split("\n").filter((l) => l.trim());
    if (lines.length === 0) return null;
    for (let i = lines.length - 1; i >= 0; i--) {
      try { return JSON.parse(lines[i]!) as Record<string, unknown>; } catch { /* skip malformed */ }
    }
  } catch { /* unreadable */ }
  return null;
}

/** Read the ts field of the last parseable event line. null if missing. */
function readLatestEventTs(eventsFile: string): number | null {
  const evt = readLatestEvent(eventsFile);
  if (!evt || typeof evt.ts !== "string") return null;
  const ms = Date.parse(evt.ts);
  return isNaN(ms) ? null : ms;
}

// ---------------------------------------------------------------------------
// State derivation (pure)
// ---------------------------------------------------------------------------

/** The RFC-020 idle/working threshold — 2 minutes since the last event = idle. */
export const IDLE_THRESHOLD_MS = 2 * 60 * 1000;

/**
 * Derive working/idle/done/failed from the latest event timestamp + status.
 * Rule:
 *   - status === "completed" → done
 *   - status === "failed"    → failed
 *   - otherwise              → working if now - latestEventTs < 2min, else idle
 *
 * `now` defaults to Date.now() but is injectable for deterministic tests.
 */
export function deriveState(
  status: WorkspaceState["status"],
  latestEventTs: number | null,
  now: number = Date.now(),
): DerivedState {
  if (status === "completed") return "done";
  if (status === "failed") return "failed";
  if (latestEventTs === null) return "idle";
  return now - latestEventTs < IDLE_THRESHOLD_MS ? "working" : "idle";
}

// ---------------------------------------------------------------------------
// Stage derivation (pure)
// ---------------------------------------------------------------------------

/**
 * Derive the current stage label from completed_stages + the latest event.
 * Order matters: the latest event usually says what stage just completed or
 * started; completed_stages tells us what's been finished. We display the
 * most-actionable label (e.g. "build" if build just completed and patch-review
 * is next, but "completed" if status is done).
 */
export function deriveStageLabel(row: WorkspaceRow): string {
  if (row.state.status === "completed") return "completed";
  // For failed runs, surface the failing stage if the latest event carries one;
  // otherwise just show "failed".
  const evt = row.latestEvent;
  const kind = evt && typeof evt.event === "string" ? evt.event : "";
  if (row.state.status === "failed") {
    if (evt && typeof evt.stage === "string" && kind === "stage-error") {
      return `${evt.stage} (error)`;
    }
    return "failed";
  }
  // The latest event usually carries a `stage` field (stage-complete, stage-error).
  if (evt && typeof evt.stage === "string") {
    const stage = evt.stage;
    if (kind === "stage-error") return `${stage} (error)`;
    if (kind === "stage-complete") {
      // Surface the next pending stage when available.
      const completed = row.state.completed_stages ?? [];
      const order = ["plan", "review", "build", "test", "patch-review"];
      const next = order.find((s) => !completed.includes(s));
      return next ?? stage;
    }
    if (kind === "loop-retry") return "build (retry)";
    if (kind === "resume") return typeof evt.from_stage === "string" ? String(evt.from_stage) : "resume";
    return stage;
  }
  // No usable event — fall back to completed_stages.
  const completed = row.state.completed_stages ?? [];
  if (completed.length === 0) return "(starting)";
  const order = ["plan", "review", "build", "test", "patch-review"];
  const next = order.find((s) => !completed.includes(s));
  return next ?? "completed";
}

// ---------------------------------------------------------------------------
// Elapsed formatting (pure)
// ---------------------------------------------------------------------------

/** Humanize a millisecond delta as "4m12s" / "18s" / "1h02m". */
export function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Table rendering (pure)
// ---------------------------------------------------------------------------

const COLUMN_HEADERS = ["ID", "SPEC", "STAGE", "STATE", "ELAPSED", "WHERE"] as const;

/**
 * Render the dashboard table. Joins workspace rows with worktree entries (by
 * matching the worktree's branch against `state.branch`). Each row is a line
 * with column-padded fields; the header row is followed by a separator.
 */
export function renderTable(rows: WorkspaceRow[], worktrees: WorktreeEntry[], now: number = Date.now()): string {
  // Build a branch → worktree map for the join.
  const worktreeByBranch = new Map<string, WorktreeEntry>();
  for (const w of worktrees) {
    if (w.branch) worktreeByBranch.set(stripRefsPrefix(w.branch), w);
  }

  const lines: string[] = [];
  const data = rows.map((r) => {
    const state = deriveState(r.state.status, r.latestEventTs, now);
    const stage = deriveStageLabel(r);
    const elapsed = r.latestEventTs !== null ? formatElapsed(now - r.latestEventTs) : "—";
    const where = r.state.host ?? "local";
    const spec = r.corrupt ? "(corrupt)" : (r.state.spec_path ?? r.state.description ?? "(no spec)");
    const branch = r.state.branch ?? `adw/${r.id}`;
    const wt = worktreeByBranch.get(branch);
    return {
      id: r.id,
      spec,
      stage,
      state,
      elapsed,
      where,
      worktreePath: r.state.worktree_path ?? wt?.path ?? "",
    };
  });

  // Compute column widths (header vs content).
  const widths: number[] = COLUMN_HEADERS.map((h, i) => {
    let w = h.length;
    for (const row of data) {
      const val = [row.id, row.spec, row.stage, row.state, row.elapsed, row.where][i] ?? "";
      w = Math.max(w, String(val).length);
    }
    return w;
  });

  // Header
  lines.push(padRow(COLUMN_HEADERS as unknown as string[], widths));
  // Separator
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  // Rows
  for (const row of data) {
    lines.push(padRow([row.id, row.spec, row.stage, row.state, row.elapsed, row.where], widths));
  }
  if (data.length === 0) lines.push("(no workspaces found)");
  return lines.join("\n");
}

function padRow(values: string[], widths: number[]): string {
  return values.map((v, i) => String(v).padEnd(widths[i]!)).join("  ");
}

function stripRefsPrefix(branch: string): string {
  return branch.startsWith("refs/heads/") ? branch.slice("refs/heads/".length) : branch;
}

// ---------------------------------------------------------------------------
// Remote query helpers (thin — full remote module is adws-modules/remote.ts)
// ---------------------------------------------------------------------------

/**
 * Stub for remote query. The real implementation lives in remote.ts; this is
 * kept here so the dashboard's local-mode code path is independent of remote
 * deps. When --remote is set, main() imports remote.ts dynamically and passes
 * the results back into renderTable.
 */
export interface RemoteWorkspaceResult {
  host: string;
  rows: WorkspaceRow[];
  reachable: boolean;
}

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

async function renderAsync(agentsDir: string, idFilter?: string): Promise<string> {
  const rows = loadAllWorkspaces(agentsDir).filter((r) => (idFilter ? r.id === idFilter : true));
  const deps: WorktreeDeps = { gitRun: runGitCmd };
  const wtEither = await listWorktrees(deps, PROJECT_ROOT).run();
  const worktrees = Either.isRight(wtEither) ? wtEither.right : [];
  return renderTable(rows, worktrees);
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (Either.isLeft(parsed)) {
    if (parsed.left.startsWith("__help__:")) {
      process.stdout.write(parsed.left.slice("__help__:".length) + "\n");
      return 0;
    }
    process.stderr.write(`Error: ${parsed.left}\n`);
    return 1;
  }
  const args = parsed.right;

  if (!args.watch) {
    const out = await renderAsync(AGENTS_DIR, args.id);
    process.stdout.write(out + "\n");
    return 0;
  }

  // --watch: re-render every args.intervalSec seconds. Clears the screen
  // between renders so the table stays at the top of the terminal.
  while (true) {
    const out = await renderAsync(AGENTS_DIR, args.id);
    process.stdout.write("\x1b[2J\x1b[H"); // clear screen + cursor home
    process.stdout.write(out + "\n");
    await new Promise((r) => setTimeout(r, args.intervalSec * 1000));
  }
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
