# Test-Stage Wall-Clock Timeout + Process-Tree Kill

## Status

Accepted

## Context

The initial `adw-test.ts` dispatcher (ADR-0101) spawned `bun run test:unit` via `runRaw` and awaited `child.on("close")` with **no wall-clock timeout**. On workspace `01KVNYP3P5` (SPEC-063), a hung test (later diagnosed as the BUG-16 socket leak, ADR-0103) pinned a CPU core at 103% for 6+ minutes with zero output, and the stage sat idle forever — no event, no error, no recovery. The operator had to notice and SIGKILL manually.

Two gaps were exposed:
1. **No wall-clock bound.** A single hung test or wedged subprocess hung the entire stage indefinitely.
2. **No process-tree kill.** Even if a timeout killed the direct child (`bun run test:unit`), the grandchild (`bun test`) and great-grandchildren (the actual test process, any spawned servers) would keep running as orphans, burning CPU and holding resources into the next resolve iteration.

The unit suite's true runtime is ~777s (3019 tests, 201 files) — far longer than the naive "tests are fast" assumption. Any timeout must distinguish "suite is legitimately slow" from "suite is hung."

## Decision

Wrap `runRaw` in `adw-test.ts` with a **wall-clock timeout that kills the child's process group**:

1. **`detached: true`** on the `spawn` call — makes the child a process-group leader so a subsequent `process.kill(-pid)` reaches the whole tree (`bun run` → `bun test` → any spawned servers/sub-agents), not just the direct child.

2. **`STAGE_RUN_TIMEOUT_MS` (default 1,200,000 ms = 20 min)** — a wall-clock cap on each `bun run test:*` invocation. Chosen as ~1.5× the measured suite runtime (~777s) with headroom for slower CI boxes. Override via the `ADW_TEST_STAGE_TIMEOUT_MS` env var. The original value was 180s (3 min) — written before measuring, unreachable for a 3000-test suite; it killed healthy runs and caused 3 spurious resolve iterations on workspace `01KVPRP6Y1`.

3. **On timeout: `process.kill(-child.pid, "SIGKILL")`** (group kill, falling back to `child.kill("SIGKILL")` if the group kill fails), then resolve `Right({ ok: false, exitCode: -1, stderr: "...timed out..." })`. The timeout returns `Right` with `ok: false`, not `Left` — a timed-out suite is a track failure (the resolve loop handles it), not a stage infrastructure error.

4. **`settled` guard** — both the `close` handler and the timeout timer check a `settled` flag so the second-firing one is a no-op. Prevents a double-resolve if the child exits just as the timer fires.

## Consequences

**Easier:** A hung suite fails fast (≤20 min) instead of hanging forever; the resolve loop gets a chance to fix the underlying cause. Group-kill prevents orphan processes from accumulating across resolve iterations. The `Right`/`Left` boundary stays clean: timeouts are track outcomes, not infrastructure errors.

**Harder:** The 20-min cap is a blunt instrument. A legitimately-slow run that exceeds 20 min (e.g. a much larger test suite on a slow CI box) is killed even though it would have completed. Mitigation: `ADW_TEST_STAGE_TIMEOUT_MS` is tunable, and the cap is decoupled from the suite's per-test `--timeout`. A stall detector (proposed in SPEC-066) would be sharper — it watches tee-file *growth* (real staleness), not wall-clock (which can't distinguish slow from stuck) — but requires the in-process watchdog Layer 1 that hasn't been built yet.

**Why `process.kill(-pid)` and not a `try/catch` shutdown:** a busy-looping or wedged child may not honor a graceful signal; SIGKILL is the only reliable stop. The `detached: true` + group-kill pattern is also used by `adw-patch-review.ts`'s gate runner and is the project's standard for "kill the whole subprocess tree."

**Related:** ADR-0101 (the test stage this bounds), ADR-0103 (the BUG-16 fix that made the timeout rarely fire in practice), SPEC-066 (the proposed stall detector that would supersede the wall-clock cap with growth-based detection).
