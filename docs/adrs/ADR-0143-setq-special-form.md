# ADR-0143 — setq is a special form, alias of set! (#41)
## Status: Accepted
## Context
`setq` was registered as a builtin **function** (`src/tlisp/stdlib.ts`), so the
evaluator pre-evaluated its variable-name argument before the builtin ran. This
violated the standard Lisp/Emacs contract that the name is an unevaluated
symbol, causing two failure modes: (1) accumulator/state-mutation idioms broke
— `(defvar acc 0) (dolist (x ...) (setq acc (+ acc x)))` evaluated `acc` (the
name) to its value first, so the accumulator never mutated; (2) silent ghost
bindings — when the current value was a string/symbol, `setq` created a
variable named after the value. The shipped **fikra** minor mode uses `setq`
16× and was broken; `evaluator-sync-async-parity.test.ts:57` contained the
broken idiom and reported green only because both evaluator paths failed
identically.

## Decision
Route `setq` to the existing `SET` special-form executor (i.e. an alias of
`set!`) in `SPECIAL_FORMS` (`src/tlisp/evaluator/special-form-dispatch.ts`), and
delete the eager builtin from `src/tlisp/stdlib.ts`. `setq`'s name argument is
now an unevaluated symbol; the value is assigned via lexical `env.set`
(`evalSetBang`). This is the minimal sound fix recommended by codex review — no
new logic, no new abstraction. All string-name callers (`(setq "name" v)` →
`(setq name v)`) were migrated in the keymap-customization + init-file-cli
tests, ADR-0006, CHORE-33, and `bench/micro-tlisp.ts`; every target was
`defkeymap`/`defvar`/`let`-bound first, so behavior is preserved.

## Consequences
- `setq` is now **symbol-only**: a string name raises "must be a symbol"
  (matching `set!`). `(setq "x" 1)` is a TypeError, not a silent ghost binding.
- `setq` on an **undefined** variable now errors (`env.set`) instead of
  silently creating a global (the old `globalEnv.define`). Every shipped caller
  binds first, so there is no regression; future callers that need a fresh
  global use `defvar`.
- Unblocks #48 (parity-test correctness oracle): the broken idiom at
  `evaluator-sync-async-parity.test.ts:57` now returns the correct value (6) on
  both sync and async paths; parity still holds, and #48 can assert correctness.
- Verify-gate: PASS (independent re-run confirmed counter=1, dolist=10,
  ghost=world; regression 8/8; parity 38/38; migrated integration 20/20).

Spec: [BUG-31](../specs/BUG-31-setq-special-form.md). Issue: #41.
