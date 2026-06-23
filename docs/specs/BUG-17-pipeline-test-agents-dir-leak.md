# Bug: adw-pipeline unit tests pollute the real agents/ directory

## Bug Description

The adw orchestrator unit tests (`test/unit/adw-pipeline.test.ts`, `test/unit/adw-pipeline-loop.test.ts`) exercise `runPipeline` with mocked subprocess deps but write state files to the **real** `process.cwd()/agents/` directory instead of a per-test temp directory. Every full-suite run of `bun run test:unit` litters fake workspace directories into the production `agents/` folder.

**Expected:** unit tests are hermetic — they write to an isolated temp dir that is cleaned up after each test, leaving the real `agents/` untouched.

**Actual:** as of 2026-06-23, the real `agents/` directory contained **1,149 fake workspace directories** accumulated over weeks of local suite runs. Each carries a bogus spec path (`/abs/spec.md`), description (`"add a feature"`), and `status: failed`. The test files acknowledge this in a comment (`adw-pipeline.test.ts:5`: "state files written by runPipeline (which uses the real AGENTS_DIR — these [are left behind]").

## Problem Statement

The leak pollutes `agents/` with test garbage that:
- Accumulates across every suite run (1,149 dirs observed; CI runs would compound it).
- Confuses operational status checks — a human or watchdog (SPEC-066) scanning `agents/*/adw-state.json` for stale workspaces sees 1,149 false positives, all pointing at `/abs/spec.md`.
- Risks namespace collision with real workspace ids (the ULID-timestamp space is shared).
- Breaks test hermeticity — a test's outcome could depend on leftover state from a prior run.

## Solution Statement

Add an explicit filesystem-root injection seam to the two pipeline orchestrators, then rewire the pipeline test files to pass a per-test temp directory via `mkdtempSync`, matching the pattern already used correctly in `test/unit/builder.test.ts`. The tests must redirect `runPipeline`'s own state I/O, not only their local assertions.

## Steps to Reproduce

1. From a clean repo: `ls agents/ | wc -l` (note the count, e.g. N).
2. Run the full suite: `bun run test:unit`.
3. `ls agents/ | wc -l` again — the count is now N + ~4 (per full-suite run; over many runs it grows unboundedly).
4. Inspect a new workspace: `cat agents/01KV*/adw-state.json | jq .spec_path` → `/abs/spec.md` (the test fixture path).
5. Contrast: `bun test test/unit/builder.test.ts` — does NOT leak (uses `mkdtempSync(join(tmpdir(), "builder-test-"))`).

## Root Cause Analysis

`adw-pipeline.test.ts:28` and `adw-pipeline-loop.test.ts:31` both define:

```ts
const AGENTS_DIR = join(process.cwd(), "agents");
```

This is the real project `agents/` directory. The tests' `writeState` helper (`adw-pipeline.test.ts:37`) writes `adw-state.json` into `join(AGENTS_DIR, id)` — i.e. directly into the real folder. Because `runPipeline` (the function under test) internally calls the module's own `AGENTS_DIR` for some operations, and the test mocks only the subprocess-spawning deps (not the state-writing path), the real directory gets written.

The correct pattern exists 200 lines away in `builder.test.ts:24`:

```ts
tmp = mkdtempSync(join(tmpdir(), "builder-test-"));
```

The pipeline tests were written before the temp-dir convention was established and never migrated.

## Relevant Files

Use these files to fix the bug:

### Existing Files to Modify

- **`adws/adw-plan-reviewspec-build.ts`** — add an explicit `agentsDir`/roots option or state I/O dependency to `PipelineDeps`/`runPipeline`, and use it everywhere this orchestrator reads or writes pipeline state instead of closing over only the private module-level `AGENTS_DIR`.
- **`adws/adw-plan-review-build-patch.ts`** — same injection seam as above. This orchestrator also owns a private `AGENTS_DIR`, so it must be changed for loop/retry tests to redirect state writes cleanly.
- **`test/unit/adw-pipeline.test.ts`** — the primary offender. Line 28 hardcodes `AGENTS_DIR = join(process.cwd(), "agents")`; line 37's `writeState` writes into it. Replace with a per-test `mkdtempSync` + `afterEach` `rmSync`, and pass the temp dir through the new orchestrator injection seam when calling `runPipeline`. The file already imports `mkdtempSync`, `rmSync`, `tmpdir` (lines 12, 14) — they're just unused.
- **`test/unit/adw-pipeline-loop.test.ts`** — same pattern. Line 31 hardcodes the real `AGENTS_DIR`; lines 266 and 307 read state back from it. Same fix: per-test temp dir passed into `runPipeline`.

### Existing Files to Read (reference, not modify)

- **`test/unit/builder.test.ts`** — the correct pattern to mirror. Line 24: `mkdtempSync(join(tmpdir(), "builder-test-"))`; `afterAll`: `rmSync(tmp, { recursive: true, force: true })`.
- **`docs/adrs/ADR-0105-test-isolation-policy.md`** — the standing policy this fix implements.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Task 1: Isolate `adw-pipeline.test.ts` to a temp dir

**User Story**: As a developer running the unit suite, I want the pipeline tests to write state to a temp directory so that the real `agents/` folder stays clean.

- In `adws/adw-plan-reviewspec-build.ts`:
  - Extend `PipelineDeps`/`runPipeline` with an explicit `agentsDir` option (or a small state I/O dependency) that defaults to the current `AGENTS_DIR`.
  - Route every state read/write/path construction in `runPipeline` through that injected value.
  - Do not try to export or monkey-patch the module-level `AGENTS_DIR`; ES module bindings are immutable from importers and the existing constant is private.
- In `test/unit/adw-pipeline.test.ts`:
  - Replace `const AGENTS_DIR = join(process.cwd(), "agents");` (line 28) with a module-level `let AGENTS_DIR: string;` and a `beforeEach` that sets `AGENTS_DIR = mkdtempSync(join(tmpdir(), "adw-pipeline-test-"));`.
  - Add an `afterEach` that calls `rmSync(AGENTS_DIR, { recursive: true, force: true });`.
  - The file already imports `mkdtempSync`, `rmSync`, and `tmpdir` — verify they're used now (they were imported but dead).
  - Pass `AGENTS_DIR` into each `runPipeline` invocation through the new injection seam.
  - Confirm the `writeState` helper (line 37), `runPipeline`, and any other `AGENTS_DIR` references now point at the same temp path.

**Acceptance Criteria**:
- [ ] `adw-pipeline.test.ts` no longer references `process.cwd()` for `AGENTS_DIR`.
- [ ] `adw-plan-reviewspec-build.ts` exposes an explicit `agentsDir`/state I/O injection seam that defaults to the real `agents/` path for production calls.
- [ ] A `beforeEach`/`afterEach` pair creates and removes a temp dir.
- [ ] Running `bun test test/unit/adw-pipeline.test.ts` leaves zero new entries in the real `agents/`.

### Task 2: Isolate `adw-pipeline-loop.test.ts` to a temp dir

**User Story**: As a developer, I want the loop/retry tests to be hermetic so they don't leak state between runs.

- In `adws/adw-plan-review-build-patch.ts`:
  - Add the same explicit `agentsDir` option or state I/O dependency to `PipelineDeps`/`runPipeline`, defaulting to the current `AGENTS_DIR`.
  - Route all state reads/writes/path construction through the injected value.
  - Do not rely on monkey-patching the private module-level `AGENTS_DIR`.
- Apply the same `mkdtempSync`/`rmSync` pattern to `adw-pipeline-loop.test.ts` (line 31, and the state reads at lines 266, 307).
- Pass the temp `AGENTS_DIR` through the new `runPipeline` injection seam.
- This file tests the build↔patch retry loop, so it writes more state per test — verify the temp dir captures all of it.

**Acceptance Criteria**:
- [ ] `adw-pipeline-loop.test.ts` no longer references `process.cwd()` for `AGENTS_DIR`.
- [ ] `adw-plan-review-build-patch.ts` exposes an explicit `agentsDir`/state I/O injection seam that defaults to the real `agents/` path for production calls.
- [ ] Running `bun test test/unit/adw-pipeline-loop.test.ts` leaves zero new entries in the real `agents/`.

### Task 3: Clean up the existing 1,149 leaked workspaces

**User Story**: As a developer, I want the `agents/` directory to contain only real pipeline workspaces so status scans are accurate.

- Identify leaked test workspaces with exact JSON checks, not broad predicates. A candidate leaked workspace must have the known test fixture state, such as `spec_path == "/abs/spec.md"` and `description == "add a feature"`, verified from `adw-state.json`.
- First dry-run the exact removal list:
  - `for f in agents/*/adw-state.json; do jq -e '.spec_path == "/abs/spec.md" and .description == "add a feature"' "$f" >/dev/null 2>&1 && dirname "$f"; done`
- Review the dry-run output before deleting anything. Do not delete by description alone, by approximate workspace id age, or by unverified assumptions about remaining workspace ids.
- Only after the dry run is reviewed, remove exactly the listed directories.
- `agents/` is gitignored, so this is a local-only cleanup — no version-control impact.

**Acceptance Criteria**:
- [ ] `for f in agents/*/adw-state.json; do jq -e '.spec_path == "/abs/spec.md" and .description == "add a feature"' "$f" >/dev/null 2>&1 && dirname "$f"; done | wc -l` returns 0.
- [ ] Any remaining `agents/` entries have been verified from their JSON state rather than assumed real from their ids.

### Task 4: Regression test + validation

**User Story**: As a developer, I want confidence that the fix prevents future leaks so the bug doesn't recur.

- Add a concrete per-test or per-file regression check that snapshots the real `agents/` directory around each `runPipeline` call while `runPipeline` is configured with the temp `agentsDir`.
- Also assert the returned workspace state exists under the injected temp dir and not under the real `agents/` directory.
- Run the full Validation Commands.

**Acceptance Criteria**:
- [ ] A regression check exists that fails if the pipeline tests write to the real `agents/`.
- [ ] `bun run test:unit` completes with zero new entries in `agents/`.
- [ ] All existing pipeline/loop tests still pass.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

**Reproduce before the fix:**
- `ls agents/ | wc -l` (record count) → `bun run test:unit` → `ls agents/ | wc -l` (count grew). Before the fix, it grows by ~4 per run.

**Validate the fix:**
- `bun run typecheck:test` — Test typecheck, zero errors.
- `bun test test/unit/adw-pipeline.test.ts test/unit/adw-pipeline-loop.test.ts` — The two fixed test files pass.
- `bun run test:unit` — Full suite passes; afterward `ls agents/ | wc -l` is unchanged from before the run.
- `for f in agents/*/adw-state.json; do jq -e '.spec_path == "/abs/spec.md" and .description == "add a feature"' "$f" >/dev/null 2>&1 && dirname "$f"; done | wc -l` — Returns 0 (no leaked test workspaces remain).

## Notes

- **This is the same bug class as BUG-16** (ADR-0103): tests exercising real I/O paths without filesystem isolation. BUG-16 leaked Unix sockets into `/tmp`; this leaks workspace dirs into `agents/`. Both are fixed by the same shape of solution — shared lifecycle/isolation helpers + per-test cleanup. ADR-0105 codifies the policy so the next test file doesn't reintroduce the pattern.
- **Why `mkdtempSync` and not a fixed test dir:** a fixed dir (e.g. `agents/test-fixture/`) still risks cross-test contamination within a single run if tests assume a clean slate. `mkdtempSync` gives every test its own dir, so ordering and parallelism don't matter.
- **The dependency-injection seam (ADR-0105) is required for this fix.** `runPipeline`/`writeState` must accept an injected `agentsDir` or equivalent state I/O dependency via `PipelineDeps`/`runPipeline` options. Do not monkey-patch the module constants: the orchestrators' `AGENTS_DIR` values are private `const` bindings, and ES module imports cannot mutate them.
- **`agents/` is gitignored**, so the 1,149 leaked dirs were never committed — they're local-development cruft. CI runs on a fresh checkout wouldn't accumulate them across runs, but a single CI run would still create ~4 and any post-run artifact scan would see them. Fixing the tests is correct regardless.
