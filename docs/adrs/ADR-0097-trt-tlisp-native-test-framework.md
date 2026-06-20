# TRT — T-Lisp-Native Test Framework

## Status

Accepted

## Context

The original T-Lisp test framework was implemented in TypeScript (`src/tlisp/test-framework.ts`, `test-output.ts`, `test-registry.ts`) with 7 corresponding TS test files. This violated the project's core architecture principle: T-Lisp handles all editor logic, TypeScript handles only primitives. Testing T-Lisp code through a TS framework created a impedance mismatch — test assertions couldn't use T-Lisp data structures natively, and the framework couldn't be extended from `init.tlisp`.

## Decision

Replace the TS test framework with **TRT (tmax Runtime Testing)** — a T-Lisp-native test framework:

1. **`src/tlisp/trt/bootstrap.ts` + `results.ts`** — minimal TS bootstrap that loads `.tlisp` test modules and collects results. This is the only TS layer; all test logic is T-Lisp.
2. **`src/tlisp/core/trt/`** — 12 T-Lisp modules implementing the framework: `assertions`, `async`, `bench`, `coverage`, `doctest`, `fixtures`, `mock`, `parametrize`, `snapshots`, `suites`, `cli`, and the top-level `trt.tlisp` orchestrator.
3. **Delete** the old TS framework: `src/tlisp/test-framework.ts`, `test-output.ts`, `test-registry.ts`, and the 7 `test/unit/test-*.test.ts` files.

## Consequences

**Easier:** Tests are written in T-Lisp, using T-Lisp data structures natively. The framework is extensible from `init.tlisp`. Test modules live alongside the code they test (`src/tlisp/core/trt/`).

**Harder:** TS-side debugging of test failures is less direct (the test logic is in T-Lisp). The bootstrap layer is a thin seam that must stay minimal.

**Migration:** Old `test/unit/test-*.test.ts` files are deleted; their coverage is replaced by `test/tlisp/trt-self.test.tlisp` and the TRT modules' self-tests.

**Related:** ADR-0098 (FP foundations used by TRT), SPEC-049 through SPEC-053 (TRT design specs).
