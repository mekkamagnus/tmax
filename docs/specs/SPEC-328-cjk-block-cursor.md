# SPEC-328 — The BLOCK cursor walks visual widths under wrap

## Goal

The render loop's painted BLOCK-cursor placement must agree with the
(#321-fixed) hardware cursor under wrap + wide characters: the paint
walk compares VISUAL widths, not the logical display column.

## Completion criteria

- [x] The block-cursor walk (buffer-lines.ts) converts the display
      cursor column to a VISUAL offset (stringWidth of the prefix)
      before comparing against wrapped-row widths; the within-row
      column is the visual remainder.
- [x] A cursor after wide characters past a wrap boundary paints on
      the same row/cell as `getWrappedCursorRow`/`Column` (tested:
      10 界 over width 12, cursor at logical 8 → row 1, visual cell 4;
      the block covers a full 2-cell char).
- [x] Boundary-exact (the cursor AT a wrap boundary) prefers the NEXT
      row in both the paint and the hardware math (tested: 7 界, cursor
      at logical 6 → row 1 cell 0).
- [x] ASCII-only wrap unchanged (tested: no wide-char regression).

## Out of scope

- The adjacent wiki-transform COUNTING paths
  (`transformWikiLine(text, undefined)`) — the issue marks them
  "style-only, low priority"; the textual backtick protection is
  span-independent by design (wiki-display.ts: the textual scan is
  REQUIRED, not a fallback). Filed as a follow-up comment, not
  silently dropped.
