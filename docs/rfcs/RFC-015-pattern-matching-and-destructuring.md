# RFC-015: Pattern Matching (`match`) and Destructuring (`destructuring-let`)

**Date:** 2026-06-15
**Status:** Proposed
**Author:** Mekael Turner

**Depends on:** the existing macro system with quasiquote (`src/tlisp/evaluator.ts:2006`, `evalDefmacro`), and the stdlib list/string predicates already present (`mapcar`, `filter`, `car`/`cdr` family, `string=`, `hashmap-get`).

**Motivated by:** `docs/memos/elisp-pain-points.md` LD-3 ("No pattern matching… make the language feel modern"). This is Tier 1 from the "could T-Lisp gain these" design discussion — highest value, lowest cost, pure macro-layer work, zero interpreter changes required for the core feature.

## Summary

Two T-Lisp language features, shipped as pure macros that desugar to existing forms:

1. **`match`** — structural pattern matching over the existing tagged values (numbers, strings, symbols, lists, nil, `_` wildcard, literal-equality, and list-head/element patterns).
2. **`destructuring-let`** — bind names to parts of a list value in one form, desugaring to nested `let` + `car`/`cadr`.

Both operate on the existing closed value-tag set (`types.ts` `TLispValueType`). No new value types, no new evaluator code paths (except a single `&rest` macro-parameter prerequisite), no static analysis.

## Feature Description

T-Lisp currently dispatches on values through nested `cond` / `if` chains and accesses list/struct fields through chains of `car`/`cdr`/`hashmap-get`. This works but is verbose and error-prone — exactly the pain Elisp developers report (LD-1, LD-3). This spec adds two language features as **pure T-Lisp macros** that desugar to existing forms:

1. **`match`** — structural pattern matching over the existing tagged values (numbers, strings, symbols, lists, nil, `_` wildcard, literal-equality, and list-head/element patterns).
2. **`destructuring-let`** — bind names to parts of a list value in one form, desugaring to nested `let` + `car`/`cadr`.

Both features operate on the **existing closed value-tag set** (`types.ts` `TLispValueType`). They introduce no new value types, no new evaluator code paths, and no static analysis. They are *dynamic* pattern matching: failures surface at runtime, like the rest of T-Lisp.

### What this is NOT

- Not algebraic data types. There is no `deftype`/sum-type declaration here (that's a deferred Tier 2 spec).
- Not type classes or static typing.
- Not exhaustiveness checking. A `match` with no matching clause signals a runtime error; the macro does not statically know the universe of variants.

These boundaries are deliberate (see `elisp-pain-points.md` LD-4: "Don't need a full type system"). This spec delivers the *ergonomic* win without the *type-system* cost.

## Prerequisites (must be verified before implementation)

1. **Variadic macros (`&rest`/`&body`).** `evalDefmacro` (`evaluator.ts:2062`) currently rejects any call where `args.length !== paramList.length`. A clean `match` is `(match expr clause1 clause2 …)` — variadic in clauses. **This is the one interpreter change the spec requires**, and it is the gating prerequisite. `destructuring-let` is fixed-arity and needs no such change.

   - Pre-check: confirm `evaluator.ts:2062` is the only arity enforcement point for macros and that changing it does not affect function (`defun`) arity handling.

## User Stories

### Story 1: Dispatch on editor mode

As a T-Lisp author writing a command that behaves differently per mode,
I want to write
```lisp
(match (editor-get-mode)
  ("normal"  (do-normal-thing))
  ("insert"  (do-insert-thing))
  (_         (message "mode not handled")))
```
instead of a four-line `cond` with three `(string= …)` calls,
so that the dispatch is readable and the fallthrough is obvious.

### Story 2: Pull fields out of a list

As an author parsing a returned list `(line column)`,
I want to write
```lisp
(destructuring-let (line col) (cursor-position)
  (message "at line %d col %d" line col))
```
instead of
```lisp
(let ((pos (cursor-position)))
  (let ((line (car pos)) (col (cadr pos)))
    (message "at line %d col %d" line col)))
```
so that field binding is one expression, not three.

### Story 3: Match a list head

As an author handling a parsed token list `(:line 10 "text")`,
I want to write
```lisp
(match token
  (("line" n text)  (handle-line n text))
  (("word" text)    (handle-word text))
  (nil              (message "end"))
  (_                (message "unknown token")))
```
so that the shape of the data drives the branch.

## Problem Statement

- T-Lisp has `cond` and `if`, but no `match`. Dispatch on a value's structure requires hand-written predicates (`listp`, `string=`, `eq`) and manual field extraction on every branch.
- T-Lisp has `let`, but no destructuring. Binding the elements of a returned list requires either a `let*` chain or `car`/`cadr`/`caddr` calls inline.
- Neither feature requires new runtime capability — only macro expansion. The macro system already supports quasiquote and unquote (`test/unit/macros.test.ts`).

## Solution Statement

Two new T-Lisp macros, shipped as a stdlib module:

1. **`std/pattern`** — a new module containing `match`, `destructuring-let`, and any helpers. Loaded the same way as `std/strings` / `std/lists` (`src/tlisp/stdlib-assets.ts`, `STANDALONE_STDLIB_MODULES`).
2. **`&rest` macro parameters** — extend `evalDefmacro` so that a trailing `&rest <name>` in the parameter list collects all remaining arguments into a list bound to `<name>`. This is the only TypeScript change.

### Macro shape

```lisp
;; match
(match <expr>
  (<pattern> <body>)
  (<pattern> <body>)
  ...)
```

Patterns supported (Tier 1 subset — deliberately small):

| Pattern | Matches | Example |
|---------|---------|---------|
| `_` | anything (wildcard) | `_` |
| `nil` | nil | `nil` |
| `<number-literal>` | that number (numeric equality) | `0`, `42` |
| `<string-literal>` | that string (`string=`) | `"normal"` |
| `<symbol>` (not `_`/`nil`) | binds the value to that name | `x` |
| `(<p1> <p2> …)` | a list whose elements match `p1`,`p2`,… in order | `(a b c)` |

Out of scope for Tier 1 (deferred): hashmap patterns, `&rest` inside list patterns, guard expressions (`(pattern :when expr)`), or-patterns (`(or p1 p2)`).

```lisp
;; destructuring-let
(destructuring-let (<p1> <p2> …) <expr> <body>)
;; expands to nested let + car/cdr/…, binding p1..pN to elements of <expr>'s value
```

### Expansion sketches (implementation may refine)

```lisp
;; (match expr ("normal" A) (_ B))
;; →
(let ((%%target expr))
  (cond
    ((string= %%target "normal") A)
    (t B)))

;; (match expr (("line" n text) A) (nil B))
;; →
(let ((%%target expr))
  (cond
    ((and (listp %%target)
          (string= (car %%target) "line")
          (>= (length %%target) 3))     ; bind n, text via nested let
     (let ((n (cadr %%target)) (text (caddr %%target))) A))
    ((nilp %%target) B)
    (t (error "match: no clause matched %s" %%target))))
```

`destructuring-let` is a special case of the same list-pattern logic applied to a fixed arity, no cond.

## Architecture Constraints

| Area | Governing Doc | Rule |
|------|--------------|------|
| T-Lisp ownership | `src/tlisp/Claude.md` | All pattern/destructuring logic lives in T-Lisp. The only TypeScript touch is `&rest` support in `evalDefmacro`. No new primitives. |
| Functional error handling | `rules/tlisp.md`, `rules/functional-programming.md` | Macro expansion errors return `Either.left(EvalError)` like existing macro arity errors; no `throw`. |
| Surgical changes | `CLAUDE.md` §3 | Touch only `evaluator.ts` (the `&rest` prerequisite), `stdlib-assets.ts` (new module), and new test files. Do not refactor `evalDefmacro` beyond adding the `&rest` branch. |
| Type safety | `learnings.md` | `bun run typecheck` must pass with zero errors — the `&rest` change touches typed evaluator code. |

## Relevant Files

### Existing Files to Modify

| File | Change | Constraints |
|------|--------|-------------|
| `src/tlisp/evaluator.ts` | In `evalDefmacro` (~line 2046): detect a trailing `&rest <sym>` in `paramList`. Bind the rest parameter to a `createList(remainingArgs)` instead of rejecting. Fixed-arity macros behave exactly as today; only the presence of `&rest` changes behavior. | Do NOT touch `defun` arity handling. Do NOT change the fixed-arity path. Preserve the existing arity error message for fixed-arity macros. |
| `src/tlisp/stdlib-assets.ts` | Add a `"std/pattern"` entry to `STANDALONE_STDLIB_MODULES` containing the `match` and `destructuring-let` macros. | Follow the `std/strings` module shape (`defmodule` + `export`). |

### New Files

| File | Purpose | Constraints |
|------|---------|-------------|
| `test/unit/pattern-matching.test.ts` | Bun tests for `match` and `destructuring-let` macro expansion + evaluation. | Follow `test/unit/macros.test.ts` harness style (`TLispParser` + `createEvaluatorWithBuiltins`). |

## Implementation Phases

### Phase 0: Prerequisite — `&rest` in `defmacro`

**Constraint checkpoint:** Before starting, verify:
- [ ] `evaluator.ts:2062` (`if (args.length !== paramList.length)`) is the only arity enforcement for macros.
- [ ] The `paramList` validation loop (`evaluator.ts:2047`) still rejects non-symbol params; `&rest` itself must not be treated as a parameter name.

#### Step 1: Parse `&rest` in the macro parameter list

**User story:** As a macro author, I want to write `(defmacro match (expr &rest clauses) …)` and have `clauses` bound to a list of all arguments after `expr`.

**Description:** In `evalDefmacro`, after extracting `paramList`, scan for a `&rest` symbol. If present, it must be followed by exactly one symbol (the rest-param name) and be the second-to-last element. Store the split point. Validation errors (e.g., `&rest` not followed by a symbol, `&rest` appearing twice) return `EvalError` with the same shape as the existing parameter-validation errors.

**MUST:**
- `(defmacro foo (a &rest b) …)` defines a macro callable with ≥1 args; `b` is a list value inside the body.
- `(defmacro foo (a b) …)` (no `&rest`) behaves exactly as today — identical arity error if called with wrong count.
- `&rest` is only honored in `defmacro`, never `defun`.

**MUST NOT:**
- Change `defun` parameter handling.
- Allow `&rest` mid-list (it is trailing-only).

**Acceptance criteria:**
- [ ] `(defmacro my-list (&rest xs) \`(list ,@xs))` then `(my-list 1 2 3)` returns `(1 2 3)`.
- [ ] `(defmacro needs-two (a b) …)` still errors on 1 or 3 args with the existing message.
- [ ] `bun run typecheck:src` passes.

### Phase 1: `destructuring-let` (fixed-arity, no cond)

**Constraint checkpoint:** Before starting, verify:
- [ ] Phase 0 merged and tests green.

#### Step 1: Implement and test `destructuring-let`

**User story:** Story 2 above.

**Description:** Define in `std/pattern`:
```lisp
(defmacro destructuring-let (vars expr &rest body)
  ;; vars is (v1 v2 … vN); desugar to nested let over car/cdr/…
  …)
```
Support list-element patterns only (the `(v1 v2 …)` form). `_` in a var position means "skip this element."

**MUST:**
- `(destructuring-let (a b) '(1 2) (+ a b))` → `3`.
- `(destructuring-let (a _ c) '(1 2 3) (+ a c))` → `4`.
- Value with too few elements → runtime `EvalError` ("destructuring-let: expected N elements, got M").

**Acceptance criteria:**
- [ ] The two MUST examples pass as Bun tests in `pattern-matching.test.ts`.
- [ ] A short list (fewer elements than vars) signals a clear error.

### Phase 2: `match` (variadic clauses)

**Constraint checkpoint:** Before starting, verify:
- [ ] Phase 1 merged.

#### Step 1: Implement `match` for scalar patterns

**User story:** Story 1 above.

**Description:** Define `match` in `std/pattern`. For Tier 1, support: `_`, `nil`, number literals, string literals, and binding symbols. Expand to a `cond` chain.

**MUST:**
- `(match "normal" ("normal" 1) (_ 2))` → `1`.
- `(match "insert" ("normal" 1) (_ 2))` → `2`.
- `(match 0 (0 "zero") (_ "other"))` → `"zero"`.
- `(match nil (nil "empty") (_ "nonempty"))` → `"empty"`.
- A binding pattern: `(match 42 (n n))` → `42`.

**Acceptance criteria:**
- [ ] All five MUST examples pass.

#### Step 2: Extend `match` with list patterns

**User story:** Story 3 above.

**Description:** Extend the pattern compiler so a list pattern `(p1 p2 …)` generates a clause guarded by `(and (listp tgt) (>= (length tgt) N))` with each element matched by its sub-pattern (nested `let` for bindings).

**MUST:**
- `(match '("line" 10 "hi") (("line" n text) n) (_ 0))` → `10`, with `text` bound inside the body.
- `(match '("word" "hi") (("line" n text) n) (("word" text) text) (_ ""))` → `"hi"`.
- A value that is not a list does NOT match a list pattern (falls through to next clause).

**Acceptance criteria:**
- [ ] The two MUST examples pass.
- [ ] Non-list value against a list pattern falls through (does not error).

#### Step 3: No-match runtime error

**User story:** As a developer, when my `match` handles no clause, I want a clear error pointing at the unmatched value, not silent nil.

**Description:** If no clause matches, expand to a final `(t (error "match: no clause matched %s" %%target))` branch (or equivalent using the project's error-returning `EvalError`). The error must include the value via a reasonable printer (fallback to `prin1`-style).

**Acceptance criteria:**
- [ ] `(match 42 ("x" 1))` returns an `Either.left(EvalError)` whose message contains `42` and the word `match`.

## Acceptance Criteria

1. `(defmacro name (fixed… &rest rest) …)` works; `rest` is a list inside the body. Fixed-arity macros are unaffected.
2. `destructuring-let` binds list elements to names, supports `_` skip, and errors clearly on short input.
3. `match` supports patterns: `_`, `nil`, number literal, string literal, binding symbol, list of sub-patterns.
4. A `match` with no matching clause returns an `EvalError` naming the value.
5. Non-list values fall through list patterns without erroring.
6. `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck` all pass with zero errors.
7. `bun test` passes with zero regressions; `test/unit/pattern-matching.test.ts` covers every MUST above.

## Validation Commands

- `bun run typecheck:src` — zero type errors
- `bun run typecheck:test` — test types clean
- `bun run typecheck` — full project types clean
- `bun test test/unit/pattern-matching.test.ts` — new feature tests pass
- `bun test test/unit/macros.test.ts` — macro system unaffected (regression guard for the `&rest` change)
- `bun test` — full suite, zero regressions

## Design Decisions

| Decision | Rationale | Alternative rejected |
|----------|-----------|---------------------|
| Implement as T-Lisp macros, not interpreter special forms | The macro system + quasiquote already exists; the whole feature desugars to `cond`/`let`/`car`/`string=`. Zero new runtime capability. Matches `src/tlisp/Claude.md`. | Add `match` as an evaluator special form — pushes editor logic into the wrong layer and duplicates what macros can express. |
| Ship in a `std/pattern` module | Matches `std/strings`/`std/lists` convention; importable, not forced on every session. | Inject `match` into the global env unconditionally — pollutes the namespace. |
| Tier 1 pattern subset only (no hashmap/guard/or-patterns) | `elisp-pain-points.md LD-3` asks for "pattern matching," not a full pattern compiler. Ship the 80% case; defer the rest. | Build the full pattern compiler up front — speculative, violates CLAUDE.md §2. |
| Extend `defmacro` for `&rest` rather than make `match` fixed-arity | `match` is fundamentally variadic in clauses; `&rest` is the standard Lisp answer and unblocks future variadic macros. | Hardcode a max clause count in `match` — ugly, and `&rest` is needed anyway. |
| `&rest` is `defmacro`-only, never `defun` | Functions have a separate, correct arity model in `evaluator.ts`; touching it is out of scope and risky. | Generalize `&rest` across both — scope creep, more type surface. |

**Deferred to follow-up specs:**
- **Tier 2 — ADT declarations (`deftype`).** Sum-type constructors that pair with `match` for declared types. Separate spec; depends on this one shipping first.
- **Tier 2 — multimethods (`defgeneric`/`defmethod`).** CLOS-style dispatch on the existing `.type` tag. The honest T-Lisp analog of type classes.
- **Tier 3 — static typing / type inference.** Explicitly deferred per `elisp-pain-points.md LD-4`. A separate checker tool (Typed-Racket/Coalton-style) layered over the dynamic core would be the right shape if ever pursued — not retrofitting inference into `evaluator.ts`.
- Pattern extensions: hashmap patterns, `&rest` inside list patterns, guard `:when`, or-patterns. Add only when concrete editor code asks for them.

## Edge Cases

- **`&rest` with zero extra args:** `(defmacro f (a &rest b) …)` called as `(f 1)` must bind `b` to `nil` (empty list), not error.
- **Binding symbol shadowing:** a binding pattern named the same as an outer var must bind locally inside the clause body only (lexical scope, as with `let`).
- **`_` as a binding name:** `_` is always a wildcard, never a binding. Using `_`'s "value" in the body is an unbound-symbol error (same as today).
- **Hygiene / generated-symbol collisions:** the expansion introduces a temp like `%%target`. Confirm no existing T-Lisp code uses `%%`-prefixed names; if hygiene matters, use `gensym` if available, else document the reserved prefix.
- **List pattern against a string:** a string is not a list — must fall through, not match char-by-char. Confirm via the `listp` guard, not `stringp`.
- **Destructuring on nil:** `(destructuring-let (a b) nil …)` — `car` of nil is nil in T-Lisp; this binds `a`/`b` to nil rather than erroring. Document this as the defined behavior (matches how `car` already behaves) unless a test reveals it surprises users.
