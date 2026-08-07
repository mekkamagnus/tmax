# Bug: TCO trampoline does not eliminate stack growth — deep tail recursion overflows (#129)

## Bug Description

The TCO trampoline advertised by the interpreter ("tail-call optimization", per
`CLAUDE.md`) only catches the *outermost* tail call. Deep tail recursion grows the
JS stack linearly and eventually throws `Maximum call stack size exceeded`.

Symptoms (measured at `HEAD` before the fix, standalone interpreter):

| form | tail construct | passes | overflows |
|------|---------------|--------|-----------|
| `(cd-if n)` | `if` tail | 4500 | 5000 |
| `(cd-cond n)` | `cond` tail | 4000 | 4500 |

The issue's reproducer was `(countdown 5000)` (an `if`-tail countdown) → stack
overflow. `cond`-tail was marginally worse (one extra frame per iteration).

## Problem Statement

The lambda body was evaluated via `this.eval(body, callEnv)`. `eval()` calls
`evalInternal(expr, env)` with `inTailPosition` defaulting to **false**, so the
body's tail call was *not* deferred to a `TailCall` thunk. Instead it was
evaluated eagerly by `evalFunctionCall`'s non-tail branch, which recursed through
`evalFunctionCallInternal → lambdaFunction → this.eval(body) → …` — one nested JS
call per recursion level. The trampoline in `eval` never saw a `TailCall`, so it
never looped.

`evalIf` / `evalCond` / `evalLet` / `evalProgn` all *do* propagate
`inTailPosition` to their branch/last expression — that plumbing was correct.
The defect was solely that the lambda body entered `eval` at
`inTailPosition=false`, so the propagation never started.

## Solution Statement

Give the evaluator a **flat** trampoline by letting the lambda body return a raw
`EvalResult` (a value **or** a `TailCall` thunk) up to a single trampoline loop,
instead of trampolining once per stack frame:

1. **`TailCall` interface moved to `types.ts`** (shared) so
   `TLispFunction.bodyEval` can reference it without a cycle back to
   `evaluator.ts`. `evaluator.ts` imports it.
2. **`TLispFunction.bodyEval`** — optional field, populated only on user-defined
   lambdas. It binds args and returns `evalInternal(body, callEnv, true)` RAW
   (value or `TailCall`), catching `FunctionReturn` (BUG-32). It does NOT
   trampoline.
3. **`runTrampoline(initial)`** — extracted from `eval`. Drives a `TailCall`
   chain to a concrete value without growing the stack. Shared by:
   - `eval` (top-level entry),
   - the non-tail call site in `evalFunctionCall` (a non-tail call whose body
     yields a `TailCall` is driven to a value here),
   - `lambdaFunction` (the `value` impl used by higher-order builtins — see #4).
4. **`evalFunctionCallInternal`** — when `func.bodyEval` exists (lambda), returns
   `bodyEval(args)` raw (so the caller's trampoline drives it flat). Builtin
   primitives have no `bodyEval` and fall through to `value` as before.
5. **`lambdaFunction`** (the `value` used by `mapcar`/`funcall`/`apply` via
   stdlib `call`) now does `runTrampoline(bodyEval(args))` — higher-order
   builtins still receive a concrete value; their contract is unchanged.

Why this is flat: in the trampoline, each iteration calls
`evalFunctionCallInternal(lambda, args)` → `bodyEval(args)` → returns the body's
`TailCall` immediately (no nested `this.eval`). The same trampoline loop advances
to the next tail call. No JS stack growth across recursion depth.

Async TCO (`evalAsync`) is out of scope — the bug report and the synchronous
reproducer are sync; the async path still evaluates bodies via `this.evalAsync`
(unchanged, no regression).

## Steps to Reproduce

```
tmax -e '(defun countdown (n) (if (= n 0) (quote done) (countdown (- n 1)))) (countdown 5000)'
```
Before fix: `Maximum call stack size exceeded`. After fix: `done`.

## Root Cause Analysis

`evaluator.ts` `evalLambda` → `lambdaFunction` did `this.eval(body, callEnv)`.
`eval`'s default `inTailPosition=false` meant `evalFunctionCall`'s tail branch
(`return createTailCall(...)`) was never reached for the body; the non-tail
branch recursed. The trampoline existed but starved.

## Relevant Files

- `src/tlisp/types.ts` — `TailCall` interface (moved here); `bodyEval` field on `TLispFunction`.
- `src/tlisp/values.ts` — `createFunction` accepts/attaches `bodyEval`.
- `src/tlisp/evaluator.ts` — imports `TailCall`; `runTrampoline`; `bodyEval` on
  lambda; `evalFunctionCallInternal` uses `bodyEval`; non-tail `else` branch
  trampolines.
- `test/unit/tail-call.test.ts` — deep-recursion regression block (#129).
- `test/unit/evaluator-module-boundaries.test.ts` — trampoline-ownership contract
  updated (TailCall now imported from types.ts).

## Step by Step Tasks

### Task: Make the trampoline flat
**User Story**: As a T-Lisp author writing recursive functions, I want deep tail
recursion to run in constant stack, so that loops expressed as recursion do not
crash the editor.

- Move `TailCall` to `types.ts`; add `TLispFunction.bodyEval`.
- Add `bodyEval` to `evalLambda`; make `lambdaFunction` trampoline it.
- Route `evalFunctionCallInternal` through `bodyEval` for lambdas.
- Extract `runTrampoline`; use it in `eval`, the non-tail call site, and `lambdaFunction`.

**Acceptance Criteria**:
- [ ] `(cd-if 50000)` (if-tail) returns `done` (was: overflow at 5000).
- [ ] `(cd-cond 50000)` (cond-tail) returns `done` (was: overflow at 4500).
- [ ] `(sum-tail 20000 0)` (let-tail accumulator) returns `20000`.
- [ ] Mutual recursion `(is-even 20000)` / `(is-odd 20001)` return `t`.
- [ ] Higher-order builtins still correct: `(mapcar (lambda (x) (* x 2)) '(1 2 3 4))` → `(2 4 6 8)`; `(funcall (lambda (a b) (+ a b)) 3 4)` → `7`.
- [ ] Existing shallow TCO tests still pass (factorial-tail, countdown 100, fib, even-odd).
- [ ] `bun run typecheck` clean; full unit suite green.

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/tail-call.test.ts` (6 original + 5 deep #129)
- `bun test test/unit/evaluator-module-boundaries.test.ts`
- Full unit suite (the evaluator change is on the hottest path)

## Notes

- Async TCO unchanged (sync bug only). A future deep-async-recursion report would
  need the analogous `bodyEval`/trampoline treatment on the async path.
- The CHORE-44 "evaluator.ts owns the trampoline" contract is preserved:
  `isTailCall`/`createTailCall`/`runTrampoline` remain in `evaluator.ts`; only
  the `TailCall` *interface* moved to `types.ts` (a shared-types file) so
  `bodyEval` can be typed.
