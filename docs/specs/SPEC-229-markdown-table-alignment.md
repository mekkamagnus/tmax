# SPEC-229 — Markdown table alignment (org-table semantics)

Issue: #229 `[markdown-mode] Pipe tables display unaligned — expect org-table-style aligned rows`
Status: implementing
Date: 2026-08-28

## Background

markdown-mode has a manual table aligner (`markdown-align-table`, bound to `, t`) but tables open jagged and drift out of alignment while editing. The existing aligner also pads by **character count** (CJK/double-width cells stay crooked), ignores `:---`/`:---:`/`---:` alignment markers, pads the delimiter row with spaces instead of stretching dashes, treats empty edge cells as a phantom extra column, and truncates short rows instead of padding them.

## Goal

Pipe tables in markdown-mode behave like Emacs org-tables: they **show up aligned** (on mode activation) and **stay aligned** (TAB / RET inside a table row realigns). Alignment rewrites **buffer text** (org semantics — screen == buffer, padded form is saved), with padding computed on **terminal display width**.

## Design decisions

- **Org-style buffer rewrite** (resolved in issue #229): aligning rewrites buffer lines; rejected display-only virtual alignment (cursor-through-phantom-padding, h-scroll interplay) and strict org parity without align-on-open (foreign files stay jagged).
- **Display width** comes from a new interpreter builtin `string-display-width` that reuses the renderer's `isWideChar` East-Asian/wide ranges (`src/core/screen-buffer.ts`, #202) — one width truth shared by renderer and aligner. TS builtin is justified: T-Lisp cannot compute Unicode codepoint widths; it's a factual primitive, not editor logic.
- **Triggers**: `<Tab>` in markdown-mode normal realigns when point is on a table row (folding cycle otherwise); `post-newline-hook` realigns when Enter splits a table row (current or previous line is a row); mode activation hook (`major-mode-hook-add "markdown"`) aligns all tables in the buffer (find-file / `major-mode-set`).

## Completion criteria

1. Opening a .md buffer in markdown-mode shows every pipe table aligned (mode-activate hook; `major-mode-set` runs `mode-markdown-activate-hook`).
2. TAB with point on a table row realigns the whole table; TAB elsewhere keeps the fold/visibility-cycle behavior.
3. RET (`post-newline-hook`) with the current or previous line a table row realigns the table.
4. Padding is computed on terminal display width — CJK/emoji cells (2 columns) align correctly.
5. Delimiter row cells are stretched with dashes to the final column widths (colons preserved: `:---`, `---:`, `:---:`) and remain valid GFM.
6. Alignment markers are honored: `:---`/none → left, `:---:` → center, `---:` → right.
7. Re-aligning an already-aligned table is a no-op: buffer content byte-identical, `buffer-modified-p` unchanged (no dirtying clean buffers).
8. `, t` still aligns explicitly and shares the same implementation as the automatic triggers.
9. Empty leading/trailing cells no longer create a phantom extra column; short rows are padded with empty cells instead of truncated.
10. Cursor position survives realign (mapped pipe-to-pipe into the same cell — including the RET path when the line after the table is restored), and the table keeps its leading indentation: the first row's indent prefix is applied uniformly to every row (aligned pipes require a uniform indent, so a table with mixed per-row indentation normalizes to the first row's).

## Implementation outline

- `src/core/screen-buffer.ts`: export `isWideChar`.
- `src/tlisp/stdlib.ts`: `string-display-width` builtin (sum of per-codepoint widths, wide = 2).
- `src/tlisp/core/commands/markdown/tables.tlisp`: rewritten alignment core — `markdown-table-cell-split` (edge-sentinel strip), separator detection + per-column align extraction, display-width column widths, dash-stretched delimiter emission, center/right padding, missing-cell padding, per-line skip-when-unchanged, pipe-to-pipe cursor mapping, indent preservation; new `markdown-align-tables-in-buffer` (whole-buffer pass) and `markdown-tab`; formula eval re-aligns (SPEC-039:373 promised this).
- `src/tlisp/core/modes/markdown-mode.tlisp`: register activate hook; `<Tab>` → `markdown-tab`.
- `src/tlisp/core/commands/post-newline.tlisp`: markdown branch realigns after list continuation.
- `src/tlisp/core/commands/markdown.tlisp`: re-export new commands.

## Test plan

`test/unit/markdown-table-align.test.ts` — basic alignment (issue example), CJK width, markers, delimiter stretch, idempotence + no-dirty, align-on-open via `major-mode-set`, phantom column, short-row padding, TAB in/out of table, post-newline realign, cursor mapping. Existing suites stay green: `markdown-spec-039` (formulas), `markdown-module-boundaries` (exports).

## Out of scope

Cell navigation (TAB jumping between cells), org `#TBLFM`-style field recalculation on realign, escaped `\|` in cells, display-only alignment mode.

## Verify-gate audit (2026-08-28, retry 1 amendments)

- RET-path restore now maps the column through pipe positions (identity for an untouched line) instead of restoring a raw column.
- Spec criterion 10 clarified: uniform first-row indent; mixed per-row indentation normalizes (locked by a test).
- Added tests: emoji width (🚀 = 2 cols), mixed-indent normalization, formula-eval leaves the table aligned (SPEC-039:373), and the registered hook name (`mode-markdown-activate-hook`) is what realigns.
- post-newline-hook docstring updated to mention the table realign.
- Retry 1 also surfaced and fixed three latent formula-write bugs the new realign exposed (SPEC-039 territory, all pre-existing on main): (1) the result row was written via `markdown-delete-line` + `buffer-insert-at-position`, which MERGED the row into the formula-comment line that shifted into the deleted slot; (2) writes indexed the raw `string-split` row (leading sentinel = `$1`) while reads filter edge cells — `$1` wrote into the sentinel and vanished; (3) evaluated formula comments were never consumed, so the outer loop re-evaluated formula 1 forever (main's merge corruption accidentally mangled it out of the scan), and re-entry with the cursor on the comment line crashed `(length (nth 0 table))` on an empty table. The write is now sentinel-aware (`$1` = first visible cell), replaces the line in place, re-aligns, and consumes the comment; the table search anchors at the line above the formula when point is not on a row.
- Not actionable: "no Codex review comment on the issue" (no codex review was run for #229) and load-induced timeout flakes under host load-average ~100 (all isolated green; vim-dispatch proven identical on clean main).
