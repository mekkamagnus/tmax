# ADR-0130 — Either.isLeft consistency (#19)
## Status: Accepted
## Context: 11 sites hand-checked `result._tag === 'Left'` instead of using the provided `Either.isLeft` type guard.
## Decision: Replace all with `Either.isLeft(result)`. Consistency with the project's FP vocabulary.
## Consequences: Mechanical; narrowing preserved (isLeft is a type guard); typecheck clean.
