# SPEC-272 — the evalTlisp callback-context state model, verified + guarded (#306)

## Goal

Verify the exact sharing boundary at the make-process filter/sentinel
evalTlisp callback with a minimal reproduction; document it at the exact
locations; guard it as a permanent regression.

## The verified (narrowed) model

The incident hypothesis (setq invisible to callbacks, mutations shared)
was DISPROVED in its setq half by the fixture: **within one editor
session, the callback context shares the environment as the fixture
exercises it** — module-variable setq reads and hashmap mutations made
via keymap-mutable-set! are both visible to the filter and the sentinel.
The fixture verifies these specific behaviors; no broader "full
environment" claim is made. The incident's actual mechanism was the
daemon's separate-editor-session split (the round-27/28 root cause): a
callback's evalTlisp binds to its SPAWNING session, so other sessions'
setqs are invisible there; whether hashmap mutations ALWAYS cross
sessions is incident-inferred, not fixture-proven. Safe patterns:
mutation-shared carriers (with same-session fallbacks), thread-record
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
