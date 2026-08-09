# ADR-0210 — `(interactive)` declaration for T-Lisp commands (`#183` / SPEC-115)

## Status
Accepted

## Context
M-x (`execute-extended-command`) listed every visible callable — ~1,164
candidates — because the old `command-detail-interactive-p` rule was "has a
docstring OR is key-bound". That included stdlib (`car`, `string-join`, `+`),
every TS primitive, and every internal helper, cluttering the list and slowing
completion on every keystroke (BUG-78). Emacs distinguishes *commands*
(user-callable via M-x) from *functions* (internal) via the `(interactive)`
declaration; tmax had no such signal.

## Decision
1. **`(interactive)` declaration.** `defun` accepts an optional
   `(interactive)` or `(interactive "spec")` form after the docstring.
   `parseFunctionDef` (form-shapes.ts, shared by defun + lambda) detects it as
   the first body form, strips it (so it is never evaluated), and records
   `interactive: boolean` on `FunctionDefShape`. `evalDefun` sets
   `fn.interactive = true` on the resulting `TLispFunction`. `TLispFunction`
   gains `interactive?: boolean`. The arg-spec string is parsed-and-ignored
   (argument prompting is a future enhancement).
2. **A command = declared interactive OR key-bound.** `callable-command-details`
   gains an optional `interactive-only` flag. When truthy, a callable is included
   iff `fn.interactive === true` **OR** it appears in the key-binding map. The
   key-bound check is DRY: a `(key-bind ...)` already declares "this is a
   user-facing command", so key-bound defuns need no `(interactive)` annotation.
3. **M-x sources the filtered table.** `command-completion-refresh`
   (execute-extended-command.tlisp) now calls `(callable-command-details t)` and
   keeps its secondary `trt-`/`should-` guard. `describe-function-table` (SPC h f)
   is unchanged — it calls the unfiltered primitive so describe-function still
   shows every callable (no regression to per-symbol help).
4. **Graceful fallback.** If `interactive-only` yields zero candidates, the full
   table is returned so M-x is never empty.
5. **Migration.** Added `(interactive)` to the ~35 non-key-bound user-facing
   commands reachable only via M-x (`save-buffer`, `query-replace`, `occur`,
   `dired`, `info`, `helpgrep`, `switch-to-buffer`, `kill-buffer`, …). Key-bound
   commands need no change. Internal helpers (`--` names, `*-candidate`,
   `*-table`, `*-accept`, `*-p`, the `vim-*` state machine) and stdlib are
   intentionally excluded — they are the "inapplicable options" the user wants
   gone.

## Consequences
- M-x candidate count dropped from ~1,164 → ~146 (8× reduction); stdlib and
  internal helpers removed, all key-bound + declared-interactive commands kept.
- `(interactive)` is the opt-in annotation for non-key-bound commands; new
  key-bound commands auto-appear in M-x with no annotation (better DX).
- The spec's first-draft "<100 / ~50-80" target was corrected to "<200 (~146)"
  after measurement: there are 211 legitimate key-bound commands, so going
  below ~100 would require hiding real commands (a regression). The semantic
  win — M-x shows commands, not stdlib — is intact.
- Argument-prompting codes (`(interactive "fFile: ")`) are recognized but the
  spec is ignored (future work).
- TS primitives remain M-x candidates only when key-bound (they cannot declare
  `(interactive)`); a future phase could add an `interactive` flag to `defineRaw`.

## Verification
`bun run typecheck:src` + `typecheck:test` clean. New
`test/unit/interactive.test.ts` 9/9 (parser flag for bare/spec forms, body
stripping, missing-body error, filter excludes stdlib, retains commands,
fallback non-empty). Regression suites green: evaluator-sync-async-parity 39/39
(shared validator), evaluator + describe 71/71. No other test references the
changed completion surfaces.
