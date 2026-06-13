# Bug: Which-key C-g cancellation breaks subsequent vim prefixes; g prefix bindings incomplete

## Bug Description
Two related bugs in the which-key system:

1. **C-g doesn't reset T-Lisp vim prefix state**: After a vim prefix (z, g, C-w) activates the which-key popup and the user presses C-g to cancel, the T-Lisp `vim-pending-prefix` variable is NOT reset. This causes the next key to be misrouted as a continuation of the cancelled prefix, producing "Unsupported prefix" errors.

2. **g prefix which-key bindings are stale**: `vim-prefix-bindings("g")` in motions.tlisp only returns 3 bindings (g, t, T) but `vim-dispatch-prefix-key` actually handles 7 bindings (g, t, T, h, O, x, b). The which-key popup shows incomplete information for the g prefix.

## Problem Statement
When the which-key popup is showing (after timeout fires) and the user presses C-g, only the TypeScript-side which-key state is cleared. The T-Lisp `vim-pending-prefix` remains set, causing subsequent keys to be misrouted.

## Solution Statement
1. Add `vim-reset-pending` call to the C-g handler in `normal-handler.ts` so both TypeScript and T-Lisp state are cleaned up.
2. Update `vim-prefix-bindings` in `motions.tlisp` to include all g prefix bindings (h, O, x, b).
3. Add regression tests covering C-g cancellation and prefix binding completeness.

## Steps to Reproduce

**Bug 1 — C-g doesn't reset vim prefix:**
1. Open tmax with a file
2. Press `z` and wait for the which-key popup (~1 second)
3. Press `C-g` to cancel
4. Press `g` — expected: g prefix starts; actual: "Unsupported prefix: zg"

**Bug 2 — g prefix bindings incomplete:**
1. Open tmax with a file
2. Press `g` and wait for the which-key popup
3. Observe only 3 bindings shown (g, t, T) instead of 7

## Root Cause Analysis

**Bug 1**: In `normal-handler.ts:33-36`, the C-g handler checks `isWhichKeyActive() || currentPrefix` and returns early after calling `clearLegacyPrefix()`. This clears TypeScript state but never calls `executeVimDispatcher`, so T-Lisp's `vim-reset-pending` is never invoked. The `vim-pending-prefix` variable remains set to the cancelled prefix.

**Bug 2**: The `vim-prefix-bindings` function in `motions.tlisp:240-243` was not updated when markdown navigation bindings (h, O, x, b) were added to `vim-dispatch-prefix-key` in the same file.

## Relevant Files

- `src/editor/handlers/normal-handler.ts` — C-g handler at lines 33-36 needs to also reset T-Lisp state
- `src/tlisp/core/commands/motions.tlisp` — `vim-prefix-bindings` at line 240 needs g prefix update
- `test/unit/which-key-popup.test.ts` — existing tests, needs new regression tests added

## Step by Step Tasks

### Fix C-g to reset T-Lisp vim prefix state

**User Story**: As a user pressing C-g to cancel a which-key popup, I want the vim prefix state fully cleared so that my next key press starts fresh.

- In `src/editor/handlers/normal-handler.ts`, add `await (editor as any).executeCommandAsync("(vim-reset-pending)")` to the C-g handler block (lines 33-36), after `clearLegacyPrefix(editor)`

**Acceptance Criteria**:
- [ ] After pressing z, waiting for which-key, pressing C-g, then pressing g: the g prefix starts correctly (status shows g which-key or a g command executes)
- [ ] After pressing z, waiting for which-key, pressing C-g: T-Lisp `vim-pending-prefix` is nil
- [ ] Legacy C-c/SPC prefix cancellation still works correctly

### Update g prefix bindings in vim-prefix-bindings

**User Story**: As a user pressing g and waiting for which-key, I want to see all available g prefix bindings so I can discover markdown navigation commands.

- In `src/tlisp/core/commands/motions.tlisp`, update `vim-prefix-bindings` for the g case to include: `h` (markdown-up-heading), `O` (markdown-heading-outline), `x` (markdown-do), `b` (markdown-jump-back)

**Acceptance Criteria**:
- [ ] `(vim-prefix-bindings "g")` returns 7 bindings: g, t, T, h, O, x, b
- [ ] Which-key popup for g shows all 7 bindings

### Add regression tests

**User Story**: As a developer, I want automated tests that catch which-key regressions so these bugs don't recur.

- Add to `test/unit/which-key-popup.test.ts`:
  - Test: C-g after vim prefix which-key resets vim state (z → wait → C-g → g works)
  - Test: C-g before which-key timeout resets vim state (z → C-g → g works)
  - Test: g prefix which-key shows all 7 bindings
  - Test: C-w prefix which-key shows all 8 bindings
  - Test: z prefix which-key shows all 7 bindings

**Acceptance Criteria**:
- [ ] All new tests pass
- [ ] Existing which-key tests still pass (no regressions)

### Run validation commands

- `bun test test/unit/which-key-popup.test.ts` — all which-key tests pass
- `bun run typecheck:src` — no type errors
- `bun run build` — build succeeds

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun test test/unit/which-key-popup.test.ts` — all which-key tests pass (existing + new)
- `bun run typecheck:src` — no TypeScript errors in source
- `bun run build` — build compiles without errors
- Integration verification: run inline script that presses z → wait → C-g → g and confirms g prefix starts correctly

## Notes
- The state disconnect between `whichKeyState.timeout` (module-level) and `this.state.whichKeyTimeout` (editor state) is a pre-existing issue not introduced by CHORE-22. The T-Lisp API `(which-key-timeout N)` only updates editor state but `scheduleWhichKey()` reads module-level state. This is out of scope for this bug but should be noted for future cleanup.
