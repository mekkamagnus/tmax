# Gap Analysis: T-Lisp vs Common Lisp

**Date:** 2026-06-15
**Purpose:** Catalog the gaps between T-Lisp's current capabilities and Common Lisp, and decide what (if anything) is worth closing. Companion to [RFC-016](../rfcs/RFC-016-tlisp-common-lisp-parity.md).
**Related memos:** [standalone-tlisp-gap-analysis.md](standalone-tlisp-gap-analysis.md), [clojure-lessons-for-tlisp.md](clojure-lessons-for-tlisp.md), [elisp-pain-points.md](elisp-pain-points.md)

---

## Abstract

This memo compares T-Lisp against Common Lisp (CL) as a reference implementation of "a Lisp," and specifically addresses the question *should T-Lisp grow a Roswell-style scripting story?* The conclusion has two parts:

1. **On scripting:** T-Lisp already has the Roswell capability its users actually want (run scripts, REPL, `tlisp -e`, shebang support, `(load …)`). Roswell's other features (implementation manager, app distribution, Quicklisp integration) are either irrelevant to a single-implementation language or already covered for free by Bun. **Do not build a Roswell equivalent.**

2. **On language parity:** the highest-value gaps are not the glamorous CL features (CLOS, the condition system, bignums). They are, in order: two undefined macros (`when`/`unless`) and missing lambda-list keywords (`&rest`/`&body`) that **the codebase already uses in shipped `.tlisp` files** — these are latent bugs, not gaps. After that, a handful of Tier 2 idioms (`reduce`, `format`, the `push`/`pop`/`incf` family) would make T-Lisp productive to write rather than "CL with stubs."

Everything else — CLOS, the full condition/restart system, bignums/ratios, the full `LOOP` macro, a package system — is either too expensive for the payoff in an editor Lisp, or already has a T-Lisp-native answer (module system instead of packages; functional `Either` returns instead of conditions).

---

## Method

Findings were extracted by reading the interpreter source directly:

- Special forms: `src/tlisp/evaluator.ts` (`evalLet`, `evalDefmacro`, `parseLambdaParameters`, special-form dispatch table)
- Data types: `src/tlisp/types.ts`, `src/tlisp/values.ts`
- Stdlib surface: `src/tlisp/stdlib.ts`, `src/tlisp/test-framework.ts`, standalone profile additions
- Editor surface: `src/editor/tlisp-api.ts` + `src/editor/api/*.ts`
- Reader syntax: `src/tlisp/tokenizer.ts`
- Scripting surface: `src/tlisp/cli.ts`, `src/tlisp/repl.ts`, `src/editor/api/load-ops.ts`, `src/tlisp/module-loader.ts`

Each "gap" claim below is grounded in a file reference or an explicit grep result. Three claims were double-checked against source after initial findings, and one was corrected (see §"Corrections to initial findings").

---

## Question 1: Does T-Lisp need Roswell?

Roswell does five things. The table evaluates each against T-Lisp's actual status.

| Roswell capability | What it is | T-Lisp status | Verdict |
|---|---|---|---|
| **Run scripts** | `ros script.ros`, `ros -e EXPR`, REPL | ✅ Already present: `tlisp script.tlisp`, `tlisp -e EXPR`, `tlisp` (REPL). Shebang stripping at `cli.ts:29`. Multi-line REPL with `*1`/`*2`/`*3`/`*e` history at `repl.ts`. | **Already covered.** This is the capability you said you wanted. |
| **Impl management** | Install and switch between SBCL, CCL, ECL, ABCL, etc. | N/A — T-Lisp has exactly one implementation (itself). | **Irrelevant.** A single-implementation language has nothing to switch. |
| **Build standalone binary** | `ros build` → bundle a CL image into a self-contained executable | ✅ Free: `bun build --compile src/tlisp/cli.ts --outfile tlisp`. Bun bakes its runtime into the binary. Cross-compile via `--target`. | **Already covered, for free.** No Roswell needed. |
| **App distribution** | `ros install foo` fetches a CL app from a registry and makes it executable | That is a package registry, not a Roswell feature. Separate project (see [RFC-010 Loom](../rfcs/RFC-010-loom-package-manager.md)). | **Different project.** Out of scope for "Roswell-like." |
| **Quicklisp integration** | Pull deps from the CL library ecosystem | N/A — T-Lisp has no shared ecosystem. | **Irrelevant.** |

### Recommendation

**Do not build a Roswell equivalent.** The capability you want (run scripts) already exists. The capability that doesn't exist (standalone binaries) comes for free from Bun's compile flag and is a build-pipeline task, not a subsystem. The remaining Roswell features are either irrelevant (impl management) or separate projects (app distribution = Loom).

If a Roswell-style *workflow* (init script → run → build) is still desired for ergonomics, the entire feature is roughly:
- A `tlisp init` scaffolding command (new-project template)
- A shell wrapper around `bun build --compile`

That is an afternoon of work, not a subsystem. It belongs in [RFC-010 Loom](../rfcs/RFC-010-loom-package-manager.md) or its own small tooling RFC, not in a "Roswell clone" effort.

---

## Question 2: Language feature gaps

### What T-Lisp has today

Verified against source:

- **Special forms (complete):** `quote`, `quasiquote`/`unquote`/`unquote-splicing`, `if` (2- or 3-arg), `let` (parallel binding) and `let*` (sequential binding) — **correctly distinguished** at `evaluator.ts:1160-1161`, `lambda`, `defun`, `defmacro`, `cond`, `progn`, `while`, `dolist`, `and`, `or`, `defvar`, `set!`, `defmodule`/`require-module`/`provide`/`current-module`, test forms (`deftest`, `deftest-suite`, `deffixture`, `use-fixtures`, `assert-*`).
- **Data types:** nil, boolean, number (JS double), string, symbol, list, function, macro, hashmap, promise. (No vectors as a distinct type, no struct/CLOS, no character, no ratio/bignum.)
- **Numbers:** floats only. Tokenizer regex `/^-?\d+(\.\d+)?$/` (`parser.ts:293`). No hex/octal/binary/ratio/bignum literals.
- **TCO:** real tail-call optimization via `TailCall` trampoline (`evaluator.ts:201-244`).
- **Macros:** quasiquote with proper nesting depth; `defmacro` body evaluated in macro env with unevaluated args.
- **Higher-order:** `funcall`, `apply`, `mapcar`, `filter`, `identity`. **No `reduce`/`fold`.**
- **Modules:** `defmodule` with `export`, `require-module` with `:as`/`:import`, circular-dep detection. Not CL-style packages.
- **Reader syntax:** `'` / `` ` `` / `,` / `,@` / `;` line comments. No reader macros, no `#'`, no `#\a`, no `#()`, no `#| |#` block comments.
- **Scripting:** REPL, CLI (`tlisp`, `tlisp -e`, `tlisp script.tlisp`), `(load FILE)` with load-path, standalone module loader with path-traversal protection.

### Corrections to initial findings

During verification, one claim from the initial scan was corrected:

- **`let` vs `let*` are NOT conflated.** `evaluator.ts:1095` sets `isSequential` based on the form symbol; `:1160-1161` evaluates `let` bindings in the outer env (parallel semantics) and `let*` bindings in the new env (sequential). This is correct CL behavior. The conflation flagged in the first pass was wrong.

### Tier 1 — latent bugs (not gaps; fix immediately)

These are used by shipped code but not implemented. They will fail when their code paths execute.

| Feature | Evidence of use | Evidence of absence |
|---|---|---|
| `when` / `unless` | `src/tlisp/core/commands/replace.tlisp:8`, `dired.tlisp:26`, `indent.tlisp:8`, `save.tlisp:8,11`, plus `examples/init.tlisp.example:83-89` which tries to *define* `when` as a macro | No entry in the evaluator's special-form dispatch, no stdlib definition. The example init file's `(defmacro when (condition &rest body) …)` is itself broken (see next row). |
| `&rest` / `&body` in lambda-lists | `examples/init.tlisp.example` (in the `when` defmacro); idiomatic CL/Scheme | `parseLambdaParameters` (`evaluator.ts:1467+`) handles only required params and `&optional`/`optional`. Zero matches for `&rest`/`&body`/`&key` in the evaluator. `evalDefmacro` rejects non-symbol params (`evaluator.ts:2048-2057`). |

These are the single highest-value items to fix. They are small (two macros plus one lambda-list extension) and they stop `.tlisp` files from being time bombs. Note that [RFC-015](../rfcs/RFC-015-pattern-matching-and-destructuring.md) already requires `&rest` for macros as a prerequisite — the fix is shared.

### Tier 2 — high value, low cost

CL idioms that editor code reaches for constantly. All are small to implement and unlock real productivity.

| Feature | Why it matters for an editor Lisp | Effort |
|---|---|---|
| `incf`/`decf`/`push`/`pop` | Counters and accumulators in every non-trivial command | Trivial macros |
| `prog1` / `prog2` | "Return X but run Y for side effect" — cleanup idioms | Trivial |
| `dotimes` | Pairs with `dolist`; loop N times | Trivial |
| `case` / `ecase` | Constant-time dispatch on mode/event values; replaces `cond` chains | Small |
| `labels` / `flet` | Local recursive helpers without hoisting to top-level `defun` | Small-medium |
| `destructuring-bind` | Pairs with `&rest`; needed once lambda-list keywords land. Overlaps [RFC-015](../rfcs/RFC-015-pattern-matching-and-destructuring.md) `destructuring-let`. | Small-medium |
| `gensym` + `macroexpand` | Hygienic macros + the ability to debug them | Small |
| `reduce` / `fold` | Glaring hole: `mapcar` + `filter` exist, the third HOF does not | Trivial |
| `format` (subset) | No general formatter today. Even `~a`/`~s`/`~d`/`~%` replaces many `string-append` + `number-to-string` chains | Medium (full CL `format` is huge; a 20% subset is small) |

### Tier 3 — medium value, medium cost

| Feature | Notes |
|---|---|
| `catch`/`throw`/`unwind-protect` + `block`/`return-from` | Nonlocal exits. Editor commands abort mid-way frequently (cancel a search, abort a prompt). The current `Either` model covers *failure* but not *success-with-abort*. Worth doing. |
| `values` / `multiple-value-bind` | Idiomatic CL. Can be faked with lists today, so lower urgency. |
| Character type | Editors are character-oriented; T-Lisp fakes it with 1-char strings. Genuine need, not urgent. |
| `defstruct` | Nice-to-have; hashmaps cover most of it today. |
| Reader dispatch (`#'`, `#\a`, `#()`, `#t`) | `#'fn` matters only if `flet`/`labels` lands. `#\a` (char literal) matters more for an editor than for most Lisps. |

### Tier 4 — skip (expensive, low payoff for an editor Lisp)

| Feature | Why skip |
|---|---|
| **Full condition/restart system** | Very large. T-Lisp already has functional `Either` error flow. Emacs Lisp doesn't have this either. The `catch`/`throw`/`unwind-protect` subset (Tier 3) covers the practical need. |
| **CLOS / MOP** | Multimethods + metaobject protocol. Emacs doesn't have it. Huge cost, narrow payoff. |
| **Full CL `LOOP`** | The mini-Loop (`while`/`dolist`/`dotimes`) covers ~90% of real editor code. The real `LOOP` is famously baroque. |
| **Bignums / ratios / integer-vs-float split** | T-Lisp numbers are JS doubles. Editors don't need rationals. |
| **Full package system (`import`/`export`/`shadow`/`use-package`)** | T-Lisp has a working module system (`defmodule`/`require-module`). CL packages add complexity the module system doesn't need. |
| **Separate compilation / fasls** | T-Lisp is an interpreter. N/A. |
| **`setf` places / generalized references** | Compelling in CL, but T-Lisp's functional style (`hashmap-set` returns a new map) and `set!` cover the practical cases. `setf` over arbitrary places is a large subsystem. |

---

## Coupling matrix (what changes, what doesn't)

Mirroring the standalone-tlisp-gap-analysis format. Each row shows where the work lives.

| Gap tier | Touches `evaluator.ts`? | Touches `stdlib.ts` / new stdlib modules? | Touches `tokenizer.ts`/`parser.ts`? | New value types? |
|---|---|---|---|---|
| Tier 1 (`when`/`unless`, `&rest`/`&body`) | Yes — `&rest` branch in `parseLambdaParameters`/`evalDefmacro`. `when`/`unless` are pure macros. | `when`/`unless` as macros in stdlib | No | No |
| Tier 2 (`reduce`, `format`, `push`/`pop`/`incf`, `case`, `dotimes`) | `case`/`dotimes` are best as special forms or macros. Most of the rest are pure macros/stdlib. | Most of it | No | No |
| Tier 3 (`catch`/`throw`, char type, `defstruct`) | `catch`/`throw`/`unwind-protect` need evaluator support. Char type needs a new value tag. `defstruct` is a macro. | `defstruct` | Char literals need reader support (`#\a`) | Char type: yes |
| Tier 4 (CLOS, conditions, bignums, packages) | Large evaluator changes | Large | Some (reader syntax) | Some |

The clear pattern: **Tiers 1–2 are almost entirely macro-layer work** with one small evaluator touch (`&rest`). Tiers 3–4 are where the cost curve bends upward.

---

## What does NOT need to change

- The interpreter pipeline (tokenizer → parser → evaluator → environment) is sound.
- TCO is real and tested.
- The macro system + quasiquote is correct and complete enough for the Tier 1–2 work.
- The module system is a reasonable T-Lisp-native answer to CL packages; do not retrofit CL packages on top of it.
- Functional `Either` error flow is the project's chosen idiom (`rules/functional-programming.md`); do not replace it with conditions except where nonlocal *success* exits are genuinely needed (`catch`/`throw`).
- The scripting surface (CLI, REPL, `(load …)`, module loader) is already adequate. The Roswell instinct is satisfied.

---

## Recommended path

1. **Fix Tier 1 immediately** — it is a bug fix, not a feature. `when`/`unless` as macros; `&rest`/`&body` in macro (and then function) lambda-lists. The `&rest` work is shared with [RFC-015](../rfcs/RFC-015-pattern-matching-and-destructuring.md) Phase 0.
2. **Ship Tier 2 incrementally**, prioritizing `reduce` (smallest, plugs the obvious HOF hole), then the `push`/`pop`/`incf` family, then `format` (subset), then `case`/`dotimes`/`labels`.
3. **Defer Tier 3** until concrete editor code asks for it. The strongest case is `catch`/`throw`/`unwind-protect` for abortable commands.
4. **Skip Tier 4** unless a future RFC makes a specific, concrete case. Do not build CLOS or the full condition system speculatively.
5. **Do not build a Roswell equivalent.** Document the existing scripting surface instead, and treat standalone-binary distribution as a build-pipeline task using `bun build --compile`.

---

## Open questions (for RFC-016 to resolve)

- Should `&rest`/`&body` land in `defun` too, or stay `defmacro`-only (as RFC-015 proposes)? The shared-infra argument says both; the scope-discipline argument says start with `defmacro`.
- Is a `format` subset worth its own RFC, or does it land piecemeal as editor code needs directives?
- Where do the new macros live — global env, a `std/cl` module, or per-feature modules (`std/control`, `std/format`, …)?
