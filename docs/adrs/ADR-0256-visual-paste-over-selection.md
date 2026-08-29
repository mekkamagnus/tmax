# Visual-mode paste over selection (p / P)

## Status

Accepted (2026-08-29) — implements #230 / SPEC-230.

## Context

`vi"` then `p` dead-ended: visual mode had no `p`/`P` binding, so paste-over-selection silently did nothing (live-verified against the daemon; the quote text objects themselves were fine post-BUG-83). Investigation also surfaced pre-existing linewise holes: `V d` deleted nothing (zero-width line selection at entry + span-based delete), and `V y` registered without the trailing newline, so any linewise paste fell back to charwise — all part of the user-perceived "visual mode not working."

## Decision

1. **`vim-visual-paste` composes existing primitives — no new TS API.** `visual-delete` already removes the selection, sets the unnamed register to the removed text (Vim's swap semantics fall out), and exits to normal mode; the T-Lisp command wraps it with `paste-before`/`paste-after`, undo grouping (`undo-commit "visual-p"`), macro recording, and the pending-register hook (mirroring `vim-paste-after`). `P ≡ p`. Charwise pastes at the selection start with the cursor advanced to the last pasted character; linewise pastes at the deleted line position (below the last line when the deletion ran through EOF) with the cursor at first-non-blank.
2. **Blockwise uses the true rectangle edges** — `min(lines)`/`min(cols)`, not the forward-normalized start (verify-gate caught reversed-column rectangles pasting at the wrong column). Segments re-insert one per line at the left column; short lines pad with spaces; segments past EOF append at the END of the last line (`"\n" + padding + segment`) so no insert can ever go out of bounds — the first attempt's out-of-range insert aborted mid-paste, lost the register swap, and skipped `undo-commit` (a data-integrity defect the gate's live probe caught). The cursor is pinned to the rectangle's top-left after the per-segment inserts.
3. **Linewise whole-line semantics fixed in the primitives** (`visual-ops.ts`): line-mode `visual-delete` removes whole lines (through the following newline, or the preceding one for tail deletions) and registers `line\n…\n`; line-mode `visual-yank` registers with the trailing newline so linewise pastes paste as lines. `V d`, `V y`, `V c`, and `V p` all inherit this; regression tests lock it.

## Consequences

- `vi"p`, `Vp`, block paste, and the register swap round-trip work end-to-end (live daemon check passed).
- Paste behavior is keyed on register content (`\n` ⇒ linewise) — the pre-existing primitive heuristic, unchanged; pasting a linewise register over a block selection is a cosmetic corner (documented out of scope).
- Follow-up hardening noted by the verify-gate: keying paste on register *type* (Vim semantics) and a `condition-case` around `visual-delete` in the paste path.
- Out of scope, separate concerns: `p` with a count in visual mode; the `"a` register prefix in visual mode (normal-mode-only binding today).
