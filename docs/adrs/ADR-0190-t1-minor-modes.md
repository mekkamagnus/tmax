# ADR-0190 — T1 minor modes: read-only, overwrite, electric-pair, electric-indent (+ 3 registered) (`#149`)

## Status

Accepted

## Context

`docs/modes.md` lists seven T1 ship-first minor modes as missing (❌): overwrite,
read-only, show-paren, whitespace, truncate-lines, electric-pair, electric-indent.
The last two are Phase 1.5 prerequisites for the programming major modes (#151).

Two pleasant discoveries de-risked the work:
- **read-only enforcement already existed** at the primitive level
  (`buffer-ops.ts` `isReadonly()` guards four mutation primitives; `buffer-set-read-only`
  toggles the current buffer). It just had no user-facing minor-mode toggle.
- **auto-indent-on-Enter already ran unconditionally** in `post-newline-hook`
  (`indent-apply-line`); there was just no toggle to disable it.

So four modes needed real (but contained) behavior; three (show-paren,
whitespace, truncate-lines) are render-dependent and ship as registered toggles
whose visuals are a render-pipeline follow-up.

## Decision

All seven modes follow the `line-numbers-mode` pattern (`define-minor-mode` +
buffer toggle + global toggle), loaded via `require-module` in `normal.tlisp`.

Functional wiring:
- **read-only-mode** — toggle calls `(buffer-set-read-only flag)`; the existing
  primitive guards do the enforcement.
- **overwrite-mode** / **electric-pair-mode** — a new T-Lisp `insert-char` wrapper
  in `insert-entries.tlisp`. `insert-handler.ts`'s printable-char path now calls
  `(insert-char "k")` instead of `(buffer-insert "k")`. **With both modes off,
  `insert-char` is a plain `buffer-insert` → default behavior byte-identical.**
  overwrite (active + cursor before EOL) deletes the next char first (net
  replace); electric-pair (active + open delimiter) inserts the close and steps
  the cursor back. This keeps the new logic in T-Lisp per the architecture
  (`src/editor/CLAUDE.md`: TS provides primitives only), and limits blast radius
  to when the modes are explicitly on.
- **electric-indent-mode** — globally enabled at startup in its mode file
  (`(global-minor-mode-set "electric-indent" t)`), so `(minor-mode-active-p
  "electric-indent")` is true by default. `post-newline-hook` gates the
  `indent-apply-line` call on that predicate → default auto-indent-on-Enter
  preserved; toggle off to disable.
- **truncate-lines / show-paren / whitespace** — `define-minor-mode` only.

## Consequences

- `*Help*`/`*Messages*` can be protected with `(read-only-mode t)`. Overwrite,
  electric-pair, and a toggle for auto-indent now exist — completing the Phase
  1.5 minor-mode prerequisites for #151 (electric-pair + electric-indent +
  show-paren registered).
- Default editing behavior is unchanged: the `insert-char` wrapper is a plain
  insert when overwrite/electric-pair are off, and electric-indent is on by
  default. Verified by `vim-bindings-smoke` (99/99) + `edit-commands`/`operators`/
  `vim-dispatch` (133/0).
- The three render-dependent modes (paren highlight, whitespace glyphs, line
  truncation) are **registered toggles only** — their visuals need render-pipeline
  work (overlay/render-path changes), tracked as a separate effort. This is an
  honest partial: the toggle infrastructure exists; flipping the visual on is
  trivial once the renderer consults the flag.
- electric-pair quote handling is simple (always insert the pair); smart
  skip-over-close-quote is a future refinement.
- Verify-gate (SPEC-092): **PASS** — all acceptance criteria met.
