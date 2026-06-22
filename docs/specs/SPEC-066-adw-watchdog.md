# Feature: adw-watchdog — auto-detect and recover from silent pipeline stalls/crashes

## Feature Description

**adw-watchdog** adds a liveness monitor to the adw pipeline that detects silent failures the orchestrator currently misses, and recovers from them automatically. Two failure classes observed in production on workspace `01KVPRP6Y1` (BUG-16, 2026-06-22):

1. **Silent crash.** A stage's `claude -p` subprocess exits non-zero (e.g. patch-review's `exited with code 2` at 06:46). The orchestrator logs `stage-error` and writes `status: failed` to state — then **sits idle for 3h17m** until a human notices and runs `--resume`. No alarm fires.
2. **Silent stall.** The orchestrator logs `loop-retry → build` at 12:48, but the build's `claude -p` subprocess doesn't actually start until 20:48 — an **8-hour dead gap** with the orchestrator process alive but not dispatching. No heartbeat staleness is detected because no heartbeat is being written.

The watchdog closes both gaps by (a) wrapping every stage spawn with a liveness check that kills + retries a stalled/hung subprocess, and (b) running a separate lightweight monitor that watches the orchestrator's own event stream for gaps and, on a stale workspace, re-invokes `--resume` automatically.

This feature turns multi-hour silent hangs into bounded (~5 min) blips. On the BUG-16 run it would have saved ~11 hours of idle wall-clock.

## User Story

As a **developer who kicks off an adw pipeline and walks away**
I want to **have stalled or crashed stages detected and recovered automatically, with an audible/logged alarm when recovery itself fails**
So that **a 90-minute pipeline doesn't silently become a 9-hour pipeline because a subprocess died at minute 30.**

## Problem Statement

The pipeline has two layers of "is it still running?" and **neither acts**:

- **`withHeartbeat`** (`adws-modules/heartbeat.ts`) prints `[adw] <stage> running — Xm Ys elapsed, raw-output.jsonl +NKB since last beat` to stderr every 30s. It is purely observational: it reports byte-growth deltas but **never kills anything**, never alarms, never resumes. A heartbeat line that reads `+0B since last beat` for 30 consecutive beats (15 min) is indistinguishable to the system from a healthy stage between tool calls.
- **`spawnStage`** (`adw-plan-review-build-patch.ts:358`) awaits a child process and resolves on `close`. If the child exits non-zero, the orchestrator records `stage-error` + `status: failed` and **returns from `runPipeline`**. The pipeline is now parked. Nothing watches the parked state. The next event only fires when a human runs `--resume <id>`.

Meanwhile, the dispatch path between stages has no liveness check either: `runPipeline` calls `await deps.runBuild(...)` which calls `spawnStage("adw-build.ts", ...)`. If `adw-build.ts`'s own `claude -p` subprocess hangs (e.g. blocked on a sub-agent `TaskOutput` with a 10-min timeout that never returns — observed on BUG-16 retry 2), the `spawnStage` promise never resolves and the orchestrator hangs forever with no heartbeat growth.

There is no separate watchdog process. The orchestrator cannot monitor itself for stalls because a stalled orchestrator can't run its own monitor. This is the structural gap.

## Solution Statement

Add a two-layer watchdog:

**Layer 1 — per-stage stall detector (in-process).** Wrap `spawnStage` with a staleness monitor that tracks the stage's tee-file (`raw-output.jsonl`) byte growth. If the file hasn't grown by >N bytes in `STALL_TIMEOUT_MS` (default 5 min — generous, since `claude -p` between tool calls can pause briefly but not for 5 min), kill the child's process tree and let the orchestrator's existing retry/error path handle it. This converts an infinite hang into a fast failure that the `loop-retry` machinery already knows how to handle.

**Layer 2 — workspace watchdog (separate process).** A new `adws/adw-watchdog.ts` dispatcher that runs as a long-lived background process (launched by `adw-launch.ts` alongside the orchestrator). Every `WATCHDOG_POLL_MS` (default 60s) it scans `agents/*/adw-state.json` for workspaces whose `status` is `running` but whose newest event across all `events.jsonl` files is older than `WATCHDOG_STALE_MS` (default 10 min). For each stale workspace it:
  - Verifies the orchestrator process is actually dead (no live PID matching the workspace's recorded `orchestrator_pid`).
  - If dead → re-invokes `bun adws/adw-plan-review-build-patch.ts --resume <id>` in a fresh tmux window.
  - If alive but stale → writes an `alarm` event and emits a desktop notification (`osascript -e 'display notification...'` on macOS, `notify-send` on Linux, no-op elsewhere) so a human intervenes. Does NOT auto-kill a live-but-stuck orchestrator (too risky — could interrupt a genuinely long build).

Layer 2 is the safety net Layer 1 can't be: only an external process can detect that the orchestrator itself has parked.

## Relevant Files

Use these files to implement the feature:

### Existing Files to Read (reference)

- **`adws/adws-modules/heartbeat.ts`** — The existing observational heartbeat. The watchdog's staleness logic is the *actuative* counterpart to this file's *observational* reporting. Reuse `fmtElapsed`, `fmtBytes`, `tryStatSize` (export it). Do not duplicate the formatting helpers.
- **`adws/adw-plan-review-build-patch.ts`** — The orchestrator. `spawnStage` (line 358) is where Layer 1 wraps. `runPipeline` (line ~560) and the retry loop (lines 678-826) are the existing error/retry paths Layer 1 feeds into. `OrchestratorState` (line ~475) and `writeState` need a new `orchestrator_pid` field for Layer 2 to check liveness. `STAGE_ORDER` / `StageName` (lines 60-61) are the stage vocabulary.
- **`adws/adw-launch.ts`** — The tmux launcher. This is where Layer 2's watchdog process gets launched alongside the orchestrator (one extra `tmux new-window` or a `--watchdog` flag). Currently launches only the orchestrator script.
- **`adws/adw-build.ts`**, **`adws/adw-patch-review.ts`**, **`adws/adw-test.ts`** — Each dispatcher already wraps its `claude -p` call in `withHeartbeat` with a `teeFile`. Layer 1's staleness check reads these same tee files. No changes needed to the dispatchers themselves — Layer 1 operates at the `spawnStage` level in the orchestrator.

### Existing Files to Modify

- **`adws/adw-plan-review-build-patch.ts`** — Wrap `spawnStage` (line 358) in a `withStallWatch` that monitors the child's tee file and kills on staleness. Add `orchestrator_pid: process.pid` to the state written by `writeState` so Layer 2 can check liveness. Add an `alarm` event type to the event schema (or reuse `stage-error` with a new `kind: "stall"` discriminator).
- **`adws/adw-launch.ts`** — After launching the orchestrator window, optionally launch a watchdog window (`bun adws/adw-watchdog.ts --poll-ms 60000 --stale-ms 600000`). Gate behind a `--no-watchdog` flag for users who don't want a background daemon. Default: watchdog ON.
- **`docs/specs/SPECS_INDEX.md`** — Add SPEC-066 entry.

### New Files

- **`adws/adws-modules/stall-detector.ts`** — Layer 1. Pure, dependency-injected module: `withStallWatch<T>({ teeFile, stallMs, killTree, clock }, fn)`. Kills the spawned child's process tree if the tee file doesn't grow for `stallMs`. No `child_process` import (uses injected `killTree`). Fully unit-testable with a fake clock.
- **`adws/adw-watchdog.ts`** — Layer 2 dispatcher. CLI entry mirroring the other dispatchers' structure (`parseArgs`, `USAGE`, `main`, `import.meta.main`). Long-running poll loop: scan `agents/*/adw-state.json`, detect staleness, resume dead workspaces, alarm on live-but-stuck ones. Writes `agents/<id>/watchdog/events.jsonl`.
- **`test/unit/adw-watchdog.test.ts`** — Unit tests for both layers (stall-detector with fake clock; watchdog scan logic with a temp `agents/` dir).

## Implementation Plan

### Phase 1: Stall detector module (Layer 1)

Build `adws/adws-modules/stall-detector.ts` — a pure, injectable wrapper that monitors a tee file's growth and kills a process tree on staleness. This is the in-process defense against a hung `claude -p` subprocess inside a single stage.

### Phase 2: Watchdog dispatcher (Layer 2)

Build `adws/adw-watchdog.ts` — the external monitor that catches cases Layer 1 structurally cannot (orchestrator parked after `stage-error`, orchestrator itself hung). Scans workspaces, resumes dead ones, alarms on stuck ones.

### Phase 3: Integration

Wire Layer 1 into `spawnStage`, Layer 2 into `adw-launch.ts`, add `orchestrator_pid` to state, update the docs index.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Stall detector module — types and growth tracker

- Create `adws/adws-modules/stall-detector.ts`.
- Re-export `fmtElapsed`, `fmtBytes` from `heartbeat.ts` (do not duplicate).
- Define the injectable interface:
  ```ts
  export interface StallDetectorDeps {
    now(): number;                              // injectable clock
    setInterval(cb: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
    statSize(path: string): number | null;      // injectable file-size probe (wraps statSync)
    killTree(pid: number, signal?: string): void;  // injectable process-tree kill (wraps process.kill(-pid))
  }
  export interface StallWatchOptions {
    teeFile: string;
    stallMs?: number;          // default 300_000 (5 min) — a healthy claude -p never goes 5 min between writes
    minGrowthBytes?: number;   // default 64 — ignore sub-64B jitter; a real tool call writes KB
    pollMs?: number;           // default 30_000 — check every 30s (aligns with heartbeat)
    deps?: StallDetectorDeps;  // defaults to production impl
    onStall?: (info: { pid: number; stalledForMs: number; lastGrowthMs: number }) => void;  // alarm callback
  }
  ```
- Export `DEFAULT_STALL_MS = 300_000`, `DEFAULT_MIN_GROWTH_BYTES = 64`, `DEFAULT_POLL_MS = 30_000` as named consts.

### Step 2: Stall detector module — `withStallWatch` core

- Implement `withStallWatch<T>(opts: StallWatchOptions, childPid: number, fn: () => Promise<T>): Promise<T>`:
  - Track `lastGrowthTime = now()` and `lastSize = statSize(teeFile)`.
  - Every `pollMs`: read current size. If `currentSize - lastSize >= minGrowthBytes` → update `lastGrowthTime = now()`, `lastSize = currentSize`. Else if `now() - lastGrowthTime >= stallMs` → call `onStall`, then `deps.killTree(childPid, "SIGKILL")`, clear the interval, and let `fn` reject/resolve naturally (the killed child surfaces as a non-zero exit through `spawnStage`).
  - Always `clearInterval` in a `finally` (mirror `withHeartbeat`'s pattern).
  - The kill is one-shot: once fired, the watch stops. The orchestrator's existing retry/error path takes over.
- The function does NOT spawn the child — it takes `childPid` as a parameter. The caller (`spawnStage` integration in Step 7) spawns the child, knows its pid, and passes it in. This keeps the module pure and testable.

### Step 3: Stall detector — unit tests

- Create `test/unit/adw-watchdog.test.ts`.
- Inject a fake clock + fake `statSize` + fake `killTree` (record all calls).
- Test cases:
  - **No stall, steady growth:** fake file grows 1KB each poll → `withStallWatch` completes normally, `killTree` never called.
  - **Stall triggers kill:** file stops growing; after `stallMs` elapses (advance fake clock), `killTree` called with the right pid, `onStall` fired with correct `stalledForMs`.
  - **Sub-threshold jitter ignored:** file grows 10B/poll (below `minGrowthBytes`) → treated as no growth → kill fires after `stallMs`.
  - **Growth resets the stall timer:** file grows, stalls 4 min (under 5), grows again → no kill.
  - **Interval cleared on resolve:** `fn` resolves → `clearInterval` called (spy on `deps.clearInterval`).
  - **`onStall` callback receives accurate `lastGrowthMs`.**

### Step 4: Watchdog dispatcher — `adw-watchdog.ts` skeleton

- Create `adws/adw-watchdog.ts` mirroring the dispatcher structure of `adw-build.ts` / `adw-test.ts`:
  - File header comment (purpose, usage, exit codes).
  - `USAGE` constant documenting `--poll-ms`, `--stale-ms`, `--once` (single scan then exit, for testing), `--max-resumes N` (default 3 per workspace per 24h — prevents resume loops), `--workspaces-glob` (default `agents/*/adw-state.json`).
  - `parseArgs`, `main`, `import.meta.main` guard.
- Define the scan result type:
  ```ts
  type WorkspaceStatus =
    | { kind: "healthy"; id: string; lastEventMs: number }
    | { kind: "stale-dead"; id: string; lastEventMs: number; orchestratorPid: number | null }
    | { kind: "stale-alive"; id: string; lastEventMs: number; orchestratorPid: number }
    | { kind: "not-running"; id: string };  // status !== "running" — ignore
  ```

### Step 5: Watchdog dispatcher — scan + classify logic

- Implement `classifyWorkspace(statePath: string, now: number, staleMs: number): WorkspaceStatus`:
  - Read `adw-state.json`. If `status !== "running"` → `not-running`.
  - Find the newest `mtime` across all `agents/<id>/**/events.jsonl` files (zero-dep: `readdirSync` + `statSync`). If `now - newestMtime < staleMs` → `healthy`.
  - Else check the `orchestrator_pid` from state:
    - If pid missing or `process.kill(pid, 0)` throws (ESRCH) → `stale-dead`.
    - If pid exists and signal succeeds → `stale-alive`.
- This is a **pure function over the filesystem + a pid probe** — unit-testable with a temp dir and a fake pid.
- Unit tests: create temp `agents/<id>/adw-state.json` + events files with controlled mtimes; assert classification for each of the 4 kinds.

### Step 6: Watchdog dispatcher — resume + alarm actions

- Implement the poll loop in `main`:
  - Every `pollMs`: glob workspaces, classify each.
  - For `stale-dead`: check a per-workspace resume counter (`agents/<id>/watchdog/resume-count.json`) — if under `--max-resumes`, write `resume` event, re-spawn `bun adws/adw-plan-review-build-patch.ts --resume <id>` in a new tmux window via `tmux new-window`, increment counter. If over limit → `alarm` event + notification (don't infinite-loop resumes).
  - For `stale-alive`: write `alarm` event, fire `notify()` (macOS `osascript`, Linux `notify-send`, else log), do NOT kill.
  - For `healthy` / `not-running`: no-op.
- `--once` flag: run a single scan, print results, exit (for tests + manual diagnosis).
- `notify(kind, msg)`: detect platform; on darwin run `osascript -e 'display notification "..." with title "adw-watchdog"'`; on linux run `notify-send`; else write to stderr. Best-effort, never throws.
- Write all actions to `agents/<id>/watchdog/events.jsonl` with the workspace id, action, timestamp.

### Step 7: Integration — wrap `spawnStage` with stall detection

- In `adws/adw-plan-review-build-patch.ts`, modify `spawnStage` (line 358):
  - After spawning the child, determine the stage's tee file path. The dispatchers write to `agents/<id>/<stage-dir>/raw-output.jsonl` — pass the expected path into `spawnStage` (or infer from the stage name via a small map).
  - Wrap the existing `await new Promise<...>` body with `withStallWatch({ teeFile, stallMs: DEFAULT_STALL_MS }, child.pid!, promise)`.
  - On stall-kill: the child's `close` handler fires with a non-zero code (SIGKILL → null/137), `spawnStage` resolves with `{ code: 137, ... }`, and the orchestrator's existing `if (code !== 0)` path treats it as a stage error → retry loop or finalize. No new error path needed.
- Add `orchestrator_pid: process.pid` to the state object written by `writeState` (so Layer 2 can check liveness).

### Step 8: Integration — launch watchdog from `adw-launch.ts`

- In `adws/adw-launch.ts`, after the `tmux new-window` that launches the orchestrator, add a second `tmux new-window` launching `bun adws/adw-watchdog.ts --poll-ms 60000 --stale-ms 600000` in the same `tmax` session.
- Gate behind a `--no-watchdog` flag (parse it, skip the watchdog window if set). Default: watchdog ON.
- The watchdog window is long-lived (survives across multiple pipeline runs) — it scans all workspaces, not just the one being launched. Print "Watchdog launched in window `adw-watchdog`" alongside the orchestrator launch message.

### Step 9: Resume-loop guard

- In the watchdog, before each `stale-dead` resume, read/write `agents/<id>/watchdog/resume-count.json`: `{ count, window_start }`. Reset the window every 24h. If `count >= maxResumes` in the current window, do NOT resume — emit `alarm` with `kind: "resume-limit"` and notify. This prevents a repeatedly-crashing workspace from spawning unbounded orchestrator processes.

### Step 10: SPECS_INDEX + Validation

- Add SPEC-066 to `docs/specs/SPECS_INDEX.md` under "ADW Pipeline & Testing".
- Run every Validation Command. All must pass.

## Testing Strategy

### Unit Tests

All in `test/unit/adw-watchdog.test.ts`:

- **Stall detector (`withStallWatch`):** 6 cases listed in Step 3. Uses fake clock + fake `statSize` + fake `killTree`. No real files, no real processes.
- **`classifyWorkspace`:** 4 cases (healthy / stale-dead / stale-alive / not-running) using a temp `agents/` dir with controlled `adw-state.json` + events-file mtimes. Use a known-dead pid (e.g. a pid we `kill` in setup) for `stale-dead`, the test process's own pid for `stale-alive`.
- **Resume counter:** under limit → resume fires; at limit → alarm fires, no resume.
- **`notify`:** mocked `execSync` (or the platform dispatcher) — assert the right command string is built for darwin/linux/unknown.
- **`parseArgs`:** `--poll-ms`, `--stale-ms`, `--once`, `--max-resumes`, `--no-watchdog` (on launcher), defaults.

### Integration Tests

Not added as automated tests — the watchdog's end-to-end behavior (detect a parked workspace, spawn a resume, see it complete) is inherently time-based (10-min stale window) and process-based, which makes it a poor fit for the unit suite. Validated manually via the `--once` flag (Step 10 Validation) and by the BUG-16 / SPEC-063 runs that follow.

### Edge Cases

- **Tee file doesn't exist yet** (stage just started, `claude -p` hasn't written) → `statSize` returns null → treat as "no growth yet", start the stall timer from stage start, don't immediately kill. Give a `stallMs` grace before the first growth is expected.
- **Tee file is on a slow filesystem** (NFS) → `statSize` may throw → caught, returns null, same as above.
- **Child pid reused by an unrelated process** → the stall detector's `killTree(pid)` could kill the wrong process. Mitigation: kill via the process group (`process.kill(-pgid)`) established by `detached: true` (already set in `adw-test.ts`; add to `spawnStage` too). Process-group kill is scoped to the child's tree, not a bare pid.
- **Watchdog launches a resume while a human is also resuming** → the resume counter + a pre-resume pid check (if the orchestrator pid is suddenly alive again, skip) mitigate double-resumes.
- **Workspace state is corrupted** (unparseable JSON) → `classifyWorkspace` catches the parse error, returns `not-running`, logs a `scan-error` event. Never crashes the watchdog.
- **`tmux` not installed** → the watchdog's resume action fails to spawn the window; log `alarm` with `kind: "tmux-missing"`, continue polling other workspaces.
- **`stale-alive` for a genuinely-long build** (78-min build on a slow box) → 10-min stale window could false-alarm. Mitigation: the build's own heartbeat writes to `raw-output.jsonl` every ~30s of growth, so `classifyWorkspace` sees fresh events. Only a *truly* stuck orchestrator (no writes for 10 min) alarms. Tune `--stale-ms` up if false alarms appear.

## Acceptance Criteria

1. **`stall-detector.ts` exists and is injectable:** exports `withStallWatch`, `StallWatchOptions`, `StallDetectorDeps`, and the `DEFAULT_*` consts. Imports no `child_process` directly — uses injected `killTree`.
2. **`withStallWatch` kills on staleness:** when the tee file shows `< minGrowthBytes` growth for `stallMs`, the watched child's process group is SIGKILLed and `onStall` fires with accurate timing. Verified by 6 unit tests.
3. **`adw-watchdog.ts` exists** with the dispatcher structure (USAGE, parseArgs, main, `import.meta.main`) and the `--poll-ms`, `--stale-ms`, `--once`, `--max-resumes` flags.
4. **`classifyWorkspace` correctly classifies** all 4 states (healthy / stale-dead / stale-alive / not-running) — verified by unit tests with controlled mtimes + pids.
5. **`stale-dead` triggers auto-resume:** the watchdog re-spawns `adw-plan-review-build-patch.ts --resume <id>` in a new tmux window, increments the resume counter, and writes a `resume` event.
6. **`stale-alive` triggers alarm, not kill:** a live-but-stuck orchestrator gets an `alarm` event + desktop notification, but is NOT auto-killed.
7. **Resume-loop guard works:** after `--max-resumes` (default 3) in a 24h window, further resumes are suppressed and an `alarm` (`kind: "resume-limit"`) fires instead.
8. **`spawnStage` wrapped:** every stage spawn in the orchestrator is monitored by `withStallWatch`; a hung `claude -p` subprocess is killed within `stallMs + pollMs` (default 5m30s) and surfaces as a stage error that the retry loop handles.
9. **`orchestrator_pid` in state:** `adw-state.json` carries `orchestrator_pid: <number>` so the watchdog can distinguish dead vs. alive orchestrators.
10. **`adw-launch.ts` starts the watchdog** by default in a second tmux window; `--no-watchdog` skips it.
11. **Typecheck/build/tests pass:** `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`, `bun run build`, `bun run test:unit` all exit 0. The new `adw-watchdog.test.ts` passes.
12. **Manual `--once` smoke:** `bun adws/adw-watchdog.ts --once` scans all workspaces and prints a classification table without hanging.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run typecheck:src` — Source typecheck, zero errors.
- `bun run typecheck:test` — Test typecheck, zero errors.
- `bun run typecheck` — Full project typecheck, zero errors.
- `bun run build` — Build succeeds.
- `bun test test/unit/adw-watchdog.test.ts` — New unit tests pass (stall detector + classifyWorkspace + resume counter + notify + parseArgs).
- `bun run test:unit` — All unit tests pass, no regressions.
- `bun adws/adw-watchdog.ts --help` — Prints USAGE, exits 0.
- `bun adws/adw-watchdog.ts --once` — Single scan, prints a classification table of every workspace in `agents/` (healthy/stale-dead/stale-alive/not-running), exits 0. Does not hang, does not spawn anything.
- `bun adws/adw-launch.ts --script adw-plan-review-build-patch.ts "test watchdog integration"` — Confirms the launcher now opens two tmux windows (orchestrator + watchdog). (Manual; kill the spawned run immediately after confirming both windows exist.)

## Notes

- **Why two layers.** Layer 1 (in-process stall detector) catches the common case: a `claude -p` subprocess hangs inside an otherwise-healthy orchestrator. Layer 2 (external watchdog process) catches what Layer 1 structurally cannot: the orchestrator itself has parked (returned from `runPipeline` after a `stage-error`) or hung (the `spawnStage` promise never resolves). Neither layer subsumes the other. BUG-16's 3h17m dead gap was a Layer-2 failure (parked orchestrator); BUG-16's 8h build-dispatch stall was a Layer-1 failure (hung subprocess the orchestrator was blocked on). Both must exist.
- **Why 5 min for `stallMs`.** A healthy `claude -p` writes to its tee file on every tool call — multiple per minute. The longest legitimate pause is a single tool call that itself takes ~1-2 min (e.g. a big file read). 5 min is >2x that ceiling, so a 5-min stall is a real stall, not a slow tool call. Tunable via the module's `StallWatchOptions` if a slower model is used.
- **Why 10 min for `WATCHDOG_STALE_MS` (Layer 2).** Layer 2 watches the orchestrator's *event stream*, which updates at stage boundaries (every ~15-78 min during a real run) plus per-stage heartbeats (every 30s when `withHeartbeat` writes to stderr — but stderr isn't a file the watchdog can stat). The reliable signal is the per-stage `events.jsonl`, which gets a `start` event at stage entry. 10 min is short enough to catch a parked orchestrator quickly, long enough to not false-alarm during a legitimate inter-stage gap (which is seconds, not minutes). If heartbeats are redirected to a file in a future change, `WATCHDOG_STALE_MS` can drop to ~2 min.
- **Why NOT auto-kill a live-but-stuck orchestrator (Layer 2 `stale-alive`).** Killing a process that's actively holding file locks, tmux sessions, and a `claude -p` child tree is high-risk: orphaned children, half-written state, leaked tmux windows. The conservative choice is to alarm loudly (desktop notification + event) and let a human decide. Auto-resume is only safe when the orchestrator is provably *dead* (ESRCH on the pid), because a dead process has nothing to corrupt.
- **Relationship to the existing `withHeartbeat`.** `withHeartbeat` stays as-is — it remains the human-facing "is this stage alive?" reporter (printed to the tmux pane). `withStallWatch` is the machine-facing "kill this stage if it's not" actor. They run concurrently on the same tee file; neither replaces the other.
- **Process-group kill is mandatory.** The stall detector must kill the child's *process group* (`process.kill(-pgid)`), not just the child pid. `spawnStage`'s child (`bun adws/adw-build.ts`) spawns its own child (`claude -p`), which may spawn *its own* children (sub-agents). A bare-pid kill leaves orphans that keep the tee file from going quiet and burn CPU. `spawnStage` must spawn with `detached: true` (as `adw-test.ts` already does) so the group leader can be killed.
- **Resume counter prevents runaway loops.** A workspace that crashes on the same stage repeatedly (e.g. a spec that always triggers a `claude` OOM) would otherwise be resumed infinitely by Layer 2. The per-workspace 24h resume cap (default 3) bounds this: after 3 auto-resumes, the watchdog alarms and stops, deferring to a human.
- **Out of scope:** predictive stall detection (ML on historical stage durations), cross-workspace scheduling (only one resume at a time), and a web dashboard. These are future-work; the first version just needs to detect-and-recover the two observed failure classes.
