# Bug: Flaky test startup and module exports inaccessible via eval

## Bug Description
Two related issues discovered during UI test expansion:

**Issue 1 — Flaky daemon startup**: Tests occasionally fail with "Daemon failed to start within 5 seconds" because `cleanup_run()` sends `(editor-quit)` to the previous test's daemon but does not wait for the process to actually terminate. The next test may start while the old daemon is still alive, causing port or resource conflicts.

**Issue 2 — Module exports inaccessible via eval**: T-Lisp functions defined inside `(defmodule ... (export ...))` blocks (e.g., `vim-count-current`, `indent-current-line`, `split-window-below`) are not accessible when evaluating expressions via the daemon client (`tmaxclient --eval`). Only TypeScript-registered primitives (`count-get`, `buffer-insert`) are accessible. The `resolveUniqueExport` lookup at `evaluator.ts:370` only runs inside module environments (`isModuleEnvironment(env)` check), but daemon eval uses the global environment.

## Problem Statement
1. The test runner's cleanup doesn't synchronize with daemon shutdown — it fires `(editor-quit)` and immediately proceeds.
2. The evaluator skips module export resolution when evaluating in the global environment, which is what `interpreter.execute(code)` (no env arg) uses — the path the daemon's `handleEval` takes.

## Solution Statement
1. **Cleanup fix**: After sending `(editor-quit)`, poll the socket until it stops responding (or a short timeout expires), confirming the daemon is fully stopped.
2. **Module export fix**: Extend the `resolveUniqueExport` check at `evaluator.ts:370` to also run for the global environment, not just module environments. This makes all exported module symbols accessible from any eval context — matching user expectation that `(vim-count-current)` "just works" after `normal.tlisp` loads all modules at startup.

## Steps to Reproduce

**Issue 1**:
1. Run `bun run test:ui` several times in succession
2. Occasionally test 02 (or any early test) fails with "Daemon failed to start within 5 seconds"

**Issue 2**:
1. Start daemon: `tmax file.txt`
2. Evaluate: `tmaxclient --socket /tmp/tmax-$(id -u)/server --eval '(vim-count-current)'`
3. Expected: returns `1` (default count)
4. Actual: error — `vim-count-current` is not found
5. But `(count-get)` works because it's a TypeScript primitive registered in the global env

## Root Cause Analysis

**Issue 1**: In `run_python_suite.py:cleanup_run()`, after sending `(editor-quit)` via tmaxclient, the function immediately proceeds to kill tmux and remove directories. It never confirms the daemon process has exited. The next test starts, creates a new daemon, but the old one may still be holding resources.

**Issue 2**: In `evaluator.ts:370`:
```typescript
if (value === undefined && slashIdx < 0 && this.moduleRegistry && this.isModuleEnvironment(env)) {
  const exported = this.moduleRegistry.resolveUniqueExport(name);
  // ...
}
```
The `this.isModuleEnvironment(env)` guard prevents this code from running when `env` is the global environment. The daemon's `handleEval` calls `interpreter.execute(code)` which defaults to `this.globalEnv`, so module exports are never resolved.

The fix is to remove or relax the `isModuleEnvironment` check so that `resolveUniqueExport` also works from the global scope.

## Relevant Files

- `test/ui/run_python_suite.py` — `cleanup_run()` function needs to wait for daemon to fully stop (line 46)
- `src/tlisp/evaluator.ts` — `evalSymbol()` method needs to remove `isModuleEnvironment` guard at line 370
- `src/server/server.ts` — `handleEval()` calls `interpreter.execute(code)` which uses global env (line 751)
- `src/tlisp/interpreter.ts` — `execute()` defaults to `this.globalEnv` (line 144)

## Step by Step Tasks

### Fix flaky cleanup in test runner

**User Story**: As a test developer, I want cleanup to fully complete before the next test starts so that tests don't flake on daemon startup.

- In `cleanup_run()`, after sending `(editor-quit)`, poll the socket with `client.ping()` until it fails or a 3-second timeout expires
- This ensures the daemon has fully shut down before cleanup returns

**Acceptance Criteria**:
- [ ] `cleanup_run()` waits for daemon to stop responding
- [ ] Running `bun run test:ui` 3 times in a row produces 0 flaky startup failures

### Fix module export resolution in global scope

**User Story**: As a T-Lisp user, I want `(vim-count-current)` to work from the daemon client so that all editor functions are accessible regardless of how they're defined.

- In `evaluator.ts`, remove the `isModuleEnvironment(env)` check at line 370 so `resolveUniqueExport` runs for all environments including global
- This allows any eval context to access module exports by their public name

**Acceptance Criteria**:
- [ ] `(vim-count-current)` succeeds when called via `tmaxclient --eval`
- [ ] `(indent-current-line)` succeeds when called via `tmaxclient --eval`
- [ ] `(split-window-below)` succeeds when called via `tmaxclient --eval`
- [ ] Ambiguous exports (same name from two modules) still produce an error
- [ ] All 24 UI tests pass with zero regressions
- [ ] `bun run typecheck` passes with zero errors

### Run validation suite

**User Story**: As a developer, I want confidence that fixes resolve both bugs without regressions.

- Run the full test suite multiple times to verify flaky startup is fixed
- Verify module exports are now accessible

**Acceptance Criteria**:
- [ ] `bun run test:ui` passes 24/24 at least 3 consecutive runs
- [ ] `bun run typecheck` passes with zero errors

## Validation Commands
```bash
bun run test:ui         # 24/24 must pass
bun run test:ui         # Run again — verify no flaky startup
bun run test:ui         # Third run — confirm stability
bun run typecheck       # Zero type errors
```

## Notes
- The `isModuleEnvironment` check was likely added as an optimization to avoid scanning all modules on every symbol lookup. The performance impact of removing it should be negligible since `resolveUniqueExport` only runs when a symbol is not found in the current environment (the fallback path).
- The flaky startup is a pre-existing issue (not caused by the test expansion) but became more visible with 19 daemon-mode tests running sequentially.
