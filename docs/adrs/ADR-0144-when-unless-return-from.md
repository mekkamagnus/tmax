# ADR-0144 — when / unless / return-from special forms (#42)
## Status: Accepted
## Context
The shipped `save.tlisp`, `replace.tlisp`, `dired.tlisp`, and `indent.tlisp`
command modules used `when`, `unless`, and `return-from` — but none of the
three were defined anywhere in the T-Lisp runtime (not in `SPECIAL_FORMS`, no
macro, no stdlib fn). `save-buffer` (bound to `SPC x s`), `query-replace`, and
`dired-up-directory` therefore threw `Undefined symbol` at call time.

`when`/`unless` cannot be builtins: a builtin would eagerly evaluate the body
even when the test is false — the same class of bug as `setq` (BUG-31). They
must be special forms. `return-from` needs nonlocal exit.

## Decision
Add all three as **sync-only special forms** (executors `WHEN`/`UNLESS`/
`RETURN_FROM` in `SPECIAL_FORMS`), so the async path delegates to the sync
executors via the existing `evalListAsync` default arm:

- `when`/`unless` — evaluate the test; if the gate holds, evaluate the body
  forms in order and return the last; otherwise return nil (body NOT evaluated).
- `return-from` — evaluate the optional value (default nil) and throw a
  contained `FunctionReturn(blockName, value)` exception.

`return-from` is implemented as a JS exception caught at the function-body
evaluation boundary: the sync lambda body (`evaluator.ts:1077`) and the async
lambda body (`:1131`) wrap their body eval in `try/catch` and convert
`FunctionReturn` ⇒ `Either.right(value)`; the function-call error catches
(`:1736` sync / `:1840` async) **re-throw** `FunctionReturn` so it is never
mis-converted to a `RuntimeError`; the interpreter's top-level
`execute`/`executeAsync` catch a stray (out-of-function) `return-from` and
surface a clean "no enclosing function" error.

This is the minimal mechanism satisfying every shipped usage — all of which
return from the immediately-enclosing `defun`. Full Common-Lisp named-`block`
semantics (return-from arbitrary depth) is deliberately out of scope.

## Consequences
- `when`/`unless` bodies are no longer eagerly evaluated (codex's concern).
- Both sync and async evaluator paths support all three forms; parity holds.
- `return-from` exits the enclosing defun; a top-level `return-from` is a
  clean eval error rather than a crash.
- Out-of-scope gaps surfaced (separate issues, not this one): `save-buffer`
  still fails later on `set-buffer-modified-p` arg-type / the #45 write path,
  and `dired-up-directory` on `Undefined symbol: file-dirname` — neither is
  `when`/`unless`/`return-from`.
- Unblocks #45 (write-file-content) and contributes to #49 (save-buffer chain)
  via AUTO-UNBLOCK.

Spec: [BUG-32](../specs/BUG-32-when-unless-return-from.md). Issue: #42.
Verify-gate: PASS (13/13 regression; 38/38 parity; daemon `when`=1, `unless`=1,
`return-from`=9).
