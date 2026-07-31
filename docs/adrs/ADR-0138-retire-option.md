# ADR-0138 — Retire Option<T> (#29)
## Status: Accepted
## Context: Option<T> (src/utils/option.ts) was dead code — only consumer was adt.ts (itself dead code, imported by nobody). The codebase standardized on Either<string,T> + null/undefined.
## Decision: RETIRE — delete option.ts + adt.ts + option.test.ts. Remove Option from rules. 324 lines of dead code removed.
## Consequences: Simpler FP vocabulary (Either is the sole error/nullable type). No behavior change (nothing imported the deleted code).
