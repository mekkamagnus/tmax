# Bug: setq evaluates its variable-name argument (registered as a builtin, not a special form)

## Bug Description
`setq` is one of the most fundamental Lisp forms, but tmax registers it as a
**builtin function** (`src/tlisp/stdlib.ts:899`). Because builtins are ordinary
function calls, the evaluator **pre-evaluates every argument** before invoking
the builtin — including the variable-name argument. This violates the standard
Lisp/Emacs contract that `setq`'s name argument is **not evaluated**.

Two concrete failure modes:
1. **Accumulator/state-mutation idioms break.** `(defvar acc 0) (dolist (x ...) (setq acc (+ acc x)))` evaluates `acc` (the name) to its current value *first*, then tries to use that value as a variable name — so the accumulator never mutates and the loop returns the wrong total.
2. **Silent ghost bindings.** When the current value is a string or symbol, `setq` creates a variable **named after the value** (e.g. `(defvar s "hello") (setq s "world")` creates a variable literally named `hello`), silently misrouting the assignment.

The shipped **fikra** minor mode uses `setq` 16 times to mutate core state
(`fikra-mode-active`, `fikra-claude-process`, `fikra-history-index`, etc.) and
is broken by this. The parity-test design flaw (issue #48, blocked by this one)
exists *because* `evaluator-sync-async-parity.test.ts:57` contains exactly this
broken idiom and both evaluator paths fail identically while the suite reports
green.

## Problem Statement
`setq` must behave as the Emacs/Common-Lisp standard: the name argument is a
**symbol literal, not evaluated**, and the value is assigned to that binding.
Today it evaluates the name, breaking every accumulator idiom and leaking ghost
bindings.

## Solution Statement
Make `setq` a **special form** that is an alias of `set!` (which already has
correct not-evaluated, symbol-only semantics via the `SET` executor):
1. Add `setq` to the `SPECIAL_FORMS` table routing to the existing `SET` executor (`src/tlisp/evaluator/special-form-dispatch.ts`).
2. Remove the eager `setq` builtin from `src/tlisp/stdlib.ts`.
3. Migrate callers that relied on the old **string-name** form (`(setq "name" val)` → `(setq name val)`): the keymap-customization + init-file-cli tests and two doc examples.
4. Add a regression test asserting symbol-name `setq` mutates the correct binding without creating ghosts.

Minimal sound fix recommended by codex review (issue #41 comment).

## Steps to Reproduce
```bash
# 1. Accumulator (should return 10; today it errors / returns 0)
bin/tmax -e '(let ((acc 0)) (dolist (x (list 1 2 3 4)) (setq acc (+ acc x))) acc)'

# 2. Ghost binding (today this creates a variable named "hello")
bin/tmax -e '(defvar s "hello") (setq s "world") s'
```

## Root Cause Analysis
`setq` was added as `interpreter.defineBuiltin("setq", raw(args => ...))` in
`stdlib.ts:899`. Builtin functions receive already-evaluated arguments — the
evaluator evaluates `elements[1]` (the name) before the builtin runs
(`evaluator.ts` function-call path). The builtin then treated whatever value
resulted as a variable name and did `globalEnv.define(name, value)`, accepting
both strings and symbols. `set!` (the correct special form, `SET` executor at
`evaluator.ts:1941` `evalSetBang`) takes `elements[1]` unevaluated, requires it
to be a symbol, and does lexical `env.set`. Routing `setq` to `SET` fixes both
the evaluation order and the binding semantics.

## Relevant Files
- `src/tlisp/evaluator/special-form-dispatch.ts:80` — add `setq` → `SET` next to `set!`.
- `src/tlisp/stdlib.ts:893-924` — remove the eager `setq` builtin (comment + `defineBuiltin`).
- `src/tlisp/evaluator.ts:1941` (`evalSetBang`) — the executor `setq` now uses (unchanged; reference only).
- Callers to migrate (string-name → symbol):
  - `test/integration/keymap-customization.test.ts` (lines 56,57,139,165,166,167,196,201,288,289)
  - `test/integration/init-file-cli.test.ts:107`
  - `docs/adrs/ADR-0006-tlisp-keymap-data-structures.md:178,179`
  - `docs/specs/CHORE-33-perf-benchmark-harness.md:72` (also drop the now-false "setq is an eager builtin" note)
- Verified safe: every shipped `setq` target (`src/tlisp/core/fikra/*`, `examples/init.tlisp.example`) is bound first (5 via `defvar`, 2 via `let`), so routing to `env.set` (which errors if undefined) breaks nothing.

### New Files
- `test/unit/setq-special-form.test.ts` — regression test for the special-form semantics.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Task 1 — Add `setq` as a special form (alias of `set!`)

**User Story**: As a T-Lisp author, I want `(setq name value)` to treat `name` as an unevaluated symbol, so accumulator loops and state mutation work like every other Lisp.

- In `src/tlisp/evaluator/special-form-dispatch.ts`, add to `SPECIAL_FORMS` immediately after the `"set!"` entry: `setq: { category: "sync-only", executor: "SET", minArity: 3, description: "(setq name value) — alias of set!; name is a symbol, not evaluated" }`

**Acceptance Criteria**:
- [ ] `SPECIAL_FORMS` contains a `setq` key routing to executor `SET`, category `sync-only`.
- [ ] `classifyForm("setq")` returns the `SET` metadata.

### Task 2 — Remove the eager `setq` builtin

**User Story**: As a maintainer, I want exactly one definition of `setq` (the special form), so there is no shadowing builtin with the old eager semantics.

- In `src/tlisp/stdlib.ts`, delete the `setq` builtin block (the JSDoc comment at `:893` through the closing `}))` at `:924`).

**Acceptance Criteria**:
- [ ] `rg -n 'defineBuiltin\("setq"' src/tlisp/stdlib.ts` returns nothing.
- [ ] No other code registers a `setq` builtin.

### Task 3 — Migrate string-name callers to symbol form

**User Story**: As a test/doc author, I want my `setq` calls to use the standard symbol form, so they work after `setq` becomes symbol-only.

- Replace every `(setq "*name*" expr)` with `(setq *name* expr)` in the listed test + doc files. Each target is created by a prior `(defkeymap "*name*")` which `globalEnv.define`s the binding under that exact key, and symbol lookup resolves to the same key, so the migration is behavior-preserving.
- In `CHORE-33-perf-benchmark-harness.md`, also remove the parenthetical "Use the quoted variable name because `setq` is an eager builtin in the current interpreter." (no longer true) and use the symbol form.

**Acceptance Criteria**:
- [ ] `rg -n '\(setq\s+"' src/ test/ examples/ docs/` returns nothing.
- [ ] `keymap-customization.test.ts` and `init-file-cli.test.ts` pass.

### Task 4 — Regression test

**User Story**: As a maintainer, I want a test pinning `setq` special-form semantics, so this bug cannot regress.

- Add `test/unit/setq-special-form.test.ts` covering: accumulator via defvar+dolist; let-bound accumulator; ghost-binding absence; symbol-only rejection of a string name; both sync and async evaluator paths.

**Acceptance Criteria**:
- [ ] `(defvar counter 0) (setq counter (+ counter 1)) counter` ⇒ 1 (sync + async).
- [ ] `(let ((acc 0)) (dolist (x (list 1 2 3 4)) (setq acc (+ acc x))) acc)` ⇒ 10.
- [ ] After `(defvar s "hello") (setq s "world")`, no binding named `hello` exists and `s` ⇒ "world".
- [ ] `(setq "x" 1)` raises (name must be a symbol).

### Task 5 — Validate

- Run `bun run typecheck` and the Validation Commands below; all green before commit. Then run the verify-gate Workflow per `issue-burn-down.md`.

## Validation Commands
- `bun run typecheck:src && bun run typecheck:test` — clean types.
- `bin/tmax -e '(defvar counter 0) (setq counter (+ counter 1)) counter'` ⇒ prints `1`.
- `bin/tmax -e '(let ((acc 0)) (dolist (x (list 1 2 3 4)) (setq acc (+ acc x))) acc)'` ⇒ prints `10`.
- `bin/tmax -e '(defvar s "hello") (setq s "world") s'` ⇒ prints `world`.
- `bun test test/unit/setq-special-form.test.ts` — green.
- `bun test test/unit/evaluator-sync-async-parity.test.ts` — still green.
- `bun test test/integration/keymap-customization.test.ts test/integration/init-file-cli.test.ts` — green.

## Notes
- This unblocks #48 (parity-test correctness oracles) via AUTO-UNBLOCK once #41 closes.
- `set!` semantics differ from the old builtin in one way: `env.set` errors if the binding is undefined (the old builtin did `globalEnv.define`, creating a global). Every shipped caller binds first, so this is a non-issue; if a future caller needs top-level implicit creation, use `defvar` first.
