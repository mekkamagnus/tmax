# Markdown table alignment (org-table semantics)

## Status

Accepted (2026-08-28) — implements #229 / SPEC-229.

## Context

markdown-mode had a manual table aligner (`, t` → `markdown-align-table`) but tables opened jagged and drifted while editing. The old aligner also: padded by character count (CJK/double-width cells stayed crooked on screen), ignored `:---`/`:---:`/`:---:` alignment markers, padded the delimiter row with spaces instead of stretching dashes, counted the empty edge cells from leading/trailing pipes as a phantom extra column, and truncated short rows instead of padding them. #229 asked for Emacs/org-table behavior: tables *show up* aligned and *stay* aligned.

A design fork existed: org-style **buffer rewrite** vs **display-only virtual alignment** (the wiki-link transform in `wiki-display.ts` is the in-repo precedent for the latter). Display-only was rejected: screen ≠ buffer puts the cursor inside phantom padding and interacts badly with horizontal scrolling (the wiki transform only applies at `viewportLeft === 0`). Strict org parity (no align-on-open) was rejected: externally-authored files (LLM output, other editors) would stay jagged on view, which is the reported complaint.

## Decision

1. **Org-style buffer rewrite.** Aligning rewrites buffer lines with padding; screen == buffer; the padded form is what gets saved. The org tradeoff is accepted: opening a .md with unaligned tables dirties the buffer until saved.
2. **One width truth.** A new interpreter builtin `string-display-width` (`src/tlisp/stdlib.ts`) reuses the renderer's `isWideChar` table (exported from `src/core/screen-buffer.ts`, #202): wide CJK/emoji code points count 2 terminal columns. The aligner pads on display width, so pipes line up with what the terminal actually draws. TS builtin is justified under the TS/T-Lisp split: Unicode codepoint widths are a factual primitive T-Lisp cannot compute.
3. **Three realign triggers, one implementation.** `md-table-align-core` (private) does the work; `markdown-align-table` (`, t`), `markdown-tab` (TAB on a table row in markdown-mode; falls through to visibility cycling elsewhere), `markdown-table-realign-after-newline` (wired into `post-newline-hook`'s markdown branch), and `markdown-align-tables-in-buffer` (registered via `major-mode-hook-add` on the markdown mode-activate hook, which `major-mode-set` already runs on find-file) all share it. Formula evaluation re-aligns after writing its result cell (SPEC-039:373 promised this; it was never implemented). Landing that exposed three latent formula-write bugs (pre-existing on main): the delete+insert row write merged the row into the formula-comment line, writes indexed raw split rows so `$1` landed in the leading edge sentinel while reads filter edge cells, and evaluated comments were never consumed so "evaluate ALL" looped on formula 1 (main's merge corruption had masked it). Writes are now sentinel-aware, replace the line in place, re-align, and consume the comment.
4. **Idempotence by skip, not by undo.** The re-emit loop compares each rendered line against the current buffer line and skips unchanged lines, so an already-aligned table is a byte-identical no-op and a clean buffer stays clean. The cursor is restored by mapping pipe positions pipe-to-pipe (`md-table-map-column`), keeping point in its cell across realign.
5. **Private helpers stay out of the public namespace.** The 17 alignment helpers are `md-table-*`, not `markdown-table-*`, per the #227 rule (every `markdown-*` defun is public inventory, asserted by `markdown-module-boundaries` AC11.1/11.2). The `.chore44-baseline/markdown-fns.txt` baseline was refrozen 125 → 128 for the three new public commands.

## Consequences

- Tables in .md buffers are aligned on open, on TAB, and on RET — org-table semantics with no per-table command hunting.
- Files authored with compact tables gain whitespace churn on first open+save (the accepted org tradeoff).
- Marker columns (`:---`, `:-:`, `--:`) are at least 3 wide so the delimiter cell fits; plain columns at least 1 dash — minimum-valid GFM is preserved.
- `string-display-width` is generally available to T-Lisp for any future width-aware feature (status line padding, echo truncation).
- The markdown public inventory is +3 (128); future private helpers must keep the non-`markdown-` prefix convention or the boundary gate goes red by design.
