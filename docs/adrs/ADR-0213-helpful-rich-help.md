# ADR-0213 — helpful-style rich help layout (`#180` / SPEC-113)

## Status
Accepted

## Context
`*Help*` rendered only a flat docstring + optional `documentation.ts` block. It
lacked the contextual info that makes the Emacs `helpful` package so much more
useful than built-in help: source location, the keys that invoke a command, and
who references a symbol. SPEC-110 (help-mode) added navigation; this adds
content depth.

## Decision
Add three describe-time data sources + a sectioned renderer. All data is
computed on demand from live state (never a stale cached index):

1. **`help-source-location(name)`** (editor.ts) — scans every loaded module's
   source for `(def\w* NAME` (defun/defmacro/defvar/…) and returns
   `{file, line, excerpt}`. Describe-time lookup over `moduleRegistry` source
   paths — no parser/AST changes, and it covers functions AND variables.
2. **`help-symbol-references(name)`** (editor.ts) — a lightweight on-demand xref:
   the modules whose source mentions NAME as a word. Text scan (not AST) — cheap
   and approximate, built from live source so it can't go stale.
3. **Key bindings** — `describe-function-data` (describe-ops.ts) reverses the
   key→command map, scanning each binding's command string for `(NAME`.
   Bindings are full T-Lisp expressions (`(cursor-move …)`, `(progn …)`), not
   just `(name)` cells, so a token scan (not exact-cell match) is required.
4. **Related / Examples** — inlined from `documentation.ts` (`getDocumentation`).
5. **Renderer** (describe.tlisp) — `describe-function`/`-variable` emit sections
   (`— Source —`, `— Key bindings —`, `— References —`, `— Related —`,
   `— Examples —`) via `help-source-section` / `help-list-section` helpers.

## Consequences
- `describe-function save-buffer` now shows signature, docstring, source
  (file:line + excerpt), references, and (for key-bound commands) key bindings —
  one page instead of a flat docstring. `describe-variable` adds source + refs.
- The xref is approximate (text scan): a module that mentions the name in a
  comment or unrelated context shows as a reference. Accepted tradeoff for
  never-stale, zero-maintenance references.
- TS primitives (e.g. `cursor-move`) have no `.tlisp` source → no Source section
  (Key bindings + References still show). Correct: there's no source to cite.
- Examples/Related appear only when `documentation.ts` has an entry for the exact
  name (a pre-existing data-alignment consideration, not introduced here).
- `help-symbol-references` was named to avoid colliding with the pre-existing
  module-scoped `help-references` defvar (the *Help* buffer's scanned `[name]`
  navigation refs from SPEC-110).

## Verification
`bun run typecheck` (all 4 projects) clean. New
`test/unit/helpful-rich-help.test.ts` 10/10 (source-location for defun + defvar
+ nil-for-primitive; references non-empty; describe-function Source/Keys/Refs;
describe-variable value + not-defined; no regression to signature/docstring).
Regression suites green: describe-function/describe-key/help-mode/apropos/
help-prefix-cheatsheet 30/30. Verify-gate: PASS.
