# ADR-0177 — Defer the five large M-x features as a cataloged backlog (#96 / SPEC-086)

## Status

Accepted

## Context

The alpha-readiness audit (`docs/memos/alpha-audit-2026-08-01.md`) named five
high-value, expected-by-users-but-missing editor features: `grep`,
`recover-session`, `jump-to-register` (window-config), `info`, and `tutorial`.
Each is a **new subsystem** (a results-buffer lifecycle, an auto-save artifact
lifecycle, a new register capability, a tree-shaped reader, a shipped lesson
script) rather than a thin wrapper over an existing primitive. Bundling any of
them into the surgical alpha-closing pass would have violated the project's
"simplicity first / surgical changes" rules and risked shipping half-built
subsystems.

## Decision

Defer all five — **explicitly and auditably** — by recording them as a
**catalog meta-spec** (`docs/specs/SPEC-086-deferred-large-features.md`) whose
sole deliverable is the catalog itself (verified on `main`). For each
sub-feature the meta-spec records: the audit gap, the **real** source files the
feature attaches to (verified by Read/Grep), the accurate root cause (why it is
missing today), a tmax-specific implementation sketch grounded in the existing
factory / T-Lisp-layer patterns (the `occur` subsystem is the proven template
for four of the five), the per-sub-feature acceptance criteria, and the reserved
M-x names. No code ships under this decision.

Each sub-feature is **independent** and is to be lifted into its own dedicated
spec + implementation session (e.g. a future `SPEC-0NN-grep.md`) when
prioritized — the per-sub-feature criteria in SPEC-086 are the seed contract for
that day.

## Consequences

- The five features are tracked durably (in the spec, not just in memory) so a
  future implementer can pick exactly one up without re-discovering the audit
  gap, re-reading the codebase, or accidentally duplicating a name. The reserved
  M-x names (`grep`, `grep-jump`, `recover-session`, `window-config-to-register`,
  `jump-to-register`, `info`, `tutorial`) prevent silent reimplementation under
  conflicting names.
- Closing #96 reflects its actual deliverable (the catalog meta-spec, which is
  complete). The five sub-features remain intentionally unimplemented; to action
  one, file a per-feature spec that lifts its sketch from SPEC-086.
- This ADR records the deferral decision in the ADR ledger so "why isn't `grep`
  implemented?" has a one-stop answer pointing at the catalog + rationale.
