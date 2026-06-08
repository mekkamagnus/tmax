# Chore: Update Testing Suite

## Chore Description

The current test suite reports strong Bun test results while leaving important correctness gaps:

- CI does not run the current Python UI suite.
- `test:ui` still invokes the deprecated Bash harness.
- Most Python "UI" tests call daemon T-Lisp APIs directly instead of exercising terminal input and rendering.
- Test TypeScript is excluded from the required typecheck, allowing mocks and tests to drift from production contracts.
- Some Vim tests can pass without making an assertion or before asynchronous editor startup completes.
- Steep input parsing, T-Lisp ownership boundaries, and daily-driver rendering behavior lack direct regression coverage.
- The UI harness can stop shared daemons or tmux windows and does not guarantee cleanup after failures.
- UI assertion helpers can convert query failures, skipped checks, and known limitations into passes.
- Testing commands and expectations differ across package scripts, CI, rules, and documentation.

This chore makes the suite trustworthy before broadening it. Work is ordered from release-blocking gates and test isolation through input/UI coverage and documentation cleanup.

This chore owns test type safety, test mocks, test helpers, and the CI gate that typechecks tests. Production source type-error repair remains owned by [`docs/specs/CHORE-10-fix-type-errors-harden-ci.md`](../docs/specs/CHORE-10-fix-type-errors-harden-ci.md). The final required gate is still zero source and test type errors.

Success criteria:

- Required CI cannot pass while source or test TypeScript contains type errors.
- `bun run test:ui` invokes the current Python suite, not the deprecated Bash harness.
- UI tests are isolated, cleanup-safe, and never stop a daemon or tmux resource they did not create.
- Daemon API integration tests and renderer end-to-end tests are named and reported separately.
- Renderer tests send real keys and verify rendered output for critical Vim and daily-driver workflows.
- Assertion failures, query failures, skips, and expected failures are reported accurately.
- Tests cannot silently pass because setup was not awaited or an expected value had the wrong shape.
- Testing commands and suite boundaries have one consistent definition across CI, rules, and documentation.

## Relevant Files

- `package.json` - Define authoritative typecheck, unit, integration, and UI test commands.
- `.github/workflows/ci.yml` - Require source/test typechecks and non-destructive UI jobs.
- `tsconfig.json` - Preserve the full-project typecheck contract.
- `tsconfig.src.json` - Preserve the production source-only typecheck gate.
- `tsconfig.test.json` - Add a dedicated test TypeScript typecheck configuration.
- `docs/specs/CHORE-10-fix-type-errors-harden-ci.md` - Coordinate production type-error repair and final zero-error acceptance.
- `test/mocks/filesystem.ts` - Bring the mock filesystem into compliance with the production `FileSystem` contract.
- `test/helpers/test-helpers.ts` - Add or expose typed, fail-fast test helpers.
- `test/helpers/editor-fixture.ts` - Add a focused started-editor fixture if the existing helper file would become unclear.
- `test/unit/count-prefix.test.ts` - Await editor startup and remove conditional assertions that can pass vacuously.
- `test/unit/frontend-input.test.ts` - Preserve frontend input behavior coverage.
- `test/unit/steep-input.test.ts` - Add pure Steep chunk-tokenization regression coverage.
- `test/unit/vim-dispatch.test.ts` - Strengthen Vim dispatch behavior and architecture-boundary assertions.
- `test/unit/lisp-owned-commands.test.ts` - Expand command ownership coverage.
- `test/unit/architecture-boundaries.test.ts` - Add an explicit T-Lisp ownership inventory and router-only boundary checks.
- `test/unit/window-splitting.test.ts` - Preserve state-level split and focus behavior coverage.
- `test/unit/window-resizing.test.ts` - Preserve state-level resize behavior coverage.
- `src/frontend/frontends/steep/input.ts` - Extract a testable chunk tokenizer and fix batched control-key normalization.
- `test/ui/run_python_suite.py` - Separate suite categories, guarantee cleanup, and report pass/fail/skip accurately.
- `test/ui/tmax_harness/config.py` - Generate per-run socket, tmux, and temporary resource identifiers.
- `test/ui/tmax_harness/editor.py` - Track resource ownership and only stop resources created by the harness.
- `test/ui/tmax_harness/input.py` - Provide real terminal key-input operations.
- `test/ui/tmax_harness/operations.py` - Distinguish daemon API operations from real renderer input operations.
- `test/ui/tmax_harness/assertions.py` - Make renderer, daemon, error, skip, and failure assertions truthful.
- `test/ui/tests/test_harness_helpers.py` - Cover harness lifecycle, isolation, ownership, and assertion semantics.
- `test/ui/tests/*.py` - Reclassify existing scenarios and guarantee cleanup.
- `test/ui/tests/14_vim_input.py` - Add real-key Vim insert/editing regressions.
- `test/ui/tests/15_daily_driver_rendering.py` - Add splits, tabs, focus, resizing, and relative-line-number rendering coverage.
- `rules/testing.md` - Define the authoritative testing matrix and required commands.
- `rules/ui-testing.md` - Document safe Python harness usage and renderer-test requirements.
- `test/ui/README.md` - Document current suites, modes, commands, and failure semantics.
- `test/ui/TEST_STATUS.md` - Replace stale status and legacy-default claims.
- `README.md` - Point contributors to authoritative test commands.
- `CLAUDE.md` - Keep workflow validation commands aligned if testing commands change.
- `AGENTS.md` - Mirror any testing workflow changes from `CLAUDE.md`.
- `specs/SPEC-004-daily-driver-blocks.md` - Validate daily-driver rendering acceptance criteria.
- `specs/SPEC-005-vim-editing-motions.md` - Validate Vim input and T-Lisp ownership acceptance criteria.

## Step by Step Tasks

### 1. Establish the Testing Matrix and Baseline

- Define four explicit suite boundaries:
  - Type safety: source TypeScript and test TypeScript.
  - Bun unit/integration tests: deterministic in-process behavior.
  - Daemon API integration tests: JSON-RPC, T-Lisp commands, and editor state without renderer claims.
  - Renderer end-to-end tests: real terminal input plus visible TUI or Steep output.
- Record the current baseline in the chore implementation notes:
  - Bun suite pass/fail count.
  - Source and test type-error counts.
  - Python daemon and daemon-tmux suite results.
- Coordinate with `docs/specs/CHORE-10-fix-type-errors-harden-ci.md`:
  - Do not duplicate broad production source-error repair.
  - Treat zero production source errors as a dependency for the final full-project gate.
  - Own and fix all test-specific type errors exposed by the new test gate.

### 2. Make Type Safety and Test Commands Authoritative

- Add `tsconfig.test.json` that typechecks test code and its required source imports without weakening compiler settings.
- Add clear package scripts for:
  - Source typechecking.
  - Test typechecking.
  - Full-project typechecking.
  - Bun tests.
  - Daemon integration tests.
  - Renderer UI tests.
- Change `test:ui` to invoke the current Python suite instead of `test/ui/start-ui-test.sh`.
- Keep the deprecated Bash harness out of authoritative scripts and required workflow documentation.
- Update CI so required jobs include:
  - Source typecheck.
  - Test typecheck.
  - Bun tests.
  - Non-destructive daemon integration tests.
  - Non-destructive daemon-tmux renderer tests.
- Ensure no required gate suppresses errors, ignores exit codes, or treats an unavailable dependency as a pass.

### 3. Make the Python Harness Isolated and Cleanup-Safe

- Generate a unique per-run identifier and use it for:
  - Daemon socket or runtime directory.
  - tmux session and window names.
  - Temporary files and configuration.
- Track ownership for every daemon, tmux resource, and temporary path created by the harness.
- Stop or remove only resources owned by the current test run.
- Remove unconditional cleanup that can stop a user daemon or delete unrelated `test-editor` tmux windows.
- Make cleanup idempotent and guaranteed with `try/finally` or a suite-level lifecycle wrapper.
- Add harness helper tests proving:
  - A pre-existing daemon remains running.
  - A pre-existing tmux session/window remains intact.
  - Cleanup runs after a scenario failure.
  - Two runs can use distinct resources without collision.

### 4. Separate Daemon Integration Tests From Renderer End-to-End Tests

- Classify every existing Python scenario as daemon integration, renderer end-to-end, or both.
- Rename suite labels and result output so daemon state checks are never described as UI verification.
- Keep direct T-Lisp evaluation helpers for daemon integration tests only.
- Add renderer-mode operations that send real keys through tmux or the Steep input path.
- Require renderer assertions to inspect captured renderer output.
- Make unsupported assertions fail clearly in the wrong mode instead of silently passing.
- Represent skip and expected-failure states separately from pass.
- Remove "known limitation" passes. Use an explicit tracked skip/expected failure only when the suite supports it; otherwise leave the test failing until behavior is implemented.
- Guarantee every scenario uses the lifecycle wrapper so cleanup occurs on success, failure, and exception.

### 5. Harden UI Assertions and Error Reporting

- Change `assert_no_errors` to query structured daemon/client error state such as `recentErrors` or an equivalent status API.
- Treat daemon query failures as test failures.
- Stop scanning the edited buffer for generic words such as `error`, `failed`, or `exception`.
- Make screen-fill and renderer assertions fail or explicitly skip when no renderer is available.
- Include enough captured input, screen, mode, and daemon status context in failures to diagnose regressions.
- Add focused helper tests for pass, failure, query-error, skip, and expected-failure reporting.

### 6. Harden the Steep Input Boundary and Real-Key Vim Coverage

- Extract a pure, deterministic tokenizer from `src/frontend/frontends/steep/input.ts`.
- Preserve printable text and Unicode while correctly normalizing controls inside batched chunks.
- Add unit coverage for:
  - Batched printable text.
  - Enter mixed with text.
  - Backspace mixed with text.
  - Tab and Ctrl keys.
  - Escape sequences mixed with text.
  - Partial and multiple escape sequences.
  - Unicode input.
- Add renderer end-to-end regressions that send real keys for:
  - Enter/new-line insertion in insert mode.
  - Backspace/delete behavior in insert mode.
  - Tab insertion or configured Tab behavior.
  - Escape back to normal mode.
  - Representative normal-mode motions, counts, operators, and linewise edits.
- Verify these scenarios through visible output and editor state rather than direct command evaluation alone.

### 7. Remove Vacuous Assertions and Async Setup Races

- Add typed helpers such as:
  - `createStartedEditor` to construct and await editor startup.
  - `expectRight` or equivalent to fail immediately when a result is not successful.
  - `bufferText` or equivalent to retrieve text without private-state access or `as any`.
- Replace every unawaited `editor.start()` in tests with awaited setup.
- Replace conditional expectations that can execute zero assertions with fail-fast typed assertions.
- Fix test mocks, beginning with `test/mocks/filesystem.ts`, so they implement current production interfaces such as `createDir`.
- Remove test-only private-state access and unsafe casts where a public or typed test helper can express the contract.
- Add a lightweight repository check or focused test that detects recurring unawaited editor startup and vacuous conditional expectation patterns without introducing a new lint dependency.

### 8. Strengthen T-Lisp Ownership and Daily-Driver Coverage

- Build an explicit inventory of Vim, window, and tab commands expected to be owned by T-Lisp.
- Add boundary tests that load and execute the relevant T-Lisp libraries rather than relying only on source-string checks.
- Add a narrow architectural allowlist or equivalent check proving TypeScript key handlers remain routers and do not regain editor policy.
- Keep source scans only as supplemental diagnostics, not the primary architecture assertion.
- Add daemon-tmux renderer scenarios using real keys for:
  - Visible horizontal and vertical splits.
  - `C-w` focus switching, closing, and resizing.
  - Tab bar visibility and active-tab indication.
  - `gt` and `gT` tab navigation.
  - Relative line number gutter rendering and current-line behavior.
  - Cursor/focus visibility after split, tab, and resize operations.
- Retain lower-level window state tests while using renderer tests to protect the user-visible daily-driver contract.

### 9. Consolidate Testing Documentation and Retire Legacy Guidance

- Establish `rules/testing.md` as the concise testing matrix and command reference.
- Keep `rules/ui-testing.md` focused on Python harness APIs, isolation rules, real-key requirements, and troubleshooting.
- Update `test/ui/README.md` and `test/ui/TEST_STATUS.md` to match current suite names, modes, commands, and limitations.
- Remove or clearly deprecate legacy Bash harness instructions and stale default-mode claims.
- Update `README.md`, `CLAUDE.md`, and mirrored `AGENTS.md` commands where required.
- Ensure all documentation agrees that:
  - Daemon tests are integration tests, not renderer UI tests.
  - Renderer tests must send real keys and inspect rendered output.
  - Query failures and unavailable assertions cannot pass.
  - Source and test typechecks are required.

### 10. Run the Full Required Validation Matrix

- Run every typecheck, Bun test, daemon integration test, and renderer test locally.
- Confirm the UI suite does not disturb a separately running user daemon or unrelated tmux resources.
- Confirm intentionally broken input parsing, architecture ownership, mock contracts, and renderer output each cause the appropriate required job to fail.
- Record final suite counts and any explicit skips or expected failures.
- Do not report the chore complete until all required commands exit successfully and no required check is skipped.

## Validation Commands

```bash
bun run typecheck:src
bun run typecheck:test
bun run typecheck
bun test
bun test test/unit/steep-input.test.ts test/unit/frontend-input.test.ts test/unit/vim-dispatch.test.ts test/unit/count-prefix.test.ts
bun test test/unit/architecture-boundaries.test.ts test/unit/lisp-owned-commands.test.ts test/unit/window-splitting.test.ts test/unit/window-resizing.test.ts
(cd test/ui && uv run python tests/test_harness_helpers.py)
(cd test/ui && uv run python run_python_suite.py daemon)
(cd test/ui && uv run python run_python_suite.py daemon-tmux)
bun run test:ui
git diff --check
```

## Notes

- Prior review baseline: `bun test` passed 1,598 tests, while `bun run typecheck` reported 1,230 errors, including 1,067 test errors and 149 source errors. Re-measure before implementation because the workspace may have changed.
- `bun run typecheck:src` currently fails on production errors owned by `docs/specs/CHORE-10-fix-type-errors-harden-ci.md`. This chore is not complete until that dependency is resolved and the full typecheck is green.
- The demonstrated Steep batching defect converts `"\ra"` into `["\r", "a"]`; the expected normalized tokens are `["\n", "a"]`.
- Keep daemon API helpers because they provide fast integration coverage, but do not use them as evidence that terminal input or rendering works.
- Prefer extending existing helpers and modules. Add new files only when doing so makes suite boundaries or ownership materially clearer.
- Do not add external runtime dependencies solely for test orchestration or static checks.
- Do not run destructive UI cleanup against default user daemon sockets, tmux sessions, or windows.
