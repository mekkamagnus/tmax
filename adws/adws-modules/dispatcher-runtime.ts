/**
 * dispatcher-runtime.ts — CHORE-44 Change 8: shared ADW dispatcher infrastructure.
 *
 * ONE implementation of the primitives that every adw stage script and
 * orchestrator previously duplicated:
 *
 *   - `adwId()`                       — ULID-timestamp workspace id minting.
 *   - `appendEvent(...)`              — append one JSONL event line (atomic, sync).
 *   - `writeState(...)`               — atomic write of `adw-state.json`.
 *   - `run(...)` / `runCapture(...)`  — TaskEither-wrapped subprocess capture.
 *   - `spawnStage(...)`               — orchestrator → child stage subprocess.
 *   - `tokensOf(...)`                 — last-stdout-line token parser.
 *   - `readWorkspaceState(...)`       — load agents/{id}/adw-state.json.
 *   - `recoverSpecPathFromEvents(...)`— scan orchestrator/events.jsonl backward.
 *
 * Plus the canonical `ADW_ID_RE` / `CROCKFORD` constants and re-exports of the
 * spec-path resolution helpers from ./workspace.ts (single source of truth).
 *
 * Bodies are moved verbatim from the stage scripts + orchestrators; where the
 * copies differed slightly (stage-style `appendEvent(id, agent, event)` vs
 * orchestrator-style `appendEvent(id, event, agentsDir)`) the unified signature
 * takes every dependency explicitly and the stage scripts/orchestrators adapt
 * via thin wrappers. No globals, no service locator.
 *
 * Behavior is identical to the pre-refactor per-script implementations — every
 * call site preserves its on-disk artifacts (state JSON keys, event JSONL
 * lines, ordering, exit codes). Verified by the ADW test suite
 * (`bun run test:adw`, 14 files).
 */
import { spawn } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "path";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import { formatToolUseLine } from "./live-filter.ts";

// Re-export spec-path resolution so callers have one canonical import surface.
export { findWorkspaceBySpecPath, normalizeSpecPath, type NormalizedSpecPath } from "./workspace.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 10-char Crockford Base32 ULID-timestamp — the workspace id shape. */
export const ADW_ID_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/** Crockford Base32 alphabet (excludes I, L, O, U to avoid confusion with 1/0/V). */
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// ---------------------------------------------------------------------------
// adwId() — ULID timestamp portion (10 chars)
// ---------------------------------------------------------------------------

/** ULID timestamp portion: 48-bit ms-since-epoch → 10 chars Crockford Base32. */
export function adwId(): string {
  let ms = Date.now();
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[ms & 31]! + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

// ---------------------------------------------------------------------------
// appendEvent — append one JSONL event line to agents/{id}/{agent}/events.jsonl
// ---------------------------------------------------------------------------

/**
 * Append a single lifecycle event as one JSON line to the agent's events file.
 * Sync, append-only — survives crashes. Each event is on disk immediately.
 *
 * `agent` selects the subdirectory (e.g. "planner", "reviewer", "orchestrator").
 * For orchestrator event streams callers pass `agent: "orchestrator"`.
 *
 * The `ts` timestamp is prepended so the on-disk line shape stays
 * `{ ts, ...event }` — identical to every pre-refactor caller.
 */
export function appendEvent(
  agentsDir: string,
  id: string,
  agent: string,
  event: Record<string, unknown>,
): void {
  const dir = join(agentsDir, id, agent);
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  appendFileSync(join(dir, "events.jsonl"), line);
}

// ---------------------------------------------------------------------------
// writeState — atomic write of agents/{id}/adw-state.json
// ---------------------------------------------------------------------------

export interface WriteStateResult {
  /** Absolute path that was written. */
  path: string;
}

/**
 * Write the run-state file (id, description, type, status — no events).
 *
 * Atomic write semantics: build the JSON string, then `writeFile` truncates +
 * replaces in one syscall. Called at most twice per stage: after start and
 * after result/error. The directory is created if missing.
 */
export function writeState(
  agentsDir: string,
  id: string,
  state: Record<string, unknown>,
): TaskEither<string, WriteStateResult> {
  return TaskEither.tryCatch(async () => {
    const dir = join(agentsDir, id);
    await mkdir(dir, { recursive: true });
    const path = join(dir, "adw-state.json");
    await writeFile(path, JSON.stringify(state, null, 2) + "\n");
    return { path };
  }, (e) => `writeState: ${(e as Error).message}`);
}

// ---------------------------------------------------------------------------
// run / runCapture — TaskEither-wrapped subprocess capture (stage scripts)
// ---------------------------------------------------------------------------

export interface RunOpts {
  cwd?: string;
  env?: Record<string, string>;
}

export interface RawRunResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunRawOpts extends RunOpts {
  /** Make the child a process-group leader so timeout cleanup reaches descendants. */
  detached?: boolean;
  /** Optional wall-clock ceiling. Omit for long-running LLM audit calls. */
  timeoutMs?: number;
  /** Optional streamed stdout destination. */
  teeTo?: string;
  /** Optional live tool-use filter label for streamed stdout. */
  liveLabel?: string;
  /** Text appended to stderr when the timeout fires. */
  timeoutMessage?: string;
}

/**
 * Canonical drain-safe subprocess capture implementation.
 *
 * Non-zero exits and timeouts are returned as `Right<RawRunResult>` so callers
 * that parse test output retain the exit code and complete stdout/stderr.
 * Spawn/setup failures are `Left`. When a timeout is configured, a detached
 * child is killed as a process group to avoid orphaned Bun grandchildren.
 */
export function runRaw(cmd: string, args: string[], opts: RunRawOpts = {}): TaskEither<string, RawRunResult> {
  return TaskEither.from(async () => {
    return await new Promise<Either<string, RawRunResult>>((resolve) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
        ...(opts.detached ? { detached: true } : {}),
      });
      let stdout = "";
      let stderr = "";
      let teeBuffer = "";
      let settled = false;
      let processClosed = false;
      let stdoutEnded = false;
      let stderrEnded = false;
      let exitCode = -1;

      const emitTeeLine = (line: string): void => {
        if (opts.teeTo) {
          try { appendFileSync(opts.teeTo, line); } catch { /* best effort */ }
        }
        if (opts.liveLabel) {
          try {
            const filtered = formatToolUseLine(opts.liveLabel, line.trimEnd());
            if (filtered) process.stderr.write(filtered + "\n");
          } catch { /* best effort */ }
        }
      };

      const flushTee = (): void => {
        if (teeBuffer.length === 0) return;
        emitTeeLine(teeBuffer);
        teeBuffer = "";
      };

      const timer = opts.timeoutMs
        ? setTimeout(() => {
          if (settled) return;
          settled = true;
          if (opts.detached && child.pid) {
            try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
          } else {
            try { child.kill("SIGKILL"); } catch { /* gone */ }
          }
          flushTee();
          const message = opts.timeoutMessage ?? `${cmd} ${args.join(" ")} timed out after ${opts.timeoutMs}ms`;
          resolve(Either.right({ ok: false, exitCode: -1, stdout, stderr: stderr + `\n${message}\n` }));
        }, opts.timeoutMs)
        : undefined;

      const trySettle = (): void => {
        if (settled || !processClosed || !stdoutEnded || !stderrEnded) return;
        settled = true;
        if (timer) clearTimeout(timer);
        flushTee();
        resolve(Either.right({ ok: exitCode === 0, exitCode, stdout, stderr }));
      };

      child.stdout.on("data", (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        stdout += text;
        if (!opts.teeTo && !opts.liveLabel) return;
        teeBuffer += text;
        let newline: number;
        while ((newline = teeBuffer.indexOf("\n")) >= 0) {
          emitTeeLine(teeBuffer.slice(0, newline + 1));
          teeBuffer = teeBuffer.slice(newline + 1);
        }
      });
      child.stdout.on("end", () => { stdoutEnded = true; trySettle(); });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.stderr.on("end", () => { stderrEnded = true; trySettle(); });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(Either.left(`failed to spawn ${cmd}: ${error.message}`));
      });
      child.on("close", (code) => {
        if (settled) return;
        processClosed = true;
        exitCode = code ?? -1;
        trySettle();
      });
    });
  });
}

/**
 * Spawn, capture stdout/stderr. Returns TaskEither (lazy, composable).
 * Left = non-zero exit (error = stderr||stdout); Right = trimmed stdout.
 *
 * Identical to the per-stage `run()` helper pre-refactor.
 */
export function run(cmd: string, args: string[], opts: RunOpts = {}): TaskEither<string, string> {
  return runRaw(cmd, args, opts).flatMap((result) => result.ok
    ? TaskEither.right<string, string>(result.stdout.trim())
    : TaskEither.left<string, string>((result.stderr || result.stdout).trim() || `${cmd} exited with code ${result.exitCode}`));
}

/**
 * runCapture: like run, but tees stdout to `teeTo` path line-by-line as it
 * arrives (via sync appendFileSync — acceptable for line-at-a-point small
 * writes that must survive a crash). Returns TaskEither (lazy).
 *
 * When `liveLabel` is set, each complete line is also passed through
 * `formatToolUseLine` and the filtered tool-use summary is emitted to stderr
 * so an orchestrated run shows live progress. The union of the per-script
 * signatures (some had liveLabel, some didn't) collapses to "always optional".
 */
export function runCapture(
  cmd: string,
  args: string[],
  opts: RunRawOpts & { teeTo: string },
): TaskEither<string, string> {
  return runRaw(cmd, args, opts).flatMap((result) => result.ok
    ? TaskEither.right<string, string>(result.stdout.trim())
    : TaskEither.left<string, string>((result.stderr || result.stdout).trim() || `${cmd} exited with code ${result.exitCode}`));
}

// ---------------------------------------------------------------------------
// spawnStage — orchestrator spawns a child stage subprocess
// ---------------------------------------------------------------------------

export interface SpawnStageOpts {
  /** Absolute project root — the child is spawned with `cwd` here. */
  projectRoot: string;
  /**
   * SPEC-065: when set, the child receives `ADW_WORKTREE=<path>` so its
   * spec-path resolution + git operations target the worktree. Only the
   * 5-stage orchestrator sets this.
   */
  worktreePath?: string;
  /**
   * 5-stage orchestrator spawns `detached: true` so child.pid is the
   * process-group leader → killTree(-pid) reaches all descendants. Off for
   * the 2/3-stage orchestrators (preserves their existing behavior).
   */
  detached?: boolean;
}

/**
 * Spawn a child stage (`bun adws/<script> --id <id> <args>`), inherit stderr
 * so the user sees live progress, capture stdout for the machine-readable
 * `<id> <…> <spec-path>` result line. Sets `ADW_ORCHESTRATED=1` so the child
 * skips writing its own adw-state.json (the orchestrator owns the workspace
 * state — the single-state-file contract).
 */
export function spawnStage(
  script: string,
  args: string[],
  opts: SpawnStageOpts,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn("bun", [join("adws", script), ...args], {
    cwd: opts.projectRoot,
    env: {
      ...process.env,
      ADW_ORCHESTRATED: "1",
      ...(opts.worktreePath ? { ADW_WORKTREE: opts.worktreePath } : {}),
    },
    stdio: ["ignore", "pipe", "inherit"], // stdout captured, stderr shown live
    ...(opts.detached ? { detached: true } : {}),
  });
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer | string) => {
    stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  });
  return new Promise((resolve) => {
    child.on("error", () => resolve({ code: 1, stdout, stderr: `failed to spawn ${script}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: "" }));
  });
}

// ---------------------------------------------------------------------------
// tokensOf — parse the last non-empty stdout line as space-separated tokens
// ---------------------------------------------------------------------------

/** Parse the last non-empty stdout line as space-separated tokens. */
export function tokensOf(stdout: string): string[] | null {
  const lines = stdout.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;
  return lines[lines.length - 1]!.trim().split(/\s+/);
}

// ---------------------------------------------------------------------------
// Workspace state recovery — shared by the orchestrators' loadWorkspace
// ---------------------------------------------------------------------------

/** Workspace state on-disk shape (read by loadWorkspace; new fields optional). */
export interface WorkspaceState {
  adw_id: string;
  description?: string;
  status?: "running" | "completed" | "failed" | "planned" | "setup";
  agents?: string[];
  failed_stage?: string;
  completed_stages?: string[];
  spec_path?: string;
  error?: string;
  // 5-stage orchestrator fields (absent on 2/3-stage state files).
  base_sha?: string;
  worktree_path?: string;
  branch?: string;
  orchestrator_pid?: number;
  patch_iterations?: number;
  /** Alias some 5-stage state files use for patch_iterations. */
  patch_review_iterations?: number;
  patch_review_next_action?: "build" | "patch-review";
  patch_review_verdict?: string;
  goal_condition?: string;
  /** SPEC-065: implementation commit SHA after a successful build (or null when worktree was clean). */
  implementation_commit?: string | null;
  /** SPEC-065: remote host when dispatched via --remote. */
  host?: string;
  /** SPEC-065: timestamp (ISO) when --setup-only finished (for dashboard derivation). */
  setup_completed_at?: string;
}

/**
 * Read agents/{id}/adw-state.json; Left if missing or unparseable.
 *
 * Generic over the `StageName` union so each orchestrator can narrow the
 * `completed_stages` / `failed_stage` interpretation in its own `loadWorkspace`.
 */
export function readWorkspaceState(
  agentsDir: string,
  id: string,
): Either<string, WorkspaceState> {
  const stateFile = join(agentsDir, id, "adw-state.json");
  if (!existsSync(stateFile)) return Either.left(`no workspace agents/${id}/adw-state.json — nothing to resume`);
  const parsed = Either.tryCatch(() => JSON.parse(readFileSync(stateFile, "utf8")) as WorkspaceState);
  return Either.mapLeft(parsed, (e) => `failed to parse agents/${id}/adw-state.json: ${(e as Error).message}`);
}

/**
 * Recover the specPath from the orchestrator event log when the state file
 * doesn't have a `spec_path` field. Scans events.jsonl backward for the last
 * `stage-complete` event carrying a non-null spec_path.
 */
export function recoverSpecPathFromEvents(agentsDir: string, id: string): string | null {
  const eventsFile = join(agentsDir, id, "orchestrator", "events.jsonl");
  if (!existsSync(eventsFile)) return null;
  const lines = readFileSync(eventsFile, "utf8").split("\n").filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const d = JSON.parse(lines[i]!) as Record<string, unknown>;
      if (d.event === "stage-complete" && typeof d.spec_path === "string" && d.spec_path) {
        return d.spec_path as string;
      }
    } catch { /* malformed line — skip */ }
  }
  return null;
}
