# T-Lisp Functional Programming Foundations

## Status

Accepted

## Context

The T-Lisp interpreter's evaluator and stdlib were imperative-first, with no discriminated unions, no monadic patterns, and no structured error handling. Complex editor logic (the adw pipeline, test framework, observability) needed composable error handling and data modeling that the imperative style couldn't express cleanly. The `evaluator.ts` had grown to 300+ lines of inline branching, and `stdlib.ts` was a monolithic 280-line file mixing unrelated concerns.

## Decision

Introduce TypeScript-side FP primitives and refactor the evaluator/stdlib around them:

1. **`src/utils/adt.ts`** — discriminated union helpers: a `match()` function for exhaustive pattern matching on `_tag`-tagged unions (used by the adw pipeline's `DispatchOutcome` and `AuditVerdict` types).
2. **`src/utils/writer.ts`** — a `WriterT` monad for log-collection (created during the adw pipeline's evolution; ultimately unused by the final design but retained as a general-purpose utility).
3. **`src/tlisp/core/monads.tlisp`** — T-Lisp-native monadic primitives (`maybe`, `either`, `pipe`) exposed to editor logic so T-Lisp code can compose error-handling without TypeScript.
4. **Evaluator/stdlib refactor** — `evaluator.ts` restructured around a cleaner dispatch table; `stdlib.ts` decomposed into focused modules. The interpreter gained tail-call optimization improvements and module-loading changes to support the new `.tlisp` module files.

## Consequences

**Easier:** Composable error handling (`Either`/`TaskEither` chains), exhaustive pattern matching (compile-time safety on union types), T-Lisp code can express FP patterns natively.

**Harder:** Two paradigms now coexist (imperative editor core + FP pipeline/test logic). New contributors must understand both. The `writer.ts` module is currently unused — a maintenance question for the future.

**Related:** ADR-0094 (adw pipeline uses `TaskEither`/`match`), ADR-0097 (TRT uses `adt.ts`).
