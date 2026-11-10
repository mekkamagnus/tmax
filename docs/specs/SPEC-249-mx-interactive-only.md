# M-x lists only interactive commands — internal key-bound helpers migrate out

## Goal

Emacs parity for `M-x`: the completion list contains **only commands** —
functions declared `(interactive)` (SPEC-115's declaration mechanism), plus
TS-defined editor primitives explicitly marked as commands. Being bound to a
key must NOT, by itself, put a function in M-x. Internal key-plumbing
(`vim-mark-begin-set`, `visual-enter-char-mode`, `editor-handle-space`,
`macro-handle-q`, …) disappears from the list; genuine commands currently
reaching M-x via the key-bound arm (`find-file`, `quick-save`, `undo`,
`switch-buffer`, `paragraph-next`, …) gain `(interactive)` declarations and
stay.

## Problem Statement

`callable-command-details` (`src/editor/editor.ts:1465`): `isCommand =
fn.interactive === true || bindingsByCommand.has(name)` — the OR key-bound arm
(SPEC-115) admits every key-bound function. Today's M-x source table has 234
entries: 116 already declared interactive, **118 arriving only via the
key-bound arm** — of which ~27 are internal plumbing (pending-state entries,
visual-mode operators, mode-entry/exit handlers, `*-impl`/range helpers) that
leak into M-x (#249's report).

## Solution Statement

Three coordinated changes (the issue's fix direction):

1. **Expose the flag**: the candidate hashmap gains `"interactive"`
   (boolean) alongside `name`/`documentation`/`bindings`[/`module`] — so the
   T-Lisp side can filter/annotate without re-deriving.
2. **Migrate genuine commands** (the Emacs-parity criterion: an action a user
   can meaningfully trigger by name — motions, edits, buffer/file/window/tab
   ops, help/info/man/dired operations, export, search, mode toggles):
   - 79 T-Lisp defuns gain `(interactive)` as the first body form (after the
     docstring), the existing SPEC-115 idiom.
   - 12 TS-defined primitives (`editor-quit`, `undo`, `redo`, `yank-pop`,
     `line-first-non-blank`, `line-last-column`, `search-next`,
     `search-previous`, `tab-next`, `tab-prev`, `word-under-cursor-next`,
     `word-under-cursor-previous`) are marked by setting `interactive = true`
     on the registered function value (builtins cannot carry a declaration
     form; the value object is the registration).
   - Deliberately NOT migrated (internal plumbing, drops out of M-x — 27):
     `editor-handle-space`, `editor-enter/exit-command-mode`,
     `editor-execute-command-line`, `insert-delete-to-bol`, `macro-handle-at`,
     `macro-handle-q`, `vim-begin-register-prefix`, `vim-mark-begin-set`,
     `vim-mark-begin-jump-line`, `vim-mark-begin-jump-exact`,
     `vim-replace-begin`, `vim-replace-mode-enter`, `vim-visual-delete-flash`,
     `vim-visual-yank-flash`, `vim-visual-indent`, `vim-visual-outdent`,
     `vim-visual-lowercase`, `vim-visual-uppercase`, `vim-visual-toggle-case`,
     `vim-visual-paste`, `visual-change`, `visual-enter-block-mode`,
     `visual-enter-char-mode`, `visual-enter-line-mode`, `visual-exit`,
     `visual-swap-anchor`.
     Rationale: pending-state entry points and per-mode key operators are
     key-dispatch machinery; invoking them by name from M-x is meaningless or
     wrong (they act on state a bare M-x invocation doesn't have).
3. **Tighten**: `isCommand` drops the key-bound arm — `fn.interactive ===
   true` only. `bindingsByCommand` stays (it feeds the `bindings` field, which
   remains useful annotation). Key bindings themselves are UNAFFECTED —
   keymap resolution never consulted `isCommand`.
4. **T-Lisp guard** (`command-detail-interactive-p`): now requires the
   exposed `interactive` flag AND keeps the `trt-`/`should-` exclusion —
   defense in depth, and the predicate finally lives up to its name.

`describe-function` (full table via no-arg call) and the empty-filter
fallback (filter-empty → full table) are unchanged.

## Completion Criteria

- [ ] The M-x source table (`callable-command-details t`) contains NO entry
      with `interactive = false` (after the T-Lisp guard: none without the
      flag).
- [ ] None of the 27 internal names above appears in the M-x source table.
- [ ] Genuine commands still present: `find-file`, `quick-save`, `undo`,
      `redo`, `switch-buffer`, `editor-quit`, `paragraph-next`,
      `execute-extended-command`, `isearch-forward`, `apropos`, `yank-pop`.
- [ ] Key bindings still work for dropped internals (e.g. `m` sets the mark
      pending state; `v` enters visual mode; `:` enters command mode) — M-x
      membership and key dispatch are independent.
- [ ] The candidate hashmap exposes `interactive` (boolean) on every entry;
      the full table (no arg) still includes every callable (`car`,
      `string-join`, and the internal names — describe-function parity).
- [ ] M-x count after: 207 ± a few (234 − 27); never empty; < 300 (existing
      guard).
- [ ] Existing suites stay green: `interactive.test.ts` (SPEC-115),
      `markdown-mx-discoverability.test.ts` (BUG-75), `mx-completion-cache`,
      `mx-accept-execution`, describe suites.
- [ ] New tests red before the tighten, green after (mutation-proven by
      reverting the `isCommand` change).
- [ ] `bun run typecheck` clean; `bun run test:unit` green.

## Relevant Files

- `src/editor/editor.ts` — `isCommand`, candidate hashmap, TS-command marking
- `src/tlisp/core/commands/execute-extended-command.tlisp` — T-Lisp guard
- ~25 files under `src/tlisp/core/**` — `(interactive)` insertions (79 defuns)
- `test/unit/mx-interactive-only.test.ts` — new invariant suite

## Notes

- The dump/classification methodology: the 234-entry table was dumped from a
  headless editor; each key-bound-only name was classified by definition site
  (defun vs TS builtin) and by the Emacs-parity criterion above.
- `occur-prompt` was initially suspected internal but is a genuine command
  ("Prompt for a pattern…Bound to SPC s o") — migrated, not dropped.
- Counts: 116 (already interactive) + 79 (migrated defuns) + 12 (marked TS)
  = 207 commands.

Status: RESOLVED pending CI green — implemented at issue-249 (f450602, amended
after gate round 1 caught the lost T-Lisp guard edit); typecheck clean, unit
suite 3,610/0, verify-gate PASS on retry 1 (verifier independently
re-proved the isCommand mutation).
