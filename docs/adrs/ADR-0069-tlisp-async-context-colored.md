# ADR 0004: T-Lisp Context-Colored Async Primitives

**Date**: 2026-06-07
**Status**: Accepted

## Context

The tmax daemon runs T-Lisp evaluations synchronously on the Bun event loop. When T-Lisp calls filesystem functions (`read-file-content`, `read-dir`, etc.) using `fs.readFileSync` and `fs.readdirSync`, the entire daemon blocks until the operation completes. No keypresses are processed, no render-state polls answered, no other clients served. This is the Elisp PF-1 pain point documented in `docs/memos/elisp-pain-points.md`: "Emacs runs Elisp in a single thread. Any long-running Elisp code freezes the entire UI."

The challenge was adding async I/O without creating the JavaScript/Python "function coloring" problem — where every I/O primitive needs two names (`read` vs `readAsync`) and the async annotation propagates through the entire call chain, forcing package authors to maintain parallel sync and async APIs.

Languages like Go and Kotlin solve this differently: the same function call yields or blocks depending on execution context, not function name. Clojure uses JVM threads plus `core.async` channels for the same separation.

The spec (`specs/SPEC-012-tlisp-async-primitives.md`) was reviewed before implementation. Key findings that shaped the design:

1. A singleton async-context boolean would leak across concurrent client evaluations — must be per-evaluation.
2. Promise introspection builtins (`promise-value`, `promise-then`) need async-aware function signatures, not the existing sync-only `TLispFunctionImpl`.
3. `async-let` must cover body forms and indirect function calls, not just binding init forms.
4. `write-file-content` should also be context-aware so T-Lisp can observe write completion.

## Decision

### 1. Context-colored I/O — one function name, two behaviors

I/O builtins check a per-evaluation `EvalContext` object. Inside `async-let`, they use `fs.promises.*` and return promise values. Outside `async-let`, they use `fs.*Sync` and return direct values. Package authors call the same function name regardless.

```lisp
;; Sync: blocks, returns string
(let ((content (read-file-content "big.ts"))) ...)

;; Async: yields to event loop, returns resolved string
(async-let ((content (read-file-content "big.ts"))) ...)
```

### 2. Per-evaluation async context via `EvalContext`

Added `EvalContext` interface to `src/tlisp/types.ts` — an object with `asyncMode: boolean` passed through evaluator calls. No global state, no `AsyncLocalStorage`. The context is created per evaluation and propagated through the call chain. Nested `async-let` creates a new context with `asyncMode: true` without mutating the parent.

### 3. Parallel async evaluator path

Added `evalAsync` and `evalAsyncList` to `src/tlisp/evaluator.ts` alongside the existing synchronous `evalList`. The async path handles `async-let`, `let`, `if`, `cond`, `progn`, `lambda`, `defun`, `defmacro`, function calls, and tail calls. It awaits promise values at evaluation boundaries. The sync path is completely unchanged — zero overhead for hot-path key dispatch.

### 4. Promise value type

Added `TLispPromise` to `src/tlisp/types.ts`: `{ type: "promise", value: Promise<TLispValue> }`. Created via `createPromise()` in `src/tlisp/values.ts`. Resolution helpers (`awaitIfPromise`, `awaitPromiseValue`) in `src/tlisp/async.ts`.

### 5. Async-capable function signatures

Added `TLispFunctionImplAsync` type to `src/tlisp/types.ts` and an optional `asyncValue` slot on `TLispFunction`. The evaluator uses the async path when in async mode and an async implementation exists. Sync builtins keep their existing signature.

### 6. Promise introspection builtins

Added to `src/tlisp/stdlib.ts`:
- `promise-resolved-p` — non-blocking check
- `promise-value` — awaits and returns inner value
- `promise-then` — attaches callback, returns new promise

### 7. Context-aware filesystem operations

Modified `src/editor/api/file-ops.ts` so all 10 filesystem functions (`read-file-content`, `read-dir`, `file-exists-p`, `file-stat`, `file-modtime`, `write-file-content`, `file-copy`, `file-remove`, `file-mkdir`, `make-backup-file`) check `EvalContext` and use async implementations when in async mode.

### 8. Async wiring through server and editor

- `src/tlisp/interpreter.ts`: added `executeAsync` method that creates an async `EvalContext` and calls the async evaluator.
- `src/server/server.ts`: `handleEval` calls `executeAsync` so async I/O yields to the event loop.
- `src/editor/editor.ts`: added `executeCommandAsync` for T-Lisp command dispatch.
- `src/editor/handlers/normal-handler.ts` and `mx-handler.ts`: key dispatch uses async command execution.

## Consequences

### Positive

- Daemon stays responsive during I/O-bound T-Lisp evaluations — other clients, render-state polls, and keypresses continue processing while async I/O is pending
- No function coloring — package authors call `read-file-content` and get async behavior automatically inside `async-let`
- Sync code paths are completely unchanged — no Promise wrapping, no overhead on the hot key-dispatch path
- `write-file-content` is no longer fire-and-forget inside `async-let` — T-Lisp can observe write completion
- Indirect calls (functions calling functions calling I/O) inherit async context correctly through the evaluator

### Negative

- Two evaluator paths to maintain — `evalList` (sync) and `evalAsyncList` (async) must stay in sync when new special forms are added
- Async tail-call optimization is not implemented — async `evalAsyncList` evaluates tail calls directly rather than trampolining, which could stack-overflow on deep recursion in async mode
- Same-socket requests still serialize — if client A sends a long async eval, client A's subsequent requests queue behind it (other client sockets are unaffected)
- Filesystem functions gained conditional branching on every call (check `EvalContext`) — negligible overhead but adds complexity to what were simple sync wrappers

### Neutral

- `TLispFunction` now has an optional `asyncValue` slot that most builtins don't populate — the sync `value` remains the primary implementation
- The `EvalContext` interface may grow additional flags beyond `asyncMode` in future phases (e.g., timeout, cancellation)
- CPU-heavy T-Lisp loops still block — this spec addresses I/O blocking only; worker threads for computation are a future phase
