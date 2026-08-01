# Bug: when / unless / return-from missing — shipped save/replace/dired/indent commands throw "Undefined symbol"

## Bug Description
`when`, `unless`, and `return-from` are used by four shipped core command modules
but are **not defined anywhere** in the T-Lisp runtime (absent from `SPECIAL_FORMS`,
no macro, no stdlib fn):

- `src/tlisp/core/commands/save.tlisp:8,10,11` — `(unless path … (return-from save-buffer))`, `(when (file-exists-p path) …)`
- `src/tlisp/core/commands/replace.tlisp:8,10` — `(when (null matches) … (return-from query-replace))`
- `src/tlisp/core/commands/dired.tlisp:26` — `(when parent (dired parent))`
- `src/tlisp/core/commands/indent.tlisp:8` — `(when rules …)`

As a result `save-buffer` (bound to SPC x s, documented in the manual), `query-replace`,
and `dired-up-directory` all throw `Undefined symbol` at call time.

## Problem Statement
Three standard control-flow forms must exist and every shipped command that uses
them must execute without an undefined-symbol error.

## Solution Statement
Add all three as **special forms** (not eager builtins — the body must not be
pre-evaluated; this is the same class of bug as BUG-31/`setq`):

1. **`when`** (`(when test body...)`) — if `test` is truthy, evaluate the body forms and return the last; otherwise return nil.
2. **`unless`** (`(unless test body...)`) — if `test` is nil/false, evaluate the body forms and return the last; otherwise return nil.
3. **`return-from`** (`(return-from name [value])`) — early exit from the enclosing function, returning `value` (default nil). Implemented as a contained `FunctionReturn` exception thrown by the form and caught at the function-body evaluation boundary (sync `eval` at evaluator.ts:1049 and async `evalAsync` at :1094). This is the minimal mechanism that satisfies every shipped usage (all of which return from the immediately-enclosing `defun`); it is not full Common-Lisp arbitrary-block semantics.

The function-call error catches (evaluator.ts:1694 sync / :1796 async) re-throw
`FunctionReturn` so it is never mis-converted to a RuntimeError; a top-level
(out-of-function) `return-from` surfaces as a clean eval error.

Codex review (APPROVE-WITH-CONCERNS) honored: special forms (not eager fns);
both evaluator paths covered; false/skipped + multi-form bodies; real shipped
callers exercised (query-replace empty-match, dired-up-directory, indent), not
just `save`. Note: the audit's "`dired-up-parent`" name was wrong — the real
caller is `dired-up-directory` / the `(when parent (dired parent))` site.

## Steps to Reproduce
```bash
bin/tmax -e '(when t 1)'            # today: Undefined symbol: when ; should be 1
bin/tmax -e '(unless nil 1)'        # today: Undefined symbol: unless ; should be 1
bin/tmax -e '(progn (defun f () (return-from f 9) 1) (f))'  # today: Undefined symbol; should be 9
```

## Root Cause Analysis
The forms were never registered. `when`/`unless` cannot be builtins (a builtin
would eagerly evaluate the body even when the test is false — the BUG-31 pattern),
so they must be special forms. `return-from` needs nonlocal exit; the evaluator's
function-body evaluation at evaluator.ts:1049 (`this.eval(body, callEnv)`) and
:1094 (`this.evalAsync(body, callEnv, context)`) are the natural catch boundary.

## Relevant Files
- `src/tlisp/evaluator/special-form-dispatch.ts` — add `when`/`unless`/`return-from` to `SPECIAL_FORMS` (sync-only, executors WHEN/UNLESS/RETURN_FROM).
- `src/tlisp/evaluator.ts` — add `FunctionReturn` class; `evalWhen`/`evalUnless`/`evalReturnFrom`; case dispatches in `evalList`; wrap body eval at :1049 (sync) + :1094 (async) with a `FunctionReturn` catch; re-throw `FunctionReturn` from the function-call catches at :1694 + :1796.
- `src/tlisp/interpreter.ts` — top-level `execute`/`executeAsync` catch stray `FunctionReturn` → clean error.

### New Files
- `test/unit/when-unless-return-from.test.ts` — regression covering all three forms (sync + async), false/skipped + multi-form bodies, unmatched/top-level return-from erroring, plus the real shipped command paths (save-buffer, query-replace empty-match, dired-up, indent).

## Step by Step Tasks
### Task 1 — `FunctionReturn` exception + special-form table entries
**User Story**: As an implementer, I want a contained nonlocal-exit signal and the forms registered, so when/unless/return-from dispatch correctly.
- Add exported `FunctionReturn` class (`name: string`, `value: TLispValue`) extending `Error`.
- Add to `SPECIAL_FORMS`: `when`, `unless`, `return-from` (category sync-only, executors WHEN/UNLESS/RETURN_FROM, minArity 2).
**AC**: `classifyForm("when"/"unless"/"return-from")` returns the metadata.

### Task 2 — executors + dispatch
**User Story**: As a T-Lisp author, I want the three forms to evaluate correctly.
- `evalWhen`: eval test; if truthy, eval each body form, return last; else nil.
- `evalUnless`: eval test; if nil/false, eval body, return last; else nil.
- `evalReturnFrom`: eval the (optional) value arg (default nil); throw `new FunctionReturn(nameArg, value)`.
- Add `case "WHINE"/"UNLESS"/"RETURN_FROM"` dispatches in `evalList`.

### Task 3 — function-body catch + re-throws
**User Story**: As an implementer, I want return-from to exit the enclosing function and not be swallowed.
- Wrap `this.eval(body, callEnv)` (:1049) in try/catch → `FunctionReturn` ⇒ `Either.right(e.value)`, re-throw others.
- Wrap `this.evalAsync(body, callEnv, context)` (:1094) in `try { return await … } catch` → same.
- Add `if (err instanceof FunctionReturn) throw err;` atop the catches at :1694 and :1796.
- Top-level `execute`/`executeAsync` (interpreter.ts): catch stray `FunctionReturn` ⇒ eval error "return-from: no enclosing function".

### Task 4 — regression test (real shipped paths)
**AC**:
- [ ] `(when t 1)` ⇒ 1; `(when nil 1)` ⇒ nil; `(when t 1 2 3)` ⇒ 3 (multi-form body).
- [ ] `(unless nil 1)` ⇒ 1; `(unless t 1)` ⇒ nil.
- [ ] `(progn (defun f () (return-from f 9) 1) (f))` ⇒ 9 (early exit; body after return-from not evaluated).
- [ ] `(return-from no-such 1)` at top level ⇒ eval error (no crash).
- [ ] sync + async paths agree.
- [ ] `bin/tmax -e '(save-buffer "/tmp/bug32.txt")'` no longer throws Undefined symbol (writes the file).
- [ ] query-replace empty-match path, dired-up-directory, indent run without Undefined symbol.

### Task 5 — Validate
typecheck clean + Validation Commands green + verify-gate PASS.

## Validation Commands
- `bun run typecheck:src && bun run typecheck:test`
- `bin/tmax -e '(when t 1)'` ⇒ 1 ; `(unless nil 1)` ⇒ 1 ; `(progn (defun f () (return-from f 9) 1) (f))` ⇒ 9
- `bun test test/unit/when-unless-return-from.test.ts`
- `bun test test/unit/evaluator-sync-async-parity.test.ts` — still green.

## Notes
- Unblocks #45 (write-file-content) and #49 (save-buffer chain) via AUTO-UNBLOCK once #42 closes.
- `return-from` supports early-return from the enclosing defun only (all shipped usages). Full CL named-block semantics (`(block name …)`, return-from arbitrary depth) is out of scope.
