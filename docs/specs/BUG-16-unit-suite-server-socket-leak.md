# Bug: Unit test suite hangs mid-run due to cumulative socket/server leaks in server-test files

## Bug Description

Running the full unit suite (`bun run test:unit`) **hangs indefinitely** somewhere between the 750th and 1130th test. The process drops to **0% CPU** (blocked, not looping) and never recovers — bun's per-test timeout does not fire, so the suite sits forever until killed externally. The hang point is **position-independent**: it lands on different test files between runs even under identical conditions (e.g. `markdown-spec-039.test.ts` one run, `command-documentation-preview.test.ts` the next, `jumplist.test.ts` the next).

**Expected:** `bun run test:unit` completes with all tests passing under the current 1200s wall-time gate. The two suspect server-test files also exit cleanly when run directly under an external guard.

**Actual:** The suite blocks forever partway through; Ctrl-C / SIGKILL is the only exit.

### Evidence gathered during diagnosis (2026-06-22)

- **Every test file passes in isolation** (`gtimeout -s KILL 10 bun test <file>` × 169 files → 0 hangs, 0 failures). The bug is *cumulative across files*, not in any single file.
- **First-half / second-half split:** first 84 files pass (1410 tests); second half hangs. Both quarters of the second half hang, but the *earlier* quarter hangs faster (157 tests in) than the later one (442 tests in).
- **Serial execution (`--max-concurrency=1`) gets further** (~1131 tests vs ~750 concurrent) but still hangs — inside the server-test cluster.
- **Hung process shows 0% CPU** repeatedly when sampled → blocked on I/O, not busy-looping.
- **1,850 orphaned `/tmp/tmax-test-*.sock` files** had accumulated on disk (3 weeks' worth) — `server.shutdown()` wasn't unlinking them because tests were timing out / crashing without running cleanup.
- **A leaked `bun src/server/server.ts` daemon process** was running in the background since the prior Sunday.
- **Every server test uses `connect(socketPath)` with NO connection timeout** — only the *response* has a timeout. A `connect()` to a stale or wedged socket can hang indefinitely at the socket layer, and that hang is invisible to bun's per-test timeout (it fires in the test's async body, not in a `connect` callback that never fires).

## Problem Statement

The unit suite is non-runnable as a whole. This blocks CI, blocks the adw test stage (SPEC-063), and makes any "did my change break anything?" check unreliable. The June socket/server lifecycle leaks must remain fixed, but the current July regression appears to be a lingering handle that prevents process exit after the suspect server-test files finish their assertions.

## Solution Statement

Fix the resource lifecycle in the 6 server-test files so each test is hermetic, then identify and clean up the July lingering-handle exit-stall:

1. **Add a connection timeout to every `connect(socketPath)`** so a wedged socket fails fast instead of blocking forever. A shared helper (`connectWithTimeout`) prevents the bug class across all server tests.
2. **Guarantee `server.shutdown()` runs even on test failure/timeout** via `afterEach` (not inline at the end of each test). Currently shutdown is the last line of each test — if any assertion throws, shutdown never runs and the socket/process leaks.
3. **Verify `TmaxServer.shutdown()` is actually idempotent and complete** — confirm it unlinks the socket file, clears all timers (`autoSaveTimer`, `debouncedSaveTimers`), and destroys all client sockets even when called from a partial state.
4. **Identify the surviving active handle in the current suspect files** (`server-daemon-hardening.test.ts`, `server-observability.test.ts`) and clean up its owner. The accepted fix must prove file-level process exit, not just passing assertions.

No production-code changes unless active-handle evidence or a regression test proves production cleanup is incomplete. Start from test-owned partial servers and editor/runtime timers before changing `src/server/server.ts`.

## Steps to Reproduce

1. From a clean shell: `rm -f /tmp/tmax-{test,observability,harden,save,server-client,server-daemon-test}-*.sock` (start with no stale sockets).
2. Run: `bun run test:unit` (or `gtimeout -s KILL 120 bun test --timeout 30000 test/unit/` to auto-kill).
3. Observe: the run progresses normally through ~750 tests, then stops printing output. CPU drops to 0%. The process never exits.
4. Reproducibility: ~100% on the observed tree. Hang point varies between runs (confirming the cumulative-leak signature).
5. Contrast: `bun test --timeout 8000 test/unit/<any-single-file>.test.ts` always passes.

## Root Cause Analysis

The original June diagnosis found real lifecycle leaks in the server-test files: raw socket connects had no connection timeout, `server.shutdown()` was often the last statement in a test body, and old `/tmp/tmax-*.sock` files accumulated across runs. Those issues are still part of the fix and must not regress.

The July 5 re-investigation changed the active bug: the current failure is an **exit-stall from a lingering process handle**, not a proven Unix-socket connect hang. The targeted server-test files finish their assertions and print shutdown logs, then the Bun process remains alive at 0% CPU. A minimal isolated repro of `TmaxServer.start()` / rejected second server / `forceShutdown()` exits with **0 active handles**, so implementers should not chase broad `TmaxServer.shutdown()` rewrites unless a new handle dump proves a production shutdown gap.

The most likely remaining vector is test-file cumulative state: partially-started second `TmaxServer` instances, editor/runtime timers introduced by recent model/command-queue work, or client/server handles created inside `server-daemon-hardening.test.ts` and `server-observability.test.ts` that survive file teardown. The fix must identify the surviving handle type in the real hanging files, then clean up that specific source with a regression test that proves the file process exits.

**Why the hang point moves:** the trigger is resource-threshold or handle-order dependent, not tied to the innocent file where the full suite stops printing.

**Why serial execution gets further:** `--max-concurrency=1` reduces peak resource usage, so the threshold is reached later, but it does not eliminate the underlying lingering handle.

## Relevant Files

Use these files to fix the bug:

### New Files

- **`test/fixtures/server-test-helpers.ts`** — Shared helpers for server tests:
  - `connectWithTimeout(socketPath, timeoutMs = 2000): Promise<Socket>` — wraps `net.connect` with a connection-phase timeout that destroys the socket and rejects on expiry. Used by every server test helper instead of bare `connect()`.
  - `forceShutdown(server): Promise<void>` — idempotent shutdown that catches errors and guarantees the socket file is unlinked even if `server.shutdown()` throws. Used in `afterEach`.
  - `sweepTestSockets(): void` — best-effort cleanup for all known server-test socket prefixes (`/tmp/tmax-test-*.sock`, `/tmp/tmax-observability-*.sock`, `/tmp/tmax-harden-*.sock`, `/tmp/tmax-save-*.sock`, `/tmp/tmax-server-client-*.sock`, `/tmp/tmax-server-daemon-test-*.sock`), called once in a global `afterAll` as a safety net.

### Existing Files to Modify

- **`test/unit/server-observability.test.ts`** — Update the local `RpcConnection.connect(socketPath)` implementation so it uses `connectWithTimeout(socketPath)` internally and still returns a `RpcConnection` instance with `.send()`, `.collectResponses()`, etc. Move `server.shutdown()` out of each test body into an `afterEach`. This is the highest-impact file (10+ connect calls).
- **`test/unit/server-daemon-hardening.test.ts`** — Same treatment: update the local `RpcConnection.connect(socketPath)` implementation to call `connectWithTimeout(socketPath)` internally while preserving the `RpcConnection` API, plus `afterEach` shutdown. Also inspect partially-started second-server instances and any surviving active handle reported by the July exit-stall diagnostics.
- **`test/unit/test-ai-agent-control.test.ts`** — Replace the inline `sendRequest` helper's `connect(socketPath)` with `connectWithTimeout`. Move `server.shutdown()` into `afterEach`. This file has many timer/connect hits.
- **`test/unit/server-client.test.ts`** — Replace raw `connect(socketPath)` usage with `connectWithTimeout`; add `afterEach` shutdown.
- **`test/unit/server-save-file.test.ts`** — Same pattern. Verify `afterEach` covers every test.
- **`test/unit/server-daemon.test.ts`** — Currently starts the daemon through `execAsync('TMAX_SOCKET=... timeout 8s bun run src/main.tsx --daemon || true')` rather than instantiating `TmaxServer` directly. Keep the shell timeout and add shell-safe socket cleanup, or refactor to `spawn` and retain a process handle before adding SIGTERM/SIGKILL `afterEach` cleanup. May not need `connectWithTimeout` if it only checks stdout, but audit it.

### Existing Files to Read (reference, likely no change)

- **`src/server/server.ts`** — `TmaxServer.shutdown()` and `removeFile()`/`ownsSocket` logic. Read to confirm shutdown is idempotent and unlinks the socket under all exit paths. Only modify if a handle dump or regression test proves a gap (e.g. shutdown throws before unlink on a partially-started server).
- **`src/editor/editor.ts`** — Audit timer/queue machinery (`setTimeout`, `setInterval`, command draining, model/state sync) if active-handle dumps point at timers or editor-owned async work.
- **`test/mocks/terminal.ts`**, **`test/mocks/filesystem.ts`**, **`test/helpers/editor-fixture.ts`** — Existing test helpers; match their style for the new `server-test-helpers.ts`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Task 1: Create shared server-test helpers

**User Story**: As a test author, I want a single vetted `connectWithTimeout` and `forceShutdown` helper so that every server test handles socket/server lifecycle identically and a wedged socket fails fast instead of hanging.

- Create `test/fixtures/server-test-helpers.ts`.
- Implement `connectWithTimeout(socketPath: string, timeoutMs = 2000): Promise<Socket>`:
  - Wrap `net.connect(socketPath)` in a `Promise`.
  - Start a `setTimeout(timeoutMs)` immediately. On expiry: `socket.destroy()` and `reject(new Error(\`connect to ${socketPath} timed out after ${timeoutMs}ms\`))`.
  - On `connect` event: `clearTimeout`, resolve the socket.
  - On `error` event: `clearTimeout`, reject.
- Implement `forceShutdown(server: TmaxServer | null): Promise<void>`:
  - No-op if `server` is null.
  - Capture `server.getSocketPath()` before shutdown.
  - `await server.shutdown()` in try/catch; swallow errors (best-effort). Rely on `shutdown()` idempotency; do not inspect the private `shuttingDown` field.
  - After shutdown, best-effort `unlink` the socket path if the file still exists (defensive — covers the case where shutdown threw before unlink).
- Implement `sweepTestSockets(): void` — remove every socket in `/tmp` whose filename starts with one of `tmax-test-`, `tmax-observability-`, `tmax-harden-`, `tmax-save-`, `tmax-server-client-`, or `tmax-server-daemon-test-` and ends with `.sock`, swallowing ENOENT. (Zero-dep: use `readdirSync` + filter, not a glob library.)
- Export all three.

**Acceptance Criteria**:
- [ ] `test/fixtures/server-test-helpers.ts` exists and exports `connectWithTimeout`, `forceShutdown`, `sweepTestSockets`.
- [ ] `connectWithTimeout` rejects promptly for a non-existent socket path; the test must accept immediate `ENOENT` instead of treating it as evidence that the timeout path fired.
- [ ] The timeout branch is covered by a stale/listening-but-nonresponsive socket scenario or another deterministic test that proves the helper destroys the socket and rejects within `timeoutMs + 100ms` when the connection phase does not complete.
- [ ] `forceShutdown(null)` resolves without throwing.
- [ ] `sweepTestSockets()` does not throw when `/tmp` has no matching files.

### Task 2: Wire helpers into the 6 server-test files

**User Story**: As a developer running the full suite, I want every server test to clean up its server and sockets even when an assertion fails, so that leaked resources don't accumulate and hang the suite.

- For each of `server-observability.test.ts`, `server-daemon-hardening.test.ts`, `test-ai-agent-control.test.ts`, `server-client.test.ts`, `server-save-file.test.ts`:
  - Import `connectWithTimeout`, `forceShutdown` from `../fixtures/server-test-helpers.ts`.
  - Replace every bare `connect(socketPath)` / `connect(testSocketPath)` raw socket call with `connectWithTimeout(...)`.
  - For files with a local `RpcConnection` wrapper, keep `RpcConnection.connect(socketPath)` call sites intact and update the `RpcConnection.connect` implementation to call `connectWithTimeout(socketPath)` internally, preserving the returned `RpcConnection` API.
  - Remove `await server.shutdown()` from the end of every test body. Add an `afterEach(async () => { await forceShutdown(server); server = null; })`.
  - Keep the existing `beforeEach` that mints the socket path; optionally add `sweepTestSockets()` to a global `beforeAll` once at the top of the file to start clean.
- For `server-daemon.test.ts` (subprocess-based): the current test uses `execAsync('TMAX_SOCKET=... timeout 8s bun run src/main.tsx --daemon || true')`, not a retained spawned process handle. Either keep this shell-timeout strategy and wrap the test in `try/finally` to unlink the generated socket path after `execAsync` returns, or explicitly refactor the test to `spawn` and then add `afterEach` cleanup that sends SIGTERM followed by SIGKILL after 500ms. Do not specify SIGTERM/SIGKILL cleanup without retaining a process handle. If the shell-level `timeout ... || true` form stays, assert on captured stdout/stderr and/or exit status so real daemon startup failures are not masked as expected timeout behavior.
- Do NOT change any assertion logic, test names, or the production `src/server/server.ts` in this task — purely lifecycle wiring.

**Acceptance Criteria**:
- [ ] `rg -n '\bconnect\(' test/unit/server-*.test.ts test/unit/test-ai-agent-control.test.ts` has only documented allowed hits: `connectWithTimeout(...)` calls/imports, `RpcConnection.connect(...)` call sites whose local implementation uses `connectWithTimeout`, and no remaining raw `connect(...)` calls from `net`.
- [ ] Every `await server.shutdown()` call in the 6 files has moved into an `afterEach`; no test body ends with a direct shutdown call.
- [ ] Each file imports from `../fixtures/server-test-helpers.ts`.
- [ ] `server-daemon.test.ts` distinguishes the expected external timeout path from real startup failure; `|| true` is not the only reason the test passes.

### Task 3: Identify and clean up the current lingering handle

**User Story**: As a developer fixing the July regression, I want the surviving handle type identified and covered by a file-level exit test so the implementation targets the actual leak instead of the already-fixed socket lifecycle.

- Add temporary active-handle diagnostics only while investigating `server-daemon-hardening.test.ts` and `server-observability.test.ts`. Prefer a small local helper that records `process._getActiveHandles()` / `process._getActiveRequests()` constructor names after `afterEach`/`afterAll`. Remove raw diagnostic logging before finalizing the fix unless it is behind an explicit debug flag used only on failure.
- Run each suspect file directly with an external wall-clock guard and inspect stderr/stdout after the Bun test summary:
  - `gtimeout -s KILL 45 bun test test/unit/server-daemon-hardening.test.ts ; echo "exit: $?"`
  - `gtimeout -s KILL 45 bun test test/unit/server-observability.test.ts ; echo "exit: $?"`
- Identify the surviving handle type and owning code path before changing production code. Expected examples are `Timeout`, `Server`, `Socket`, or Bun/Node request handles; the final spec implementation notes must name the observed type.
- Clean up the owner of the surviving handle. Start with test-owned partial servers and editor/runtime timers or command queues; only change `src/server/server.ts` if the handle dump proves `TmaxServer.shutdown()` leaves a production-owned handle alive.
- Add a permanent regression test or script-level assertion that proves each suspect file exits cleanly, not merely that its assertions pass. The regression may be a targeted test wrapper command, but it must fail if the file prints a passing summary and then stalls until killed.

**Acceptance Criteria**:
- [ ] The final implementation identifies the surviving active handle type and the owning code path in the implementation notes or test failure message.
- [ ] `server-daemon-hardening.test.ts` exits with code 0 under a 45s external wall-clock guard; it must not rely on `gtimeout -s KILL` to terminate.
- [ ] `server-observability.test.ts` exits with code 0 under a 45s external wall-clock guard; it must not rely on `gtimeout -s KILL` to terminate.
- [ ] A permanent targeted regression check exists for file-level exit behavior of the two suspect files.
- [ ] No permanent unconditional `console.error(process._getActiveHandles()...)` logging remains in passing test output.

### Task 4: Regression test — targeted files and full suite run to completion

**User Story**: As a developer, I want the full unit suite to complete reliably so I can trust `bun run test:unit` as a CI gate.

- Run the two targeted hanging files together 2 times consecutively under an external wall-clock guard: `gtimeout -s KILL 120 bun test test/unit/server-daemon-hardening.test.ts test/unit/server-observability.test.ts ; echo "exit: $?"`. Both runs must exit 0 without being killed.
- Run `bun run test:unit` end-to-end once (no `gtimeout`). It must complete in under 1200s with all tests passing. (Measured baseline ~777-823s on this machine across 201 files / 3020 tests; 1200s gives ~50% headroom for slower CI boxes.)
- After the run, verify no orphaned sockets accumulate across all known prefixes: `find /tmp -maxdepth 1 -type s \( -name 'tmax-test-*.sock' -o -name 'tmax-observability-*.sock' -o -name 'tmax-harden-*.sock' -o -name 'tmax-save-*.sock' -o -name 'tmax-server-client-*.sock' -o -name 'tmax-server-daemon-test-*.sock' \) | wc -l` must be exactly 0 — the `sweepTestSockets` safety net + per-test `forceShutdown` should leave nothing behind.
- Verify no leaked `bun src/server/server.ts` processes: `ps aux | grep 'bun.*src/server/server.ts' | grep -v grep` should be empty after the suite exits.

**Acceptance Criteria**:
- [ ] The two targeted hanging files complete with exit 0 in 2 consecutive guarded runs.
- [ ] `bun run test:unit` completes once with exit 0.
- [ ] No sockets matching `/tmp/tmax-{test,observability,harden,save,server-client,server-daemon-test}-*.sock` remain after the suite exits.
- [ ] No leaked `bun src/server/server.ts` processes after the suite exits.
- [ ] Total suite wall-time is under 1200s.

### Task 5: Validate zero regressions and run the Validation Commands

- Run every command in the `Validation Commands` section below. All must pass.

**Acceptance Criteria**:
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run test:unit` exits 0 once.
- [ ] The 6 modified server-test files still pass individually and in the suite.
- [ ] `bun run test:tmax-use` still passes (no impact on the e2e track).

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

**Reproduce before the fix (baseline — should hang):**
- `gtimeout -s KILL 120 bun test --timeout 30000 test/unit/ ; echo "exit: $?"` — before the fix, exits with 137 (killed). After the fix, exits 0.

**Validate the fix:**
- `bun run typecheck:src` — Source typecheck, zero errors.
- `bun run typecheck:test` — Test typecheck, zero errors.
- `bun run typecheck` — Full project typecheck, zero errors.
- `gtimeout -s KILL 45 bun test test/unit/server-daemon-hardening.test.ts ; echo "exit: $?"` — The suspect hardening file exits 0 before the guard kills it.
- `gtimeout -s KILL 45 bun test test/unit/server-observability.test.ts ; echo "exit: $?"` — The suspect observability file exits 0 before the guard kills it.
- `gtimeout -s KILL 120 bun test test/unit/server-daemon-hardening.test.ts test/unit/server-observability.test.ts ; echo "exit: $?"` — Run 2× consecutively; both runs exit 0 before the guard kills them.
- `bun run test:unit` — Full unit suite completes once. Was hanging before; must complete in <1200s now.
- `bun test test/unit/server-observability.test.ts test/unit/server-daemon-hardening.test.ts test/unit/test-ai-agent-control.test.ts test/unit/server-client.test.ts test/unit/server-save-file.test.ts test/unit/server-daemon.test.ts` — The 6 modified server-test files pass together (this is the cluster that was leaking).
- `bun run test:tmax-use` — tmax-use e2e suite still passes (no e2e impact).

**Leak-verification commands:**
- `find /tmp -maxdepth 1 -type s \( -name 'tmax-test-*.sock' -o -name 'tmax-observability-*.sock' -o -name 'tmax-harden-*.sock' -o -name 'tmax-save-*.sock' -o -name 'tmax-server-client-*.sock' -o -name 'tmax-server-daemon-test-*.sock' \) | wc -l` — must be 0 after `bun run test:unit` exits.
- `ps aux | grep 'bun.*src/server/server.ts' | grep -v grep` — must be empty after the suite exits.

## Notes

- **This is a pre-existing bug, surfaced by SPEC-063's adw-test stage.** The adw-test stage runs `bun run test:unit` as a subprocess with no wall-clock timeout (a separate gap, addressed by an `adw-test.ts` timeout patch landed alongside this spec). The hang has likely been latent for weeks; the test stage just made it visible because it runs the whole suite in one shot where developers usually run individual files.
- **Do NOT change production `src/server/server.ts` unless a shutdown gap is found.** The bug is in test lifecycle management. If `shutdown()` is found to throw before unlinking the socket on a partially-started server, that's a legitimate production fix — but isolate it as its own finding and keep the change minimal.
- **Why `connectWithTimeout` rather than fixing `connect` to always timeout:** the response-phase timeout in `test-ai-agent-control.test.ts` (`AI_AGENT_CONTROL_TIMEOUT_MS = 20000`) is deliberately generous for slow CI; adding a 2s *connection* timeout is orthogonal and tighter, since a healthy local Unix socket connects in <10ms. 2s is a safe ceiling that still catches wedged sockets.
- **Why `afterEach` and not `try/finally` in each test:** `afterEach` is the desired cleanup boundary for assertion failures and normal test timeouts, while a `try/finally` around the test body is easier to bypass when an external command kills the whole process. Do not rely on this as an uncited Bun guarantee for every kill mode; cover cleanup with the targeted guarded exit tests above.
- **`sweepTestSockets()` is a safety net, not the fix.** The per-test `forceShutdown` is the real fix; the sweep just prevents historical accumulation (the 1850 orphans found during diagnosis) from corrupting future runs.
- **Out of scope:** refactoring the server tests to use a shared `beforeAll` server instance (faster, but changes test semantics — each test currently expects a fresh server). Keep per-test servers; just clean them up reliably.

## Appendix: Historical Notes

The June 22 audit transcripts are intentionally summarized here instead of kept inline. They contained stale line numbers, old pass/fail states, and obsolete validation targets. The current source of truth is the task list, acceptance criteria, and validation commands above.

### June 22 audit summary

- The initial lifecycle fix added `connectWithTimeout`, `forceShutdown`, and `sweepTestSockets`, then wired the helpers into the six server-test files.
- Follow-up audits closed gaps around direct helper tests, `server-client.test.ts` using `afterEach`, and the six-file server-test cluster passing together.
- The old runtime budget findings are superseded: the current full-suite wall-time target is one `bun run test:unit` run under 1200s, plus 2 consecutive guarded runs of the targeted hanging files.

### July 5 re-investigation summary

- The suite began hanging again during CHORE-41/42/43 adw `/goal` runs even though the June lifecycle fix remained in place.
- The active failure is an exit-stall: the suspect files pass their assertions and print shutdown logs, then the process stays alive at 0% CPU.
- A minimal isolated repro of create/start/rejected-second-server/forceShutdown showed 0 active handles and exited cleanly, so broad `TmaxServer.shutdown()` rewrites are not justified without new handle evidence.
- One partial leak vector was a rejected second `TmaxServer` instance created before `start()` failed; cleanup for that instance helped but did not fully explain the file-level stall.
- Reverted attempts included broad `removeAllListeners`, broad process signal-handler removal, and cosmetic wrapper timeout changes because they either did not fix the leak or broke legitimate behavior.
- The next implementation must identify the surviving handle type in `server-daemon-hardening.test.ts` and `server-observability.test.ts`, clean up that owner, and add guarded file-level exit regression coverage.
