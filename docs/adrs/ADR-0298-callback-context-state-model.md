# ADR-0298 — #306: pin the callback-context sharing contract

- **Status**: Accepted
- **Date**: 2026-11-20
- **Issue**: #306
- **Spec**: SPEC-272

## Context

2026-11-20's worst live bug (turn-end events silently dropped) was
attributed to a two-state callback model: setq invisible to
make-process filter callbacks, mutations shared. The trap was
undocumented and unguarded.

## Decision

Verify before documenting. The minimal fixture DISPROVED the setq half
within one session: callbacks share the full environment — the
incident's invisibility was the daemon's separate-editor-session split
(each evalTlisp bound to its spawning session), not interpreter
scoping. The regression test pins the same-session contract (both
directions); src/tlisp/CLAUDE.md and docs/learnings.md document the
narrowed model, the incident as the motivating case, and the safe
patterns (mutation-shared carriers, thread-record fields,
explicit-path emitters). A defvar-read-in-filter lint was considered
and deferred: static T-Lisp call-graph analysis is its own project.

## Consequences

- The model is pinned by evidence, not by the incident narrative — a
  future runtime change to the sharing semantics turns CI red with the
  fixture named.
- The cross-session split remains architecture (not single-fixture
  pinning-able); its docs carry the safe patterns.
