# Chore: Test Suite Cleanup

## Chore Description
Clean up the test suite based on the audit findings: remove placeholder and debug-only tests, consolidate duplicated coverage, fix brittle assertions, and simplify repeated test setup. The goal is a smaller, quieter, more behavior-focused suite with no loss of meaningful regression coverage.

The cleanup should preserve productive tests around editor behavior, T-Lisp semantics, daemon/server behavior, completion, file operations, and Python UI workflows. It should remove tests that only assert `true`, print debug transcripts, or duplicate stronger canonical tests.

## Relevant Files
Use these files to resolve the chore:

- `README.md` - Project context, architecture, and canonical test commands.
- `package.json` - Test script entry points for unit, integration, daemon, and UI suites.
- `test/helpers/editor-fixture.ts` - Existing helper module to extend for common editor/test execution setup.
- `test/unit/eval-buffer.test.ts` - Placeholder-only tests; replace with real behavior tests or remove.
- `test/unit/eval-init-file.test.ts` - Placeholder-only tests; replace with real behavior tests or remove.
- `test/unit/init-file-loading.test.ts` - Mostly string-construction and placeholder assertions; replace with real init-file behavior coverage or remove in favor of existing integration tests.
- `test/unit/debug-error-test.test.ts` - Debug transcript for `assert-error`; fold unique assertions into canonical assertion tests, then delete.
- `test/unit/debug-tlisp-testing.test.ts` - Debug transcript for `deftest` and `assert-true`; covered by canonical testing framework tests.
- `test/unit/simple-test-debug.test.ts` - Debug transcript for simple test definition/run; covered by canonical testing framework tests.
- `test/unit/simple-isolation-test.test.ts` - Debug-style isolation probe; merge any unique `defvar` coverage into `test-isolation.test.ts`.
- `test/unit/test-assert-type-debug.test.ts` - Debug probe; covered by `test-rich-assertions.test.ts`.
- `test/unit/test-assert-type-error.test.ts` - Debug probe; covered by `test-rich-assertions.test.ts`.
- `test/unit/test-assertions-debug.test.ts` - Debug probe; covered by `test-rich-assertions.test.ts`.
- `test/unit/test-coverage-enable-debug.test.ts` - Debug probe; covered by `basic-coverage.test.ts`.
- `test/unit/test-defvar-debug.test.ts` - Debug probe; covered by evaluator/interpreter tests.
- `test/unit/test-defvar-simple-debug.test.ts` - Debug probe; covered by evaluator/interpreter tests.
- `test/unit/test-fixture-body-debug.test.ts` - Debug probe; covered by fixture system tests.
- `test/unit/test-fixture-debug.test.ts` - Debug probe; covered by fixture system tests.
- `test/unit/test-fixture-simple-debug.test.ts` - Debug probe; covered by fixture system tests.
- `test/unit/test-fixture-underscore-debug.test.ts` - Debug probe; covered by fixture system tests.
- `test/unit/test-multistmt-debug.test.ts` - Debug probe; covered by parser/interpreter and suite tests.
- `test/unit/test-nested-suite-debug.test.ts` - Debug probe; covered by `test-test-suites.test.ts`.
- `test/unit/test-parser-multiline.test.ts` - Debug-style parser probe; merge useful multiline case into parser tests.
- `test/unit/test-simple-assert-type.test.ts` - Debug probe; covered by rich assertion tests.
- `test/unit/test-suite-debug.test.ts` - Debug probe; covered by suite tests.
- `test/unit/test-suite-debug2.test.ts` - Debug probe; covered by suite tests.
- `test/unit/test-test-suites-debug.test.ts` - Debug probe; covered by suite tests.
- `test/unit/test-append-function.test.ts` - Minimal debug probe; covered by stdlib tests.
- `test/unit/test-list-function.test.ts` - Minimal debug probe; covered by stdlib tests.
- `test/unit/parser.test.ts` and `test/unit/parser-with-either.test.ts` - Duplicate parser coverage; merge Either/error-path assertions into `parser.test.ts`.
- `test/unit/tokenizer.test.ts` and `test/unit/tokenizer-with-either.test.ts` - Duplicate tokenizer coverage; merge Either/error-path assertions into `tokenizer.test.ts`.
- `test/unit/core-bindings.test.ts`, `test/unit/core-bindings-simple.test.ts`, and `test/unit/test-core-bindings-split.test.ts` - Overlapping binding checks; keep behavior-focused loader coverage and remove brittle source-text/count checks where redundant.
- `test/integration/core-bindings.test.ts` - Contains brittle exact status-message assertion that currently fails integration.
- `test/integration/migration-validation.test.ts` and `test/integration/migration-validation-fixed.test.ts` - Duplicate migration validation coverage; keep one.
- `test/unit/file-completion.test.ts` and `test/unit/buffer-completion.test.ts` - Productive tests with repeated setup that can use shared helpers.
- `test/unit/which-key-popup.test.ts` and `test/unit/command-documentation-preview.test.ts` - Productive but slow tests; simplify timeout-dependent cases if the codebase exposes a safe way to lower delays in tests.
- `test/ui/README.md`, `test/ui/TEST_STATUS.md`, and `test/ui/tests/*.py` - Python UI suite is authoritative and should remain.
- `test/ui/tests/*.test.sh`, `test/ui/lib/*.sh`, `test/ui/core/*.sh`, `test/ui/ops/*.sh`, and `test/ui/assert/*.sh` - Deprecated Bash UI harness; remove from CI expectations or move to explicit legacy/reference status.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Record Baseline And Protect Current Work
- Run `git status --short` and identify unrelated pre-existing changes.
- Run targeted baseline commands for the known problem areas:
  - `bun test test/unit/`
  - `bun test test/integration/`
- Confirm the only expected integration failure before cleanup is the brittle `test/integration/core-bindings.test.ts` status-message assertion.

### 2. Fix Brittle Integration Assertion
- Update `test/integration/core-bindings.test.ts` so the missing-core-bindings case asserts behavior, not an incidental final status message.
- Prefer assertions such as:
  - `testEditor.isRunning()` is true after startup.
  - `state.statusMessage` does not contain `"Failed to load core bindings"`, unless the desired contract is to surface that warning.
- Re-run `bun test test/integration/core-bindings.test.ts`.

### 3. Delete Placeholder-Only Tests
- Remove tests that provide no behavioral protection:
  - `test/unit/eval-buffer.test.ts`
  - `test/unit/eval-init-file.test.ts`
  - `test/unit/init-file-loading.test.ts`
- Before deleting, confirm equivalent real coverage exists in integration tests or editor tests.
- If a real gap exists, replace the placeholder file with one or two actual editor-level tests instead of keeping placeholder assertions.

### 4. Fold Debug Probe Coverage Into Canonical Test Files
- For each `*debug*.test.ts`, `simple-test-debug.test.ts`, `test-simple-assert-type.test.ts`, `test-append-function.test.ts`, and `test-list-function.test.ts`, check whether it contains a unique assertion not already covered.
- Move unique cases into the canonical file:
  - Assertion behavior into `test/unit/test-rich-assertions.test.ts`.
  - Fixture behavior into `test/unit/test-fixtures-system.test.ts`.
  - Suite behavior into `test/unit/test-test-suites.test.ts`.
  - Isolation behavior into `test/unit/test-isolation.test.ts`.
  - Parser multiline behavior into `test/unit/parser.test.ts`.
  - `append` and `list` behavior into `test/unit/stdlib.test.ts`.
- Delete the debug/probe files after preserving any unique behavior.
- Ensure no committed unit test emits ordinary `console.log` output unless the test is explicitly verifying console output.

### 5. Merge Parser And Tokenizer Either Tests
- Move the useful error-path assertions from `test/unit/parser-with-either.test.ts` into `test/unit/parser.test.ts`.
- Move the useful error-path assertions from `test/unit/tokenizer-with-either.test.ts` into `test/unit/tokenizer.test.ts`.
- Delete `parser-with-either.test.ts` and `tokenizer-with-either.test.ts`.
- Prefer `Either.isRight` and `Either.isLeft` assertions over `'right' in result` / `'left' in result`.

### 6. Consolidate Core Binding Tests
- Keep the behavior-focused split loader test in `test/unit/test-core-bindings-split.test.ts`.
- Remove or shrink source-text tests in `test/unit/core-bindings.test.ts` and `test/unit/core-bindings-simple.test.ts` that duplicate each other or assert brittle key-bind counts.
- Keep only a minimal syntax/loadability check if it still reflects an actual shipped file.
- Re-run the core binding unit and integration tests.

### 7. Consolidate Migration Validation Tests
- Compare `test/integration/migration-validation.test.ts` and `test/integration/migration-validation-fixed.test.ts`.
- Keep the clearer/current version and delete the duplicate.
- Ensure the remaining file covers editor creation, `key-bind` availability, core binding loading, command execution, and key mapping count/shape if those are still meaningful.

### 8. Simplify Repeated Editor Completion Setup
- Extend `test/helpers/editor-fixture.ts` with narrowly scoped helpers if useful:
  - `executeTlisp(editor, source)` already exists; reuse it in completion tests.
  - Add a row-text helper only if it is reused by multiple files.
  - Add a `startFindFileCompletion` helper only if it reduces repetition without hiding important behavior.
- Refactor `test/unit/file-completion.test.ts` and `test/unit/buffer-completion.test.ts` to use the shared helpers.
- Keep assertions behavior-focused: visible candidates, filtering, no-match messaging, accept/cancel effects.

### 9. Reduce Slow Timeout-Dependent Tests Where Safe
- Inspect `test/unit/which-key-popup.test.ts` and `test/unit/command-documentation-preview.test.ts` for repeated one-second timeout waits.
- If the production API supports it, set a shorter which-key timeout in test setup.
- If no safe API exists, leave behavior unchanged and add a note in the final report rather than introducing timing hacks.

### 10. Treat Bash UI Harness As Legacy Reference
- Do not add new Bash UI tests.
- Ensure package scripts and documentation point to the Python UI harness as authoritative.
- If Bash tests are referenced by CI or docs as validation, update those references to the Python commands.
- Leave Bash files in place only if they are explicitly marked legacy/reference and are not part of automated validation.

### 11. Run Validation Commands
- Execute every command in the Validation Commands section.
- Fix any failures introduced by the cleanup.
- Confirm final output has no test failures and less noisy debug output than the baseline.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run typecheck:src` - Validate source TypeScript.
- `bun run typecheck:test` - Validate test TypeScript.
- `bun test test/unit/` - Run all unit tests.
- `bun test test/integration/` - Run all TypeScript integration tests.
- `bun run test:daemon` - Run authoritative daemon API UI tests.
- `bun run test:ui:helpers` - Run Python UI harness helper tests.
- `bun run test:ui:renderer` - Run renderer/TUI tests when tmux is available.

## Notes
- The current audit baseline showed unit tests passing (`1538 pass, 0 fail`) and integration tests failing only on a brittle final status-message assertion in `test/integration/core-bindings.test.ts`.
- The cleanup should reduce the number of committed TypeScript test files and remove ordinary debug output from the unit run.
- Do not remove meaningful behavior tests just because they overlap at a high level. Remove only exact duplicates, placeholder assertions, debug probes, and brittle source-text assertions that are covered by stronger behavior tests.
