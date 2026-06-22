# Server-Test Socket-Leak Fix — Shared Lifecycle Helpers

## Status

Accepted

## Context

The full unit suite (`bun run test:unit`) **hung indefinitely** at ~750 tests. Diagnosis (BUG-16):

- Every server test used `net.connect(socketPath)` / `RpcConnection.connect(socketPath)` with **no connection-phase timeout** — only the response had a timeout. A `connect()` to a stale or wedged socket hung forever at the socket layer, and bun's per-test timeout didn't fire (it covers the test's async body, not a `connect` callback that never fires).
- `server.shutdown()` was the *last statement* of each test. If any assertion above it threw, shutdown never ran — the socket file stayed on disk, the `autoSaveTimer` interval kept firing, and the listening socket stayed open. 1,850 orphaned `/tmp/tmax-test-*.sock` files had accumulated.
- There was no cross-test cleanup of leaked state. Over a full suite run, dozens of leaked sockets and timers accumulated until the process stalled at 0% CPU (blocked on I/O, not looping).

Every test file passed in isolation (169 files, 0 failures) — the bug was purely cumulative across files. This blocked CI, blocked the adw test stage (ADR-0101), and made "did my change break anything?" checks unreliable.

## Decision

Fix the resource lifecycle in the 6 server-test files so each test is hermetic, via **shared lifecycle helpers** (not inline duplication):

1. **`test/fixtures/server-test-helpers.ts`** — a new shared module exporting:
   - `connectWithTimeout(socketPath, timeoutMs = 2000): Promise<Socket>` — wraps `net.connect` with a connection-phase timeout that destroys the socket and rejects on expiry. A healthy local Unix socket connects in <10ms; 2s is a safe ceiling that catches wedges.
   - `forceShutdown(server): Promise<void>` — idempotent shutdown that captures the socket path *before* awaiting `server.shutdown()`, swallows errors, and unlinks the residual socket file if it still exists. Covers the case where shutdown throws before unlink.
   - `sweepTestSockets(): void` — best-effort `unlink` of all `/tmp/tmax-{test,observability,...}-*.sock` files. A safety net called in `beforeAll`/`afterAll`; the per-test `forceShutdown` is the real fix.

2. **Every server test moves `server.shutdown()` into `afterEach`** (not the last line of the test body). `afterEach` runs even when a test times out or an assertion throws — a `try/finally` inside the test body does not. This is the key to guaranteeing cleanup.

3. **Every `connect(socketPath)` is replaced** with `connectWithTimeout(socketPath)` — either directly or via the `RpcConnection.connect` static method, which now routes through `connectWithTimeout` internally.

4. **Production `src/server/server.ts:shutdown()` is unchanged** — the bug was in test lifecycle management, not the server. The auditor verified `shutdown()` is already idempotent (`if (this.shuttingDown) return`), clears all timers, destroys client sockets, and unlinks the socket + lock under `ownsSocket`/`ownsLock` guards.

## Consequences

**Easier:** The full suite completes reliably — measured 3019 pass / 0 fail / 0 orphan sockets / 0 leaked daemons in ~777s (vs indefinite hang before). `bun run test:unit` is trustworthy as a CI gate again. The adw test stage (ADR-0101) can run the suite without hanging.

**Harder:** The 2s connection timeout is a judgment call — too tight and healthy sockets false-fail on a loaded box; too loose and the original hang returns. 2s is >200× the observed healthy connect time, so the margin is wide, but it's a tunable constant. The `sweepTestSockets` safety net is a concession to historical accumulation (the 1850 orphans); ideally per-test cleanup alone suffices, but the sweep prevents a bad historical state from corrupting future runs.

**Related:** BUG-16 (the spec), ADR-0101 (the test stage that depends on a runnable suite), ADR-0104 (the wall-clock timeout that bounds the stage if a regression reintroduces a hang).
