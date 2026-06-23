# RFC-021: T-Lisp Monoid Abstraction & Generic `reduce`

**Date:** 2026-06-24
**Status:** Proposed
**Author:** Mekael Turner
**Depends on:** [RFC-018](RFC-018-tlisp-scripting-primitives.md) Tier 1 (proposes adding a `core/monads` module; this RFC scopes the Monoid piece of it concretely)
**Related:** [RFC-016](RFC-016-tlisp-common-lisp-parity.md) (`reduce` listed as a CL-parity idiom), `src/tlisp/core/monads.tlisp` (existing monad module — Monoid extends this layer), `src/tlisp/stdlib.ts` (where the `reduce` builtin lands)

## Abstract

This RFC proposes adding a **Monoid abstraction** to T-Lisp plus a single generic **`reduce`** builtin that removes the need to hand-write a fold for every monoid consumer. It is a focused subset of RFC-018 Tier 1's "core/monads module" work — narrowly scoped to the one abstraction (Monoid) that the codebase already uses implicitly but has no name for, and the one builtin (`reduce`) that the existing `monads.tlisp` already calls out as missing.

The proposal was **verified against a live interpreter** before writing: all primitives required to define a List monoid (`list`, `append`, `car`, `cdr`, `null`, `equal`, `let*`, `while`, `set!`) work today, and all four monoid laws (left identity, right identity, associativity, `mconcat` flattening) hold when the abstraction is written in T-Lisp. **No new value type, no new special form, no evaluator change is required.** The work is ~80 lines of T-Lisp in a new module + one ~20-line builtin.

## Motivation

### The implicit-monoid pattern is already everywhere

`src/tlisp/core/monads.tlisp` already builds five monadic abstractions (Option, Either, Result, Validation, State/Reader) on top of **tagged lists** — e.g. `(list 'some value)`, `(list 'right v)`. The Validation module (lines 142-205) is internally a **list monoid of errors**: `lift2`/`lift3` do `(append (monads--value a) (monads--value b))` to accumulate them. This is the List monoid in everything but name. Similarly, every `monads-*-bind` in the file is structurally a fold — and the code is forced to spell the fold out by hand because there is no `reduce`.

The repo's own code acknowledges the gap: `monads.tlisp:180` carries the comment `Iterative (no named let / reduce)` explaining *why* `lift2` is a `while`/`set!` loop instead of a one-liner. That comment is the motivation for this RFC.

### Every monoid consumer currently reimplements `mconcat`

Without a Monoid abstraction, every author who wants "fold a list of X-values combining via X's operation" rewrites the same `while`/`set!`/`cdr` loop. The List monoid demo from the RFC background conversation produced exactly this shape:

```lisp
(defun list-mconcat (lst)
  (let* ((acc list-mempty) (rest lst))
    (while (not (null rest))
      (set! acc (list-mappend acc (car rest)))
      (set! rest (cdr rest)))
    acc))
```

This is correct, but it's repeated boilerplate — and worse, the `reduce` builtin that would eliminate it is also a prerequisite for RFC-016's CL-parity work and for RFC-018's port of the adw orchestrator (block 8 of its building blocks is "monadic composition", which `reduce` makes idiomatic).

### Why now

Three things converged:

1. **RFC-018 Tier 1 proposes `core/monads` but doesn't scope it.** This RFC scopes the Monoid piece concretely so RFC-018 can reference it rather than re-deriving.
2. **RFC-016 lists `reduce` as a CL-parity idiom** without specifying semantics. This RFC nails those down.
3. **Live verification (this RFC's background work)** confirmed the abstraction works end-to-end today — there's no research risk, only implementation.

## Design

### Scope: two coupled additions

| # | Addition | Location | LOC estimate |
|---|----------|----------|--------------|
| 1 | **Monoid abstraction** — `mempty`, `mappend`, `mconcat`, `monoid-laws-check` | new file `src/tlisp/core/monoid.tlisp` | ~60 |
| 2 | **`reduce` builtin** — `(reduce f init list)` | `src/tlisp/stdlib.ts` | ~20 |

Plus one optional refinement (Tier 2 below): **named monoid records** so callers can pass `#'list-monoid` instead of three separate functions.

### Part 1 — Monoid abstraction (`core/monoid.tlisp`)

A **Monoid** is a triple `(carrier, mempty, mappend)` satisfying three laws:

1. **Left identity:** `(mappend mempty x) = x`
2. **Right identity:** `(mappend x mempty) = x`
3. **Associativity:** `(mappend a (mappend b c)) = (mappend (mappend a b) c)`

The abstraction provides:

- **`monoid-make (mempty-fn mappend-fn)`** — constructs a monoid record `(list 'monoid mempty-fn mappend-fn)`. `mempty` is a thunk (0-arg function) so non-constant identities (e.g. a fresh empty buffer) work.
- **`monoid-mempty (m)`** — `(mempty-fn)`.
- **`monoid-mappend (m a b)`** — `(mappend-fn a b)`.
- **`monoid-mconcat (m lst)`** — left fold via the `reduce` builtin: `(reduce (lambda (acc x) (monoid-mappend m acc x)) (monoid-mempty m) lst)`.
- **`monoid-laws-check (m sample-a sample-b sample-c)`** — returns `t` if all three laws hold for the given samples; used by tests and by authors validating a new monoid.

**Canonical instances** (in the same file, exported as a monoid registry):

| Instance | `mempty` | `mappend` | Notes |
|----------|----------|-----------|-------|
| `list-monoid` | `(list)` | `append` | The motivating instance; already implicit in Validation |
| `sum-monoid` | `0` | `+` | Numeric sum |
| `product-monoid` | `1` | `*` | Numeric product |
| `string-monoid` | `""` | `string-append` | String concatenation |
| `all-monoid` | `t` | `and` | Conjunction (`t`/`nil`) |
| `any-monoid` | `nil` | `or` | Disjunction (`t`/`nil`) |
| `endo-monoid` | `(lambda (x) x)` | `(lambda (f g) (lambda (x) (f (g x))))` | Function composition under `>>>`; the "dual" of the Writer monad |

Each is ~3 lines of T-Lisp. The whole registry is ~25 lines.

### Part 2 — `reduce` builtin (`stdlib.ts`)

**Signature:** `(reduce f init list)` → value

**Semantics:**
- Left fold: `result_0 = init`, `result_{i+1} = (f result_i list[i])`, return `result_n`.
- Empty list → returns `init` unchanged (this is exactly the monoid identity law made operational).
- `f` is called with two args: the accumulator and the current element.
- Non-list `list` arg → `EvalError` "reduce: third argument must be a list".
- Non-callable `f` → `EvalError` "reduce: first argument must be callable".

**Implementation** (mirrors existing builtin shapes in `stdlib.ts`):

```ts
interpreter.defineBuiltin("reduce", (args) => {
  if (args.length !== 3) return makeError("reduce: expected 3 arguments (f, init, list)");
  const [f, init, list] = args;
  if (!isFunction(f)) return makeError("reduce: first argument must be callable");
  if (!isListValue(list)) return makeError("reduce: third argument must be a list");
  let acc = init;
  for (const item of list.right) {
    const result = interpreter.applyFunction(f, [acc, item]);
    if (Either.isLeft(result)) return result;
    acc = result.right;
  }
  return Either.right(acc);
});
```

The exact shape (does `interpreter.applyFunction` exist by that name, or is it `evalFunctionCall`?) is TBD during implementation — the implementer will mirror whatever the existing higher-order builtins (`mapcar`, `filter`) use.

**Right-fold companion?** No. RFC-016 lists `reduce` only; `reduce-right` is a separate CL-parity idiom and belongs in RFC-016's CHORE. Keeping this RFC minimal: one builtin, left fold, monoid-friendly.

### Part 3 (Tier 2, deferred) — Typeclass-style dispatch

**Not in scope for this RFC.** Tier 2 is recorded here so the design is extensible: a future RFC could let monoid consumers dispatch on value type (`(monoid-mconcat any-monoid lst)` for booleans, `string-monoid` for strings) without the caller naming the monoid. This requires either multimethods or a convention over value tags. It is **explicitly deferred** — every Tier 1 consumer can name its monoid explicitly with no ergonomic loss for the current codebase.

## Alternatives Considered

### "Just add `reduce`, skip the Monoid abstraction"
Rejected for two reasons: (1) the List-monoid pattern is already implicit in `monads.tlisp`'s Validation module — naming it makes the code shorter and self-documenting; (2) RFC-018 Tier 1 already commits to a `core/monads` module, and Monoid is the simplest member of that family, so it's the natural first addition. A `reduce` builtin alone would leave the codebase still hand-rolling `mempty`/`mappend` pairs.

### "Add `reduce` to `monads.tlisp` as a T-Lisp function, not as a builtin"
Rejected. A T-Lisp-level `reduce` would itself need a `while`/`set!`/`cdr` loop — recreating the boilerplate it's meant to eliminate, just moved one layer down. The builtin is ~20 lines of TS and short-circuits on the first error via `Either`, which a T-Lisp implementation cannot do without `condition-case`. The builtin is the right shape.

### "Implement Haskell-style `Monoid` as a typeclass with instances"
Rejected. T-Lisp has no typeclass system (RFC-015 is pattern matching, not typeclasses; no multimethod RFC exists). Records-as-monoids (`(list 'monoid mempty-fn mappend-fn)`) is the idiomatic T-Lisp encoding, consistent with how Option/Either/Result are already encoded in `monads.tlisp`. Adding typeclasses would be a much larger language change and is recorded as Tier 2 above for future consideration.

### "Add `foldr`/`foldl`/`foldl1`/`foldr1` (the full CL/Haskell fold family)"
Rejected as scope creep. RFC-016 owns the CL-parity fold family; this RFC adds only the one fold that Monoid needs. Keeping the scope tight is the same discipline applied in RFC-016 and RFC-018.

## Architecture Constraints

- **Zero external dependencies** (AGENTS.md Project Overview). The `reduce` builtin uses only `interpreter.applyFunction` and `Either` — both already in the codebase.
- **No evaluator change.** `reduce` is a regular builtin registered like `mapcar`/`filter`; no special-form treatment.
- **No new value type.** Monoids are encoded as tagged lists, matching the existing Option/Either/Result encoding in `monads.tlisp`.
- **Functional style preserved.** `reduce` does not mutate `list` or `init`; it allocates a single accumulator cell that it rebinds. The `monoid.tlisp` module contains no `set!` outside `monoid-mconcat`'s internal fold (which is itself inside the builtin, not T-Lisp).
- **Consistency with `monads.tlisp`.** Module name `std/monoid` mirrors `std/monads`; same `defmodule`/`export` shape; same `--` private-prefix convention (e.g. `monoid--mempty-fn`).

## Phased Plan

```
Phase 0 (verification, already done):
  The List monoid was built and all four laws verified against a live
  interpreter. No further research needed.

Phase 1 (the RFC's deliverable):
  1. Add `reduce` builtin to src/tlisp/stdlib.ts.
  2. Add src/tlisp/core/monoid.tlisp with the 7 canonical instances.
  3. Add tests under test/unit/ (TDD per rules/testing.md):
     - reduce.test.ts: empty-list returns init; left-fold semantics;
       short-circuit on error; type errors.
     - monoid.test.ts: each of the 7 instances passes monoid-laws-check
       on representative samples.
  4. Refactor monads.tlisp Validation to use the new abstraction
     (lift2/lift3 become one-liners via monoid-mconcat).

Phase 2 (deferred to a follow-up RFC, recorded here):
  Typeclass-style dispatch so consumers don't name the monoid explicitly.
  Requires a value-tag dispatch convention; out of scope.
```

## Open Questions

1. **Should `reduce` accept a `:from-end` keyword for right-fold semantics?** CL's `reduce` does. This RFC says **no** — keep the builtin minimal; `reduce-right` belongs in RFC-016 if/when it lands. Adding a keyword arg also complicates the TS implementation (the existing builtins use positional args only).
2. **Should monoid records carry their carrier type for future dispatch?** Tempting (it would ease Tier 2), but it adds a field nothing currently reads. Defer until Tier 2 actually arrives — adding a field later is non-breaking.
3. **Should the canonical monoid registry live in `core/monoid.tlisp` or be split per-type?** Single file. The seven instances are ~25 lines total; splitting would be over-engineering.
4. **Does `endo-monoid` belong in Tier 1?** It's the most abstract of the seven (function composition) and has no current consumer in the codebase. Recorded in the RFC for completeness but could be dropped if the reviewer wants the registry minimal — it's the one instance with no motivating use case today.

## Design Decisions

- **Left fold, not right fold.** Monoid `mconcat` is conventionally a left fold; right-fold semantics add nothing for associative operations and complicate short-circuit on error.
- **`mempty` is a thunk, not a value.** Some monoids have non-constant identities (a fresh mutable thing — though T-Lisp is immutable so this is mostly future-proofing). A 0-arg function is strictly more general and costs one extra call per `mconcat`.
- **No typeclass dispatch in Tier 1.** Explicit monoid passing (`(monoid-mconcat list-monoid lst)`) is fine for every current consumer; dispatch is Tier 2.
- **`monoid-make` over a literal record constructor.** A constructor function validates arity and gives a stable tag (`'monoid`) for future pattern-matching (RFC-015).

## Non-Goals

- **Typeclasses / multimethods.** Tier 2, future RFC.
- **The full CL fold family** (`foldr`, `foldl1`, `reduce-right`, `:from-end`). RFC-016.
- **Functor/Applicative/Monad typeclasses.** Out of scope — `monads.tlisp` already encodes these per-instance; abstracting them is a much larger design.
- **Rewriting `monads.tlisp` end-to-end.** Only the Validation module's `lift2`/`lift3` get refactored to use `monoid-mconcat`; the rest stays as-is.

## Status & Trigger

**Proposed.** This RFC is ready to be turned into a SPEC/CHORE for execution via the adw pipeline. Suggested follow-on artifacts:

- **SPEC-063-tlisp-monoid-reduce.md** — turns Phase 1 into an executable spec.
- The `reduce` builtin portion can also be lifted into RFC-016's CHORE if that CHORE hasn't landed yet, since RFC-016 lists `reduce` as a CL-parity idiom. The two RFCs are compatible — this one owns the semantics, RFC-016 owns the broader CL-family rollout.

The work is small enough (~80 LOC + tests) that it can ship in a single CHORE without a patch-review loop.
