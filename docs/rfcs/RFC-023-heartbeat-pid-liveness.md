# RFC-023: Heartbeat PID Liveness Signal

**Status:** PROPOSED
**Created:** 2026-06-27
**Author:** tmax Design Team
**Follows from:** ADR-0106 (Watchdog Resume-All Gap), ADR-0094 (Pipeline Architecture), RFC-020 (adw Observability)

## Context

The adw pipeline orchestrator emits structured heartbeat lines every 30 seconds during long-running stages (build, test, patch-review). Each heartbeat reports:

```
{ event: "heartbeat", stage, elapsed_ms, tee_file?, tee_delta_bytes? }
```

The `tee_delta_bytes` field measures growth of the stage's raw-output JSONL (stdout captured via `tee`). This is the **only liveness signal** in the heartbeat.

### Problem

Not all pipeline activity writes to the tee file. The patch-review stage has a multi-phase structure:

| Phase | Where output goes | `tee_delta_bytes` |
|-------|-----------------|-------------------|
| `claude /audit` (the actual review) | raw-output.jsonl (stdout) | ✅ Accurate |
| Gate commands (`bun run typecheck:src`, `bun test test/unit/`, `bin/tmax-use test`) | stderr / subprocess exit codes | ❌ Always 0 |
| `codex exec` (spec-review) | raw-output.jsonl (stdout) | ✅ Accurate |

When a gate command runs for 15+ minutes (unit tests, tmax-use e2e), the heartbeat reports `+0B since last beat` for the entire duration. A human reading the heartbeat log (or the orchestrator's `events.jsonl`) sees 30+ consecutive `0B` heartbeats and reasonably concludes the stage is stalled or dead — when in fact it's actively running gate commands that happen to write to stderr, not the tee file.

This has happened in production:
- **CHORE-39 build retry 2 (2026-06-27):** The patch-review stage ran typecheck → unit tests → tmax-use e2e gates (collectively ~16 minutes), all writing to stderr. The heartbeat reported `+0B` for 32 consecutive beats. A human checking status via `agents/*/orchestrator/events.jsonl` saw `tee_delta_bytes: 0` and asked "is it hung?" — it wasn't.

### Why not just check file growth?

Adding stderr capture would work for gate commands, but introduces complexity:
- Gate commands are `spawnSync` calls inside the orchestrator, not piped through the tee
- Adding a second tee stream doubles the bookkeeping
- The root problem is that **byte growth is a proxy for liveness, not a direct liveness signal**

## Proposal

Add a **PID liveness check** to the heartbeat payload. The heartbeat already wraps the child subprocess; passing the PID is trivial.

### Changes

**`HeartbeatOptions`** — add optional `childPid?: number`:

```typescript
export interface HeartbeatOptions {
  stage: string;
  teeFile?: string;
  childPid?: number;          // NEW — child subprocess PID
  intervalMs?: number;
  write?: (s: string) => void;
  clock?: HeartbeatClock;
  onBeat?: (payload: HeartbeatPayload) => void;
}
```

**`HeartbeatPayload`** — add `child_alive: boolean`:

```typescript
export interface HeartbeatPayload {
  stage: string;
  elapsed_ms: number;
  tee_file?: string;
  tee_delta_bytes?: number;
  child_alive?: boolean;      // NEW — true if child PID is still running
}
```

**`withHeartbeat` beat handler** — add PID check:

```typescript
const handle = clock.setInterval(() => {
  // ... existing elapsed + tee delta logic ...

  let childAlive: boolean | undefined;
  if (opts.childPid !== undefined) {
    try { process.kill(opts.childPid, 0); childAlive = true; }
    catch { childAlive = false; }
  }

  // payload now includes child_alive when childPid is provided
});
```

**Orchestrator callers** — pass `childPid: child.pid` to `withHeartbeat` at each spawn site (build, test, patch-review). This is already available — the orchestrator spawns each child process and has `child.pid` before calling `withHeartbeat`.

### Heartbeat line format

With `child_alive`, the stderr line becomes:

```
[adw] patch-review (iteration 3/3) running — 16m0s elapsed, raw-output.jsonl +0B since last beat, child alive
```

When the child has exited (e.g., the heartbeat fires between child exit and parent processing the close event):

```
[adw] patch-review (iteration 3/3) running — 16m0s elapsed, raw-output.jsonl +0B since last beat, child exited
```

### Reading the signals

A consumer of heartbeat events (`orchestrator/events.jsonl` or stderr) can now distinguish three states:

| `tee_delta_bytes` | `child_alive` | Interpretation |
|-------------------|---------------|----------------|
| `> 0` | `true` | ✅ Active — claude/codex producing output |
| `0` | `true` | ✅ Active — running but output is elsewhere (gate commands, API wait) |
| `0` | `false` | ⚠️ Stalled/dead — child exited without producing output |
| `> 0` | `false` | (impossible — dead child can't write) |

This eliminates the false "stalled" diagnosis for gate-command phases.

## Safety: why this won't repeat the watchdog bugs

ADR-0106 documents a class of bugs where the watchdog auto-resumed stale-dead workspaces, spawning unintended orchestrators that dirtied the tree. The key distinction:

| Aspect | Watchdog resume (ADR-0106 bugs) | Heartbeat PID liveness (this RFC) |
|--------|----------------------------------|----------------------------------|
| Action triggered | Auto-resume pipeline | None — purely observational |
| Signal used | `status != running` + PID dead | `child_alive` boolean in heartbeat |
| Side effect | Spawns processes, edits tree, consumes API budget | Writes a field to an existing JSON line |
| Blast radius | Unbounded — 4 zombie orchestrators in 30 minutes | Zero — no action taken |

The PID check itself (`process.kill(pid, 0)`) is a standard POSIX pattern — it sends signal 0 (no-op) and checks for ESRCH. It cannot harm the child or the tree. The watchdog bugs were in **what action was taken based on the signal**, not the signal itself.

This RFC adds no auto-action. It only makes the existing heartbeat more informative.

## Alternatives

### 1. Tee stderr alongside stdout
- Adds a second tee file per stage
- Requires piping `child.stderr` through a separate tee process
- Works but adds complexity for every stage; the PID check is simpler and more general
- **Rejected** — solves the gate-command case but not the "claude is thinking" case (both stdout and stderr are silent during API waits)

### 2. Heartbeat timeout that kills the child
- If N consecutive `0B` beats, kill the child
- This was attempted in ADR-0104 (test-stage wall-clock timeout) and caused issues — the timeout killed `bun test` while it was legitimately running slow unit tests
- **Rejected** — `tee_delta_bytes: 0` is not a reliable stall indicator (gates, API waits)

### 3. Do nothing — the tmux window shows the truth
- A human can `tmux attach` and see the actual output
- But the heartbeat exists precisely so you don't need to attach — it's the remote status signal
- **Rejected** — defeats the purpose of structured observability (RFC-020)

## Consequences

**Easier:** Status checks via `events.jsonl` are now authoritative. No more "is it hung or just running gates?" ambiguity. The `child_alive` field is a definitive liveness signal.

**Implementation cost:** ~15 lines in `heartbeat.ts` + passing `childPid` at each `withHeartbeat` call site in the orchestrator (~6 call sites). No new dependencies.

**Backward compatible:** `child_alive` is optional in the payload. Existing heartbeat consumers that don't check it are unaffected.
