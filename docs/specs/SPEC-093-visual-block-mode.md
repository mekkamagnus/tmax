# Feature: Visual block mode — rectangular selection + block operators (`#145`)

## Feature Description

`C-v` enters visual block mode (`--VISUAL BLOCK--`) but the operators treat the
selection as a contiguous start→end range, not a rectangle. This adds
**rectangular** semantics for the core block operators: `d` (delete), `y` (yank),
`x` (delete), `c` (change), and `r` (replace — via the existing char replace on
each line). The rectangle spans lines `[topLine, bottomLine]` × columns
`[leftCol, rightCol]` (inclusive, vim semantics).

**Deferred:** block `I` / `A` (insert at block start/end across all lines) require
multi-cursor infrastructure that tmax does not have; tracked as a follow-up. This
ships the rectangle-destructive/view operations, which are the most-used block
features and need no multi-cursor.

## User Story

As a tmax user editing columnar data (CSV columns, aligned assignments),
I want `C-v` to select a rectangle and `d`/`y`/`x`/`c` to operate on that
rectangle per-line,
So that I can edit a column of text the way vim does.

## Problem Statement

`visual-enter-block-mode` sets `mode:'block'` but `visual-delete`/`visual-yank`
(visual-ops.ts) normalize to a single `{start,end}` range and call
`buffer.getText`/`delete` once — so a block selection across lines N..M deletes
the whole span as one contiguous region, not per-line columns. The buffer API is
range-based (no native rectangle), but `getLine(L)` exposes per-line text, so a
rectangle op iterates lines and deletes/yanks each line's `[leftCol, rightCol]`
slice.

## Solution Statement

Add a `visualSelection.mode === 'block'` branch to `visual-delete` and
`visual-yank` in `src/editor/api/visual-ops.ts`:

- Compute `topLine`/`bottomLine` = min/max of the two line coords; `leftCol`/
  `rightCol` = min/max of the two column coords (inclusive).
- For each line `L` in `[topLine, bottomLine]`: read `buffer.getLine(L)`; if
  `leftCol` is past EOL the line contributes nothing (ragged rectangle); else the
  segment is `line.slice(leftCol, min(rightCol, len-1) + 1)`. Push the segment to
  a list.
- `visual-yank`: join segments with `\n`, store in the yank + `"` registers; exit
  to normal (no buffer change).
- `visual-delete`: same segment collection, then per-line
  `buffer.delete({start:{L,leftCol}, end:{L,segEnd+1}})` (each deletion is within
  one line, so line numbers don't shift); store joined text in the delete +
  registers; cursor to `(topLine, leftCol)`; exit to normal.
- `visual-change` (T-Lisp) composes on `visual-delete` → block `c` deletes the
  rectangle then enters insert at the top-left (single-line insert, not
  multi-cursor). `x` in visual mode is bound to `visual-delete`, so block `x`
  works once delete is block-aware.

## Relevant Files

- `src/editor/api/visual-ops.ts` — block branches in `visual-delete` + `visual-yank`.
- `test/unit/visual-block.test.ts` (NEW).

## Implementation Plan

### Phase 1: rectangle ops
- `visual-delete`: block branch (per-line segment + per-line delete).
- `visual-yank`: block branch (per-line segment, join, register).

### Phase 2: tests
- Block delete across 3 lines removes the column slice from each (ragged lines
  contribute nothing past EOL); register holds the joined column.
- Block yank stores the joined column without mutating the buffer.
- Block `x` (bound to visual-delete) and `c` (composes) behave correctly.
- Char/line mode behavior unchanged (regression).

## Testing Strategy

### Unit Tests
- Drive `(visual-enter-block-mode)`, move cursor, `(visual-delete)` / `(visual-yank)`, assert `(buffer-text)`.
- Rectangle over a 3-line, 2-column window; ragged short line.

### Edge Cases
- Single-line block (topLine == bottomLine) → behaves like a char-range delete of that column slice.
- `leftCol` past a short line's EOL → that line unchanged.
- Cursor lands at `(topLine, leftCol)` after block delete.

## Acceptance Criteria

- [ ] `C-v` then a multi-line, multi-column rectangle + `d` deletes the column slice from EACH line (not the contiguous span); line count unchanged.
- [ ] Block `y` yanks the per-line column (joined with `\n`) into the register; buffer unchanged.
- [ ] Block `x` deletes the rectangle (bound to visual-delete).
- [ ] Block `c` deletes the rectangle and enters insert at the top-left of the block.
- [ ] Ragged rectangle: a line shorter than `leftCol` is left unchanged.
- [ ] After block delete, the cursor is at `(topLine, leftCol)`.
- [ ] Char-mode and line-mode visual delete/yank behavior unchanged (regression — existing visual tests stay green).
- [ ] `bun run typecheck` clean; `visual-block.test.ts` passes; existing visual tests green.

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/visual-block.test.ts`
- `bun test test/unit/vim-visual-text-objects.test.ts test/unit/core-bindings.test.ts`

## Notes

- Block `I`/`A` (multi-cursor insert across all block lines) is deferred — tmax
  has no multi-cursor infrastructure. The rectangle-destructive ops shipped here
  are the most-used block features and are self-contained.
- Block paste (re-inserting a yanked rectangle as a block, not linearly) is also
  deferred; the yanked text is stored newline-joined so a normal `p` pastes it
  linearly (a documented limitation).
