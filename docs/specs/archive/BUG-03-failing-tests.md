# Bug: Failing Test Suite Regressions

## Bug Description
The Bun test suite has multiple failing clusters after the daily-driver implementation work. The visible symptoms are failed fuzzy completion winner selection, T-Lisp test isolation leaks, quoted-symbol `assert-type` failures, `coverage-enable false` not disabling coverage, malformed error-handling expectations, a keymap test typo, and a daemon startup test timing out.

## Problem Statement
The suite should pass without relying on global T-Lisp state leaks, malformed assertions, or long-running daemon processes. Current failures mask real regressions and make SPEC-035 validation unreliable.

## Solution Statement
Fix the root causes in the smallest affected areas: preserve isolated T-Lisp environments when test framework helpers execute bodies, parse `false` as a boolean literal, accept quoted symbols in `assert-type`, tune fuzzy best-match scoring, correct invalid test assertions/typos, and make the daemon smoke test terminate under Bun's test timeout.

## Steps to Reproduce
- Run `bun test --timeout 120000`.
- Observe failures in error handling, fuzzy completion, server daemon, T-Lisp isolation, rich assertions, coverage-enable debug, and keymap customization tests.
- Run targeted clusters such as `bun test test/unit/fuzzy-command-completion.test.ts test/unit/test-isolation.test.ts test/unit/test-rich-assertions.test.ts`.

## Root Cause Analysis
- The mock interpreter used while registering builtins ignored the optional evaluation environment, so test bodies executed against `globalEnv` instead of an isolated child environment.
- `false` was not parsed as a boolean literal, so `(coverage-enable false)` evaluated an undefined symbol and left coverage enabled.
- `assert-type` did not evaluate its quoted type argument before checking for a symbol.
- Fuzzy matching gave ambiguous scores to clear abbreviation patterns such as `buf-s` and `bs`.
- Some tests contain invalid `expect(...includes(...).toBe(true))` patterns or an undefined variable name.
- The daemon smoke test used a 5-second shell timeout inside a 5-second Bun test timeout.

## Relevant Files
- `src/tlisp/evaluator.ts` - Builtin registration mock, test special forms, and `assert-type` evaluation.
- `src/tlisp/parser.ts` - Boolean literal parsing.
- `src/editor/utils/fuzzy-completion.ts` - Fuzzy scoring and best-match selection.
- `test/unit/error-handling.test.ts` - Invalid expectation syntax.
- `test/unit/server-daemon.test.ts` - Daemon smoke timeout.
- `test/integration/keymap-customization.test.ts` - Undefined variable typo.

## Step by Step Tasks

### 1. Preserve T-Lisp Test Isolation
- Update the builtin-registration mock evaluator to honor the environment parameter.
- Verify `defvar` inside a test no longer writes into `globalEnv`.

### 2. Fix Boolean and Type Assertions
- Parse `false` as `createBoolean(false)`.
- Evaluate `assert-type` arguments so `(quote number)` is accepted as a type symbol.
- Keep string arguments rejected for the existing negative test.

### 3. Restore Fuzzy Best Matches
- Improve abbreviation scoring for hyphen-separated command components.
- Keep ambiguous prefixes such as `buf` returning `null`.

### 4. Correct Test Harness Issues
- Fix malformed error-handling `expect` calls.
- Replace the undefined keymap test variable with the intended init content.
- Shorten daemon smoke timeout below Bun's per-test timeout.

### 5. Run Validation Commands
- Execute targeted tests for each fixed cluster.
- Execute the full Bun test suite.

## Validation Commands
- `bun test test/unit/fuzzy-command-completion.test.ts test/unit/test-isolation.test.ts test/unit/test-isolation-simple.test.ts test/unit/test-rich-assertions.test.ts test/unit/test-coverage-enable-debug.test.ts test/integration/keymap-customization.test.ts --timeout 120000` - Validate the main functional clusters.
- `bun test test/unit/error-handling.test.ts test/unit/server-daemon.test.ts --timeout 120000` - Validate test typo and daemon clusters.
- `bun test --timeout 120000` - Validate the full suite.

## Notes
No new dependency is required.
