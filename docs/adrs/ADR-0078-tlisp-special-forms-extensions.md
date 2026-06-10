# T-Lisp Special Forms Extensions

## Status

Accepted

## Context

Building the markdown major mode (ADR/SPEC-018) required T-Lisp code to express sequential variable bindings, iteration over lines, and conditional formatting. The existing special forms — `let`, `if` (mandatory else), `progn` — could not express these without awkward workarounds (nested `let`, helper functions for loops, dummy else branches).

Two categories of gap appeared:

1. **Missing control flow**: no sequential binding (`let*`), no general loop (`while`), no list iteration (`dolist`).
2. **Rigid arity**: `if` required exactly three args (forcing a dummy else when none was wanted); `substring` required exactly three args (forcing a length computation to omit the end).

Both gaps blocked markdown mode and would block every future rich major mode for the same reasons.

## Decision

Extend the evaluator with four new special forms and relax the arity rules on two existing ones.

**New special forms:**

- `let*` — sequential binding. Each binding sees the previous ones, mirroring Scheme/Emacs Lisp semantics. Used when a binding depends on a computation that uses an earlier binding.
- `while` — pre-test loop with a condition. Exits when the condition evaluates to nil.
- `dolist` — list iteration. Binds a variable to each element of a list in order, evaluates a body.

**Relaxed arity:**

- `if` now accepts 2 or 3 args. Two-arg `if` returns nil when the condition is false (no else branch). Three-arg form is unchanged.
- `substring` now accepts 2 or 3 args. Two-arg form returns the suffix from `start` to end of string. Three-arg form is unchanged.

**Supporting additions** (not special forms, just new stdlib functions used by markdown mode): `string-match`, `string-split`, `string-trim`, `format`, `buffer-get-line`.

The evaluator change is concentrated in `src/tlisp/evaluator.ts`. Existing code that passed exactly three args to `if` or `substring` continues to work unchanged.

## Consequences

- **Rich major modes are writable in pure T-Lisp.** Markdown mode's folding, formatting, and navigation can be expressed directly. Same applies to future modes that need loop-over-lines logic.
- **Source compatibility preserved.** Three-arg `if` and three-arg `substring` callers see no behavior change. No migration needed.
- **The arity-relaxation principle is now in the language.** Future special forms and stdlib functions can be designed with optional trailing args instead of forced parameters. This makes T-Lisp idioms closer to Emacs Lisp, lowering the cognitive cost for Emacs users coming to tmax.
- **Tradeoff: more cases in the evaluator.** Each new special form is one more branch the evaluator must handle, and tail-call optimization has to be re-verified for `while` and `dolist`. The evaluator's test suite covers these; future special forms should land with their own tests at the same time.
