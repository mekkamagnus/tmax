# SPEC-232 — Visual-mode inclusive cursor (vim parity)

Issue: #232 — `vi"` lands ON the closing quote
Status: implementing
Date: 2026-08-31

## Goal

Visual charwise selections use Vim's INCLUSIVE convention: the cursor rests ON the last selected character. Today tmax is end-exclusive (cursor one past), which on `vi"` lands on the closing quote. Text results of `d`/`y`/`c`/`p` stay byte-identical to today where they were already correct — only cursor placement and the selection boundary interpretation change.

## Design

- `visual-dispatch-text-object` anchors the visual end at `region-end - 1` (regions are end-exclusive; the last inner char is `ec-1`).
- `visual-delete` / `visual-yank` charwise paths treat the selection end as INCLUSIVE: operate on `start .. end+1`. (Line and block modes keep their #145/#230 conventions unchanged.)
- `vim-visual-paste` normalizes with the same inclusive rule (replace `start..end+1`) and its cursor mapping accounts for the new anchor.
- `v`+motion anchoring needs no code change: `visual-update-end` already tracks the cursor; consumers interpret it inclusively now (this also fixes the charwise COUNT: `v l l d` must delete 3 chars, today 2).

## Completion criteria

1. `vi"` on `say "hello" there` leaves the cursor at `[0,9]` (the `o`), never on a quote.
2. `v l l` cursor `[0,2]`; `v l l d` on `abcdef` → `def` (3 chars deleted, vim count).
3. `vi"d`, `vi"y`, `vi"p` produce byte-identical buffer/register results to today (only cursor positions differ).
4. `vi"p` cursor lands on the last pasted char (not the quote).
5. Line/block visual ops byte-identical to today (conventions untouched).
6. Backwards selections (anchor right of cursor) still delete/yank/paste the same text.
7. Visual suites updated deliberately — position assertions change, no assertion weakened; `visual-mode-selection`, `vim-visual-text-objects`, `visual-paste`, `flash-region` all green.

## Out of scope

Linewise/blockwise cursor conventions, `o` swap-anchor interactions beyond consistency, and operator-pending (`di"`) paths (already correct).
