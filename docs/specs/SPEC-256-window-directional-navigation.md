# Enhancement: Directional Window Navigation + only/swap Bindings (#261)

## Goal

The full vim C-w chord set works: `C-w h/j/k/l` directional focus, `C-w W` reverse cycle, `C-w o` only-window, `C-w r` rotate/swap — on top of the existing `s v w q + - > < =` set, consolidated in one file.

GitHub issue: #261 (window-management, enhancement)

## Problem Statement

Only cyclic `C-w w` was bound. `C-w h/j/k/l/o/r/W` all reported "Unbound key". The issue assumed directional navigation was blocked on the layout tree (#260) — but #259's `computeLayout` already gives every window a real cell (x/y/width/height): directional focus is computable on the flat single-axis layout. Only mixed-axis layouts need #260.

Two hygiene items folded in per the issue: the C-w chords were split across `motions.tlisp` and `windows.tlisp`, and `delete-other-windows` existed twice (TS primitive + T-Lisp defun).

## Solution

1. **`window-move-focus <direction>`** TS primitive (window-ops): computes the focused pane's cell via `computeLayout`, finds the nearest candidate strictly on the target side sharing perpendicular extent (largest overlap breaks distance ties), and routes the focus change through the switch port — full #262 context rebind. No candidate → nil, focus unchanged. Geometry lives in TS (it IS the layout question); the binding/commands live in T-Lisp (`windmove-left/right/up/down` defuns) per the layer rule.
2. **`window-rotate`** TS primitive: swaps the focused window record with the next (cyclic) — pane contents trade places, focus stays on the slot — then re-routes the switch port so the model rebinds to the slot's new occupant (same-index-different-buffer rebind; the #262 class).
3. **`other-window-reverse`** T-Lisp defun wrapping the existing `window-prev` primitive → `C-w W`.
4. **`C-w o`** → `delete-other-windows`, deduplicated: the TS primitive is the live implementation (TS builtins win symbol resolution over same-named defuns — proven by the #262 cursor-absorb test failing when the primitive was removed); the T-Lisp loop defun was dead code AND behaviorally worse (restored sibling records mid-loop, losing the model cursor). The defun is deleted; the primitive gains the `C-w o` binding.
5. **Layering move**: `computeLayout`/`renderSeparators` moved to `src/core/window-layout.ts` (pure geometry; the editor layer's directional primitive needs it — same move as #258's viewport clamp), with a compatibility re-export from `frontend/render/window-layout.ts`.
6. **Consolidation**: every C-w chord now lives in `windows.tlisp` (9 → 16 chords); `motions.tlisp` keeps none.
7. **Instance-healing in `switchWindow`** (found by the directional tests): the restore now prefers the registry's live buffer instance for the target record's name — a record can hold a stale `TextBuffer` instance because immutable inserts swap the instance in the registry + the focused record while unfocused copies (e.g. a split copy) keep the old reference. Restoring the stale instance left `(buffer-current)` nil.

Out of scope: `C-w H/J/K/L` (move-window — needs #260's layout tree for meaningful semantics in mixed layouts), mixed-axis directional accuracy beyond nearest-edge heuristics (#260), unfocused-pane stale-instance display (known gap, ADR-0279 family).

## Completion Criteria

1. `C-w h/j/k/l` focus works by geometry: across a vertical split, `(window-move-focus "right")` moves focus to the right pane with the #262 buffer rebind (`buffer-current` names the right pane's buffer), edge moves are no-ops, and `left` returns; through three stacked panes, `down`/`down`/`up` navigate by index — verified by `test/unit/window-direction.test.ts` ("windmove right/left across a vertical split (with buffer rebind)", "windmove down/up through three stacked panes").
2. `C-w W` reverse-cycles (`window-prev`) — verified by `test/unit/window-direction.test.ts` ("window-prev reverse-cycles (C-w W)").
3. `C-w r` swaps pane contents with focus kept on the slot and the model rebound to the slot's new occupant — verified by `test/unit/window-direction.test.ts` ("window-rotate swaps pane contents and keeps focus on the slot (C-w r)").
4. `C-w o` is bound and `delete-other-windows` has ONE implementation (the TS primitive with the #262 absorb; the T-Lisp defun is gone) — verified by the chord-presence test ("the C-w chord set is bound in normal mode") and the existing `window-focus-rebind` delete-other-windows cursor test staying green.
5. The whole C-w chord set (16) is bound in normal mode and shown by the C-w which-key popup — verified by `test/unit/window-direction.test.ts` (chord presence) and `test/unit/which-key-popup.test.ts` (both C-w count assertions updated 9 → 16).
6. No regressions: all window suites (`window-focus-rebind`, `window-viewport`, `window-record-sync`, `window-stored-dims`, `window-splitting`, `cw-window-chords`), the which-key suites, and the full unit gate pass; `bun run typecheck:src` + `typecheck:test` are clean.
