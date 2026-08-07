# ADR-0194 — T2 minor modes: indent-tabs (functional) + 6 registered (`#153`)

## Status

Accepted

## Context

`#153` lists 7 T2 minor modes from `docs/modes.md`. Only one — **indent-tabs-mode**
(per-buffer tabs-vs-spaces) — is cleanly functional without a new subsystem: it
reuses the existing per-buffer minor-mode system (`minor-mode-active-p`), mirroring
how overwrite/electric-pair from #149 consult a minor-mode flag. The other 6 each
need a distinct subsystem (font-lock → render path; subword → motion primitive;
highlight-changes → change-tracking; auto-save → timers + recovery; abbrev →
tables; flymake → external linter), out of scope here.

The need: #144's expand-tabs is GLOBAL. Per-buffer tab style (go=tabs,
typescript=spaces in the same session) needs a per-buffer flag.

## Decision

Follow the proven #149 T1 pattern — functional subset + registered toggles for the rest:

- **indent-tabs-mode** — `define-minor-mode` + buffer/global toggle (line-numbers
  pattern). `insert-tab` (insert-entries.tlisp) checks
  `(minor-mode-active-p "indent-tabs")` FIRST: active → `(buffer-insert "\t")`
  (overrides global expand-tabs); inactive → the existing #144 expand-tabs logic.
  Default off → insert behavior byte-identical. No new buffer-state plumbing (the
  minor-mode system is already per-buffer).
- **font-lock / subword / highlight-changes / auto-save / abbrev / flymake** —
  `define-minor-mode` + toggle only (registered; behavior deferred to their
  subsystems).
- All 7 wired into startup via `(require-module editor/modes/…)` in `normal.tlisp`.

## Consequences

- Per-buffer tab style works: `(indent-tabs-mode t)` makes Tab insert `\t` for that
  buffer, overriding the global expand-tabs. Critical for go vs typescript/python.
- Default Tab behavior unchanged (indent-tabs off → expand-tabs logic).
- The 6 registered modes' toggles exist; flipping them on is a no-op until their
  subsystems land (transparently deferred — each is a distinct feature).
- Verify-gate (SPEC-096): **PASS** — stated AC met (indent-tabs functional + 7
  registered + 6 toggle + no regression).
