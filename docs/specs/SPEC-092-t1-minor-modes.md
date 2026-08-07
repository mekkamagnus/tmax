# Feature: T1 Minor modes — overwrite, read-only, show-paren, whitespace, truncate-lines, electric-pair, electric-indent (`#149`)

## Feature Description

Seven T1 ship-first minor modes from `docs/modes.md`. Four are fully functional
here; three (the render-dependent ones) ship as registered toggles whose visual
rendering is a separate render-pipeline effort.

- **read-only-mode** — FUNCTIONAL. Blocks buffer mutation (the existing
  `isReadonly()` guards in `buffer-ops.ts` already refuse inserts/deletes; the
  toggle drives `buffer-set-read-only`). Required by `*Help*`/`*Messages*`.
- **overwrite-mode** — FUNCTIONAL. Typing replaces the next character instead of
  inserting (Insert-key behavior).
- **electric-pair-mode** — FUNCTIONAL. Typing `(` `[` `{` `"` `'` inserts the
  matching close and leaves the cursor between. Phase 1.5 prerequisite.
- **electric-indent-mode** — FUNCTIONAL, **default ON** (preserves the existing
  auto-indent-on-Enter behavior). Gates the `indent-apply-line` call in
  `post-newline-hook`. Phase 1.5 prerequisite.
- **truncate-lines-mode** — REGISTERED toggle. Visual (wrap vs clip at the
  viewport edge) is a render-pipeline follow-up.
- **show-paren-mode** — REGISTERED toggle. Visual (highlight matching delimiter)
  needs a char-scan primitive + render overlay — render-pipeline follow-up.
- **whitespace-mode** — REGISTERED toggle. Visual (tabs / trailing-whitespace
  glyphs) is a render-pipeline follow-up.

## User Story

As a tmax user,
I want overwrite, read-only protection, electric pairs, and auto-indent,
So that editing behaves like a modern editor, and generated buffers (`*Help*`)
can't be accidentally mutated.

## Problem Statement

These modes are missing. read-only enforcement already exists at the primitive
level (`buffer-ops.ts` `isReadonly()` + `buffer-set-read-only`) but has no
user-facing toggle. Auto-indent-on-Enter already runs unconditionally in
`post-newline-hook`; there is no toggle to disable it. Overwrite and electric
pair need insert-path hooks.

The render-dependent visuals (paren highlight, whitespace glyphs, line truncation)
require render-pipeline work that is out of scope here; those three modes ship as
registered toggles so flipping them on is trivial once the renderer supports them.

## Solution Statement

All seven modes follow the `line-numbers-mode` pattern (`define-minor-mode` +
buffer toggle + global toggle), registered in `normal.tlisp`. Functional wiring:

- **read-only-mode** — toggle calls `(buffer-set-read-only flag)`.
- **overwrite-mode** / **electric-pair-mode** — new T-Lisp `insert-char` wrapper
  in `insert-entries.tlisp`. `insert-handler.ts`'s printable-char path calls
  `(insert-char "k")` instead of `(buffer-insert "k")`. The wrapper defaults to
  `buffer-insert` when both modes are off → default insert behavior byte-identical.
  When overwrite is active and the cursor is before EOL, it deletes the next char
  first (net replace). When electric-pair is active and the key is an open
  delimiter, it inserts the close and steps the cursor back.
- **electric-indent-mode** — globally enabled at startup (default ON); the
  `post-newline-hook` indent call is gated on `(minor-mode-active-p "electric-indent")`.
- **truncate-lines / show-paren / whitespace** — `define-minor-mode` only.

## Relevant Files

- `src/tlisp/core/modes/read-only-mode.tlisp`, `overwrite-mode.tlisp`,
  `electric-pair-mode.tlisp`, `electric-indent-mode.tlisp`,
  `truncate-lines-mode.tlisp`, `show-paren-mode.tlisp`, `whitespace-mode.tlisp` (NEW).
- `src/tlisp/core/commands/insert-entries.tlisp` — `insert-char` wrapper + pair helper.
- `src/tlisp/core/commands/post-newline.tlisp` — gate indent on electric-indent.
- `src/editor/handlers/insert-handler.ts` — `(buffer-insert …)` → `(insert-char …)`.
- `src/tlisp/core/bindings/normal.tlisp` — 7 `require-module` lines.
- `test/unit/t1-minor-modes.test.ts` (NEW).

## Implementation Plan

### Phase 1: mode files
- Seven `*-mode.tlisp` files (line-numbers pattern). read-only toggle calls buffer-set-read-only. electric-indent file globally-enables itself at the end.

### Phase 2: insert-path wiring
- `insert-entries.tlisp`: add `insert-char` + `electric-pair--close-for`.
- `insert-handler.ts`: printable-char path → `(insert-char "${escapedKey}")`.

### Phase 3: electric-indent gate
- `post-newline.tlisp`: wrap the `indent-apply-line` call in `(if (minor-mode-active-p "electric-indent") …)`.

### Phase 4: startup wiring + tests
- 7 `require-module` lines in `normal.tlisp`. `t1-minor-modes.test.ts`.

## Testing Strategy

### Unit Tests
- All 7 in `(minor-mode-list-all)`.
- read-only: enable → `(buffer-insert "x")` returns a ReadOnly error.
- overwrite: enable → typing at a non-EOL column replaces the char (buffer text + length).
- electric-pair: enable → `(insert-char "(")` yields `()` with cursor at col 1.
- electric-indent: active by default at startup; `(global-electric-indent-mode nil)` deactivates.
- truncate/show-paren/whitespace: registered + toggle flips `minor-mode-active-p`.

### Edge Cases
- overwrite at EOL → still inserts (no char to replace).
- electric-pair on a non-open char → plain insert.
- Default insert behavior (modes off) unchanged → vim-bindings-smoke stays green.

## Acceptance Criteria

- [ ] All seven modes appear in `(minor-mode-list-all)`.
- [ ] read-only-mode: `(read-only-mode t)` makes `(buffer-insert "x")` fail with a ReadOnly error; `(read-only-mode nil)` restores mutation.
- [ ] overwrite-mode: active + cursor before EOL → typing replaces the next char (line length unchanged).
- [ ] electric-pair-mode: active → `(insert-char "(")` produces `()` with the cursor between; same for `[`,`{`,`"`,`'`.
- [ ] electric-indent-mode: `(minor-mode-active-p "electric-indent")` is true at startup (default ON, preserves auto-indent); `(global-electric-indent-mode nil)` turns it off.
- [ ] truncate-lines / show-paren / whitespace: registered; `(minor-mode-toggle NAME)` flips `(minor-mode-active-p NAME)`.
- [ ] Default insert behavior unchanged (modes off): no regression — `vim-bindings-smoke.test.ts` + `core-bindings.test.ts` green.
- [ ] `bun run typecheck` clean; `t1-minor-modes.test.ts` passes.

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/t1-minor-modes.test.ts`
- `bun test test/unit/core-bindings.test.ts test/unit/vim-bindings-smoke.test.ts`

## Notes

- The 3 render-dependent modes register the toggle infrastructure now; their
  visuals are a render-pipeline epic (separate from #149). This is an honest
  partial: toggle works, visual deferred.
- electric-pair quote handling is simple (always insert the pair); smart
  skip-over-close-quote is a refinement, out of scope.
