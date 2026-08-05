# Bug: vim-dispatch + vim-bindings-smoke intermittently hang (flaky, together-only) — stalls `test:unit` batch 35

## Goals

- **Stabilize the flaky hang.** `vim-dispatch.test.ts` and `vim-bindings-smoke.test.ts` intermittently exceed the runner's 120s inactivity gap when run together in a 5-file batch, stalling `bun run test:unit` at batch 35. No test runs infinitely — the hang is timing/race-based, surfacing under the batched runner's load.
- **Identify the slow/race-prone test(s).** Profile to find which test(s) approach the per-test timeout or run uninterruptibly long under load.
- **Make `bun run test:unit` deterministic.** Exit 0 with no batch stall across multiple consecutive full-suite runs.

## Completion Criteria (Definition of Done)

- [ ] The slow/race-prone test(s) in `vim-dispatch` + `vim-bindings-smoke` are NAMED (profile output shows which test(s) approach the 60s per-test timeout / exceed a ~10s budget under load).
- [ ] Root cause of the slowness is fixed at its source (the test fixture, the handler, or the editor lifecycle) — NOT papered over by raising timeouts.
- [ ] `bun run test:unit` exits 0 with NO "batch produced no output for 120s" message on 3 consecutive runs.
- [ ] `bun test test/unit/vim-dispatch.test.ts --timeout 4000` still reports 22 pass / 2 fail (the 2 pre-existing failures — see BUG-70 splash — are unchanged and out of scope) and `bun test test/unit/vim-bindings-smoke.test.ts --timeout 4000` reports 99 pass / 0 fail.
- [ ] No new per-test timeout raised above the runner's 60s ceiling to mask the issue; if a deadline must move, it moves because the test is provably correct and the budget was too tight, with a note explaining why.

## Root Cause (investigated 2026-08-06)

**This is FLAKY (race/timing/load-sensitive), NOT a deterministic infinite loop.** The original issue framing was accurate on this point.

Evidence from the investigation (issue #122 body + burn-down):
- Each file hangs >25s when run **solo WITHOUT a per-test timeout**, but completes **cleanly** with `bun test --timeout 4000`:
  - `vim-dispatch`: **22 pass / 2 fail** (the 2 failures are the pre-existing splash BUG-70, unrelated).
  - `vim-bindings-smoke`: **99 pass / 0 fail**.
- So no test runs infinitely. Some test is **slow / race-sensitive** and under the batched runner's 5-file concurrent load it exceeds the 120s inactivity gap (or a single test blocks longer than `bun --timeout 60000` can cut).
- The BUG-16 mitigations are **already applied**: `scripts/run-unit-tests.ts` runs `bun test --dots --timeout 60000` in 5-file batches with a 120s inactivity timer (`scripts/run-unit-tests.ts:26-31, 59-72, 107-114`). Despite `--dots` + the 60s per-test timeout, the hang still occurs — meaning the blocking path is one `bun --timeout` **cannot interrupt** (a synchronous tight loop on the event loop, or an unawaited promise chain the test never awaits).

**Why these two files (and only these two) are the culprits — structural, not coincidental:**

Both files are the two highest-`editor.start()`-count files in the vim cluster:
- `test/unit/vim-bindings-smoke.test.ts:174-181` — the `for (const [label, keys] of SMOKES)` loop spawns a **fresh editor per smoke entry (99 editors)**, each via `createStartedEditor(BUFFER)`.
- `test/unit/vim-dispatch.test.ts` — spawns ~22 editors across its tests.

Every `createStartedEditor` (`test/helpers/editor-fixture.ts:260-264` → `createEditorFixture:207-250`) calls `await editor.start()` (`src/editor/editor.ts:2886-2910`), which performs, **per editor**:
1. `ensureCoreBindingsLoaded` → `bindingRuntime.loadCoreBindings` (synchronous T-Lisp eval of `keymaps.tlisp` + `normal/insert/visual/command.tlisp`),
2. `loadInitFile` (filesystem read + T-Lisp eval),
3. `loadSavedMacros` (filesystem read + T-Lisp eval).

The `BindingEvaluator` is **synchronous** (`src/editor/runtime/binding-runtime.ts:26,32` — `evalCode: (code) => Either`, run via `interpreter.execute`). Under 5-file batch load these synchronous evaluation bursts stack, lengthening each `editor.start()` and each subsequent `handleKey` dispatch.

**The uninterruptible path (why `bun --timeout` can't cut it):** T-Lisp evaluation runs synchronously on the event loop. A pathological/long `(while ...)` or a large multi-key `press`/`send` sequence that dispatches many sync T-Lisp commands in one microtask turn will block until it completes — `bun --timeout` only fires between microtasks, so a single long synchronous evaluation is not interruptible. The prime candidates, grounded in the source:

- `src/editor/handlers/insert-handler.ts:30` — on EVERY insert-mode printable keystroke, a synchronous T-Lisp `(when (and (string= (buffer-name) "*scratch*") (string-prefix-p "  tmax" (buffer-text))) ... (let ((n (buffer-line-count))) (while (> n 0) (setq n (- n 1)) (buffer-delete-line))) ...)` runs. This `(while ...)` deletes lines one at a time on the `*scratch*` splash buffer. `vim-bindings-smoke` seeds `BUFFER` so it does not hit the splash branch, but the `(when ...)` predicate still evaluates on every insert keystroke.
- `vim-dispatch` 20s-timeout tests (`test/unit/vim-dispatch.test.ts:172, 201, 276`) — these are the operator/find-char/motion tests that loop many `handleKey` calls via `press()` (`vim-dispatch.test.ts:16-20`), each `handleKey` doing a sync `executeCommand` dispatch. These three are the slow tests (they were already singled out for a 20s deadline).

**Corrected framing:** the original "together-only" framing is right but the *mechanism* is not "an unawaited daemon spawn" (neither test file spawns a daemon — both use `MockFileSystem`/`MockTerminal` via `createEditorFixture`). The mechanism is **cumulative synchronous T-Lisp evaluation load from N×`editor.start()` + N×sync `handleKey` dispatches**, which under 5-file batch contention pushes one test past the 120s inactivity gap. The investigation's "unawaited async / busy-wait" hypothesis is plausible-but-unconfirmed; profiling is the next concrete step (see Implementation Plan).

## Codex adversarial review (2026-08-06) — correction

- **The "synchronous-load / cross-editor memoization" root cause is a HYPOTHESIS, not confirmed.** The investigation cited no timing or active-handle evidence tying the stall to cumulative sync eval; it inferred the mechanism from a code read. Treat it as one candidate among several.
- **The plan is now diagnostic-first.** Step 1 (isolated reproducer + per-test timing + active-handle/async-stack capture) must PRODUCE the named slow test AND evidence of *why* it stalls (event-loop block vs. unawaited promise vs. fixture lifecycle) BEFORE any fix is selected. Do not pre-commit to fix branch (A/B/C/D) from the code read alone.
- **FORBIDDEN: any global "modules already loaded" memoization state** (e.g. a module-level flag that skips `ensureCoreBindingsLoaded` for the second editor). Each `editor.start()` loads into a **fresh per-editor interpreter**; a process-global memo would skip that load and silently break isolation. Per-instance memoization is the only admissible form if (A) is what profiling confirms.
- **Drop the splash-loop hypothesis.** The insert-handler `(while ...)` splash-clear belongs to BUG-70 (splash); `vim-bindings-smoke` seeds `BUFFER` and does not hit the splash branch, so fix (B) is out of scope here. Do not cite it as a leading cause.

## Implementation Plan

The plan is **profile-first, then fix at the source**. Do not raise timeouts to mask the slowness.

### Step 1 — Profile to NAME the slow test(s) (mandatory before any fix)

Run each file with a tight per-test timeout and per-test timing to surface which test approaches the limit:
```bash
# vim-dispatch: 3 tests already carry VIM_DISPATCH_TIMEOUT_MS=20000 (lines 172/201/276). Run with a
# 10s ceiling to force the slow one to surface, and add timing:
bun test test/unit/vim-dispatch.test.ts --timeout 10000
# vim-bindings-smoke: no per-test deadline today; impose one to find the slow entry:
bun test test/unit/vim-bindings-smoke.test.ts --timeout 10000
```
If `--timeout 10000` does not surface a single slow test, add a temporary `console.time`/`console.timeEnd` (or `performance.now()`) wrapper around the `await send(editor, keys)` / `await press(editor, …)` body in each test's `it`/`test` and run the file solo, then under a 5-file batch that reproduces the stall. The goal: **identify the exact `it`/`test` that takes >10s under load.**

Reproduce the original stall to confirm the fix later:
```bash
# Run the exact batch 35 cluster (the 5 files around vim-* in readdirSync order) repeatedly:
bun scripts/run-unit-tests.ts   # full run; watch batch 35
```

### Step 2 — Fix the slowness at its source (depends on Step 1's finding)

Pick the fix that matches what profiling found. Most likely candidates, grounded in the code read:

- **(A) Cumulative `editor.start()` cost (most likely).** If profiling shows the slowness is spread across ALL tests (no single outlier) and tracks `editor.start()` count, the fix is to **make `ensureCoreBindingsLoaded` cheaper on repeat construction** or **share one started-editor base** where the test only needs a fresh buffer, not a fresh interpreter. Look at `src/editor/runtime/binding-runtime.ts:139-176` (`loadCoreBindings` / `ensureCoreBindingsLoaded`) for work that could be memoized across editor instances in the same process (the core binding files are static). Mirror the idempotency pattern already in `Editor.start()` (`src/editor/editor.ts:2892-2895`, the `coreBindingsLoaded` short-circuit) at a coarser grain.
- **(B) The insert-handler `(while ...)` splash-clear (insert-handler.ts:30).** If profiling shows insert-mode smokes (`i`/`a`/`o` entries in `vim-bindings-smoke`) are the outliers, replace the per-keystroke `(while (> n 0) ... (buffer-delete-line))` with a single bulk clear (e.g. `(buffer-set-text "")` or one `(buffer-delete-line)` over a count), so the splash clear is O(1) not O(lines). This also removes the per-insert sync-eval overhead.
- **(C) An actual unawaited async / race in the editor lifecycle.** If profiling names a single test that blocks past `bun --timeout` (i.e. `--timeout` does NOT cut it), that confirms a synchronous tight loop. Trace the `executeCommand`/`executeCommandAsync` path (`src/editor/handlers/normal-handler.ts:340-343`, `editor.executeCommandAsync`) into the interpreter loop and find the unbounded iteration. Add a yield/bound and `await` it.
- **(D) Test-isolation race (unawaited promise in the test itself).** Check `press`/`send` (`vim-dispatch.test.ts:16-20`, `vim-bindings-smoke.test.ts:18-22`) and `createStartedEditor` (`test/helpers/editor-fixture.ts:260-264`) for a path where `editor.start()` or a `handleKey` is not actually awaited. The fixture's `await editor.start()` IS awaited (`editor-fixture.ts:219`), so this is the least likely — confirm and rule out.

### Step 3 — Verify the fix removes the stall (not masks it)

After the fix, the per-test deadline from Step 1 must still pass comfortably (the named slow test now well under 10s), AND the full suite must not stall:
```bash
bun test test/unit/vim-dispatch.test.ts --timeout 4000        # 22 pass / 2 fail (BUG-70 splash, unchanged)
bun test test/unit/vim-bindings-smoke.test.ts --timeout 4000  # 99 pass / 0 fail
bun run test:unit                                             # 3 consecutive runs, no batch stall
```

### Step 4 — Record the lesson

Append a rule to `docs/learnings.md` (per CLAUDE.md §6) capturing: "the highest-`editor.start()`-count test files are the first suspects for `test:unit` batch stalls; profile with a tight `--timeout` + per-test timing before assuming an infinite loop."

## Test Plan

- **Profile step (Step 1):** the named slow test must be reproducible — re-run the profiling command and cite the test name + observed wall time in the spec's verification log.
- **Unit (per-file) regression gates:**
  - `bun test test/unit/vim-dispatch.test.ts --timeout 4000` → 22 pass / 2 fail (the 2 fails are pre-existing BUG-70 splash, out of scope — note them, do not "fix" by silencing).
  - `bun test test/unit/vim-bindings-smoke.test.ts --timeout 4000` → 99 pass / 0 fail.
- **Full-suite gate (the actual bug):** `bun run test:unit` exits 0 with no `run-unit-tests: batch N produced no output for 120s` line, on **3 consecutive runs**. This is the Definition-of-Done assertion.
- **No-mask check:** confirm no per-test timeout was raised above the runner's 60s ceiling to make the stall disappear (grep the diff for `VIM_DISPATCH_TIMEOUT_MS` and any new `--timeout`/`setTimeout` bumps).
- **Typecheck:** `bun run typecheck:src` and `bun run typecheck:test` clean (if any source/test code changed under fix B/C).

## Relevant Files

Read these first (already read during investigation):

- **Test files (the cluster):**
  - `test/unit/vim-dispatch.test.ts` — 22 editors; 3 tests carry `VIM_DISPATCH_TIMEOUT_MS = 20000` (lines 172, 201, 276) — the operator/find/motion `press`-heavy tests, prime slow candidates.
  - `test/unit/vim-bindings-smoke.test.ts` — 99 editors (one per `SMOKES` entry, lines 36-171); the `for` loop at lines 174-181 spawns a fresh editor per entry.
- **Fixture (the per-editor lifecycle):**
  - `test/helpers/editor-fixture.ts:207-264` — `createEditorFixture` / `createStartedEditor`: each call does `await editor.start()` (line 219), then `editor.createBuffer` if content given (line 222-224). The `afterEach` (lines 178-181) disposes the bare-editor compatibility fixtures.
- **Editor lifecycle (what `start()` does per editor):**
  - `src/editor/editor.ts:2886-2910` — `start()`: `ensureCoreBindingsLoaded` + `loadInitFile` + `loadSavedMacros`.
  - `src/editor/editor.ts:1699-1704` — `ensureCoreBindingsLoaded` → `bindingRuntime`.
  - `src/editor/editor.ts:2038-2106` — `handleKey`: sync dispatch to mode handlers, each `await`ing a (synchronous) `executeCommand`/`executeCommandAsync`.
- **Synchronous evaluator (why `bun --timeout` can't cut a long eval):**
  - `src/editor/runtime/binding-runtime.ts:26,32-41` — `evalCode: BindingEvaluator = (code) => Either` (sync), confirmed synchronous.
  - `src/editor/runtime/binding-runtime.ts:139-176` — `loadCoreBindings` / `ensureCoreBindingsLoaded`: the per-editor cost center.
- **Prime uninterruptible-loop suspect (insert splash clear):**
  - `src/editor/handlers/insert-handler.ts:28-33` — the `(when (and (string= (buffer-name) "*scratch*") (string-prefix-p "  tmax" (buffer-text))) ... (while (> n 0) ... (buffer-delete-line)) ...)` runs on every insert keystroke.
- **Runner (the harness that detects the stall):**
  - `scripts/run-unit-tests.ts:26-31` — `PER_TEST_TIMEOUT_MS = 60_000`, `INACTIVITY_TIMEOUT_MS = 120_000`.
  - `scripts/run-unit-tests.ts:46-75` — 5-file batches, `--dots --timeout 60000`.
  - `scripts/run-unit-tests.ts:107-114` — the inactivity timer that fires the "batch produced no output for 120s" message.

## Notes

- The 2 `vim-dispatch` failures under `--timeout 4000` are the **pre-existing BUG-70 splash** failures, called out in the issue as out of scope for BUG-72. Do not conflate them with the hang and do not "fix" them by silencing — they are a separate spec.
- `--dots` + the 60s per-test timeout (the BUG-16 fix) are already in place. BUG-72 is a genuine residual stall that survives those mitigations, which is why the uninterruptible-sync-eval hypothesis (Step 2 B/C) is the leading explanation — `bun --timeout` only fires between microtasks, so a single long synchronous T-Lisp evaluation is not interruptible.
- Neither culprit test file spawns a daemon or opens a real socket (both use `MockFileSystem`/`MockTerminal` via the fixture), so the original issue's "daemon/socket setup" hypothesis is **ruled out** for these two files. The mechanism is cumulative synchronous T-Lisp evaluation load.
