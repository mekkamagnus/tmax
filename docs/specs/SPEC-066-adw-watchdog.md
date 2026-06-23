# Feature: adw-watchdog — auto-detect and recover from silent pipeline stalls/crashes

## Feature Description

**adw-watchdog** adds a liveness monitor to the adw pipeline that detects silent failures the orchestrator currently misses, and recovers from them automatically. Two failure classes observed in production on workspace `01KVPRP6Y1` (BUG-16, 2026-06-22):

1. **Silent crash.** A stage's `claude -p` subprocess exits non-zero (e.g. patch-review's `exited with code 2` at 06:46). The orchestrator logs `stage-error` and writes `status: failed` to state — then **sits idle for 3h17m** until a human notices and runs `--resume`. No alarm fires.
2. **Silent stall.** The orchestrator logs `loop-retry → build` at 12:48, but the build's `claude -p` subprocess doesn't actually start until 20:48 — an **8-hour dead gap** with the orchestrator process alive but not dispatching. No heartbeat staleness is detected because no heartbeat is being written.

The watchdog closes both gaps by (a) wrapping every stage spawn with a liveness check that kills + retries a stalled/hung subprocess, and (b) running a separate lightweight monitor that watches workspace activity files for gaps and, on a parked resumable workspace, re-invokes `--resume` automatically.

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

**Layer 1 — per-stage stall detector (in-process).** Wrap `spawnStage` with a staleness monitor that tracks the stage subprocess's raw tee-file (`raw-output.jsonl`) byte growth. Heartbeat/status lines written by the dispatcher must not count as progress for this detector; the monitored file is the raw output from the spawned stage/LLM work, not a combined log that grows because the heartbeat itself is printing. If the file hasn't grown by >N bytes in `STALL_TIMEOUT_MS` (default 5 min — generous, since `claude -p` between tool calls can pause briefly but not for 5 min), kill the child's process group and let the orchestrator's existing retry/error path handle it. This converts an infinite hang into a fast failure that the `loop-retry` machinery already knows how to handle.

**Layer 2 — workspace watchdog (separate process).** A new `adws/adw-watchdog.ts` dispatcher that runs as a long-lived background process (launched or reused by `adw-launch.ts` alongside the orchestrator). Every `WATCHDOG_POLL_MS` (default 60s) it scans `agents/*/adw-state.json` for workspaces whose `status` is `running` or resumable `failed`. Its staleness signal is the newest mtime across explicit workspace activity files: `adw-state.json`, stage `events.jsonl`, and stage `raw-output.jsonl` files under that workspace. `events.jsonl` is not a heartbeat stream and must not be treated as one. Stale thresholds are stage-aware: use `WATCHDOG_STALE_MS` (default 10 min) only when no active stage is recorded or the workspace is `failed`; otherwise use `WATCHDOG_STAGE_STALE_MS` defaults large enough for known long stages (`plan/spec-review` 30 min, `build/test/patch-review` 90 min) unless overridden by CLI. For each stale workspace it:
  - Verifies the orchestrator process identity, not just PID liveness: `orchestrator_pid` must be alive and its OS process start time must match `orchestrator_started_at_ms` from state. A reused PID with a mismatched or unreadable start time is not considered the same orchestrator.
  - If the workspace is `failed` and the last terminal event is a resumable `stage-error`/`pipeline-failed`, the orchestrator identity is dead, and the resume counter is under limit → re-invokes `bun adws/adw-plan-review-build-patch.ts --resume <id>` in a fresh tmux window.
  - If the workspace is `running`, stale, and the orchestrator identity is dead → re-invokes `bun adws/adw-plan-review-build-patch.ts --resume <id>` in a fresh tmux window.
  - If alive but stale → writes an `alarm` event and emits a desktop notification (`osascript -e 'display notification...'` on macOS, `notify-send` on Linux, no-op elsewhere) so a human intervenes. Does NOT auto-kill a live-but-stuck orchestrator (too risky — could interrupt a genuinely long build).

Layer 2 is the safety net Layer 1 can't be: only an external process can detect that the orchestrator itself has parked.

## Relevant Files

Use these files to implement the feature:

### Existing Files to Read (reference)

- **`adws/adws-modules/heartbeat.ts`** — The existing observational heartbeat. The watchdog's staleness logic is the *actuative* counterpart to this file's *observational* reporting. Reuse `fmtElapsed`, `fmtBytes`, `tryStatSize` (export it). Do not duplicate the formatting helpers.
- **`adws/adw-plan-review-build-patch.ts`** — The orchestrator. `spawnStage` (line 358) is where Layer 1 wraps. `runPipeline` (line ~560) and the retry loop (lines 678-826) are the existing error/retry paths Layer 1 feeds into. `OrchestratorState` (line ~475) and `writeState` need new `orchestrator_pid` and `orchestrator_started_at_ms` fields for Layer 2 to check process identity. `STAGE_ORDER` / `StageName` (lines 60-61) are the stage vocabulary.
- **`adws/adw-launch.ts`** — The tmux launcher. This is where Layer 2's watchdog process gets launched or reused alongside the orchestrator. Currently launches only the orchestrator script.
- **`adws/adw-build.ts`**, **`adws/adw-patch-review.ts`**, **`adws/adw-test.ts`** — Each dispatcher already wraps its `claude -p` call in `withHeartbeat` with a `teeFile`. Layer 1's staleness check reads these same tee files only if they contain raw child output, not heartbeat-only lines. If any dispatcher combines heartbeat/status text into that tee file, split heartbeat output before wiring Layer 1.

### Existing Files to Modify

- **`adws/adw-plan-review-build-patch.ts`** — Wrap `spawnStage` (line 358) in a `withStallWatch` that monitors the child's raw tee file and kills on staleness. Add `orchestrator_pid: process.pid` and `orchestrator_started_at_ms` to the state written by `writeState` so Layer 2 can check liveness and PID identity. Do not add watchdog-owned events to the orchestrator event schema; watchdog alarms live in the watchdog schema below.
- **`adws/adw-launch.ts`** — After launching the orchestrator window, optionally launch or reuse a watchdog window (`bun adws/adw-watchdog.ts --poll-ms 60000 --stale-ms 600000`). Gate behind a `--no-watchdog` flag for users who don't want a background daemon. Default: watchdog ON.
- **`docs/specs/SPECS_INDEX.md`** — Add SPEC-066 entry.

### New Files

- **`adws/adws-modules/stall-detector.ts`** — Layer 1. Pure, dependency-injected module: `withStallWatch<T>({ childPid, teeFile, stallMs, killTree, clock }, fn)`. Kills the spawned child's process group if the raw tee file doesn't grow for `stallMs`. No `child_process` import (uses injected `killTree`). Fully unit-testable with a fake clock.
- **`adws/adw-watchdog.ts`** — Layer 2 dispatcher. CLI entry mirroring the other dispatchers' structure (`parseArgs`, `USAGE`, `main`, `import.meta.main`). Long-running poll loop: scan `<agents-root>/*/adw-state.json`, detect staleness, resume dead/parked resumable workspaces, alarm on live-but-stuck ones. Writes watchdog-owned events to `agents/<id>/watchdog/events.jsonl`.
- **`test/unit/adw-watchdog.test.ts`** — Unit tests for both layers (stall-detector with fake clock; watchdog scan logic with a temp `agents/` dir).

## Implementation Plan

### Phase 1: Stall detector module (Layer 1)

Build `adws/adws-modules/stall-detector.ts` — a pure, injectable wrapper that monitors a tee file's growth and kills a process tree on staleness. This is the in-process defense against a hung `claude -p` subprocess inside a single stage.

### Phase 2: Watchdog dispatcher (Layer 2)

Build `adws/adw-watchdog.ts` — the external monitor that catches cases Layer 1 structurally cannot (orchestrator parked after `stage-error`, orchestrator itself hung). Scans workspaces, resumes dead ones, alarms on stuck ones.

### Phase 3: Integration

Wire Layer 1 into `spawnStage`, Layer 2 into `adw-launch.ts`, add `orchestrator_pid` and `orchestrator_started_at_ms` to state, update the docs index.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Stall detector module — types and growth tracker

- Create `adws/adws-modules/stall-detector.ts`.
- Re-export `fmtElapsed`, `fmtBytes`, and `tryStatSize` from `heartbeat.ts` (do not duplicate).
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
    childPid: number;          // detached process-group leader pid
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

- Implement `withStallWatch<T>(opts: StallWatchOptions, fn: () => Promise<T>): Promise<T>`:
  - Track `lastGrowthTime = now()` and `lastSize = statSize(teeFile)`.
  - Every `pollMs`: read current size. If `currentSize - lastSize >= minGrowthBytes` → update `lastGrowthTime = now()`, `lastSize = currentSize`. Else if `now() - lastGrowthTime >= stallMs` → call `onStall`, then `deps.killTree(opts.childPid, "SIGKILL")`, clear the interval, and let `fn` reject/resolve naturally (the killed child surfaces as a non-zero exit through `spawnStage`).
  - Always `clearInterval` in a `finally` (mirror `withHeartbeat`'s pattern).
  - The kill is one-shot: once fired, the watch stops. The orchestrator's existing retry/error path takes over.
- The function does NOT spawn the child — it takes `childPid` in options. The caller (`spawnStage` integration in Step 7) spawns the child, knows its detached group-leader pid, and passes it in. This keeps the module pure and testable.

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
  - `USAGE` constant documenting `--poll-ms`, `--stale-ms`, `--stage-stale-ms stage=ms` (repeatable override), `--once` (dry-run single scan then exit, no resumes/alarms), `--max-resumes N` (default 3 per workspace per 24h — prevents resume loops), `--agents-root PATH` (default `agents`).
  - `parseArgs`, `main`, `import.meta.main` guard.
- Define the scan result type:
  ```ts
  type WorkspaceStatus =
    | { kind: "healthy"; id: string; lastActivityMs: number }
    | { kind: "stale-dead"; id: string; lastActivityMs: number; orchestratorPid: number | null }
    | { kind: "stale-alive"; id: string; lastActivityMs: number; orchestratorPid: number }
    | { kind: "not-running"; id: string; status: string }
    | { kind: "not-resumable-failed"; id: string };
  ```

### Step 5: Watchdog dispatcher — scan + classify logic

- Implement `classifyWorkspace(statePath: string, now: number, staleMs: number): WorkspaceStatus`:
  - Read `adw-state.json`. If `status` is neither `"running"` nor `"failed"` → `not-running`.
  - If `status === "failed"`, classify it as resumable only when the last terminal orchestrator event is a `stage-error` or `pipeline-failed` that names a stage and the workspace has not exceeded the resume counter. Non-stage failures, cancelled workspaces, completed workspaces, and failed workspaces already over the counter return `not-resumable-failed`.
  - Find the newest activity `mtime` across `adw-state.json`, all `agents/<id>/**/events.jsonl` files, and all `agents/<id>/**/raw-output.jsonl` files (zero-dep: recursive `readdirSync` + `statSync`). Heartbeat-only files are excluded unless a future implementation writes a dedicated `heartbeat.jsonl` with explicit stage liveness records.
  - Choose the stale threshold: for `failed` workspaces and `running` workspaces with no active stage, use `staleMs`; for `running` workspaces with an active stage, use that stage's `--stage-stale-ms` value (defaults: `plan=1800000`, `spec-review=1800000`, `build=5400000`, `test=5400000`, `patch-review=5400000`). If `now - newestActivityMtime` is below the chosen threshold → `healthy`.
  - Else check `orchestrator_pid` and `orchestrator_started_at_ms` from state with an injected `isSameProcess(pid, startedAtMs)` probe:
    - If pid missing or the identity probe returns false → `stale-dead`.
    - If pid exists and identity matches → `stale-alive`.
- This is a **pure function over the filesystem + a pid identity probe** — unit-testable with a temp dir and a fake pid probe.
- Unit tests: create temp `agents/<id>/adw-state.json` + events/raw-output files with controlled mtimes; assert classification for healthy / stale-dead / stale-alive / not-running / resumable failed / non-resumable failed.

### Step 6: Watchdog dispatcher — resume + alarm actions

- Implement the poll loop in `main`:
  - Every `pollMs`: recursively scan `${agentsRoot}/*/adw-state.json` via `readdirSync`, classify each.
  - For `stale-dead`: check a per-workspace resume counter (`agents/<id>/watchdog/resume-count.json`) — if under `--max-resumes`, write `resume` event, re-spawn `bun adws/adw-plan-review-build-patch.ts --resume <id>` in a new tmux window via `tmux new-window`, increment counter. If over limit → `alarm` event + notification (don't infinite-loop resumes).
  - For `stale-alive`: write `alarm` event, fire `notify()` (macOS `osascript`, Linux `notify-send`, else log), do NOT kill.
  - For `healthy` / `not-running` / `not-resumable-failed`: no-op.
- `--once` flag: dry-run mode. Run a single scan, print results and intended actions, then exit without writing watchdog events, sending notifications, incrementing counters, or spawning tmux windows. This is the deterministic validation path.
- `notify(kind, msg)`: detect platform; on darwin run `osascript -e 'display notification "..." with title "adw-watchdog"'`; on linux run `notify-send`; else write to stderr. Best-effort, never throws.
- Write all real actions to `agents/<id>/watchdog/events.jsonl` with the workspace id, action, timestamp. This is the watchdog event schema and is separate from the orchestrator's own event schema.

### Step 7: Integration — wrap `spawnStage` with stall detection

- In `adws/adw-plan-review-build-patch.ts`, modify `spawnStage` (line 358):
  - After spawning the child, determine the stage's tee file path. The dispatchers write to `agents/<id>/<stage-dir>/raw-output.jsonl` — pass the expected path into `spawnStage` (or infer from the stage name via a small map).
  - Spawn the child with `detached: true` so `child.pid` is the process-group leader, and wrap the existing `await new Promise<...>` body with `withStallWatch({ childPid: child.pid!, teeFile, stallMs: DEFAULT_STALL_MS }, promise)`.
  - On stall-kill: the child's `close` handler fires with a non-zero code (SIGKILL → null/137), `spawnStage` resolves with `{ code: 137, ... }`, and the orchestrator's existing `if (code !== 0)` path treats it as a stage error → retry loop or finalize. No new error path needed.
- Add `orchestrator_pid: process.pid` and `orchestrator_started_at_ms` (captured once at orchestrator startup) to the state object written by `writeState` so Layer 2 can reject PID reuse.

### Step 8: Integration — launch watchdog from `adw-launch.ts`

- In `adws/adw-launch.ts`, after the `tmux new-window` that launches the orchestrator, launch or reuse a watchdog window running `bun adws/adw-watchdog.ts --poll-ms 60000 --stale-ms 600000` in the same `tmax` session.
- Gate behind a `--no-watchdog` flag (parse it, skip the watchdog window if set). Default: watchdog ON.
- Before launching, detect an existing watchdog by checking for a tmux window named `adw-watchdog` in the `tmax` session and, as a fallback, a live `adw-watchdog.ts` process. If one exists, reuse it and print "Watchdog already running in window `adw-watchdog`"; do not create duplicates.
- The watchdog window is long-lived (survives across multiple pipeline runs) — it scans all workspaces, not just the one being launched. Print "Watchdog launched in window `adw-watchdog`" only when a new watchdog is actually started.
- Add a launcher `--dry-run` flag if one does not already exist. In dry-run mode, print the orchestrator command and whether the watchdog would be launched or reused, but do not create tmux windows or start a pipeline.

### Step 9: Resume-loop guard

- In the watchdog, before each `stale-dead` resume, read/write `agents/<id>/watchdog/resume-count.json`: `{ count, window_start }`. Reset the window every 24h. If `count >= maxResumes` in the current window, do NOT resume — emit `alarm` with `kind: "resume-limit"` and notify. This prevents a repeatedly-crashing workspace from spawning unbounded orchestrator processes.

### Step 10: SPECS_INDEX + Validation

- Add SPEC-066 to `docs/specs/SPECS_INDEX.md` under "ADW Pipeline & Testing".
- Run every Validation Command. All must pass.

## Testing Strategy

### Unit Tests

All in `test/unit/adw-watchdog.test.ts`:

- **Stall detector (`withStallWatch`):** 6 cases listed in Step 3. Uses fake clock + fake `statSize` + fake `killTree`. No real files, no real processes.
- **`classifyWorkspace`:** healthy / stale-dead / stale-alive / not-running / resumable failed / non-resumable failed using a temp `agents/` dir with controlled `adw-state.json`, events-file mtimes, and raw-output mtimes. Use an injected pid identity probe rather than real process killing.
- **Resume counter:** under limit → resume fires; at limit → alarm fires, no resume.
- **`notify`:** mocked `execSync` (or the platform dispatcher) — assert the right command string is built for darwin/linux/unknown.
- **`parseArgs`:** `--poll-ms`, `--stale-ms`, `--stage-stale-ms`, `--once`, `--max-resumes`, `--agents-root`, `--no-watchdog` (on launcher), defaults.

### Integration Tests

Not added as automated tests — the watchdog's end-to-end behavior (detect a parked workspace, spawn a resume, see it complete) is inherently time-based and process-based, which makes it a poor fit for the unit suite. Validated manually via the dry-run `--once` flag (Step 10 Validation) and by the BUG-16 / SPEC-063 runs that follow.

### Edge Cases

- **Tee file doesn't exist yet** (stage just started, `claude -p` hasn't written) → `statSize` returns null → treat as "no growth yet", start the stall timer from stage start, don't immediately kill. Give a `stallMs` grace before the first growth is expected.
- **Tee file is on a slow filesystem** (NFS) → `statSize` may throw → caught, returns null, same as above.
- **Child pid reused by an unrelated process** → the stall detector's `killTree(pid)` could kill the wrong process. Mitigation: `pid` is the detached process-group leader created by `spawnStage`, and the production `killTree(pid, signal)` calls `process.kill(-pid, signal)`. Do not pass a nested child pid; do not call `process.kill(pid, signal)` for Layer 1.
- **Orchestrator pid reused by an unrelated process** → `process.kill(pid, 0)` alone is insufficient. Mitigation: state carries `orchestrator_started_at_ms`, and the watchdog's production pid probe must compare the OS process start time for `orchestrator_pid` to that recorded value. If the start time cannot be read or does not match, treat the orchestrator identity as dead for auto-resume eligibility.
- **Watchdog launches a resume while a human is also resuming** → the resume counter + a pre-resume pid identity check (if the orchestrator identity is suddenly alive again, skip) mitigate double-resumes.
- **Workspace state is corrupted** (unparseable JSON) → `classifyWorkspace` catches the parse error, returns `not-running`, logs a `scan-error` event. Never crashes the watchdog.
- **`tmux` not installed** → the watchdog's resume action fails to spawn the window; log `alarm` with `kind: "tmux-missing"`, continue polling other workspaces.
- **`stale-alive` for a genuinely-long build** (78-min build on a slow box) → a 10-min event-only stale window would false-alarm because stage events can be quiet for the full stage duration. Mitigation: Layer 2 uses raw-output mtimes plus per-stage stale thresholds (default 90 min for build/test/patch-review). Heartbeat output does not make `events.jsonl` fresh and must not be cited as doing so.

## Acceptance Criteria

1. **`stall-detector.ts` exists and is injectable:** exports `withStallWatch`, `StallWatchOptions`, `StallDetectorDeps`, and the `DEFAULT_*` consts. Imports no `child_process` directly — uses injected `killTree`.
2. **`withStallWatch` kills on staleness:** when the tee file shows `< minGrowthBytes` growth for `stallMs`, the watched child's process group is SIGKILLed and `onStall` fires with accurate timing. Verified by 6 unit tests.
3. **`adw-watchdog.ts` exists** with the dispatcher structure (USAGE, parseArgs, main, `import.meta.main`) and the `--poll-ms`, `--stale-ms`, `--stage-stale-ms`, `--once`, `--max-resumes`, and `--agents-root` flags.
4. **`classifyWorkspace` correctly classifies** healthy / stale-dead / stale-alive / not-running / resumable failed / non-resumable failed — verified by unit tests with controlled mtimes + injected pid identity probes.
5. **`stale-dead` triggers auto-resume:** the watchdog re-spawns `adw-plan-review-build-patch.ts --resume <id>` in a new tmux window, increments the resume counter, and writes a `resume` event.
6. **`stale-alive` triggers alarm, not kill:** a live-but-stuck orchestrator gets an `alarm` event + desktop notification, but is NOT auto-killed.
7. **Resume-loop guard works:** after `--max-resumes` (default 3) in a 24h window, further resumes are suppressed and an `alarm` (`kind: "resume-limit"`) fires instead.
8. **`spawnStage` wrapped:** every stage spawn in the orchestrator is monitored by `withStallWatch`; a hung `claude -p` subprocess is killed within `stallMs + pollMs` (default 5m30s) and surfaces as a stage error that the retry loop handles.
9. **`orchestrator_pid` identity in state:** `adw-state.json` carries `orchestrator_pid: <number>` and `orchestrator_started_at_ms: <number>` so the watchdog can distinguish dead, alive, and PID-reused orchestrators.
10. **`adw-launch.ts` starts or reuses the watchdog** by default in a tmux window named `adw-watchdog`; `--no-watchdog` skips it, and repeated launcher runs do not create duplicate watchdog windows.
11. **Typecheck/build/tests pass:** `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`, `bun run build`, `bun run test:unit` all exit 0. The new `adw-watchdog.test.ts` passes.
12. **Manual `--once` smoke:** `bun adws/adw-watchdog.ts --once` scans all workspaces and prints a classification table plus intended actions without hanging, spawning tmux windows, writing watchdog events, sending notifications, or incrementing counters.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run typecheck:src` — Source typecheck, zero errors.
- `bun run typecheck:test` — Test typecheck, zero errors.
- `bun run typecheck` — Full project typecheck, zero errors.
- `bun run build` — Build succeeds.
- `bun test test/unit/adw-watchdog.test.ts` — New unit tests pass (stall detector + classifyWorkspace + resume counter + notify + parseArgs).
- `bun run test:unit` — All unit tests pass, no regressions.
- `bun adws/adw-watchdog.ts --help` — Prints USAGE, exits 0.
- `bun adws/adw-watchdog.ts --once` — Single scan, prints a classification table of every workspace in `agents/` (healthy/stale-dead/stale-alive/not-running/not-resumable-failed), exits 0. Does not hang, does not spawn anything.
- `bun adws/adw-watchdog.ts --once --agents-root /tmp/adw-watchdog-empty-agents` — Deterministic dry-run smoke against an empty temp agents root; prints zero workspaces and exits 0 without side effects.
- `bun adws/adw-launch.ts --dry-run --script adw-plan-review-build-patch.ts "test watchdog integration"` — Confirms the launcher reports the orchestrator command and either "Watchdog launched in window `adw-watchdog`" or "Watchdog already running in window `adw-watchdog`" without starting a real pipeline. Add `--dry-run` to the launcher if it does not already exist.

## Notes

- **Why two layers.** Layer 1 (in-process stall detector) catches the common case: a `claude -p` subprocess hangs inside an otherwise-healthy orchestrator. Layer 2 (external watchdog process) catches what Layer 1 structurally cannot: the orchestrator itself has parked (returned from `runPipeline` after a `stage-error`) or hung (the `spawnStage` promise never resolves). Neither layer subsumes the other. BUG-16's 3h17m dead gap was a Layer-2 failure (parked orchestrator); BUG-16's 8h build-dispatch stall was a Layer-1 failure (hung subprocess the orchestrator was blocked on). Both must exist.
- **Why 5 min for `stallMs`.** A healthy `claude -p` writes to its tee file on every tool call — multiple per minute. The longest legitimate pause is a single tool call that itself takes ~1-2 min (e.g. a big file read). 5 min is >2x that ceiling, so a 5-min stall is a real stall, not a slow tool call. Tunable via the module's `StallWatchOptions` if a slower model is used.
- **Why 10 min for `WATCHDOG_STALE_MS` but longer stage thresholds (Layer 2).** `WATCHDOG_STALE_MS` is for parked or between-stage workspaces, including `status: failed`, where no active long-running stage should be producing output. Active stages use per-stage thresholds because `events.jsonl` updates at stage boundaries and can be quiet for 15-78 minutes during a real run. Heartbeat freshness does not affect `events.jsonl`; only explicit activity files (`adw-state.json`, `events.jsonl`, `raw-output.jsonl`) count.
- **Why NOT auto-kill a live-but-stuck orchestrator (Layer 2 `stale-alive`).** Killing a process that's actively holding file locks, tmux sessions, and a `claude -p` child tree is high-risk: orphaned children, half-written state, leaked tmux windows. The conservative choice is to alarm loudly (desktop notification + event) and let a human decide. Auto-resume is only safe when the orchestrator is provably *dead* (ESRCH on the pid), because a dead process has nothing to corrupt.
- **Relationship to the existing `withHeartbeat`.** `withHeartbeat` stays as-is — it remains the human-facing "is this stage alive?" reporter (printed to the tmux pane). `withStallWatch` is the machine-facing "kill this stage if it's not" actor. They observe the same raw child-output tee file, but heartbeat's own status lines must not be appended to that file and must not count as progress.
- **Process-group kill is mandatory.** The stall detector must kill the child's *process group* (`process.kill(-pgid)`), not just the child pid. `spawnStage`'s child (`bun adws/adw-build.ts`) spawns its own child (`claude -p`), which may spawn *its own* children (sub-agents). A bare-pid kill leaves orphans that keep the tee file from going quiet and burn CPU. `spawnStage` must spawn with `detached: true` (as `adw-test.ts` already does) so the group leader can be killed.
- **Watchdog event ownership.** Orchestrator events remain in the existing orchestrator/stage `events.jsonl` schema. Watchdog actions (`resume`, `alarm`, `scan-error`) are a separate schema written only to `agents/<id>/watchdog/events.jsonl`; do not add watchdog-only `alarm` variants to the orchestrator event union unless a future feature intentionally centralizes event storage.
- **Resume counter prevents runaway loops.** A workspace that crashes on the same stage repeatedly (e.g. a spec that always triggers a `claude` OOM) would otherwise be resumed infinitely by Layer 2. The per-workspace 24h resume cap (default 3) bounds this: after 3 auto-resumes, the watchdog alarms and stops, deferring to a human.
- **Out of scope:** predictive stall detection (ML on historical stage durations), cross-workspace scheduling (only one resume at a time), and a web dashboard. These are future-work; the first version just needs to detect-and-recover the two observed failure classes.

## Audit findings (adw-patch-review 2026-06-22T22:54:53.363Z)

**Verdict:** gaps

All 12 acceptance criteria are implemented with cited file:line evidence, and every validation command passes (typecheck/build/test:unit/--help/--once/launcher --dry-run, 37/37 new unit tests). Three gaps remain vs the spec's Testing Strategy and Edge Cases: (1) the test stage's Layer-1 teeFile is `events.jsonl` rather than a raw-output file, contradicting the spec's explicit warning against wiring heartbeat/event streams into the stall detector; (2) `takeAction` (the resume-fire and resume-limit-alarm code path) is not exported and not unit-tested, so the spec's "Resume counter: under limit → resume fires; at limit → alarm fires" test case is only covered indirectly via the classifier; (3) the pre-resume pid identity re-check the spec lists as a double-resume mitigation is explicitly skipped in code. None of these block the feature, but they are concrete deviations from the spec's testing/edge-case requirements.

### Criteria
- **1. stall-detector.ts exists and is injectable: exports withStallWatch, StallWatchOptions, StallDetectorDeps, DEFAULT_* consts; imports no child_process directly.** — implemented: adws/adws-modules/stall-detector.ts:76 (withStallWatch), :39 (StallWatchOptions), :31 (StallDetectorDeps), :24/:26/:28 (DEFAULT_STALL_MS=300_000, DEFAULT_MIN_GROWTH_BYTES=64, DEFAULT_POLL_MS=30_000). Only import is `statSync` from fs (line 17); killTree is injected via deps (line 36).
- **2. withStallWatch kills on staleness: <minGrowthBytes growth for stallMs → SIGKILL process group + onStall with accurate timing. Verified by 6 unit tests.** — implemented: stall-detector.ts:87-114 (interval callback tracks lastGrowthTime/lastSize, fires onStall then deps.killTree(opts.childPid, 'SIGKILL')). Production killTree uses process.kill(-pid) (line 62) — group kill. Six tests at test/unit/adw-watchdog.test.ts:86-311: steady growth, stall kill, sub-threshold jitter, growth-resets-timer, interval-cleared-on-resolve, accurate lastGrowthMs.
- **3. adw-watchdog.ts exists with USAGE/parseArgs/main/import.meta.main + flags --poll-ms, --stale-ms, --stage-stale-ms, --once, --max-resumes, --agents-root.** — implemented: adws/adw-watchdog.ts:99 (USAGE), :125 (parseArgs), :703 (main), :747 (import.meta.main guard). All six flags handled at :138-174. --help/-h at :137 returns help sentinel.
- **4. classifyWorkspace correctly classifies healthy / stale-dead / stale-alive / not-running / resumable failed / non-resumable failed.** — implemented: adw-watchdog.ts:391-445 (makeClassifier covers all 6 kinds: not-running at :402, not-resumable-failed at :414/:419, healthy at :431, stale-alive at :441, stale-dead at :443). Tests at adw-watchdog.test.ts:455-636 cover all six kinds plus three non-resumable-failed subcases and an unparseable-state case.
- **5. stale-dead triggers auto-resume: re-spawns adw-plan-review-build-patch.ts --resume <id> in new tmux window, increments counter, writes resume event.** — implemented: adw-watchdog.ts:578-616 (takeAction stale-dead branch): spawnTmuxResume at :601, writeResumeCounter at :608, appendWatchdogEvent action=resume at :609. buildResumeCommand at :532-541 constructs the tmux new-window spec; verified by test at adw-watchdog.test.ts:712-721.
- **6. stale-alive triggers alarm, not kill: alarm event + desktop notification, no auto-kill.** — implemented: adw-watchdog.ts:617-627 (takeAction stale-alive branch): appendWatchdogEvent action=alarm kind=stuck-alive, notify() fired, no kill call. Notes 'NEVER auto-kill' in the file header comment (:16).
- **7. Resume-loop guard: after --max-resumes (default 3) in 24h, further resumes suppressed; alarm kind='resume-limit' fires.** — implemented: adw-watchdog.ts:53-54 (DEFAULT_MAX_RESUMES=3, RESUME_WINDOW_MS=24h), :355-366 (readResumeCounter with 24h window reset), :582-591 (takeAction counter check emits alarm kind='resume-limit' when count>=max). Default verified by parseArgs test at adw-watchdog.test.ts:324.
- **8. spawnStage wrapped with withStallWatch: every stage monitored; hung subprocess killed within stallMs+pollMs, surfaces as stage error.** — implemented: adw-plan-review-build-patch.ts:381-419: spawnStage signature now takes teeFile (line 384), spawns with detached:true (line 390), wraps childDone in withStallWatch (lines 405-418). All five call sites pass tee paths: :446 (planner/raw-output.jsonl), :456 (reviewer/raw-output.jsonl), :472 (builder/raw-output.jsonl), :484 (tester/events.jsonl), :500 (patch-reviewer/raw-output.jsonl).
- **9. orchestrator_pid and orchestrator_started_at_ms in adw-state.json for PID identity check.** — implemented: adw-plan-review-build-patch.ts:57-58 (ORCHESTRATOR_PID=process.pid, ORCHESTRATOR_STARTED_AT_MS=Date.now() captured at module load), :521-524 (OrchestratorState fields), :605-606 (written into state). Watchdog consumes them at adw-watchdog.ts:434-443.
- **10. adw-launch.ts starts or reuses watchdog by default in tmux window named adw-watchdog; --no-watchdog skips; no duplicate windows.** — implemented: adw-launch.ts:356-364 (detectWatchdog: window-check then pgrep fallback), :397-410 (launchWatchdog), :412-445 (ensureWatchdog with reuse + launch). --no-watchdog at :162-163, --dry-run at :164-165. main threads watchdog launch after orchestrator at :503-509, gated by noWatchdog.
- **11. Typecheck/build/tests pass: typecheck:src, typecheck:test, typecheck, build, test:unit, adw-watchdog.test.ts.** — implemented: Re-ran during audit: bun run typecheck → exit 0; bun run build → exit 0; bun test test/unit/adw-watchdog.test.ts → 37 pass / 0 fail (81 expect calls). Gate results confirm typecheck:src, test:unit, test:tmax-use all PASS.
- **12. Manual --once smoke: scans all workspaces, prints classification table + intended actions, no side effects.** — implemented: adw-watchdog.ts:674-697 (runPass prints table, short-circuits at :689-692 when opts.once). Verified by smoke run during audit: 'adw-watchdog.ts --once' against 44 workspaces printed classifications + '--once → dry-run, no side effects' and exited 0. Empty-agents smoke also verified exit 0 with 'no workspaces' message.

### Tests
- **withStallWatch: no stall + steady growth → killTree never called** — covered: adw-watchdog.test.ts:86-110
- **withStallWatch: stall triggers SIGKILL with correct pid + signal, onStall fires with stalledForMs** — covered: adw-watchdog.test.ts:112-154
- **withStallWatch: sub-threshold jitter (10B/poll) ignored → kill after stallMs** — covered: adw-watchdog.test.ts:156-188
- **withStallWatch: growth resets stall timer (grow, plateau under stallMs, grow again → no kill)** — covered: adw-watchdog.test.ts:190-239
- **withStallWatch: clearInterval called on natural resolve** — covered: adw-watchdog.test.ts:241-262
- **withStallWatch: onStall receives accurate lastGrowthMs** — covered: adw-watchdog.test.ts:264-310
- **parseArgs: defaults (--poll-ms 60000, --stale-ms 600000, --max-resumes 3, --once false)** — covered: adw-watchdog.test.ts:318-328
- **parseArgs: --poll-ms, --stale-ms, --stage-stale-ms (repeatable), --once, --max-resumes, --agents-root overrides** — covered: adw-watchdog.test.ts:330-361
- **parseArgs: -h/--help sentinel + invalid values + unexpected arg errors** — covered: adw-watchdog.test.ts:363-391
- **classifyWorkspace: not-running (status=completed or unparseable)** — covered: adw-watchdog.test.ts:456-462 (completed) and :618-626 (unparseable)
- **classifyWorkspace: healthy (running + recent activity)** — covered: adw-watchdog.test.ts:464-476
- **classifyWorkspace: stale-dead (running, stale, pid not alive) + missing orchestrator_pid variant** — covered: adw-watchdog.test.ts:478-491 and :628-634
- **classifyWorkspace: stale-alive (running, stale, pid alive)** — covered: adw-watchdog.test.ts:493-505
- **classifyWorkspace: running with active build stage uses 90-min threshold** — covered: adw-watchdog.test.ts:507-525
- **classifyWorkspace: resumable failed (stage-error + stage field) under staleMs → healthy; stale → stale-dead** — covered: adw-watchdog.test.ts:527-560
- **classifyWorkspace: non-resumable failed (no stage / non-terminal event / counter exhausted)** — covered: adw-watchdog.test.ts:562-616 (three subcases)
- **notifyArgv: darwin osascript / linux notify-send / other null** — covered: adw-watchdog.test.ts:643-684
- **detectWatchdog: window / process / null branches** — covered: adw-watchdog.test.ts:691-705
- **buildResumeCommand: tmux resume spec for given workspace id** — covered: adw-watchdog.test.ts:712-720
- **takeAction resume counter: under-limit → resume fires (spawn tmux + increment + write resume event)** — uncovered: takeAction at adw-watchdog.ts:571-629 is not exported and has no unit test. Only the classifier-level counter exhaustion is tested (adw-watchdog.test.ts:594-616). The spec's Testing Strategy explicitly lists 'Resume counter: under limit → resume fires; at limit → alarm fires, no resume.' — the under-limit → resume-fire path is not exercised.
- **takeAction resume counter: at-limit → alarm kind='resume-limit' fires, no resume** — uncovered: takeAction's at-limit alarm branch (adw-watchdog.ts:582-591) is not directly tested. Indirectly covered by classifier test that produces not-resumable-failed at adw-watchdog.test.ts:594-616, which takeAction then treats as no-op — but the alarm-emission code path itself is not exercised.
- **takeAction: tmux-missing alarm + tmux-spawn-failed alarm branches** — uncovered: adw-watchdog.ts:596-605 (tmux-missing and tmux-spawn-failed alarms) — no unit test injects a failing spawn to exercise these paths.
- **Launcher --dry-run + --no-watchdog flag handling** — covered: Validated manually during audit: 'adw-launch.ts --dry-run --no-watchdog test' → exit 0 with '[dry-run] Watchdog: skipped (--no-watchdog)'. No automated unit test of the launcher's parseArgs for --no-watchdog/--dry-run was added.

### Edge cases
- **Tee file doesn't exist yet (stage just started) — statSize returns null; stallMs grace before first growth expected** — handled: stall-detector.ts:84 (lastSize initialized from statSize, may be null), :91 (growth check requires both lastSize and currentSize non-null), :98-102 (mid-watch null→number transition treated as growth), :106 (stall timer starts from startMs at line 82, giving full stallMs grace).
- **Tee file on slow filesystem (NFS) — statSync throws, treated as null** — handled: stall-detector.ts:60 (productionDeps.statSize wraps statSync in try/catch returning null); heartbeat.ts:76-78 (tryStatSize exported and used by re-export at stall-detector.ts:19).
- **Child pid reused by unrelated process — killTree must kill process group not bare pid** — handled: stall-detector.ts:62 (killTree calls process.kill(-pid, signal) — group kill). spawnStage sets detached:true at adw-plan-review-build-patch.ts:390 so child.pid is the group leader. Spec note observed: 'Do not pass a nested child pid; do not call process.kill(pid, signal) for Layer 1.' — implementation complies.
- **Orchestrator pid reused — process.kill(pid,0) alone insufficient; compare OS process start time** — handled: adw-watchdog.ts:509-525 (isSameProcessProduction): first process.kill(pid, 0) for liveness, then spawnSync('ps', ['-p', pid, '-o', 'lstart=']) to read OS start time; compares to startedAtMs within 5s tolerance. Returns false on ESRCH, unreadable start, or mismatch. Wired into classifier at :436-440.
- **Watchdog launches a resume while a human is also resuming — resume counter + pre-resume pid re-check mitigate double-resumes** — missed: adw-watchdog.ts:593-595 comment explicitly skips the pre-resume re-check: 'Pre-resume pid identity recheck ... (Skipped: classify already did this...)'. classify and takeAction run in the same pass with no re-check between them. Only the resume counter provides protection — if a human resumed in the gap between classify and takeAction, the watchdog would still spawn a duplicate resume window.
- **Workspace state corrupted (unparseable JSON) — classifyWorkspace catches, returns not-running, never crashes** — handled: adw-watchdog.ts:394-399 (JSON.parse wrapped in try/catch, returns {kind:'not-running', status:'unparseable'}). Tested at adw-watchdog.test.ts:618-626. (Spec also mentions logging a scan-error event — implementation returns a status marker instead of writing an event, but the watchdog does not crash.)
- **tmux not installed — resume action fails; log alarm kind='tmux-missing', continue polling** — handled: adw-watchdog.ts:544-552 (tmuxAvailable checks tmux -V and tmax session), :596-600 (takeAction emits alarm kind='tmux-missing' and returns early when tmux unavailable). Not unit-tested but code path exists.
- **stale-alive for genuinely long build (78-min build) — would false-alarm under 10-min event-only stale window** — handled: adw-watchdog.ts:57-63 (DEFAULT_STAGE_STALE_MS: plan/review 30min, build/test/patch-review 90min), :308-335 (detectActiveStage reads events.jsonl backward for loop-retry.to/stage-error.stage/resume.from_stage/start), :425-429 (classifier uses stage-specific threshold when active stage detected). Tested at adw-watchdog.test.ts:507-525 (build active, 30min old → healthy under 90min threshold).
- **Spec warning: dispatcher combining heartbeat/status text into raw-output tee file must split before wiring Layer 1** — missed: adw-test.ts has no raw-output.jsonl — only tester/events.jsonl (an event stream appended at lifecycle boundaries). spawnStage for the test stage passes tester/events.jsonl as the teeFile (adw-plan-review-build-patch.ts:484). The spec's 'Relevant Files' section explicitly warns: 'Layer 1's staleness check reads these same tee files only if they contain raw child output, not heartbeat-only lines. If any dispatcher combines heartbeat/status text into that tee file, split heartbeat output before wiring Layer 1.' events.jsonl is precisely such a stream. A long bun test run with no lifecycle events for >5 min would trip a false Layer-1 stall-kill. The other four stages correctly use raw-output.jsonl.

