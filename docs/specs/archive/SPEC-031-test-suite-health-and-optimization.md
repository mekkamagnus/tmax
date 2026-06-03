# Bug: Test Suite Health — 48 Failures, Logger Pollution, and Structural Optimization

## Bug Description

The tmax test suite has 48 failing tests (1230 pass / 1278 total) and produces 49,048 lines of output in 47.82 seconds. The failures fall into distinct categories with identifiable root causes. Additionally, the suite has 15 debug artifact test files (~200 tests, ~16K lines of code) that are development scaffolding, and multiple sets of duplicate test files testing the same modules.

### Test Run Summary (2026-05-02)
- **1278 tests across 118 files**
- **1230 pass, 48 fail, 1 error**
- **47.82 seconds runtime**
- **49,048 lines of output** (mostly logger noise)

## Problem Statement

1. **48 failing tests** across 7 distinct categories need fixing
2. **Logger output** (49K lines) makes it impossible to spot failures — the AI-friendly structured logger dumps to stdout on every Editor construction (5+ entries each, with stack traces)
3. **15 debug artifact test files** inflate the suite with ~200 tests of zero production value
4. **Duplicate test coverage** — multiple files test the same modules with overlapping assertions

## Solution Statement

Fix the 48 failing tests by category, redirect logger output to files in test mode, remove debug artifacts, and consolidate duplicate test files.

---

## Failing Tests — Detailed Breakdown

### Category 1: Error Handling Tests (6 failures)
**File:** `test/unit/error-handling.test.ts`
**Root Cause:** Test syntax bugs — `expect()` called on the return value of `.includes().toBe()` instead of wrapping the whole expression.

Broken patterns found in the file:
```typescript
// BROKEN: .includes().toBe(true) returns void inside expect()
expect(validationError.getUserMessage().toBe(true).includes("Invalid email"));
expect(aiFormat.includes("🚨 TMAX ERROR REPORT").toBe(true));
expect(health).toBeDefined();
expect(["healthy", "degraded", "critical"].includes(health.status).toBe(true));
expect(report.includes("🔬 TMAX DEBUG ANALYSIS REPORT").toBe(true));
expect(Either.isRight(sizeResult).toBe(true) || Either.isLeft(sizeResult));
expect(aiReport.includes("🔍 TMAX ERROR ANALYSIS REPORT").toBe(true));
```

Should be:
```typescript
expect(validationError.getUserMessage()).toContain("Invalid email");
expect(aiFormat).toContain("🚨 TMAX ERROR REPORT");
expect(["healthy", "degraded", "critical"]).toContain(health.status);
expect(report).toContain("🔬 TMAX DEBUG ANALYSIS REPORT");
expect(Either.isRight(sizeResult) || Either.isLeft(sizeResult)).toBe(true);
expect(aiReport).toContain("🔍 TMAX ERROR ANALYSIS REPORT");
```

**Failed tests:**
- `ErrorFactory - should create specific error types`
- `TmaxError - should provide AI-friendly formatting`
- `DebugReporter - should track system health`
- `DebugReporter - should generate AI reports`
- `Integration - Terminal with enhanced error handling`
- `Error Manager - comprehensive report generation`

### Category 2: Rich Assertions / assert-type (6 failures)
**File:** `test/unit/test-rich-assertions.test.ts`
**Root Cause:** The T-Lisp `assert-type` function returns `Left` for valid type checks. The function appears to be checking type names incorrectly — `number`, `string`, `list`, `boolean` types all fail, but `nil` passes.

**Failed tests:**
- `assert-type > should pass when value is number type` — `Either.isRight(result)` returns `false`
- `assert-type > should pass when value is string type` — same
- `assert-type > should pass when value is list type` — same
- `assert-type > should pass when value is boolean type` — same
- `assert-type > should fail when type does not match` — assertion inverted, also broken
- `assert-type > should fail with actual type in details` — message doesn't contain "expected type"

**Source to fix:** `src/tlisp/stdlib.ts` or wherever `assert-type` is implemented — likely a type-name comparison bug.

### Category 3: Word Under Cursor Search (6 failures)
**File:** `test/unit/word-under-cursor-search.test.ts`
**Root Cause:** The `*` (word-under-cursor-next) and `#` (word-under-cursor-previous) operators are not properly implemented or not wired to key bindings. The `n`/`N` continuation after `#` also fails.

**Failed tests:**
- `* > continues from current position to find next match`
- `* > handles word in middle of line`
- `# > moves cursor to previous occurrence of word under cursor`
- `# > n continues in same direction after #`
- `# > N reverses direction after #`
- `# > handles underscores in words`

### Category 4: Count Prefix (10 failures)
**File:** `test/unit/count-prefix.test.ts`
**Root Cause:** Every test in this file prints `Failed to load some core bindings. Last error: Failed to load from src/tlisp/core/bindings/command.tlisp`. The file exists at `src/tlisp/core/bindings/command.tlisp` but loading fails — likely a CWD-relative path issue when bun runs from the test directory.

**Failed tests:**
- `3w` — move 3 words forward
- `2b` — move 2 words backward
- `2e` — move to end of word 2 times
- `5+` — move down 5 lines
- `3-` — move up 3 lines
- `3x` — delete 3 characters
- `5dd` — delete 5 lines
- `2dw` — delete 2 words
- `2yy` — yank 2 lines
- `3p` — paste 3 times
- `count preserved in lastCommand`

### Category 5: Yank Operator Integration (5 failures)
**File:** `test/unit/yank-operator-integration.test.ts`
**Root Cause:** `paste-after` and `paste-before` functions return `Left` (error) instead of `Right`. The yank operations likely depend on core bindings that fail to load (same `command.tlisp` error).

**Failed tests:**
- `p > should paste character after cursor`
- `p > should paste line below current line`
- `p > should support count prefix (3p pastes 3 times)`
- `P > should paste character before cursor`
- `P > should paste line above current line`

### Category 6: Test Isolation (4 failures)
**File:** `test/unit/test-isolation.test.ts` (3 failures), `test/unit/test-isolation-simple.test.ts` (1 failure)
**Root Cause:** T-Lisp interpreter environment leaks between tests. Variables defined in one test persist into the next. The error message: `expect(received).toBe(expected) Expected: true Received: false` at the "clean test should pass" assertion — meaning a prior failing test polluted the environment.

Also: `test/unit/test-coverage-enable-debug.test.ts` (1 failure) — `debug coverage-enable`

**Failed tests:**
- `variables defined in one test should not exist in another test`
- `setup and teardown functions should work`
- `failed tests should not affect next test environment`
- `debug coverage-enable`

### Category 7: Core Binding Loading (4 failures)
**File:** `test/unit/core-bindings.test.ts`
**Root Cause:** Tests expect to load bindings from `src/tlisp/core/bindings/insert.tlisp`, `visual.tlisp`, etc. but file loading fails with "File not found" despite files existing. Same CWD-relative path issue as Category 4.

**Failed tests:**
- `should load insert mode bindings from insert.tlisp`
- `should load visual mode bindings from visual.tlisp`
- `should load custom bindings from ~/.config/tmax/init.tlisp`
- `should load all four binding files`

### Category 8: Server Daemon (1 failure)
**File:** `test/unit/server-daemon.test.ts`
**Root Cause:** Test expects to start a tmax server daemon and connect within 5000ms. Times out every time — likely no server socket implementation or port conflict.

**Failed test:**
- `should start tmax server daemon` — 5003ms (timed out after 5000ms)

### Category 9: T-Lisp Testing Framework (1 failure)
**File:** `test/unit/test-tlisp-testing-framework.test.ts`
**Root Cause:** `test-run-all` doesn't properly aggregate results — likely cascading from test isolation issues (Category 6).

**Failed test:**
- `should run all tests with test-run-all`

### Category 10: Minibuffer Input (1 failure)
**File:** `test/unit/minibuffer-input.test.ts`
**Root Cause:** Tab completion with ambiguous options doesn't show multiple completions.

**Failed test:**
- `Tab Completion > should show multiple completion options when ambiguous`

### Category 11: Keymap Customization E2E (1 failure)
**File:** `test/integration/keymap-customization.test.ts`
**Root Cause:** init.tlisp file loading fails — same path issue as Categories 4 and 7.

**Failed test:**
- `Custom Bindings Override Defaults > should allow binding multiple keys in init.tlisp`

---

## Logger Pollution

### Current Behavior
The Logger (`src/utils/logger.ts:69`) is a singleton that defaults to:
- `level: LogLevel.INFO`
- `structured: true`
- `includeStack: true`
- `aiFriendly: true`

Every Editor construction (`new Editor`) emits 5+ structured log entries via `console.log`, each with stack traces. With 59 `new Editor()` calls across tests, this produces ~49,000 lines of output.

### Proposed Fix: Log to File
Instead of silencing the logger, redirect output to a timestamped file:

1. Add `setOutputTarget(target: 'stdout' | 'file', filePath?: string)` method to Logger
2. In test setup (`beforeAll`), call `logger.setOutputTarget('file', '/tmp/tmax-test-{timestamp}.log')`
3. On test failure, the harness prints the log path with the last N relevant entries
4. AI agents can read the full log when debugging failures
5. Test runner output stays clean — only pass/fail lines visible

This preserves the AI-debugging benefit while eliminating noise.

---

## Debug Artifact Tests (15 files, ~200 tests)

These files are development scaffolding with `console.log` debugging, zero production assertions, and names matching `*-debug*.test.ts` or `simple-*-test.test.ts`:

| File | Lines | console.log count |
|------|-------|-------------------|
| `test-assertions-debug.test.ts` | 1859 | 7 |
| `test-fixture-debug.test.ts` | 1497 | 6 |
| `test-fixture-underscore-debug.test.ts` | 1508 | 4 |
| `test-nested-suite-debug.test.ts` | 1351 | 5 |
| `test-suite-debug2.test.ts` | 1315 | 5 |
| `test-fixture-body-debug.test.ts` | 1313 | — |
| `test-assert-type-debug.test.ts` | 1133 | — |
| `simple-test-debug.test.ts` | 1024 | 4 |
| `test-suite-debug.test.ts` | 1121 | — |
| `test-defvar-debug.test.ts` | 1066 | — |
| `test-fixture-simple-debug.test.ts` | 1143 | — |
| `test-multistmt-debug.test.ts` | 1073 | — |
| `test-defvar-simple-debug.test.ts` | 925 | — |
| `test-test-suites-debug.test.ts` | 975 | — |
| `test-coverage-enable-debug.test.ts` | 828 | — |
| **Total** | **~17,131** | **31+** |

**Action:** Delete these 15 files. If any contain unique test coverage, merge the meaningful assertions into the corresponding non-debug test file.

---

## Duplicate Test Coverage

These file pairs test the same modules with overlapping assertions:

| Module | Files | Recommendation |
|--------|-------|----------------|
| Evaluator | `evaluator.test.ts` + `evaluator-either.test.ts` + `evaluator-with-either.test.ts` | Merge into `evaluator.test.ts` |
| Parser | `parser.test.ts` + `parser-with-either.test.ts` | Merge into `parser.test.ts` |
| Tokenizer | `tokenizer.test.ts` + `tokenizer-with-either.test.ts` | Merge into `tokenizer.test.ts` |
| Macros | `macros.test.ts` + `macro-recording.test.ts` + `macro-persistence.test.ts` | Keep split (recording vs persistence are distinct concerns) |
| Core bindings | `core-bindings.test.ts` + `core-bindings-simple.test.ts` + `test-core-bindings-split.test.ts` | Merge into `core-bindings.test.ts` |
| Yank | `yank-operator.test.ts` + `yank-operator-integration.test.ts` | Keep split (unit vs integration) |
| Test isolation | `test-isolation.test.ts` + `test-isolation-simple.test.ts` | Merge into `test-isolation.test.ts` |
| Migration | `migration-validation.test.ts` + `migration-validation-fixed.test.ts` | Delete `migration-validation.test.ts` (the "fixed" version supersedes it) |

---

## Slow Tests

| File | Tests | Per-test time | Total estimated |
|------|-------|---------------|-----------------|
| `command-documentation-preview.test.ts` | 19 | 1.1-1.4s | ~25s |
| `test-ai-agent-control.test.ts` | 20+ | 600-700ms | ~14s |
| `which-key-popup.test.ts` | 20+ | 1.1-2.2s | ~30s |
| `server-daemon.test.ts` | 1 | 5.0s (timeout) | 5s |

These 4 files account for an estimated **~74s** of the 47.82s runtime (they may run in parallel with other files within bun). Each creates expensive Editor instances with full initialization.

---

## Relevant Files

### Source Files to Fix
- `src/utils/logger.ts` — Add `setOutputTarget()` method for log-to-file support
- `src/utils/error-manager.ts` — Error classes used by failing tests
- `src/tlisp/stdlib.ts` — `assert-type` implementation (Category 2)
- `src/editor/editor.ts` — Editor constructor, binding loading paths
- `src/editor/keymap-sync.ts` — Keymap lookup (warning about non-hashmap)
- `src/tlisp/core/bindings/*.tlisp` — Core binding files that fail to load

### Test Files to Fix
- `test/unit/error-handling.test.ts` — Fix `expect()` syntax bugs (6 tests)
- `test/unit/test-rich-assertions.test.ts` — Depends on `assert-type` fix (6 tests)
- `test/unit/word-under-cursor-search.test.ts` — `*`/`#` operators (6 tests)
- `test/unit/count-prefix.test.ts` — Path resolution + operator wiring (10 tests)
- `test/unit/yank-operator-integration.test.ts` — Paste functions (5 tests)
- `test/unit/test-isolation.test.ts` — Environment isolation (3 tests)
- `test/unit/test-isolation-simple.test.ts` — Same (1 test)
- `test/unit/core-bindings.test.ts` — File loading paths (4 tests)
- `test/unit/server-daemon.test.ts` — Timeout (1 test)
- `test/unit/test-tlisp-testing-framework.test.ts` — test-run-all (1 test)
- `test/unit/minibuffer-input.test.ts` — Tab completion (1 test)
- `test/integration/keymap-customization.test.ts` — init.tlisp loading (1 test)
- `test/unit/test-coverage-enable-debug.test.ts` — Debug artifact (1 test)

### Test Files to Delete (Debug Artifacts)
- `test/unit/test-fixture-debug.test.ts`
- `test/unit/test-fixture-underscore-debug.test.ts`
- `test/unit/test-fixture-body-debug.test.ts`
- `test/unit/test-fixture-simple-debug.test.ts`
- `test/unit/test-assertions-debug.test.ts`
- `test/unit/test-assert-type-debug.test.ts`
- `test/unit/test-suite-debug.test.ts`
- `test/unit/test-suite-debug2.test.ts`
- `test/unit/test-nested-suite-debug.test.ts`
- `test/unit/test-multistmt-debug.test.ts`
- `test/unit/test-defvar-debug.test.ts`
- `test/unit/test-defvar-simple-debug.test.ts`
- `test/unit/test-test-suites-debug.test.ts`
- `test/unit/simple-test-debug.test.ts`
- `test/unit/simple-isolation-test.test.ts`

### Test Files to Consolidate
- Delete `test/unit/parser-with-either.test.ts` → merge into `parser.test.ts`
- Delete `test/unit/tokenizer-with-either.test.ts` → merge into `tokenizer.test.ts`
- Delete `test/unit/evaluator-with-either.test.ts` → merge into `evaluator.test.ts`
- Delete `test/unit/evaluator-either.test.ts` → merge into `evaluator.test.ts`
- Delete `test/unit/core-bindings-simple.test.ts` → merge into `core-bindings.test.ts`
- Delete `test/unit/test-core-bindings-split.test.ts` → merge into `core-bindings.test.ts`
- Delete `test/unit/test-isolation-simple.test.ts` → merge into `test-isolation.test.ts`
- Delete `test/integration/migration-validation.test.ts` → keep `migration-validation-fixed.test.ts`

### New Files
- None needed

---

## Step by Step Tasks

### Phase 1: Logger — Log-to-File Support
- Add `setOutputTarget(target: 'stdout' | 'file', filePath?: string)` method to `src/utils/logger.ts`
- When target is `'file'`, write structured entries to the specified file instead of `console.log`
- Create a test helper that calls `logger.setOutputTarget('file', ...)` in `beforeAll`
- Add `afterAll` hook that prints the log path only if tests failed

### Phase 2: Fix Core Binding Path Resolution (fixes Categories 4, 5, 7, 11)
- Investigate why `src/tlisp/core/bindings/command.tlisp` reports "File not found" when the file exists
- The path resolution in Editor constructor likely uses CWD-relative paths instead of project-root-relative
- Fix the path resolution to use `import.meta.dir` or similar for absolute paths
- Verify: `bun test test/unit/core-bindings.test.ts` passes all 4 tests
- This should also fix count-prefix (10), yank-operator-integration (5), and keymap-customization (1)

### Phase 3: Fix Error Handling Test Syntax (fixes Category 1)
- Fix all broken `expect()` calls in `test/unit/error-handling.test.ts`:
  - Line 94: `expect(validationError.getUserMessage()).toContain("Invalid email")`
  - Line 141: `expect(aiFormat).toContain("🚨 TMAX ERROR REPORT")`
  - Line 162: `expect(["healthy", "degraded", "critical"]).toContain(health.status)`
  - Line 177: `expect(report).toContain("🔬 TMAX DEBUG ANALYSIS REPORT")`
  - Line 224: `expect(Either.isRight(sizeResult) || Either.isLeft(sizeResult)).toBe(true)`
  - Line 249: `expect(aiReport).toContain("🔍 TMAX ERROR ANALYSIS REPORT")`
- Verify: `bun test test/unit/error-handling.test.ts` passes all 12 tests

### Phase 4: Fix assert-type in T-Lisp (fixes Category 2)
- Debug `assert-type` in `src/tlisp/stdlib.ts` — determine why `(assert-type 42 'number)` returns Left
- Likely a type-name comparison mismatch (e.g., `'number'` vs `'Number'` or type tag mismatch)
- Verify: `bun test test/unit/test-rich-assertions.test.ts` passes all assert-type tests

### Phase 5: Fix Word Under Cursor Search (fixes Category 3)
- Investigate `*` and `#` operator implementations
- Ensure they're wired to the correct key bindings and actually search for the word under cursor
- Verify: `bun test test/unit/word-under-cursor-search.test.ts` passes all 6 tests

### Phase 6: Fix Test Isolation (fixes Category 6 + 9)
- Ensure T-Lisp interpreter creates a fresh environment for each test
- The singleton Interpreter or Editor instance is leaking state between tests
- Each test must construct a new Interpreter with its own environment chain
- Verify: `bun test test/unit/test-isolation.test.ts` passes all 3 tests
- Verify: `bun test test/unit/test-coverage-enable-debug.test.ts` passes

### Phase 7: Fix Server Daemon Test (fixes Category 8)
- Either implement the server socket the test expects, or mock the server in the test
- If no server implementation exists, skip the test with `test.skip()` and a TODO comment
- Verify: `bun test test/unit/server-daemon.test.ts` no longer times out

### Phase 8: Fix Minibuffer Tab Completion (fixes Category 10)
- Debug the ambiguous completion case in the minibuffer
- Verify: `bun test test/unit/minibuffer-input.test.ts` passes

### Phase 9: Delete Debug Artifact Tests
- Delete the 15 files listed in "Test Files to Delete" above
- Verify: `bun test` still runs and no coverage is lost (check for unique test assertions before deleting)

### Phase 10: Consolidate Duplicate Tests
- Merge `*-with-either.test.ts` variants into their base files
- Merge `*-simple.test.ts` and `*-split.test.ts` into their base files
- Delete `migration-validation.test.ts` (superseded by `-fixed` version)
- Verify: `bun test` passes with same or better coverage

---

## Validation Commands

### Before fix (reproduce failures):
```bash
bun test 2>&1 | tee /tmp/tmax-test-before.txt
# Should show 48 failures
```

### Per-category validation:
```bash
bun test test/unit/error-handling.test.ts         # Phase 3: all 12 pass
bun test test/unit/test-rich-assertions.test.ts    # Phase 4: assert-type tests pass
bun test test/unit/word-under-cursor-search.test.ts # Phase 5: all 6 pass
bun test test/unit/count-prefix.test.ts             # Phase 2: all 10 pass
bun test test/unit/yank-operator-integration.test.ts # Phase 2: all 5 pass
bun test test/unit/core-bindings.test.ts             # Phase 2: all 4 pass
bun test test/unit/test-isolation.test.ts             # Phase 6: all 3 pass
bun test test/unit/server-daemon.test.ts              # Phase 7: no timeout
bun test test/unit/minibuffer-input.test.ts           # Phase 8: all pass
bun test test/integration/keymap-customization.test.ts # Phase 2: all pass
```

### After all fixes:
```bash
bun test 2>&1 | tee /tmp/tmax-test-after.txt
# Should show 0 failures, cleaner output with log-to-file
# Runtime should be under 40s with debug artifacts removed
```

### Type checking:
```bash
bunx tsc --noEmit
# Must pass with zero errors
```

---

## Notes

- **The core binding path issue is the biggest lever** — it likely fixes 20+ failures across count-prefix, yank-operator-integration, core-bindings, and keymap-customization in one shot.
- **Phase 1 (logger) is independent** and can be done in parallel with other phases.
- **Phases 9-10 (cleanup) should come last** — fix all tests first, then consolidate, so any merge conflicts are minimal.
- The existing SPEC-026 addressed similar test failures but from when there were 200 failures. Many were fixed, but 48 remain. This spec covers the residual.
- The `ralph-runs/` directory in git status is untracked and unrelated.
