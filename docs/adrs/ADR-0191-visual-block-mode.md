# ADR-0191 — Visual block mode: rectangle operations (`#145`)

## Status

Accepted

## Context

`C-v` entered visual block mode (`--VISUAL BLOCK--`, `mode:'block'` in
`VisualSelection`), but the operators treated the selection as a contiguous
start→end range: `visual-delete`/`visual-yank` normalized to one `{start,end}`
and called `buffer.getText`/`delete` once. So a block selection across lines N..M
deleted the whole span as one contiguous region instead of the per-line column
slice. There was no rectangular selection behavior at all.

## Decision

Add a `visualSelection.mode === 'block'` branch (early return before the existing
normalize/range logic, so char/line paths are untouched) to `visual-delete` and
`visual-yank` in `src/editor/api/visual-ops.ts`:

- Rectangle = lines `[topLine, bottomLine]` (min/max of the two line coords) ×
  columns `[leftCol, rightCol]` (min/max of the two column coords, **inclusive**
  on both ends — vim semantics).
- Iterate each line `L`: `buffer.getLine(L)`; if `leftCol` is past EOL the line
  contributes `""` (ragged rectangle); else segment = `line.slice(leftCol,
  min(rightCol, len-1) + 1)`.
- **visual-yank** joins segments with `\n` into the yank + `"` registers; no
  buffer mutation.
- **visual-delete** collects the same segments, then per-line
  `buffer.delete({start:{L,leftCol}, end:{L,segEnd+1}})`. Each deletion is within
  a single line, so line numbers never shift across the loop; the immutable
  buffer threads through. Stores joined text in the delete + `"` registers; cursor
  to `(topLine, leftCol)`; exits to normal.
- `visual-change` (T-Lisp) composes on `visual-delete` → block `c` deletes the
  rectangle then enters insert at the top-left. Visual-mode `x` is bound to
  `visual-delete`, so block `x` works.

## Consequences

- Columnar edits now work: `C-v` + motion + `d`/`y`/`x`/`c` operate on the
  rectangle per-line. Char-mode and line-mode visual are unchanged (the block
  branch is an early return).
- **Deferred (out of scope):**
  - **Block `I`/`A`** (insert at block start/end across ALL lines simultaneously)
    needs multi-cursor infrastructure tmax does not have.
  - **Block paste** (re-inserting a yanked rectangle as a block). The yanked text
    is stored newline-joined, so a normal `p` pastes it linearly — a documented
    limitation.
- Verify-gate (SPEC-093): **PASS** — all acceptance criteria met; char/line
  visual regression check green (`vim-visual-text-objects` + `edit-commands` +
  `vim-bindings-smoke` 112/0).
