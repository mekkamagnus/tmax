# Bug: `0` key doesn't reset viewport after horizontal scroll

## Bug Description
After using horizontal scroll commands (`zl`, `zh`, `zs`, `ze`), pressing `0` moves the cursor to column 0 but the viewport stays scrolled. The cursor visually jumps to the left edge of the viewport (which is offset), not to the actual beginning of the line.

Additionally, `SPC x f` (and other 3-key `SPC x` sequences) were broken because the keymap prefix system only supported 2-part key sequences.

## Problem Statement
1. The `0` key handler calls `(line-first-column)` which sets cursor column to 0 but never resets `viewportLeft` back to 0.
2. `keymap-set-key` in `keymaps.tlisp` only created one level of prefix nesting, so 3-part keys like `"SPC x f"` collapsed — only the last binding survived under `"x"` in the SPC prefix.

## Solution Statement
1. Add `(viewport-left-set 0)` to the `0` key handler in `vim-dispatch.tlisp`.
2. Rewrite `keymap-set-key` to use recursive nesting for multi-part keys, and update `keymap-prefix-p`, `keymap-prefix-bindings`, and `keymap-all-bindings` to walk the nested structure.

## Steps to Reproduce
1. `0` key bug: Open file, `zl` to scroll right, press `0` — cursor goes to viewport edge but content stays offset
2. `SPC x f` bug: Press `SPC`, `x`, `f` — shows "Unbound key: SPC x" instead of opening find-file

## Root Cause Analysis
1. `vim-dispatch.tlisp` line 38 called only `(line-first-column)` without resetting viewport.
2. `keymap-set-key` split `"SPC x f"` into `("SPC" "x" "f")`, took `prefix = "SPC"`, then stored `(car (cdr parts)) = "x"` with the command — overwriting previous `SPC x` bindings. Only `SPC x C-c` (last registered) survived.

## Relevant Files

- `src/tlisp/core/commands/vim-dispatch.tlisp` — Added `(viewport-left-set 0)` to `0` key handler
- `src/tlisp/core/keymaps.tlisp` — Rewrote prefix nesting to use recursion; added `keymap-set-key-nested`, `keymap-walk-prefix`, `keymap-flatten-prefix` helpers
- `src/server/serialize.ts` — Added `viewportLeft` to editor state serialization (related fix from earlier)

## Validation Commands
- `bun test test/unit/viewport-scroll-wrap.test.ts` — viewport/wrap unit tests
- `bun test test/unit/which-key-popup.test.ts` — which-key tests
- `bun test` — full test suite (zero regressions)

## Notes
Two related fixes bundled: viewport reset on `0` key and keymap prefix nesting for multi-key sequences.
