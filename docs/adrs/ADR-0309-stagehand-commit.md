# ADR-0309 — #288: the commit compose (own buffer, F-file delivery)

- **Status**: Accepted
- **Date**: 2026-11-21
- **Issue**: #288
- **Spec**: SPEC-283

## Context

#288's body says the compose is "via the #277 primitive", but #277
(the shared compose extract) sits at order-row 46 — the codex-decided
order resolved the tension in advance: "#288 depends on the 277
compose API only conceptually; lands with own buffer". Capture
(#285) already proves the chord pattern (insert-mode buffer +
buffer-local `C-c C-c`/`C-c C-k`/`C-g`, recency restore).

## Decision

- **Own compose** in `stagehand/commit.tlisp` following capture's
  chord pattern; #277's later extraction absorbs it (that issue's own
  spec says "refactor-and-extract, not from-scratch").
- **One-way module dependency**: commit requires status (its shell
  helpers, root, staged-set); status binds `c`/`C`/`R` lazily. An
  initial mutual require was a load-time circular-dependency error —
  the boot sequence (normal.tlisp: status, then commit) replaces it.
- **Message delivery via `append-file` to a fresh mktemp file** — a
  file WRITE, never a shell argument (the #289 injection lesson:
  nothing user-typed crosses a shell boundary un-quoted; the message
  body doesn't cross one at all). The temp file is removed at every
  sentinel; a defvar + exported getter make the orphan-file contract
  test-assertable.
- **Fixup is a separate direct invocation** — no compose, no temp
  file: `git commit --fixup=<sha>` (git writes the message; `-F` and
  `--fixup` semantics never combine). The sha is shell-quoted; #290's
  log rows will pass real shas.
- **Amend rides the index as it stands** (nothing-staged amend edits
  the message — tested); `c` refuses on an empty staged set (the live
  parse's Staged section, not a re-run of git).

## Consequences

- `stagehand/commit` exports the variant entries + fixup for #290 to
  bind on log rows (non-HEAD reword remains #295's).
- Module defvars stay private behind getter defuns (the repeated
  lesson: defvars are VALUES — module-qualified CALLS of them are
  "Cannot call non-function" errors).
- Test assertions over T-Lisp lists use `member` inside T-Lisp (TS
  stringification of list values is opaque — `.not.toContain` on the
  stringified list is vacuous).
