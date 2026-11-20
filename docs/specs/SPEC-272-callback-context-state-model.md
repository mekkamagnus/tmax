# SPEC-272 — the evalTlisp callback-context state model, verified + guarded (#306)

## Goal

Verify the exact sharing boundary at the make-process filter/sentinel
evalTlisp callback with a minimal reproduction; document it at the exact
locations; guard it as a permanent regression.

## The verified (narrowed) model

The incident hypothesis (setq invisible to callbacks, mutations shared)
was DISPROVED in its setq half by the fixture: **within one editor
session, the callback context shares the FULL environment** — the filter
sees the main session's setq and the hashmap mutations. The incident's
actual mechanism was the daemon's separate-editor-session split (the
round-27/28 root cause): a callback's evalTlips binds to its SPAWNING
session, so other sessions' setqs are invisible while shared object
state crosses. Safe patterns: mutation-shared carriers, thread-record
fields, explicit-path emitters (the incident fix).

## Completion criteria

- [x] The fixture regression test lands and pins the verified semantics
      (both directions asserted: setq-visible + mutation-shared,
      same-session)
- [x] Both doc locations carry the section (src/tlisp/CLAUDE.md +
      docs/learnings.md); the model stated matches the fixture exactly
      (including the disproven-hypothesis narrowing)
- [x] The deferred-lint decision recorded with rationale (static
      T-Lisp call-graph analysis is its own project)
