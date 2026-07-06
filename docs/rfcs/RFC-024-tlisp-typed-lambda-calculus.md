# RFC-024: Typed Lambda Calculus & Gradual Typing for T-Lisp

**Date:** 2026-07-03
**Status:** Proposed
**Author:** Mekael Turner

**Depends on:** the macro system with compile-time expansion and quasiquote (`src/tlisp/evaluator.ts` `evalDefmacro`), the closed value-tag set in `src/tlisp/types.ts` (`TLispValueType`), and the tagged-value encoding already used by `src/tlisp/core/monads.tlisp` (Option/Either/Result as `(list 'tag value)`).

**Motivated by:** `docs/memos/elisp-pain-points.md` **LD-4** ("No Type System or Contracts — Medium"): "Runtime type errors surface far from the actual bug. There's no way to document 'this function expects a buffer object and a string.'" This RFC is the long-deferred answer to that pain point. It also picks up the explicit deferral in [RFC-015](RFC-015-pattern-matching-and-destructuring.md) Tier 3: "static typing / type inference … A separate checker tool (Typed-Racket/Coalton-style) layered over the dynamic core would be the right shape if ever pursued."

## Abstract

This RFC answers a feasibility question — *can T-Lisp have types via a typed lambda calculus implementation?* — with **yes, along a spectrum of cost and power**, and proposes the lowest-risk shape for T-Lisp specifically: a **gradual type system layered over the dynamic core via macros and an external checker phase**, not a retrofit of inference into the evaluator.

The proposal is deliberately **bifurcated** into two independent tracks, so the project can adopt one without committing to the other:

1. **Track A — Embedded Simply Typed Lambda Calculus (STLC).** A typed mini-language implemented *in* T-Lisp: a `check` function that walks a quoted term against typing judgments `Γ ⊢ e : τ`. Self-contained, pedagogically clean, zero changes to the evaluator. Proves the concept and provides a foundation for the more ambitious track.

2. **Track B — Gradual typing for T-Lisp itself.** A macro-time type checker (`defun:` / `lambda:` with annotations) plus an optional pre-eval checker, modeled on Typed Racket. Typed and untyped code coexist. The long pole is annotating the 100+ editor API functions; the design absorbs that as a gradual, opt-in migration rather than a flag day.

**This RFC does not commit to either track shipping today.** It records the design space, names the tradeoffs, and recommends Track A as the first step if/when the project decides to pursue types.

## Motivation

### The pain is already documented

`elisp-pain-points.md` LD-4 ranks "No Type System or Contracts" as a **Medium** priority and explicitly recommends "optional type predicates/assertions at function boundaries" and "`:pre`/`:post` conditions (Clojure-style)" as the honest answer — *not* a full type system. The roadmap row reads: `LD-4 | Language | No type contracts | Optional boundary assertions | Medium | Planned`.

T-Lisp today has none of these. A function that expects `(buffer-string)` and is handed `nil` by a caller fails somewhere inside `string-length`, far from the bug. There is no way to write "this returns `(either string error)`" and have anything check it.

### The opportunity is also documented

RFC-015's deferred-items section names the right shape already:

> Tier 3 — static typing / type inference. Explicitly deferred per `elisp-pain-points.md` LD-4. A separate checker tool (Typed-Racket/Coalton-style) layered over the dynamic core would be the right shape if ever pursued — not retrofitting inference into `evaluator.ts`.

This RFC takes that paragraph and turns it into a concrete proposal. Two prior design constraints make types unusually tractable here:

1. **T-Lisp's value set is closed and tagged.** `TLispValueType` enumerates every runtime value kind (number, string, symbol, list, hashmap, nil, function, …). A type checker's "ground types" are therefore already named and enumerable — unlike in a Lisp with arbitrary C-level objects.
2. **T-Lisp has macros with compile-time expansion and quasiquote.** The AST is reachable at expansion time, which is the natural place to run a checker. No new evaluation phase needs to be invented.

### Why not just runtime contracts

LD-4's own recommendation ("optional boundary assertions") is the cheapest option and the one this RFC explicitly endorses as a **Tier 0** baseline (see Design). But runtime contracts alone are not "types" in the Curry–Howard sense — they catch errors at runtime, not before evaluation, and they cannot express *parametric* guarantees like "`(map f xs)` returns a list of the same length as `xs`." This RFC's Track A and Track B reach for genuine static checking because that is what the user's question ("typed lambda calculus implementation") asks for.

## Design

### Key distinction: types are a phase, not a runtime concept

Following Haskell/OCaml, the type checker is a **phase that runs before evaluation**; types are **erased at runtime**. This RFC does **not** propose changing the T-Lisp evaluator. The dynamic core stays exactly as it is. Types are layered *in front of* it — most naturally at macro-expansion time (Track B) or as a pure-T-Lisp checker function operating on quoted terms (Track A).

This is the single most important architectural decision in the RFC, and it is forced by the project's own constraints (`src/tlisp/Claude.md`: editor logic stays in T-Lisp; `CLAUDE.md` §3: surgical changes).

### The spectrum, cheapest → most powerful

| Tier | What | Where it runs | Power | Cost |
|------|------|---------------|-------|------|
| **0** | Runtime contracts / `:pre`/`:post` predicates | At call time | Catches the common class of wrong-arg-type bugs; not "real" static types | Very low — a macro wrapper |
| **1** | Macro-time annotation checking | During `defun:`/`lambda:` expansion | Genuine static checking of annotated functions, before eval | Low-medium — one macro + a checker fn |
| **2 (Track A)** | Embedded Simply Typed Lambda Calculus | A `check` function on quoted terms | Full Curry–Howard for a *subset* language; proofs-as-programs | Medium — self-contained DSL |
| **3 (Track B)** | Gradual typing for all of T-Lisp | Macro-time + optional pre-eval pass | Typed Racket / Coalton: typed & untyped code coexist | High — annotating the editor API is the long pole |
| **4** | System F / Hindley–Milner / dependent types | Checker phase | Parametric polymorphism, inference, or full dependent types | Very high — out of scope |

This RFC proposes **Tier 0 as an immediate, low-risk win** (it matches LD-4's own recommendation exactly), and **recommends Track A (Tier 2) as the first real foray into static types** if the project chooses to go further. Track B (Tier 3) is recorded as the eventual destination but is **explicitly not the first step**.

### Tier 0 — Runtime contracts (the LD-4 baseline)

A macro that wraps a function body with runtime predicate checks at its boundaries:

```lisp
(defun: buffer-append ((b buffer?) (s string?)) -> string?
  ;; body unchanged; b and s are checked on entry, result on exit
  (let ((cur (buffer-text b)))
    (buffer-set-text b (string-append cur s))))

;; desugars to
(defun buffer-append (b s)
  (when-not (buffer? b)   (error "buffer-append: arg 0 expected buffer, got %s" (type-of b)))
  (when-not (string? s)   (error "buffer-append: arg 1 expected string, got %s" (type-of s)))
  (let ((%%result (progn ;; original body
                    )))
    (when-not (string? %%result) (error "buffer-append: result expected string?, got %s" (type-of %%result)))
    %%result))
```

This is **not** static typing (errors surface at call time, not before), but it satisfies LD-4's "optional boundary assertions" verbatim and costs almost nothing. It is the honest, conservative answer and this RFC endorses it as the default that ships first.

- **`:pre`/`:post`** (Clojure-style conditions) is the lighter variant of the same idea and is recorded as an alternative within Tier 0.
- Tier 0 is also the **ergonomic foundation** for Tier 1/3: once predicates like `buffer?`/`string?`/`either?` exist and are used at boundaries, the same predicates become the ground types of the static checkers.

### Track A — Embedded Simply Typed Lambda Calculus (Tier 2)

This track takes the user's phrase "a typed lambda calculus implementation in T-Lisp" **literally**: implement the STLC as a DSL *inside* T-Lisp.

**What ships:** a new stdlib module `std/typed` containing:

1. **A type representation.** Types are T-Lisp values:
   ```lisp
   (list 'base 'number)        ;; τ = number
   (list 'base 'string)
   (list 'base 'boolean)
   (list '-> τ1 τ2)            ;; function type
   (list 'list-of τ)           ;; (list τ)
   (list 'pair τ1 τ2)
   ```
2. **A term representation.** Typed terms are quoted, tagged lists:
   ```lisp
   (list 'var 'x)
   (list 'lam 'x τ body-term)      ;; λx:τ. e
   (list 'app f-term arg-term)
   (list 'lit 42 (list 'base 'number))
   ```
3. **A `check` function** implementing the typing judgments:
   ```lisp
   (check Γ term τ) → (either type-error unit)
   (infer Γ term)   → (either type-error τ)
   ```
   The classic rules — var lookup, lambda abstraction, application, literal — implemented as T-Lisp functions over the tagged representations, using the existing `Either` monad from `monads.tlisp` for error propagation.
4. **An `eval-typed` function** that runs a well-typed term through the existing T-Lisp evaluator (types erased; the term desugars to ordinary `lambda`/`application`).

**Why this shape:**

- **Self-contained.** No evaluator change, no new value type, no editor-API annotation work. The whole feature is one `std/typed` module + tests.
- **Pedagogically honest.** It is a real Curry–Howard-typed calculus, not a contract system. `(infer Γ term)` either returns a type or a `type-error` *before* any evaluation happens.
- **Extensible.** STLC is the floor. Adding `let`-polymorphism, sum types (which pair naturally with RFC-015's `match`), or System-F style ∀-quantification are all *additive* changes to the same `check`/`infer` functions. Track B is, in a sense, "Track A grown to cover the whole language."
- **Lowest research risk.** The typing rules for STLC are a century old and well-understood; the implementation is mechanical once the representations are chosen.

**MUST for Track A (acceptance shape):**

- `(infer '() '(lam x (base number) (var x)))` returns `(right (-> (base number) (base number)))`.
- `(infer '() '(app (lam x (base number) (var x)) (lit 42 (base number))))` returns `(right (base number))`.
- `(infer '() '(app (lam x (base number) (var x)) (lit "hi" (base string))))` returns `(left type-error)` mentioning the `number` vs `string` mismatch — **without evaluating** the term.
- All of `monads.tlisp`'s `Either` combinators compose with `check`/`infer` as expected.
- `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck` all pass (Track A is pure T-Lisp, so this is a regression guard only).
- `bun test test/unit/typed-stlc.test.ts` passes.

**MUST NOT for Track A:**

- Touch `evaluator.ts`. The dynamic core is untouched.
- Add new value types. Types are encoded as tagged lists, exactly like Option/Either/Result.
- Claim to type-check arbitrary existing T-Lisp code. Track A is a *separate language*; users opt in by constructing typed terms.

### Track B — Gradual typing for T-Lisp (Tier 3, the long-form destination)

Track B is what "types for T-Lisp itself" looks like. It is **recorded here as the architectural target**, not proposed for immediate implementation — Track A is the prerequisite that proves the checker logic in a smaller arena.

**Shape (Typed-Racket-style):**

1. **`defun:` / `lambda:` / `define:` macros** with annotation syntax:
   ```lisp
   (defun: buffer-append ([b : buffer] [s : string]) -> string
     (string-append (buffer-text b) s))
   ```
   During macro expansion, the macro runs a **local type check** of the body against the declared arg/return types and the ambient `Γ` (extended with `b : buffer`, `s : string`). Ill-typed bodies produce an `EvalError` at expansion time — the program never reaches the evaluator.

2. **A pre-eval checker phase** (`(check-file "init.tlisp")` or a `tmax --check` CLI) that type-checks a whole file/module in one pass, resolving cross-function references through a typed-environment cache. This is where "the whole program type-checks before it runs" lives.

3. **Boundaries between typed and untyped code.** Following Typed Racket, calls *into* typed code from untyped code (and vice versa) get **runtime checks inserted automatically** at the boundary — which is exactly Tier 0's contracts, generated rather than hand-written. This is the sense in which the tiers compose: Tier 3 is "Tier 0 contracts, but only at typed/untyped boundaries, and statically checked everywhere else."

**The long pole — annotating the editor API:**

T-Lisp exposes 100+ editor functions (`src/editor/tlisp-api.ts`: buffer ops, cursor ops, modes, key bindings, …). Typing *all of T-Lisp* means writing a type signature for each of these. This is real, ongoing labor. The design absorbs it by being **gradual and opt-in**:

- Untyped T-Lisp code keeps working forever. There is no flag day.
- A module opts into typing by using `defun:`; only the functions it calls need types.
- The editor API is annotated **incrementally**, starting with the most-used primitives (`buffer-text`, `cursor-position`, `editor-get-mode`) and growing as consumers demand.
- An "erased" or "Any" type lets unannotated API functions be called from typed code with no static guarantee — same semantics as untyped, no surprise.

**Why Track B is not the first step:**

- It depends on having a proven checker (Track A proves the `infer`/`check` logic in isolation).
- It touches the editor API surface, which is the kind of broad change `CLAUDE.md` §3 (Surgical Changes) counsels against bundling into one effort.
- It has genuine open research questions (how do macros with types compose? Typed Racket spent years on this). Track A defers all of those by being a closed DSL.

**Track B is therefore recorded as the destination, to be undertaken as a follow-up RFC after Track A has shipped and the project has felt out which editor-API types actually matter.**

## Architecture Constraints

| Area | Governing Doc | Rule |
|------|--------------|------|
| T-Lisp ownership | `src/tlisp/Claude.md` | Tier 0 and Track A are pure T-Lisp (new `std/` modules). Track B's macro additions are T-Lisp; the only TypeScript touch (if any) would be a `--check` CLI flag, deferred. No type logic in `evaluator.ts`. |
| Closed value set | `types.ts` `TLispValueType` | Ground types are taken from the existing tag enumeration. No new value types to represent types — they are tagged lists, matching `monads.tlisp`. |
| Functional error handling | `rules/tlisp.md`, `rules/functional-programming.md` | `check`/`infer` return `Either.left(TypeError)`; no `throw`. Mirrors `monads.tlisp`'s encoding. |
| Surgical changes | `CLAUDE.md` §3 | Tier 0 = one new macro + predicates. Track A = one new module + test file. Every changed line traces to a tier above. |
| Type safety | `learnings.md` | `bun run typecheck` must pass with zero errors. Tier 0 / Track A are pure T-Lisp so this is a regression guard, but the rule still holds. |

## Alternatives Considered

### "Retrofit Hindley–Milner inference into `evaluator.ts`"
Rejected. This is the path RFC-015 explicitly warned against and the path most likely to violate `src/tlisp/Claude.md` (pushing language machinery into the TS layer). HM inference over a Lisp with macros is an open research problem (Typed Racket's decade of work on macro types is the cautionary tale). The "checker as a phase, dynamic core untouched" shape is forced by the project's own constraints and is also simply the more honest design.

### "Build the full type system up front (System F / dependent types)"
Rejected as scope creep (`CLAUDE.md` §2: Simplicity First). STLC covers the Curry–Howard essentials; parametric polymorphism (System F), inference (HM), and dependent types are each separable extensions *to* the same `check`/`infer` core. Ship the floor; grow only what concrete editor code demands.

### "Just ship Tier 0 contracts and declare LD-4 closed"
Tempting and defensible — it matches LD-4's own recommendation verbatim. Rejected *as the complete answer* because the user's question explicitly asks about typed lambda calculus, and contracts are not that. Endorsed *as the first deliverable*: Tier 0 is the floor of this RFC, and Track A is the optional step above it.

### "Make types a runtime concept (carry type tags through evaluation)"
Rejected. Types are a phase, erased at runtime (Haskell/OCaml model). Carrying runtime type tags would (a) require a new value type, violating the closed-tag constraint, (b) slow every operation, and (c) collapse back toward "contracts with extra steps." The phase/erase split is both cleaner and faster.

### "Annotate the whole editor API as a prerequisite for Track B"
Rejected as a flag-day risk. The whole point of gradual typing (Typed Racket's central lesson) is that typed and untyped code coexist. Track B ships value as soon as *one* module opts into `defun:`; the API is annotated incrementally and an `Any`/erased type covers the unannotated long tail.

## Phased Plan

```
Tier 0 (recommended first deliverable — satisfies LD-4 verbatim):
  1. Add `defun:`/`:pre`/`:post` contract macro + a `std/contracts` module
     reusing existing predicates (buffer?, string?, number?, list?, either?, …).
  2. Add tests: each contract fires on the wrong type; passes on the right.
  3. (Optional) Retrofit a handful of high-traffic editor API fns with contracts.

Track A (recommended second deliverable — real static types in a closed DSL):
  1. Add std/typed module: type rep, term rep, infer, check, eval-typed.
  2. TDD under test/unit/typed-stlc.test.ts (per rules/testing.md):
     - infer on var/lam/app/lit;
     - check accepts well-typed, rejects ill-typed *without evaluating*;
     - Either-combinator composition.
  3. Docs: a short "typed lambda calculus in T-Lisp" walkthrough.

Track B (destination, separate follow-up RFC after Track A):
  1. defun:/lambda:/define: macros with local body type-checking at expansion.
  2. (check-file)/`tmax --check` whole-file phase.
  3. Auto-inserted boundary contracts (Tier 0 predicates, generated).
  4. Incremental editor-API type annotation, starting with the most-used fns.

Deferred (Tier 4, not in any plan):
  System F parametric polymorphism; Hindley–Milner inference; dependent types.
  Each is an additive extension to the same check/infer core — pursue only
  when concrete editor code asks for what STLC cannot express.
```

## Open Questions

1. **Should Tier 0's contract macro also emit a (cheap) static check when predicates are simple type tags?** E.g. `(defun: f ((n number?)) …)` could be checked at macro-expansion time when the body is a literal. Tempting, but it blurs the Tier 0/1 line. **Proposal: keep Tier 0 purely runtime; static checking belongs to Tier 1+.**
2. **Does Track A's term language need `let`-polymorphism on day one?** STLC without `let`-poly is enough to demonstrate Curry–Howard and is genuinely simpler. **Proposal: ship STLC first; add `let`-poly only if a real consumer needs it.**
3. **How do RFC-015 `match` patterns and Track A/B sum types interact?** Track A could grow `(list 'sum ...)` types that pair with `match`. Recorded as a future cross-RFC design, not blocking either.
4. **Where do typed-module boundaries live for Track B — per-`defmodule` (RFC-005) or per-file?** Typed Racket is per-module. T-Lisp modules are RFC-005; Track B should follow that boundary. Deferred to the Track B follow-up RFC.
5. **Should types be printable/readable for error messages and a REPL `:type` command?** Yes — a `type->string` is part of Track A's MVP, since `(left type-error)` messages are only useful if they name the types involved.

## Design Decisions

| Decision | Rationale | Alternative rejected |
|----------|-----------|---------------------|
| Types are a phase, erased at runtime (Haskell/OCaml model) | Cleanest separation; the dynamic core stays untouched, which `src/tlisp/Claude.md` and `CLAUDE.md` §3 demand | Carry runtime type tags — new value type, slower, collapses to contracts |
| Two independent tracks (A and B) | Lets the project prove the checker logic (A) before committing to the broad editor-API work (B); no flag day | Single monolithic "types for T-Lisp" effort — too big, too risky |
| Tier 0 ships first, as runtime contracts | Matches `elisp-pain-points.md` LD-4's own recommendation verbatim; lowest risk; foundational predicates feed the static tiers | Jump straight to static checking — more research risk, slower to land value |
| Track A is an embedded DSL, not a modification of T-Lisp | Closed arena; no evaluator change; full Curry–Howard honesty; proves the concept | Layer static types over all of T-Lisp immediately — the long pole (API annotation) blocks value delivery |
| Types encoded as tagged lists | Matches `monads.tlisp` (Option/Either/Result); no new value type; consistent with closed `TLispValueType` | Add a new `'type` value tag — violates the closed-set constraint for no gain |
| Ground types taken from existing value tags | `TLispValueType` already enumerates them; zero new vocabulary | Invent a parallel type universe — duplicated effort |
| Track B is gradual and opt-in, Typed-Racket-style | Typed/untyped coexistence is the only honest answer for a 100+-function existing API | All-or-nothing static typing — flag-day risk, blocked on full annotation |
| HM/System F/dependent types are deferred | Each is additive to the same `check`/`infer`; ship STLC, grow only on demand | Build the most powerful system first — speculative, violates Simplicity First |

## Non-Goals

- **Changing the evaluator.** The dynamic core is the foundation types are layered in front of, not a thing to be rewritten.
- **Annotating the whole editor API in this RFC.** That is Track B's labor, recorded as incremental and opt-in.
- **Type inference (HM) or parametric/dependent types in the first deliverable.** Tier 4; additive later.
- **Replacing runtime contracts.** Tier 0 and the boundary checks Track B auto-generates *are* runtime contracts. This RFC composes with them, it does not abolish them.
- **A new value type for types.** Types are quoted data, evaluated away.

## Status & Trigger

**Proposed.** This RFC is a feasibility-and-design record, not yet a build commitment. Suggested next steps, in order of escalating ambition:

1. **Tier 0 only** — turn this into a SPEC/CHORE (e.g. `SPEC-###-tlisp-runtime-contracts.md`) implementing the `defun:` contract macro. This alone satisfies LD-4 and is ~1 day of work.
2. **Track A** — a separate SPEC implementing `std/typed` (the embedded STLC). Self-contained, ~1 week, proves the typed-lambda-calculus concept the user asked about.
3. **Track B** — a *follow-up RFC* (not this one) once Track A has shipped, undertaking the gradual editor-API typing.

The user's question — *"is it possible to have types through a typed lambda calculus implementation in T-Lisp?"* — is answered **yes**, and Track A is the literal implementation of that idea.
