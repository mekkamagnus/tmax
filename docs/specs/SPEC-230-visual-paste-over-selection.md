# SPEC-230 — Visual-mode paste over selection (p / P)

Issue: #230 `Visual-mode p does nothing — no paste-over-selection (vi"p dead-ends)`
Status: implementing
Date: 2026-08-29

## Background

`vi"` then `p` dead-ends: visual mode binds `d`/`y`/`c`/`x` (`src/tlisp/core/bindings/visual.tlisp`) but has no `p`/`P` binding, so paste-over-selection silently does nothing. The quote text objects themselves work (live-verified; BUG-83 lineage). Vim semantics: visual `p` replaces the selection with the unnamed register, **swaps** (the replaced selection becomes the new unnamed register), exits to normal mode, and leaves point on the last character of the pasted text (charwise) or the first non-blank of the first pasted line (linewise).

## Goal

`p` / `P` in visual mode paste the register over the active selection with Vim semantics, for charwise, linewise, and blockwise selections.

## Design decisions

- **T-Lisp composition, no new TS primitives.** Everything needed exists: `visual-get-selection`, `visual-delete` (removes the selection AND sets the unnamed register to the removed text — the swap falls out naturally — AND exits to normal mode), `get-register`/`set-register`, `paste-before`/`paste-after` (read the register without mutating it), `buffer-insert-at-position` (block re-insert), `undo-begin`/`undo-commit`, `vim-record-change`. `vim-visual-paste` lives in `edit-commands.tlisp` beside `vim-paste-after`/`vim-paste-before` and supports the same pending-register prefix (`"x` → paste from register x; `"+`/`"*` → OS clipboard).
- **Cursor discipline.** The selection start is normalized in T-Lisp before `visual-delete` (which does not move the cursor); after the delete, the cursor is placed explicitly per mode: charwise inserts at the selection start column then advances to the last pasted character (single-line registers; multi-line charwise registers follow the primitives' existing `\n` → linewise behavior); linewise inserts at the deleted line position (`paste-before`), or below the last line when the deletion ran through EOF (`paste-after`), then first-non-blank; blockwise re-inserts one segment per line at the rectangle's left column (appending padded lines past EOF) with the cursor left at the rectangle's top-left (where `visual-delete` already put it).
- **`P` ≡ `p`** in visual mode, as in Vim.

## Completion criteria

1. `p` over a charwise visual selection replaces it with the unnamed register contents, exits to normal mode, and the cursor sits on the last character of the pasted text.
2. Vim swap: after the paste, the unnamed register contains the text that was selected (so `vi"p` then another paste round-trips).
3. `P` behaves identically to `p` in visual mode.
4. Linewise (`V`) selection + `p` replaces the selected lines with the register's lines, cursor at the first non-blank of the first pasted line; works when the selection runs through end-of-buffer.
5. Blockwise selection + `p` re-inserts the register's segments as a block at the rectangle's left column, one per line, appending padded lines when the block extends past EOF.
6. Empty register → friendly status message, no buffer change.
7. The whole operation is one undo step (`undo-commit "visual-p"`), and drives `vi"p` end-to-end: select a quoted string with the text object, paste over it.
8. **Linewise whole-line semantics fixed in the primitives** (implementation finding): `visual-delete` line-mode previously span-deleted the text, leaving an empty line, and `visual-yank` line-mode registered without the trailing newline — so `V d` deleted nothing (zero-width entry selection), and any linewise paste fell back to charwise. Both now operate on whole lines (`V d` removes the lines entirely, register `line\n…\n`), with regression tests. This was part of the user-perceived "visual mode not working."
9. Unit tests cover: charwise replace + cursor + swap, `P` equivalence, linewise (mid-buffer and through-EOF), blockwise, empty register, undo, `V d`/`V y` regressions, and the linewise paste round-trip. Plus a live daemon check of the exact `yiw` → `vi"` → `p` flow from the bug report (passed 2026-08-29: `say "second" out loud`, cursor [0,10], register swapped to `hello world`).

## Out of scope

`p` with a count in visual mode; the register-prefix `"a`/`"+` in VISUAL mode (the `"` prefix is bound in normal mode only today — the paste implementation already consumes a pending register if one ever gets set, but no visual binding exists; separate concern); and the linewise-register heuristic of the existing paste primitives (`\n` ⇒ linewise) — pre-existing behavior, unchanged (includes the trailing newline after a whole-buffer `V p`).

## Verify-gate audit (2026-08-29, retry 1 amendments)

Round 1 found two real block-paste defects, both fixed and tested:
- **Reversed-column rectangles** pasted at the forward-normalized column instead of the rectangle's true left edge — the block branch now uses `min(sl, el)`/`min(sc, ec)`.
- **Past-EOF appends aborted mid-paste** (out-of-bounds `buffer-insert-at-position`): only the first segment landed, the register swap was lost, and `undo-commit` never ran — appends now insert at the END of the last line (`"\n" + padding + segment`), and short lines pad with spaces to the block column, so no insert can go out of bounds.
- The block-paste cursor is pinned to the rectangle's top-left after the per-segment inserts (which move the cursor); asserted by tests.
- The empty-register test now asserts the `Nothing to paste` status message.
- Not actionable: "no Codex review comment" (none was run for #230).
