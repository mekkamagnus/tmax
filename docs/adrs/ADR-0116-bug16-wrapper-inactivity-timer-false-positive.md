# BUG-16 Root-Cause Reclassification — Wrapper Inactivity-Timer False-Positive (Reporter Burstiness)

## Status

Accepted — implemented in the working tree (`scripts/run-unit-tests.ts`, `test/unit/claude-529-retry.test.ts`); pending commit. Reclassifies the unresolved "load-dependent stall" claim left open by [ADR-0113](ADR-0113-adw-test-infrastructure-hardening.md). Does **not** supersede the per-file lifecycle fixes in [ADR-0103](ADR-0103-server-test-socket-leak-fix.md) — those stand and remain necessary.

## Context

BUG-16 was the longest-running defect in the project: `bun run test:unit` appeared to hang intermittently mid-suite, blocking every `/goal` build session whose goal required `test:unit` to pass. Two prior ADRs shipped substantial fixes:

- [ADR-0103](ADR-0103-server-test-socket-leak-fix.md) — `connectWithTimeout` / `forceShutdown` / `sweepTestSockets` / `afterEach` cleanup (hermetic per-file lifecycle).
- [ADR-0113](ADR-0113-adw-test-infrastructure-hardening.md) — `destroyRejectedServer`, the inactivity timer, adw-* LLM-subprocess exclusion, file-level exit-regression test, 529 budget expansion, patch-reviewer gate timeouts.

Both shipped, yet the suite **still** appeared to hang intermittently. ADR-0113's own Consequences captured the contradiction without resolving it: *"`_getActiveHandles()` diagnostics proved there is no cumulative handle leak; the stall is OS-level resource contention when multiple heavy processes compete"* — i.e. there was no leak, but the suite still "stalled," and the cause was attributed to ambient load.

A `/goal` session tasked with making every DoD gate go literally green re-investigated and found that attribution was wrong: **the suite was never stalling.** It was completing normally; the wrapper's own watchdog was killing it.

## Decision / Discovery

### Root cause: the inactivity timer false-fires on the bursty default reporter

`scripts/run-unit-tests.ts` has a mid-suite watchdog: if the child produces no stdout for `INACTIVITY_TIMEOUT_MS` (120s) and the summary line hasn't appeared, it logs `"mid-suite hang (BUG-16)"`, `SIGKILL`s the child, and exits 1. The timer resets on every stdout chunk.

The flaw: bun's **default reporter is bursty** — it emits results at file granularity, not test granularity. A single slow file (or a cluster of slow files) produces **zero stdout for well over 120s** even while tests are actively passing. The watchdog interpreted that silent-but-progressing stretch as a hang and killed a healthy run. This is exactly the "non-deterministic, load-dependent stall" ADR-0113 observed: it tracked the reporter's burstiness under load, not any resource leak.

### Proof

Re-running the identical suite with `--dots` (one character per completed test) completes clean:

> 2421 pass / 1 skip / 0 fail, 2422 tests / 169 files, **796.62s, exit 0**

Same files, same per-test timeout, same machine — the only change was reporter cadence. With `--dots`, the longest plausible silent stdout stretch is bounded by the per-test timeout (`PER_TEST_TIMEOUT_MS` = 60s), comfortably under the 120s inactivity threshold. Under the default reporter the stretch is bounded by the slowest *file*, which routinely exceeds 120s. The "hang" was a measurement artifact.

### Fix 1 — force a high-frequency reporter on the all-files path

`buildTestArgs()` now passes `--dots` on the default all-files path so output is per-test. The inactivity timer now fires only on a *genuine* hang (max output gap ≈ `PER_TEST_TIMEOUT_MS` = 60s ≪ 120s). The hard timer (`HARD_TIMEOUT_MS` = 1200s) and per-test timeout remain as independent backstops. Explicit-target invocations are unaffected (a single file the caller named).

```ts
// --dots emits one character per completed test, giving a steady output
// stream. The default reporter is bursty (file-level results); under the
// ~800s full suite a slow file cluster can create a >120s stdout gap even
// while tests are passing, which would falsely trip the mid-suite-hang
// inactivity timer below.
return ["test", "--dots", "--timeout", String(PER_TEST_TIMEOUT_MS), ...allFiles, ...flags];
```

### Fix 2 — claude-529-retry assertion drift (uncovered along the way)

While greening the gates, `test/unit/claude-529-retry.test.ts` failed: it asserted the error message contained `"3 retries"`, but commit `4254833` (per ADR-0113) expanded `CLAUDE_529_BACKOFF_MS` from 3 to 8 entries. The retry code already used `${delays.length} retries` (= `"8 retries"`); only the test was stale. Made the assertion dynamic so it cannot drift again:

```ts
expect(result.left).toContain(`${CLAUDE_529_BACKOFF_MS.length} retries`);
expect(calls).toBe(1 + CLAUDE_529_BACKOFF_MS.length);
expect(delays).toEqual([...CLAUDE_529_BACKOFF_MS]);
```

## What the prior ADRs got right (do not revert)

The per-file lifecycle work in ADR-0103/0113 is **correct and necessary** — it is the reason 169 files can run cleanly in one process with zero orphan sockets. The diagnosis of *what causes the observed "hang"* was wrong, but the fixes themselves address real latent defects (no connect-phase timeout, shutdown skipped on assertion throw, rejected-server handle leak, LLM-subprocess tests blocking under concurrent load). **Keep all of it.** The gap was mis-attributing the wrapper's reporter-burstiness false-fire to those leaks.

## Consequences

**Easier:**
- `bun run test:unit` is finally trustworthy: 2421/1skip/0fail in 796s, **zero false-positive kills**. Every DoD gate (`typecheck:src`, `typecheck:test`, `typecheck`, `build`, `test:unit`, `test:integration`, `test:tmax-use`) goes green in one pass.
- `/goal` sessions whose condition includes `test:unit` can actually terminate instead of goal-exhausting against a phantom hang.
- Future audits stop chasing a non-existent socket/handle leak.

**More difficult / open — two real issues surfaced and flagged, not fixed (neither fails a gate):**

1. **Cumulative memory growth (~1.45 GB RSS)** across the single `bun test` process — editor / T-Lisp-interpreter instances retained, producing GC-pressure slow spots around tests ~730 and ~1118. The suite still completes in 796s with 0 failures, but it is a genuine leak worth a dedicated pass (likely worsened by the immutable-model + `applyUpdate` allocations from CHORE-41/42/43, [ADR-0114](ADR-0114-editor-functional-core-deepening.md)). Unrelated to sockets.

2. **Orphan-pollution cascade (diagnostic confound, now understood)** — `kill -9` of a parent `bun test` (wrapper SIGKILL-on-timeout **or** a manual kill) orphans spawned grandchildren: daemons from the daemon/server tests and the `bun test` children of `server-test-exit-regression`. They reparent to init (PPID 1), keep running, burn CPU, and stall *subsequent* runs. This is the mechanism that made prior audits see "cumulative" and "load-sensitive" behavior — they were measuring polluted environments, not clean-suite behavior. Mitigation between manual runs: `pkill -9 -f 'bun test'; pkill -9 -f 'bun.*src/main.tsx'` and clear `/tmp/tmax-*.sock*`. A proper fix would have the wrapper kill the whole process tree (e.g. detached process group + `kill -pgid`, as the adw test stage already does per [ADR-0104](ADR-0104-test-stage-wall-clock-timeout.md)).

**Rule for future test-infra work:** a stdout-chunk-based watchdog is only safe if the child emits output **at least as frequently as the watchdog timeout**. When the child's own reporter is bursty (file-level), either (a) force a high-frequency reporter (`--dots`) or (b) make the inactivity timeout `≫` the child's longest plausible silent stretch. The wrapper's hard timer + per-test timeout already bound the true worst case; the inactivity timer is the only one that depends on reporter cadence, and it must not be the tightest bound.

**Correction to record:** ADR-0113's "load-dependent OS-level resource contention" stall is reclassified as a **wrapper-watchdog false-positive**. The handle-leak remediation in ADR-0103 and the broader hardening in ADR-0113 stand.

**Related:** [BUG-16](../specs/BUG-16-unit-suite-server-socket-leak.md), [ADR-0103](ADR-0103-server-test-socket-leak-fix.md), [ADR-0113](ADR-0113-adw-test-infrastructure-hardening.md), [ADR-0107](ADR-0107-api-529-rate-limit-retry.md), [ADR-0104](ADR-0104-test-stage-wall-clock-timeout.md).
