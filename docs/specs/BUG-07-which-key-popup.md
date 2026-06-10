# Bug: Which-key popup not showing for vim prefix keys (z, g, C-w)

## Bug Description
When typing a vim prefix key like `z`, `g`, or `C-w` in normal mode, the which-key popup should appear after a pause showing all available bindings for that prefix. Instead, nothing appears. The which-key popup only works for "legacy" keymap bindings (e.g., `C-c`, `SPC`) stored in the TypeScript `keyMappings` Map.

**Expected behavior**: Type `z`, pause, see popup showing `z → scroll-cursor-center`, `t → scroll-cursor-top`, `b → scroll-cursor-bottom`.

**Actual behavior**: Type `z`, nothing happens until next key is pressed.

## Problem Statement
The `handleNormalMode` function in `normal-handler.ts` dispatches vim prefix keys (`z`, `g`, `C-w`) to T-Lisp via `executeVimDispatcher`. T-Lisp handles them by setting `vim-pending-prefix` and returning `true`. Since `dispatchHandled` is `true`, the handler returns immediately — the which-key scheduling code (lines 48-63) is never reached.

The which-key popup only triggers for keys found in the TypeScript `keyMappings` Map via `hasLegacyPrefix()`. Vim prefix keys live entirely in T-Lisp (`motions.tlisp`) and have no representation in that Map.

## Solution Statement
After `executeVimDispatcher` handles a key and returns `true`, check if T-Lisp has entered a vim prefix-pending state. If so, query T-Lisp for the current prefix and its available bindings, then schedule the which-key popup the same way the legacy path does.

This requires:
1. A new T-Lisp function `vim-prefix-bindings` that returns available bindings for a given prefix
2. Exporting the existing `vim-pending-prefix` variable via a getter function
3. Modified normal-handler logic to schedule which-key for vim prefix states

## Steps to Reproduce
1. Start tmax with any file: `bun run start file.txt`
2. Ensure you're in normal mode
3. Type `z` and wait > 1 second
4. Observe: no which-key popup appears
5. Compare: type `C-c` and wait — the which-key popup DOES appear

## Root Cause Analysis
In `src/editor/handlers/normal-handler.ts`:

```
Line 38-44: legacyPrefixActive is false, so executeVimDispatcher is called
Line 42-43: dispatchHandled is true (vim-begin-prefix returns t), so we return immediately
Line 48-63: which-key scheduling code is never reached for vim prefix keys
```

The vim prefix state machine in `motions.tlisp` (`vim-dispatch-prefix-key`) handles all prefix key dispatch internally, with no feedback to TypeScript about what bindings are available.

## Relevant Files

- `src/editor/handlers/normal-handler.ts` — Normal mode key router; needs to schedule which-key after vim prefix keys
- `src/tlisp/core/commands/motions.tlisp` — Vim prefix state machine; needs `vim-current-prefix` and `vim-prefix-bindings` functions
- `src/editor/utils/which-key.ts` — Which-key utilities; `scheduleWhichKey` and `formatWhichKeyBindings` will be reused
- `src/editor/editor.ts` — Editor state includes `whichKeyPrefix`, `whichKeyBindings`, `whichKeyActive`; also has `executeCommandAsync` for calling T-Lisp
- `test/unit/which-key-popup.test.ts` — Existing which-key tests; needs new tests for vim prefix keys

## Step by Step Tasks

### Add T-Lisp prefix query functions

**User Story**: As a developer, I want T-Lisp to expose the current vim prefix and its available bindings so that TypeScript can schedule the which-key popup.

- In `src/tlisp/core/commands/motions.tlisp`:
  - Add and export `vim-current-prefix` function that returns `vim-pending-prefix`
  - Add and export `vim-prefix-bindings` function that takes a prefix string and returns an alist of `(key . description)` pairs:
    - `"z"` → `(("t" . "scroll to top") ("z" . "scroll to center") ("b" . "scroll to bottom"))`
    - `"g"` → `(("g" . "jump to line") ("t" . "next tab") ("T" . "prev tab"))`
    - `"C-w"` → `(("s" . "split below") ("v" . "split right") ("w" . "other window") ("q" . "delete window") ("+" . "grow height") ("-" . "shrink height") (">" . "grow width") ("<" . "shrink width"))`
    - Other → `nil`
  - Update the module export list

**Acceptance Criteria**:
- [ ] `vim-current-prefix` returns the active vim prefix string or `nil`
- [ ] `vim-prefix-bindings "z"` returns alist with `t`, `z`, `b` entries
- [ ] `vim-prefix-bindings "g"` returns alist with `g`, `t`, `T` entries
- [ ] `vim-prefix-bindings "C-w"` returns alist with `s`, `v`, `w`, `q`, `+`, `-`, `>`, `<` entries
- [ ] Module exports include both new functions

### Schedule which-key after vim prefix dispatch

**User Story**: As a user, I want the which-key popup to appear when I pause after typing a vim prefix key so I can discover available commands.

- In `src/editor/handlers/normal-handler.ts`, after `executeVimDispatcher` returns `true` (line 42):
  - Call `(vim-prefix-pending-p)` via the interpreter to check if a vim prefix is now active
  - If yes, call `(vim-current-prefix)` to get the prefix string
  - Call `(vim-prefix-bindings "<prefix>")` to get the available bindings
  - Convert the T-Lisp alist result to `WhichKeyBinding[]` format
  - Store prefix and bindings in editor state (`state.whichKeyPrefix`, `state.whichKeyBindings`)
  - Call `scheduleWhichKey` with the prefix and bindings, using the same callback pattern as the legacy path
  - Return (don't fall through to the rest of the handler)

**Acceptance Criteria**:
- [ ] Typing `z` followed by a pause (> 1s default timeout) shows which-key popup with z/t/b bindings
- [ ] Typing `g` followed by a pause shows which-key popup with g/t/T bindings
- [ ] Typing `C-w` followed by a pause shows which-key popup with window management bindings
- [ ] Typing the next key quickly (< timeout) skips the popup and executes the command
- [ ] `C-g` cancels the vim prefix and clears which-key state
- [ ] Legacy which-key paths (C-c, SPC) still work unchanged

### Add tests for vim prefix which-key

**User Story**: As a developer, I want automated tests proving that which-key works for vim prefix keys.

- In `test/unit/which-key-popup.test.ts`, add a new describe block "Which-Key for Vim Prefix Keys":
  - Test: pressing `z` activates which-key after timeout, shows z prefix bindings
  - Test: pressing `z` then `t` quickly executes scroll-cursor-top without popup
  - Test: pressing `g` activates which-key after timeout
  - Test: pressing `C-w` activates which-key after timeout
  - Test: C-g cancels vim prefix which-key

**Acceptance Criteria**:
- [ ] All new tests pass
- [ ] All existing which-key tests still pass
- [ ] Tests verify both popup activation and correct prefix binding content

### Validate with typecheck and test suite

**User Story**: As a developer, I want zero regressions from this fix.

- Run typecheck and full test suite

**Acceptance Criteria**:
- [ ] `bun run typecheck` passes with zero errors
- [ ] `bun test test/unit/which-key-popup.test.ts` passes
- [ ] `bun test` passes with no regressions

## Validation Commands

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck` — Zero type errors
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/which-key-popup.test.ts` — All which-key tests pass
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test` — Full suite passes, no regressions

## Notes

- The vim prefix bindings are hard-coded in `motions.tlisp` conditionals. If new bindings are added there, `vim-prefix-bindings` must be updated to match.
- The which-key timeout defaults to 1000ms. Tests use 50ms via `setWhichKeyTimeout`.
- Vim operators (d, y, c) also have pending states but are NOT prefix keys in the same sense — they're operator-pending, not prefix-pending. This fix only covers the `z`, `g`, `C-w` prefixes.
