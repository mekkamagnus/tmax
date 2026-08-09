# ADR-0208 — Help-mode cross-references + history (`#177` / SPEC-110)

## Status
Accepted

## Context
`*Help*` was plain text in normal mode — references in docstrings, apropos
results, and describe-* output were inert. No way to click from `save-buffer`'s
docs to `write-file`, or browse back. The splash advertised `C-h` as a help
prefix but `C-h f` fell through.

## Decision
1. **Major-mode "help"** on `*Help*` with scoped key bindings: RET (follow),
   TAB/S-TAB (cycle references forward/backward), l/r (history back/forward),
   q (bury).
2. **`[name]` cross-reference convention**: `help-linkify` TS primitive wraps
   known callable names in `[name]` markers. Applied to ALL four describe-*
   commands (sig + doc in describe-function; doc in describe-variable; command
   name + doc in describe-key; command name in describe-binding-line). Also in
   apropos output. `help-scan-references` detects `[name]` patterns by line.
3. **History with (title body) pairs**: `describe-to-help` pushes the current
   page before rendering; `help-back`/`help-forward` re-render stored pairs via
   `help-history-render` (no re-push). Position pointer clamps at both ends.
4. **Read-only enforced** via the 2-arg `buffer-set-read-only(name, flag)` form
   (merged separately as a prerequisite).
5. **S-TAB normalization**: `normalizeKey` intercepts `\x1b[Z` → `S-TAB`.
6. **describe-function unshadowing**: renamed legacy TS `defineRaw("describe-function")`
   → `"describe-function-info"` so the T-Lisp `describe-function` (which renders
   to *Help*) is the user-facing one. Tests updated to call `describe-function-info`.
7. **TAB cursor position**: `help-next-ref`/`help-prev-ref` move to col 1 (inside
   the `[` brackets) so `symbol-at-point` reads the name on RET.

## Consequences
- RET on any `[name]` in *Help* describes that function; TAB cycles between them.
- l/r browse the help history (each describe/apropos page is a history entry).
- `<key>` and mode-name references are NOT yet turned into buttons (spec-scope
  gap — future enhancement). Only callable-name `[name]` references are detected.
- `help-linkify` is O(names × text); acceptable for current function-table size.
- History is unbounded (no depth cap); acceptable for typical browsing sessions.

## Verification
`bun run typecheck` clean; 14/14 tests across help-mode + describe-function;
33/33 across all help-related suites. Verify-gate: 2 retries (first found
test regression + partial button coverage; second found TAB→RET cursor bug).
All fixed. Remaining spec-scope gap (`<key>`/mode buttons) acknowledged.
