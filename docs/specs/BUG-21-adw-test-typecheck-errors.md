# Bug: Pre-existing `typecheck:test` errors block the full test suite from running green

## Bug Description

`bun run typecheck:test` exits 2 with **41 errors** across four test files. This was
flagged as "honest caveat 1" after BUG-20: the source typechecks clean
(`typecheck:src` exit 0) and the BUG-20 pipeline tests pass (85/0), but `typecheck:test`
has been failing for a while. Because `typecheck` (the full gate) and the full `bun test`
suite both depend on test sources compiling, **the full test suite cannot be verified
green** — which is exactly the gap that let the SPEC-065 duplicate-import defect loop
undetected (ADR-0108). This bug closes that loop by making `typecheck:test` pass, so the
full suite can run.

Baseline measured via `git stash` of the BUG-20 changes: **42 errors without them, 41
with** — so these are pre-existing; BUG-20 is net-neutral-to-positive. They are NOT
regressions from BUG-20.

The 41 errors resolve to **three independent root causes**:

1. **Test mocks don't satisfy `OrchestratorWorktreeDeps`** (32 errors across
   `adw-pipeline-loop.test.ts` and `adw-plan-resume-by-spec.test.ts`). The shared
   `mockWorktreeDeps`-style objects omit `gitRun` and `mergeBranchToMain`, and their
   `withPlanningLock` is typed as `(root, fn) => Promise<unknown>` instead of the generic
   `<T>(root, fn, opts?) => Promise<T>`. These predate BUG-20; BUG-20's addition of two
   required methods makes the gap no worse (still a single mock-shape defect).

2. **`adw-watchdog.test.ts` Layer 1 imports a deleted module** (8 errors). The production
   code removed `adws/adws-modules/stall-detector.ts` (confirmed by the comment at
   `adw-plan-review-build-patch.ts:483` *"stall-detector removed"*, and production
   `adw-watchdog.ts` no longer imports it). But the test file still has a "Layer 1" block
   importing `withStallWatch`/`StallDetectorDeps`/`StallWatchOptions` from the deleted
   module. The unresolved import cascades into all the `implicit any` errors at lines
   77/81/83/134/287 (the types are unresolved → everything using them is `any`).

3. **`remote.test.ts:281` possibly-undefined index** (1 error). `rec.args[1].includes(...)`
   accesses `.includes` on a possibly-undefined element without a guard.

## Problem Statement

`typecheck:test` fails with 41 errors from three unrelated root causes, which prevents the
full `bun test` suite (and the full `typecheck` gate) from being verifiably green — the
same class of gap that hid the SPEC-065 compile defect.

## Solution Statement

Fix all three root causes minimally and surgically:

1. Add the missing `gitRun` and `mergeBranchToMain` (and BUG-20's
   `createWorktreeFromBase`/`validateWorktree`) methods to every test mock object that
   stands in for `OrchestratorWorktreeDeps`, and widen the `withPlanningLock` signature to
   match the generic. Centralize this in a shared mock builder so both test files use it.
2. Remove the dead "Layer 1" stall-detector test block from `adw-watchdog.test.ts` (and its
   import) — it tests a module that no longer exists. Keep the Layer 2 watchdog tests.
3. Add a guard for the possibly-undefined array element at `remote.test.ts:281`.

## Steps to Reproduce

1. `bun run typecheck:test` → exits 2 with 41 errors (enumerated above).
2. `bun run typecheck` (full gate) → fails because it includes test sources.
3. `bun test` full suite → cannot be trusted green because test sources don't compile.

## Root Cause Analysis

- **Mocks:** `OrchestratorWorktreeDeps extends WorktreeDeps`, so it requires `gitRun`; it
  also declares `mergeBranchToMain`, `createWorktree`, `createWorktreeFromBase`,
  `validateWorktree`, `removeWorktree`, `detectWorktree`, `commitSpecToMain`,
  `commitWorktreeChanges`, `withPlanningLock`. The test mocks were written when the
  interface was smaller and never updated. The `withPlanningLock` generic mismatch
  (`<T>` vs non-generic) is a separate sub-cause within the same mock.
- **Watchdog Layer 1:** `stall-detector.ts` was deleted but its test block wasn't removed.
  This is dead-test code referencing a non-existent module.
- **remote.test.ts:** a missing null/non-null guard on an array index access.

## Relevant Files

Use these files to fix the bug:

- **`test/unit/adw-pipeline-loop.test.ts`** — the shared `mockWorktreeDeps` object (and the
  configurable builder) must satisfy the full `OrchestratorWorktreeDeps` interface:
  add `gitRun`, `mergeBranchToMain`, and widen `withPlanningLock` to the generic form.
  This single fix clears all ~23 errors in this file.
- **`test/unit/adw-plan-resume-by-spec.test.ts`** — has its own copy of the mock shape
  (9 errors). Apply the same fix (ideally import the shared mock from a common helper, or
  at minimum add the missing members + widen the generic).
- **`test/unit/adw-watchdog.test.ts`** — remove the "Layer 1 — stall-detector.ts" import
  and its `describe`/test block (the module was deleted). Keep all Layer 2 watchdog tests
  against `adw-watchdog.ts`.
- **`test/unit/remote.test.ts:281`** — guard the `rec.args[1]` access (e.g.
  `rec.args[1]?.includes(...)` or an explicit undefined check).

### New Files
- (None.)

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Fix the `OrchestratorWorktreeDeps` mock shape in adw-pipeline-loop.test.ts

**User Story**: As a test author, I want the shared worktree mock to satisfy the full
`OrchestratorWorktreeDeps` interface so the test file typechecks and `runPipeline`'s 4th
argument is accepted.

- Add `gitRun`, `mergeBranchToMain` (and confirm `createWorktreeFromBase` +
  `validateWorktree` are present — BUG-20 already added them to the configurable builder;
  add them to the plain `mockWorktreeDeps` too).
- Widen `withPlanningLock` to the generic `<T>(rootPath: string, fn: () => Promise<T>,
  opts?) => Promise<T>` so it satisfies the interface generic.

**Acceptance Criteria**:
- [ ] `bun run typecheck:test` reports zero errors in `test/unit/adw-pipeline-loop.test.ts`.
- [ ] `bun test test/unit/adw-pipeline-loop.test.ts` still passes 39/0 (no behavioral
  change — only type-level mock additions).

### 2. Fix the mock shape in adw-plan-resume-by-spec.test.ts

**User Story**: As a test author, I want this file's worktree mock to also satisfy
`OrchestratorWorktreeDeps` so it typechecks.

- Apply the same missing-members + generic-widening fix to that file's mock object.

**Acceptance Criteria**:
- [ ] `bun run typecheck:test` reports zero errors in `test/unit/adw-plan-resume-by-spec.test.ts`.
- [ ] `bun test test/unit/adw-plan-resume-by-spec.test.ts` still passes (no regressions).

### 3. Remove the dead stall-detector Layer 1 tests from adw-watchdog.test.ts

**User Story**: As a maintainer, I want the test file to not import a deleted module, so it
typechecks and doesn't test dead code.

- Delete the `import { withStallWatch, ... } from "../../adws/adws-modules/stall-detector.ts"`
  block and the entire "Layer 1" `describe` block that uses `withStallWatch` /
  `StallDetectorDeps` / `StallWatchOptions`. Keep every Layer 2 test that exercises
  `adw-watchdog.ts` (parseArgs, makeClassifier, classifyWorkspace, resume counter, notify,
  detectWatchdog, buildResumeCommand).
- Remove the `makeFakeStallDeps`/`handleRef` helper if it is now unused (only used by
  Layer 1).

**Acceptance Criteria**:
- [ ] `bun run typecheck:test` reports zero errors in `test/unit/adw-watchdog.test.ts`.
- [ ] `bun test test/unit/adw-watchdog.test.ts` passes (Layer 2 tests intact).
- [ ] `rg "stall-detector" test/` returns no matches.

### 4. Guard the possibly-undefined index in remote.test.ts

**User Story**: As a test author, I want no strict-null-check violations in the test.

- At `remote.test.ts:281`, guard `rec.args[1]` (e.g. `rec.args[1]?.includes("find ")` with
  a preceding length check, or `const arg1 = rec.args[1]; if (arg1 && arg1.includes(...))`).

**Acceptance Criteria**:
- [ ] `bun run typecheck:test` reports zero errors in `test/unit/remote.test.ts`.
- [ ] `bun test test/unit/remote.test.ts` still passes (behavior unchanged).

### 5. Run the Validation Commands

- Execute every command in Validation Commands, confirm each passes with zero errors.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:src` — source
  still compiles (must remain exit 0).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:test` — must
  exit 0 with zero errors (the bug's direct fix).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck` — full gate
  must now exit 0 (was failing because of this bug).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test` — full suite must
  run to completion (no timeout) with zero failures. This is the headline outcome: it
  closes the gap that hid SPEC-065's compile defect (ADR-0108).

## Notes

- **These errors are pre-existing, not BUG-20 regressions.** Measured baseline: 42 errors
  without BUG-20's changes, 41 with. BUG-20 is net −1 (it actually fixed one). This bug
  exists independently and was masked because `typecheck:test` was already red.
- **Why the watchdog Layer 1 block is safe to delete:** the production module
  `adw-watchdog.ts` no longer imports `stall-detector.ts`, and `stall-detector.ts` does not
  exist on disk. The Layer 1 tests exercise code that has been removed from the codebase —
  they cannot pass and are not loadable. Keep all Layer 2 tests (the real watchdog logic).
- **The mock fix is type-only.** Adding `gitRun`/`mergeBranchToMain`/etc. to the mocks as
  no-op `TaskEither` returns changes no runtime behavior — these methods aren't exercised
  by the affected tests (they test plan/review/build/patch dispatch, not git ops).
- **Reference:** ADR-0108 — this bug is the "test-side" manifestation of the same gate
  gap; fixing it lets `typecheck:test` and the full `bun test` be trustworthy green.
