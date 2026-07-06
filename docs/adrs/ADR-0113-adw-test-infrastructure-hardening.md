# adw Test Infrastructure Hardening — BUG-16/22, Gate Timeouts, 529 Retry Budget

## Status

Accepted — implemented across commits `d8736d5`–`4254833`.

## Context

The adw pipeline's test infrastructure had three systemic defects that blocked every `/goal` build session during CHORE-39/40/41/42/43:

1. **BUG-16 (unit suite server-socket leak)** — `bun run test:unit` hung indefinitely due to cumulative resource leaks in the server-test files. Every `/goal` session whose goal condition included `test:unit passes` either goal-exhausted or was killed after 1-2 hours of fighting the hang.

2. **BUG-22 (Claude edits main repo, not worktree)** — Claude hardcodes `cd /Users/.../tmax` in Bash commands, ignoring the worktree spawn cwd. Every build's work landed in the main repo, not the worktree branch — losing the diff for patch-review and requiring manual recovery.

3. **API 529 gateway overload** — The Z.ai gateway returns persistent 529 (overloaded) errors during the GLM Coding Plan campaign ([GitHub Issue #87](https://github.com/zai-org/GLM-5/issues/87)), killing the patch-review claude audit before it could produce a verdict.

These were not code defects in the editor or adw pipeline logic — they were test-infrastructure and external-dependency issues that nonetheless blocked all automated verification.

## Decision

### BUG-16: Server-test lifecycle hardening

- **`destroyRejectedServer()`** — when a test creates a second `TmaxServer` on the same socket and `start()` rejects, the constructor's `net.Server` handle (created at `server.ts:158`) lingers. `destroyRejectedServer` closes + unrefs that handle without removing the shared socket file (which the first server owns). Applied to all 3 rejected-second-server tests in `server-daemon-hardening.test.ts`.
- **Race-timeout on `second.start()`** — races `start()` against a 2s timeout so a wedged start (which hangs instead of rejecting) can't block the suite.
- **`run-unit-tests.ts` inactivity timer** — kills the child if no output for 120s AND no summary seen, catching mid-suite hangs (not just exit-stalls).
- **Exclude adw-* LLM-subprocess tests from `test:unit`** — the 14 `adw-*.test.ts` files spawn real `claude`/`codex` subprocesses that block under concurrent pipeline load. Moved to a separate `test:adw` script. The non-adw unit suite (169 files, 2421 tests) completes in ~925s.
- **File-level exit regression test** — runs both suspect files as subprocesses under a 150s guard, asserts `allPassed: true` AND `cleanExit: true`.
- **`connectWithTimeout` timeout-branch test** — monkey-patches `Socket.prototype.connect` to a no-op, directly exercising the `setTimeout` branch (not the ENOENT error path).

### BUG-22: Worktree directive in build prompt

`buildImplementPrompt()` prepends a worktree directive to both the `/goal` and `/implement` prompts, instructing Claude to work relative to its current directory and never `cd` to a hardcoded path. This is a prompt-level fix because the spawn cwd is correct; Claude just ignores it.

### 529 retry budget expansion

`CLAUDE_529_BACKOFF_MS` expanded from 3 retries (30s/60s/120s = 3.5 min) to 8 retries (30s/60s/120s/240s/300s×4 = ~28 min), enough to outlast most gateway overload windows.

### Patch-reviewer gate timeouts

The unit and tmax-use gates now have wall-clock caps (1200s and 180s respectively) so patch-review can't hang on the very bugs it's reviewing. The unit gate uses `bun run test:unit` (the wrapper) instead of bare `bun test test/unit/`, so it excludes the adw-* LLM tests.

## Consequences

**Easier:**
- `bun run test:unit` now completes reliably (2421 pass, ~925s) without concurrent pipeline load.
- The `/goal` build sessions no longer waste 1-2 hours fighting the test hang — the goal condition can actually be satisfied.
- Claude's edits land in the worktree (BUG-22 fix), so patch-review can audit the real diff.
- The 529 retry budget covers most gateway outage windows.

**More difficult / open:**
- The full suite (`test:unit` with adw-* tests included) still blocks under concurrent pipeline load. The adw-* tests are integration tests that belong in `test/integration/`, not `test/unit/`. Moving them is a separate cleanup.
- The `test:unit` stall is non-deterministic and load-dependent — `_getActiveHandles()` diagnostics proved there is no cumulative handle leak; the stall is OS-level resource contention when multiple heavy processes compete.
- The patch-review claude audit is still subject to extended 529 outages (2+ hours observed). The 8-retry budget helps but cannot cover indefinite outages.

**Related:** BUG-16, BUG-18, BUG-22, CHORE-40, ADR-0107 (529 retry), ADR-0108 (compile gate), ADR-0112 (goal mode + BUG-23).
