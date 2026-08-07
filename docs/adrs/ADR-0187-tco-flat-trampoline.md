# ADR-0187 — Flat TCO trampoline via raw lambda `bodyEval` (`#129`)

## Status

Accepted

## Context

The interpreter advertised tail-call optimization but it did not actually
eliminate stack growth: deep tail recursion overflowed the JS stack. Measured at
`HEAD` before the fix: an `if`-tail countdown overflowed at ~5000 frames, a
`cond`-tail countdown at ~4500. The issue's reproducer `(countdown 5000)` threw
`Maximum call stack size exceeded`.

Root cause: in `evalLambda`, the lambda body was evaluated with
`this.eval(body, callEnv)`. `eval()` calls `evalInternal(expr, env)` with
`inTailPosition` defaulting to **false**, so the body's tail call was never
deferred to a `TailCall` thunk. `evalFunctionCall`'s tail branch
(`createTailCall`) was unreachable for the body; instead its non-tail branch
recursed synchronously — `evalFunctionCallInternal → lambdaFunction →
this.eval(body) → …` — one nested JS frame per recursion level. The trampoline
loop in `eval` never observed a `TailCall`, so it never advanced.

The special-form plumbing (`evalIf`/`evalCond`/`evalLet`/`evalProgn` propagating
`inTailPosition`) was already correct. The only defect was the entry point: the
lambda body began evaluation at `inTailPosition=false`, so the propagation never
started.

A naive fix (have `lambdaFunction` trampoline internally) does not work: the
trampoline's `evalFunctionCallInternal` calls `lambdaFunction`, which would start
a *new* trampoline — nesting one JS frame per tail call, identical to the bug.

## Decision

Make the trampoline **flat**: a single loop drives a chain of `TailCall` thunks,
and the lambda body returns its RAW `EvalResult` (value or `TailCall`) up to that
loop instead of trampolining per frame.

1. **`TailCall` interface moved to `types.ts`** (a shared-types module) so
   `TLispFunction.bodyEval` can reference it. `evaluator.ts` imports it.
   (`isTailCall`, `createTailCall`, and the drive loop stay in `evaluator.ts` —
   the CHORE-44 "evaluator.ts owns the trampoline" contract is preserved; only
   the interface *definition* moved so the field type is expressible.)
2. **`TLispFunction.bodyEval`** — optional field populated only on user-defined
   lambdas. `bodyEval(args)` binds parameters and returns
   `evalInternal(body, callEnv, true)` RAW (a value **or** a `TailCall`),
   catching `FunctionReturn` (BUG-32). It does **not** trampoline.
3. **`runTrampoline(initial)`** — extracted from `eval`. Drives a `TailCall`
   chain to a concrete value without growing the stack. Shared by `eval`, the
   non-tail call site in `evalFunctionCall`, and `lambdaFunction`.
4. **`evalFunctionCallInternal`** — when `func.bodyEval` exists (a lambda),
   returns `bodyEval(args)` RAW, so the caller's trampoline advances flat.
   Builtin primitives have no `bodyEval` and use `value` as before.
5. **`lambdaFunction`** (the `value` impl) now does
   `runTrampoline(bodyEval(args))` — so higher-order builtins (`mapcar` /
   `funcall` / `apply` via stdlib `call`, which call `func.value(args)` and
   expect a concrete value) still receive a value. Their contract is unchanged.

Why this is flat: inside `runTrampoline`, each iteration calls
`evalFunctionCallInternal(lambda, args)` → `bodyEval(args)` → returns the body's
`TailCall` immediately (no nested `this.eval`). The same loop takes the next
step. JS stack depth is constant across recursion depth.

## Consequences

- Deep tail recursion now runs in constant stack: `if`/`cond`/`let`/mutual
  recursion verified to 50000 / 20000 frames (was ~5000). The `runTrampoline`
  loop also serves the non-tail call site, so a non-tail call whose body contains
  deep tail recursion (e.g. `(mapcar deep-rec fn lst)`) no longer overflows
  mid-element.
- Higher-order builtins unaffected: `mapcar`/`funcall`/`apply` get concrete
  values (regression-tested).
- `return-from` (BUG-32) still caught at the function-body boundary (`bodyEval`).
- **Async TCO unchanged** (`evalAsync` path). The bug report and reproducer are
  synchronous; the async path still evaluates bodies via `this.evalAsync`. A
  future deep-async-recursion report would need the analogous treatment.
- The CHORE-44 trampoline-ownership test was updated: `TailCall` is now imported
  from `types.ts` rather than defined inline in `evaluator.ts`; `isTailCall` /
  `createTailCall` / `runTrampoline` remain there.
- Verify-gate (BUG-75): **PASS** — all acceptance criteria met; the full 42-batch
  unit suite shows zero new failures (the 2 failing batches — `fikra-mode`
  stale filenames from #158, `test-key-bind-enhancements` conflicting-bindings —
  were confirmed identical on clean `main`, i.e. pre-existing).
