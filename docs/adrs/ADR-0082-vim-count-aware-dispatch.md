# Vim Count-Aware Key Bindings and Dispatch

## Status

Accepted

## Context

Normal-mode key bindings referenced motions and operators without count support. The `vim-count-consume` function existed but wasn't wired into the binding expressions — keys like `w`, `j`, `dd` always operated with an implicit count of 1, making prefix counts (e.g., `3w`, `5dd`) non-functional.

The dispatcher in `normal-handler.ts` mixed TypeScript dispatch logic with T-Lisp keymap lookups, creating duplicated routing paths and making it hard to extend.

## Decision

Wire `vim-count-consume` into all count-aware normal-mode bindings in `normal.tlisp`:

- **Navigation**: `h/j/k/l` consume count for repeated movement (`3j` moves down 3 lines)
- **Word motions**: `w/b/e` consume count for repeated word navigation
- **Line navigation**: `0/$/_/-/+` use `vim-count-reset` to clear accumulated count; `-` and `+` consume count for line skipping
- **Delete/yank/paste**: `x/D/C/Y/J` reset count; `p/P` consume count for repeated paste
- **Page commands**: `C-f/C-b/C-d/C-u` reset count to avoid confusing repeated scrolling
- **G command**: `G` uses `vim-G` which is count-aware (with count → jump to line N, without → last line)
- **Operators**: `d/y/c` enter operator-pending state via `vim-begin-operator`

Simplify `normal-handler.ts` to delegate to T-Lisp keymap-first dispatch, removing duplicated TypeScript routing. The handler now checks the keymap and only falls back to legacy behavior for unmapped keys.

Consolidate operator logic in `operators.tlisp` — all operator+motion combinations now go through a single `vim-execute-operator` function that resolves the motion, computes the text range, and applies the operator.

## Consequences

- **Easier**: Count prefixes work everywhere — `3dw`, `5j`, `2yy` all behave correctly. Adding new count-aware commands is a single `(vim-count-consume N)` call in the binding expression.
- **Harder**: The dispatcher is now split between TypeScript (raw key handling) and T-Lisp (keymap dispatch). Debugging requires checking both layers.
- **Breaking**: Bindings that relied on the old hardcoded movement values (always moving by 1) now consume accumulated counts. This is the desired behavior but changes how prefix digits interact with all motions.
