# RFC-016: T-Lisp Common Lisp Parity Additions

**Date:** 2026-06-15
**Status:** Proposed
**Author:** Mekael Turner

**Companion analysis:** [tlisp-vs-common-lisp-gap-analysis.md](../memos/tlisp-vs-common-lisp-gap-analysis.md)
**Depends on:** [RFC-015](RFC-015-pattern-matching-and-destructuring.md) Phase 0 (`&rest` in `defmacro`) — shared prerequisite
**Aligned with:** [technical-vision.md](../technical-vision.md), `src/tlisp/Claude.md` (T-Lisp ownership), `rules/functional-programming.md` (error handling idiom)

## Table of Contents
- [Abstract](#abstract)
- [Scope Decision: Tiers, Not Wholesale Parity](#scope-decision-tiers-not-wholesale-parity)
- [Scripting Stance: No Roswell Equivalent](#scripting-stance-no-roswell-equivalent)
- [What T-Lisp Has Today](#what-t-lisp-has-today)
- [Gap Tiers](#gap-tiers)
- [Phase 1: Tier 1 — Fix Latent Bugs](#phase-1-tier-1--fix-latent-bugs)
- [Phase 2: Tier 2 — High-Value Idioms](#phase-2-tier-2--high-value-idioms)
- [Phase 3: Tier 3 — Conditional, On Demand](#phase-3-tier-3--conditional-on-demand)
- [Explicitly Out of Scope (Tier 4)](#explicitly-out-of-scope-tier-4)
- [Architecture Constraints](#architecture-constraints)
- [Open Questions](#open-questions)
- [Design Decisions](#design-decisions)

---

## Abstract

This RFC proposes a tiered, deliberately narrow set of additions to T-Lisp to close the highest-value gaps against Common Lisp. It is *not* a CL-compatibility effort. The guiding question for every inclusion is: **does editor code in this repository, or realistic near-term editor code, need this?**

The RFC also records a product decision up front: **T-Lisp will not build a Roswell equivalent.** The scripting capability that motivated the Roswell comparison already exists (CLI, REPL, `(load …)`, `tlisp -e`, shebang support); standalone-binary distribution comes for free from `bun build --compile`. The remaining Roswell features are either irrelevant to a single-implementation language or belong to [RFC-010 Loom](RFC-010-loom-package-manager.md).

The highest-priority work in this RFC is a **bug fix**, not a feature: `when`/`unless` are used by shipped `.tlisp` files but are not implemented, and `&rest`/`&body` lambda-list keywords are used in `examples/init.tlisp.example` but rejected by the evaluator. These are latent bugs that will surface the moment their code paths run.

## Scope Decision: Tiers, Not Wholesale Parity

CL is large. T-Lisp is an editor Lisp, not a general-purpose language aiming for ANSI CL conformance. This RFC draws a line: adopt the small set of CL idioms that make editor code readable and fix the bugs where shipped code uses undefined forms; explicitly defer or skip everything else.

The full gap inventory lives in the [companion analysis](../memos/tlisp-vs-common-lisp-gap-analysis.md). This RFC turns its recommendations into scoped, phased work.

### Guiding principles

1. **Macro-layer first.** Anything expressible as a pure T-Lisp macro using existing forms ships as a macro. Evaluator changes are reserved for what macros cannot express.
2. **Functional error handling stays.** T-Lisp's `Either`-returning evaluator is the project idiom (`rules/functional-programming.md`). Nonlocal exits (`catch`/`throw`) are added only for *success-with-abort*, not to replace `Either`.
3. **No new value types without a concrete need.** Character type is the one likely exception, and it is Tier 3.
4. **No speculative subsystems.** CLOS, the full condition/restart system, bignums/ratios, the full `LOOP`, and CL packages are all explicitly out of scope (Tier 4). The module system stays as the T-Lisp-native answer to packages.

## Scripting Stance: No Roswell Equivalent

The Roswell comparison produced a clear decision, recorded here so it does not need relitigating.

| Roswell capability | T-Lisp decision |
|---|---|
| Run scripts, REPL, `-e` | **Already shipped.** `src/tlisp/cli.ts`, `src/tlisp/repl.ts`. Document it; do not rebuild it. |
| Standalone binary | **Free via `bun build --compile`.** A build-pipeline task, not a subsystem. |
| Implementation manager | **N/A.** T-Lisp has one implementation. |
| App distribution (`ros install`) | **Out of scope here.** That is Loom ([RFC-010](RFC-010-loom-package-manager.md)). |
| Quicklisp integration | **N/A.** T-Lisp has no shared CL ecosystem. |

**Action:** if a Roswell-style *workflow* (init → run → build) is later desired, it is a small tooling RFC (a `tlisp init` scaffold command + a build wrapper script), not part of this RFC.

## What T-Lisp Has Today

Verified against source (see companion analysis for file references):

- Special forms: `quote`, quasiquote family, `if`, `let`/`let*` (correctly distinguished at `evaluator.ts:1160-1161`), `lambda`, `defun`, `defmacro`, `cond`, `progn`, `while`, `dolist`, `and`, `or`, `defvar`, `set!`, module forms, test forms.
- TCO via `TailCall` trampoline.
- Macro system with quasiquote and nesting depth tracking.
- Higher-order: `funcall`, `apply`, `mapcar`, `filter`, `identity`. **No `reduce`.**
- Module system: `defmodule`/`require-module`/`provide`.
- Scripting: REPL, CLI, `(load FILE)`, module loader.
- Lambda-lists: required params + `&optional` (with `(name default supplied-p)` form). **No `&rest`/`&body`/`&key`.**

## Gap Tiers

| Tier | What | Touches | Effort | Status in this RFC |
|---|---|---|---|---|
| **1** | `when`/`unless`, `&rest`/`&body` | 1 evaluator branch + macros | Small | **Phase 1 — fix now (bug)** |
| **2** | `reduce`, `format` subset, `push`/`pop`/`incf`/`decf`, `case`, `dotimes`, `labels`, `gensym`/`macroexpand`, `prog1` | Mostly macros + stdlib | Small–medium each | **Phase 2 — incremental** |
| **3** | `catch`/`throw`/`unwind-protect`, `block`/`return-from`, char type, `defstruct`, reader dispatch (`#'`, `#\a`) | Evaluator + (for char) new value type + reader | Medium | **Phase 3 — on demand only** |
| **4** | CLOS/MOP, full condition system, full `LOOP`, bignums/ratios, CL packages, `setf` places | Large | Large | **Out of scope** |

---

## Phase 1: Tier 1 — Fix Latent Bugs

**Motivation:** shipped code uses undefined forms. `src/tlisp/core/commands/replace.tlisp:8`, `dired.tlisp:26`, `indent.tlisp:8`, `save.tlisp:8,11` call `(when …)`/`(unless …)` that do not exist. `examples/init.tlisp.example:83-89` attempts to *define* `when` as a macro using `&rest`, which the evaluator also rejects. These are time bombs.

**Shared prerequisite with [RFC-015](RFC-015-pattern-matching-and-destructuring.md):** the `&rest` macro-parameter work is identical. Land it once, both RFCs benefit.

### Step 1.1: `&rest` / `&body` in macro lambda-lists

**Where:** `src/tlisp/evaluator.ts`, `evalDefmacro` (~line 2046) and `parseLambdaParameters` (~line 1467).

**MUST:**
- `(defmacro foo (a &rest b) …)` defines a macro callable with ≥1 args; inside the body `b` is a T-Lisp list of the trailing arguments.
- `&body` is accepted as a synonym for `&rest` (purely cosmetic; identical semantics).
- `(defmacro foo (a b) …)` (no `&rest`) behaves exactly as today — identical arity error if called with the wrong count.
- `&rest` must be followed by exactly one symbol and be trailing-only. Validation errors return `EvalError` matching the existing parameter-validation shape.
- `&rest` with zero trailing args binds the rest param to `nil`, not an error.

**MUST NOT:**
- Change `defun` arity handling in this step (see Open Question Q1).
- Allow `&rest` mid-list.

**Acceptance criteria:**
- [ ] `(defmacro my-list (&rest xs) \`(list ,@xs))` then `(my-list 1 2 3)` → `(1 2 3)`.
- [ ] `(defmacro needs-two (a b) …)` still errors on 1 or 3 args with the existing message.
- [ ] `(defmacro f (a &rest b) …)` called as `(f 1)` binds `b` to `nil`.
- [ ] `bun run typecheck:src` passes.

### Step 1.2: `when` / `unless` as stdlib macros

**Where:** new `std/control` stdlib module (or inline in an existing control-flow module), registered via `src/tlisp/stdlib-assets.ts`.

**MUST:**
- `(when cond form…)` → `(if cond (progn form…) nil)`.
- `(unless cond form…)` → `(if cond nil (progn form…))`.
- Both return `nil` when the condition is not satisfied.
- Both accept one or more body forms.

**Acceptance criteria:**
- [ ] `(when t 1 2)` → `2`; `(when nil 1)` → `nil`.
- [ ] `(unless nil 1 2)` → `2`; `(unless t 1)` → `nil`.
- [ ] The five shipped `.tlisp` call sites compile and run without "unbound symbol `when`/`unless`" errors.
- [ ] `bun run typecheck:src` passes.

### Step 1.3: Fix the example init file

**Where:** `examples/init.tlisp.example`.

The file currently contains a hand-rolled `(defmacro when …)` that cannot work. Once Steps 1.1–1.2 land, remove that definition — `when` is now provided by `std/control`. This is a surgical edit to the example, not a rewrite.

**Acceptance criteria:**
- [ ] `examples/init.tlisp.example` loads without error in a standalone interpreter.

---

## Phase 2: Tier 2 — High-Value Idioms

Incremental; each item is independently shippable. Order below is a suggested sequence by value/effort. Each item ships its own tests.

### 2.1 `reduce`

**Why first:** plugs the obvious higher-order hole (`mapcar` + `filter` exist, the fold does not). Smallest item on the list.

**Where:** `src/tlisp/stdlib.ts` (a builtin, not a macro — it needs to call an arbitrary function).

**Signature:** `(reduce fn init list)` → accumulates `fn` over `list` starting from `init`. (CL's `(reduce fn list :initial-value init)` ordering is rejected as scope creep; pick the simpler positional form and document it.)

**Acceptance criteria:**
- [ ] `(reduce (lambda (a b) (+ a b)) 0 '(1 2 3))` → `6`.
- [ ] `(reduce (lambda (a b) (cons b a)) nil '(1 2 3))` → `(3 2 1)`.

### 2.2 The `push` / `pop` / `incf` / `decf` family

**Why:** counters and accumulators appear in every non-trivial command. These are the most-reached-for CL macros.

**Where:** `std/control` (or a new `std/place` module if a place abstraction is later wanted; for now, these operate on `defvar`/`defvar`-style global bindings via `set!`).

**MUST:**
- `(incf x)` / `(incf x n)` → read `x`, add 1 (or `n`), `set!` back.
- `(decf x)` / `(decf x n)` → same, subtract.
- `(push x place)` → `(set! place (cons x place))`.
- `(pop place)` → return `(car place)`, `(set! place (cdr place))`.

**Note on places:** this RFC restricts "place" to a symbol naming a variable. Generalized `setf` places are Tier 4 (out of scope). Document this restriction.

### 2.3 `format` (subset)

**Why:** there is no general formatter. Even a small directive set replaces many `string-append` + `number-to-string` chains.

**Where:** `src/tlisp/stdlib.ts` or a new `std/format` module.

**Subset:** `~a` (aesthetic), `~s` (sexp/quoted), `~d` (decimal), `~%` (newline), `~~` (literal tilde). Positional args consumed left-to-right.

**MUST NOT:** implement the full CL `format` mini-language (iteration `~{ ~}`, conditional `~[ ~]`, padding `~v`, etc.). Those are added piecemeal only when concrete editor code needs them.

### 2.4 `case` / `ecase`

**Where:** macro in `std/control`.

**MUST:**
- `(case key (vals form…) … (t form…))` — `vals` is a list of literal values to match against `key` (by `equal`). `t` clause is the default.
- `(ecase key …)` — same, but signals an `EvalError` if no clause matches and there is no `t` clause.

### 2.5 `dotimes`

**Where:** macro in `std/control`, desugars to `while` + a counter.

**MUST:** `(dotimes (var count [result]) body…)` — binds `var` from 0 to `count-1`, runs body; optional `result` form is evaluated and returned after the loop.

### 2.6 `labels` / `flet`

**Where:** evaluator special form, *or* macro if the environment supports the needed indirection. (Decide in implementation — flet/labels need local function bindings visible to each other for `labels`, which a macro can express via `let` + `setq` of function values.)

**MUST:**
- `(labels ((name (params) body…) …) body…)` — mutually recursive local functions.
- `(flet ((name (params) body…) …) body…)` — non-recursive local functions (the bindings do not see each other).

### 2.7 `gensym` + `macroexpand`

**Where:** `gensym` is a builtin in `src/tlisp/stdlib.ts` (returns a fresh uninterned symbol each call); `macroexpand` is an evaluator builtin that fully expands a macro call form and returns the expansion.

**Why:** hygienic macros and the ability to debug them. Required once macros grow beyond the trivial (RFC-015's `match` already notes this need in its Edge Cases).

### 2.8 `prog1` / `prog2`

**Where:** macro in `std/control`. Trivial.

---

## Phase 3: Tier 3 — Conditional, On Demand

Not scheduled. Pursued only when concrete editor code demonstrates the need, with its own sub-RFC. Listed here so the decision to defer is explicit rather than silent.

| Item | Trigger condition | Notes |
|---|---|---|
| `catch` / `throw` / `unwind-protect`, `block` / `return-from` | An abortable editor command needs nonlocal *success* exit that `Either` cannot express | Evaluator changes; do not replace `Either` for errors |
| Character value type + `#\a` reader | Editor code needs a real char distinct from 1-char string | New value tag in `types.ts`; reader support in `tokenizer.ts` |
| `defstruct` | A group of related records would be cleaner as named accessors than raw hashmaps | Macro; hashmaps cover most cases today |
| Reader dispatch `#'`, `#()` | Needed only if `labels`/`flet` or first-class function values become common enough that `(function name)` is too verbose | Small reader addition |

---

## Explicitly Out of Scope (Tier 4)

Recorded so these are not re-proposed without a new RFC that makes a specific, concrete case against an editor need.

| Feature | Reason rejected |
|---|---|
| CLOS / MOP (classes, generic functions, methods, metaobject protocol) | Huge cost, narrow payoff. Emacs Lisp has no CLOS. The existing `cond`/`case` dispatch and a future `defgeneric`/`defmethod` (per [clojure-lessons-for-tlisp.md](../memos/clojure-lessons-for-tlisp.md) §7, implementable as a library) cover the practical extensibility need at a fraction of the cost. |
| Full condition / restart system (`handler-bind`, `handler-case`, `define-condition`, `compute-restarts`, `invoke-restart`) | Very large. T-Lisp's `Either` is the chosen error idiom. The Tier 3 `catch`/`throw`/`unwind-protect` subset covers the practical nonlocal-exit need. |
| Full CL `LOOP` (`for … across`, `collect`, `sum`, `while`, `with`, etc.) | The mini-Loop (`while`/`dolist`/`dotimes`) covers ~90% of real editor code. The full `LOOP` is famously baroque. |
| Bignums / ratios / integer-vs-float type split | T-Lisp numbers are JS doubles. Editors do not need rationals. |
| CL package system (`defpackage`, `in-package`, `import`, `shadow`, `use-package`) | T-Lisp has a working module system (`defmodule`/`require-module`). Retrofitting CL packages would duplicate it under a second model. |
| `setf` / generalized references over arbitrary places | Compelling in CL, but T-Lisp's functional style (`hashmap-set` returns a new map) plus `set!` cover the practical cases. Generalized `setf` is a large subsystem. |
| Separate compilation / fasl files | T-Lisp is an interpreter. Not applicable. |

---

## Architecture Constraints

| Area | Governing doc | Rule |
|---|---|---|
| T-Lisp ownership | `src/tlisp/Claude.md` | All macro-layer work lives in T-Lisp. The only TypeScript touch is the `&rest` branch in `evalDefmacro`/`parseLambdaParameters` and any genuine evaluator special forms (`catch`/`throw`, Tier 3 only). No new primitives where a macro suffices. |
| Functional error handling | `rules/functional-programming.md`, `rules/tlisp.md` | Failures return `Either.left(EvalError)`. `catch`/`throw` (if added) model *success-with-abort*, not error propagation. No `try/catch` in new T-Lisp-side code. |
| Surgical changes | `CLAUDE.md` §3 | Phase 1 touches `evaluator.ts` (the `&rest` branch), `stdlib-assets.ts` (new module), and `examples/init.tlisp.example`. Phase 2 items touch `stdlib.ts` and new stdlib module files. Do not refactor adjacent code. |
| Type safety | `learnings.md` | Every phase passes `bun run typecheck` with zero errors before merge. Bun does not enforce types at runtime. |
| Scope discipline | `CLAUDE.md` §2 | Tier 4 stays out of scope. New value types (char) require a Phase 3 sub-RFC. |

## Open Questions

**Q1: Should `&rest`/`&body` land in `defun` too, or stay `defmacro`-only?**

[RFC-015](RFC-015-pattern-matching-and-destructuring.md) proposes `defmacro`-only to limit scope. This RFC inherits that default but notes the shared-infra argument: once `parseLambdaParameters` understands `&rest`, extending it to `defun` is cheap and removes a future inconsistency. **Recommendation:** implement in `defmacro` first (Phase 1.1), then extend to `defun` as a Phase 2 item if no issue surfaces. The answer does not block Phase 1.

**Q2: Where do the new macros live — global env, a single `std/cl` module, or per-feature modules (`std/control`, `std/format`, …)?**

The project precedent is per-feature modules (`std/strings`, `std/lists`). `when`/`unless`/`case`/`dotimes`/`prog1` naturally group into `std/control`; `format` into `std/format`; `push`/`pop`/`incf`/`decf` into `std/control` or `std/place`. **Recommendation:** per-feature, matching existing precedent. Do not create a catch-all `std/cl`.

**Q3: Is a `format` subset worth its own RFC, or does it land piecemeal?**

The directive set is small and well-defined (`~a ~s ~d ~% ~~`). **Recommendation:** land as a Phase 2 item in this RFC with the subset pinned in acceptance criteria; promote to its own RFC only if the directive set needs to grow beyond the subset.

## Design Decisions

| Decision | Rationale | Alternative rejected |
|---|---|---|
| Tier the work; do not pursue wholesale CL parity | CL is large; T-Lisp is an editor Lisp. Adopting CL wholesale would violate `CLAUDE.md` §2 (simplicity) and import subsystems (CLOS, conditions) with poor editor payoff. | "Make T-Lisp CL-compatible" — huge, low-payoff, conflicts with the module system and functional-error idiom already chosen. |
| Phase 1 is a bug fix, not a feature | `when`/`unless` are already used in shipped code; `&rest` is used in the example init. They are undefined today. Framing as a fix keeps scope tight. | Treat as a feature and bundle with Phase 2 — delays the fix and risks scope creep. |
| `&rest` work shared with RFC-015 | RFC-015 Phase 0 is the identical change. Land once. | Duplicate the work — violates surgical-changes principle. |
| `reduce` uses `(reduce fn init list)` positional form | Simpler than CL's keyword-laden `(reduce fn list :initial-value init)`. T-Lisp has no `&key` and adding it is out of scope. | Adopt CL `&key`-based signature — would force `&key` into the language for one function. |
| Tier 4 features explicitly listed as rejected | Prevents re-litigation. Each has a one-line reason. | Leave silent — invites repeated "why don't we have CLOS?" proposals. |
| No Roswell equivalent | The scripting capability already exists; binary distribution is free via `bun build --compile`; impl management is N/A; app distribution is Loom. | Build a Roswell clone — duplicates working features and pulls in irrelevant subsystems. |
| Places restricted to variables in `push`/`pop`/`incf` | Generalized `setf` places are a large subsystem (Tier 4). Variable-only covers the practical counter/accumulator cases. | Implement generalized `setf` now — scope creep. |
| Module organization is per-feature (`std/control`, `std/format`) | Matches existing precedent (`std/strings`, `std/lists`). | A single `std/cl` catch-all — hides what's actually used and grows unbounded. |

**Deferred to follow-up RFCs (when triggered):**
- Tier 3 `catch`/`throw`/`unwind-protect` — its own RFC when an abortable command needs it.
- Character value type + `#\a` — its own RFC when editor code needs a real char type.
- `defstruct` — its own RFC when a group of records demands named accessors.
- `defgeneric`/`defmethod` (multimethods) — overlaps [clojure-lessons-for-tlisp.md](../memos/clojure-lessons-for-tlisp.md) §7; library-level, no evaluator change; its own RFC when dispatch-on-type becomes a real pain.
