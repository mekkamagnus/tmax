# Feature: T-Lisp Async Primitives for Non-Blocking Operations

## Feature Description

Add async primitives to T-Lisp so I/O operations can yield to the daemon's event loop instead of freezing the editor. This addresses PF-1 from the Elisp pain points survey: Emacs freezes when Elisp runs blocking work, and tmax has the same vulnerability today.

The design follows a context-colored approach inspired by Go and Kotlin: there is one set of I/O function names, not parallel sync and async APIs. Inside an async evaluation context, existing I/O functions such as `read-file-content` and `read-dir` use async implementations. Outside that context, they keep their current synchronous behavior.

This spec does not attempt to solve CPU-heavy T-Lisp loops. Long-running computation still needs explicit yielding or worker threads in a future phase. This spec focuses on I/O blocking.

## User Story

As a T-Lisp package author
I want to perform I/O operations without freezing the editor
So that the TUI stays responsive while my code waits on filesystem work

## Problem Statement

Today every T-Lisp evaluation runs synchronously to completion on the Bun event loop. When T-Lisp calls `read-dir` on a large directory, `read-file-content` on a big file, or another synchronous filesystem function, the entire daemon can freeze. Keypresses are not processed, render-state polls are not answered, and other clients can stall.

The current file I/O functions (`read-file-content`, `file-exists-p`, `read-dir`, etc.) use sync filesystem APIs such as `fs.readFileSync`, `fs.readdirSync`, and `fs.statSync`. `write-file-content` is already async internally, but it is fire-and-forget: T-Lisp has no way to await completion or observe failure.

## Solution Statement

### Design Principle: No Function Coloring

T-Lisp should avoid the JavaScript/Python "colored function" problem where every I/O primitive has two names and asyncness spreads through the whole API surface (`read` vs `readAsync`, `connect` vs `connectAsync`). Package authors should call the same function name. The evaluation context decides whether the function blocks or yields.

Example:

```lisp
;; Outside async-let: blocks, returns string directly.
(let ((content (read-file-content "big.ts")))
  (length content))

;; Inside async-let: yields to the event loop, then binds the resolved string.
(async-let ((content (read-file-content "big.ts")))
  (length content))
```

The function name is identical. `async-let` establishes the async context.

### Runtime Model

1. `async-let` establishes an async evaluation context for binding init forms and all body forms.
2. Existing I/O builtins check that context.
3. In sync context, they return direct `TLispValue` results as they do today.
4. In async context, they return `promise` values backed by `Promise<TLispValue>`.
5. The async evaluator awaits promises at evaluation boundaries so normal T-Lisp code receives resolved values where appropriate.
6. Promise values remain available for explicit advanced control through introspection builtins.

## Pending Decisions

These decisions should be approved before implementation because they change observable editor behavior.

### Decision 1: What Does `async-let` Return?

**Recommended:** `async-let` should be an awaiting expression. It returns the final body value after all awaited work completes.

Rationale: This keeps T-Lisp expression semantics simple. Code using `async-let` behaves like `let`, except I/O can yield while resolving. Package authors do not need to manage jobs for normal file I/O workflows.

Alternative: `async-let` starts a background task and immediately returns a promise or job handle.

Cost of alternative: This is better for fire-and-forget background work, but it complicates normal code because callers must decide when and how to join, cancel, or observe task failure.

### Decision 2: How Should Async Key Commands Complete?

**Recommended:** key dispatch should await command completion for the originating request, but render-state and other clients must remain responsive while the command is pending.

Rationale: This preserves the existing command mental model: a key command either finishes or fails. Responsiveness comes from server scheduling and async I/O yields, not from pretending the command completed before it did.

Alternative: key dispatch returns immediately with a task id and command completion is reported later through status events.

Cost of alternative: This enables true background commands but requires job lifecycle UI, cancellation, completion notifications, and error routing. That belongs in a later background-job RFC.

## Relevant Files

### Existing Files to Modify

- `src/tlisp/types.ts` — Add `promise` value type and async-capable function implementation types.
- `src/tlisp/values.ts` — Add `createPromise` factory and `isPromise` type guard.
- `src/tlisp/evaluator.ts` — Add per-evaluation async context, `async-let`, and async evaluator paths for special forms and function calls.
- `src/tlisp/interpreter.ts` — Add `executeAsync` and `evalAsync` entry points while keeping sync `execute` and `eval`.
- `src/tlisp/stdlib.ts` — Add promise introspection builtins and support async-capable builtin dispatch.
- `src/editor/api/file-ops.ts` — Make filesystem functions context-aware.
- `src/server/server.ts` — Schedule async eval/key requests so other clients and render-state requests can progress while async I/O is pending.
- `src/editor/editor.ts` — Add async-compatible key dispatch where T-Lisp command execution can yield.

### New Files

- `src/tlisp/async.ts` — Per-evaluation async context, promise helpers, and resolution helpers.

## Implementation Plan

### Phase 1: Promise Type and Async Function Signatures

Add the `promise` value type and broaden runtime function signatures to support sync and async implementations.

Do not use a process-wide singleton boolean for async context. Async state must be scoped to an evaluation. A global flag would leak across awaits: while client A is inside `async-let`, client B could enter the evaluator and accidentally inherit async mode.

Preferred implementation options:

- Pass an `EvalContext` object through evaluator calls.
- Or use `AsyncLocalStorage` if Bun support is acceptable in this codebase.

The context must support nesting. Entering nested `async-let` should preserve and restore the previous context reliably.

### Phase 2: Full Async Evaluator Path

Add async counterparts for the evaluator paths that can execute user code:

- Literal and symbol evaluation.
- `quote`, `if`, `cond`, `progn`, `let`, `lambda`, `defun`, `defmacro`, and module forms where applicable.
- Function argument evaluation.
- Function call dispatch.
- Lambda body evaluation.
- Optional parameter default evaluation.
- Tail-call trampoline behavior or a documented temporary limitation for async tail calls.

`async-let` must apply to binding init forms and body forms, not only bindings. The following should yield correctly:

```lisp
(async-let ()
  (read-file-content "big.ts"))
```

And so should indirect calls:

```lisp
(defun load-big-file (path)
  (read-file-content path))

(async-let ((content (load-big-file "big.ts")))
  (length content))
```

The synchronous evaluator path remains available and should not wrap values in promises.

### Phase 3: Context-Aware I/O

Modify filesystem functions to check the current evaluation context:

- `read-file-content`
- `read-dir`
- `file-exists-p`
- `file-stat`
- `file-modtime`
- `write-file-content`
- `file-copy`
- `file-remove`
- `file-mkdir`
- `make-backup-file`

In sync context, preserve current behavior and return direct values.

In async context, use async filesystem APIs and return promise values. This includes writes and copy/remove/mkdir operations because they can block or fail in user-visible ways. `write-file-content` should no longer be fire-and-forget inside async context; it should resolve to `nil` on success or surface a T-Lisp runtime error on failure.

Directory reads need special care: the current `read-dir` performs `readdirSync` and then `statSync` for each entry. The async path should avoid serial `await` per entry for large directories. Use bounded concurrency or `Promise.all` with a clear cap if needed.

### Phase 4: Promise Introspection

Add:

- `promise-resolved-p` — non-blocking boolean check.
- `promise-value` — await and return the inner value.
- `promise-then` — attach a callback and return a new promise.

These builtins require async-capable builtin signatures. They cannot be implemented as ordinary current `TLispFunctionImpl` functions because those return `Either<AppError, TLispValue>` synchronously.

### Phase 5: Server Scheduling

Wire `handleEval` and T-Lisp key dispatch through async interpreter entry points.

The current socket loop awaits each request before reading and responding to later requests from the same socket. That means a TUI client that sends an async eval followed by render-state polling on the same connection may still appear blocked. The implementation must choose one of these scheduling approaches before claiming same-client responsiveness:

- Allow concurrent in-flight requests per socket and correlate responses by JSON-RPC id.
- Use a separate connection for render-state polling.
- Return a job handle for long async evals and report completion separately.

Until that scheduling work is done, the guaranteed responsiveness target is: other clients and other sockets remain responsive while async I/O is pending.

## Step by Step Tasks

### Step 1: Add Promise Value Type

- Add `promise` to `TLispValueType`.
- Add `TLispPromise` with shape:
  ```ts
  interface TLispPromise extends TLispValue {
    type: "promise";
    value: Promise<TLispValue>;
    resolved: boolean;
    result?: TLispValue;
    error?: AppError;
  }
  ```
- Add `createPromise(promise: Promise<TLispValue>): TLispPromise`.
- Add `isPromise(value: TLispValue): value is TLispPromise`.
- Ensure promise resolution records `resolved`, `result`, and `error`.

### Step 2: Add Async-Aware Function Types

- Keep `TLispFunctionImpl` for sync builtins and existing code.
- Add `TLispFunctionImplAsync = (args: TLispValue[], context: EvalContext) => Promise<Either<AppError, TLispValue>>`.
- Allow `TLispFunction` to hold either sync or async implementation, or add a separate async function value type if that fits local patterns better.
- Update evaluator function dispatch so the async evaluator can call both sync and async functions.
- Keep the sync evaluator rejecting async-only functions with a clear runtime error.

### Step 3: Add Per-Evaluation Context

- Add `EvalContext` with at least:
  - `asyncMode: boolean`
  - `sourceName?: string`
  - any diagnostic metadata needed for error spans
- Pass context through evaluator calls, or implement equivalent per-async-chain storage.
- Add helpers:
  - `withAsyncMode<T>(context, fn)`
  - `isAsyncMode(context)`
  - `awaitIfPromise(value, context)`

### Step 4: Add `async-let`

Syntax:

```lisp
(async-let ((var1 (read-file-content "foo.ts"))
            (var2 (read-dir "src/")))
  body...)
```

Evaluation:

1. Create a child environment.
2. Enter async mode for the full `async-let`.
3. Evaluate binding init forms through the async evaluator.
4. Await promise values before binding.
5. Evaluate body forms through the async evaluator.
6. Await promise body result before returning.
7. Restore prior context on exit, including on errors.

### Step 5: Make I/O Functions Context-Aware

- Sync context: preserve current behavior exactly.
- Async context: use async filesystem APIs and return promise values.
- Convert filesystem exceptions into T-Lisp runtime errors with source context where available.
- Preserve current nil-on-missing behavior where that is existing API behavior, unless the command already expects an error.

### Step 6: Add Promise Builtins

- `promise-resolved-p`
- `promise-value`
- `promise-then`

`promise-value` and `promise-then` run through the async evaluator path. Calling them from sync evaluation should produce a clear error telling the author to use `async-let`.

### Step 7: Wire Async Through Interpreter and Server

- Add `evalAsync(expr, env?, context?)`.
- Add `executeAsync(source, env?, sourceName?)`.
- Update `handleEval` to use `executeAsync`.
- Add async key dispatch for T-Lisp commands.
- Implement or explicitly defer same-socket concurrent scheduling based on the approved pending decision.

### Step 8: Write Tests

`test/unit/tlisp-async.test.ts`:

- Promise value creation and resolution.
- `async-let` evaluates I/O calls with async context active.
- `async-let` resolves promise values before binding.
- `async-let` awaits body I/O, not only binding I/O.
- Indirect I/O through a function called inside `async-let` uses async context.
- `async-let` passes non-promise values through unchanged.
- I/O functions behave synchronously outside `async-let`.
- `promise-resolved-p`, `promise-value`, and `promise-then` work in async context.
- Calling await-capable promise builtins in sync context errors clearly.
- Nested `async-let` preserves context.
- Promise rejection surfaces as T-Lisp runtime error with source location.

Integration tests:

- Other client/socket can send `ping` while an async eval is pending.
- TUI render-state responsiveness matches the approved scheduling decision.
- Same function name yields or blocks based on context.
- Existing sync commands still behave as before.

### Step 9: Run Validation Commands

See Validation Commands section.

## Testing Strategy

### Unit Tests

- Promise type creation and identity.
- Async context is per-evaluation and cannot leak between concurrent evaluations.
- `async-let` sets and restores async mode correctly.
- I/O functions return promise values when async context is active.
- I/O functions return direct values when async context is inactive.
- `async-let` resolves binding and body promises before returning.
- `promise-resolved-p` returns correct state.
- `promise-value` awaits and returns inner value in async context.
- Sync evaluator path is unchanged.

### Integration Tests

- Daemon handles pending async eval plus ping from another socket without blocking.
- Same-client render-state behavior matches approved scheduling decision.
- Multiple clients can send requests concurrently without async context leakage.

### Edge Cases

- `async-let` with no I/O binds immediately.
- Nested `async-let` restores context correctly.
- Promise rejection surfaces as T-Lisp error with source location.
- `async-let` inside a function called from sync context propagates async mode to the callee.
- I/O function called outside any `async-let` behaves identically to current behavior.
- Async write failure is observable.
- Async directory listing handles entries that disappear between `readdir` and `stat`.

## Acceptance Criteria

1. `async-let` with `read-file-content` yields to the event loop without blocking other sockets.
2. The same `read-file-content` call outside `async-let` blocks synchronously as it does today.
3. Async mode is scoped per evaluation and cannot leak between clients.
4. `async-let` awaits promise values in both bindings and body forms.
5. I/O called indirectly through a function inside `async-let` uses async I/O.
6. `write-file-content` can be awaited inside async context and surfaces failures.
7. Existing sync T-Lisp code runs with no promise wrapping in sync paths.
8. Same-client render-state responsiveness is either implemented or explicitly scoped out according to the approved scheduling decision.
9. All existing tests pass unchanged unless a test encodes the old fire-and-forget write behavior.
10. `typecheck:src` and `typecheck:test` pass clean.
11. `bun run build` succeeds.
12. Promise rejection surfaces as a T-Lisp runtime error with source location.

## Validation Commands

- `bun run typecheck:src` — TypeScript compilation clean.
- `bun run typecheck:test` — Test TypeScript clean.
- `bun run typecheck` — Full typecheck.
- `bun test test/unit/tlisp-async.test.ts` — New async tests pass.
- `bun test test/unit/` — All unit tests pass.
- `bun test` — Full test suite passes.
- `bun run build` — Build succeeds.

## Notes

**Why context-colored instead of function-colored?** Two versions of every I/O function force asyncness to propagate through API names and call chains. T-Lisp keeps one function name and lets evaluation context determine blocking behavior.

**Why not make everything async by default?** The synchronous evaluator is the hot path for editing commands and tests. Keeping it sync avoids promise overhead where no I/O yielding is needed.

**Why not use a singleton async flag?** A singleton works only until the first `await`. Once the event loop can process another request, that other request can observe or mutate the same flag. Async context must be per evaluation.

**Why include writes and copy/remove/mkdir now?** Reads are not the only blocking filesystem operations. Writes and copies can block on large files or slow disks, and fire-and-forget writes are already a correctness problem because T-Lisp cannot observe failure.

**Future work not in this spec:**

- Background job handles and cancellation.
- `promise-all` / `promise-race` for concurrent async operations.
- `set-timeout` / `set-interval` T-Lisp builtins for scheduled evaluation.
- Worker threads for CPU-heavy T-Lisp computation.
- Async process execution.
