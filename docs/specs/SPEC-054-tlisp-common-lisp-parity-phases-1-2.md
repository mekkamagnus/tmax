# Feature: T-Lisp Common Lisp Parity — Phases 1 & 2

## Feature Description

Implements Phase 1 (latent-bug fixes) and Phase 2 (high-value idioms) of [RFC-016: T-Lisp Common Lisp Parity Additions](../rfcs/RFC-016-tlisp-common-lisp-parity.md).

T-Lisp is an editor Lisp, *not* a Common-Lisp conformance effort. This feature closes the highest-value CL-parity gaps that real editor code (shipped `.tlisp` files) either already depends on or will reach for next:

- **Phase 1 — bug fixes:** shipped command files call `when`/`unless` that don't exist, and the example init file defines a `when` macro via `&rest` that the evaluator rejects. These are time bombs that fire the moment their code paths run.
- **Phase 2 — idioms:** `reduce`, `push`/`pop`/`incf`/`decf`, a `format` subset, `case`/`ecase`, `dotimes`, `labels`/`flet`, `gensym`/`macroexpand`, and `prog1`/`prog2`. Each fills a concrete gap (no fold, no counters/accumulators, no general formatter, no value dispatch, no local recursion, no macro hygiene/debug).

**Governing principles (from RFC-016):** macro-layer first (ship as T-Lisp macros where possible; evaluator changes only where macros cannot express the semantics), `Either`-returning error handling stays the idiom (no `try/catch` in new T-Lisp-side code), no new value types, no speculative subsystems (CLOS, conditions, full `LOOP`, CL packages, `setf` places all stay out of scope).

## User Story

As a **T-Lisp author writing editor commands and init files**,
I want **`when`, `unless`, `&rest`/`&body` macro params, and the common CL control-flow/data idioms to exist and behave like their CL counterparts**,
So that **shipped code stops failing on undefined forms, and new editor code can be written readably without hand-rolling counters, folds, and dispatch every time**.

## Problem Statement

1. **Latent bugs in shipped code.** Five `.tlisp` files call `when`/`unless`, which are not implemented: `src/tlisp/core/commands/replace.tlisp:8`, `dired.tlisp:26`, `indent.tlisp:8`, `save.tlisp:8,11`. Separately, `examples/init.tlisp.example:83-89` *defines* `when` as a macro using `&rest`, but `evalDefmacro` rejects `&rest` in lambda-lists. Any user who triggers these commands, or who copies the example init, gets an "unbound symbol" / parameter-validation error.
2. **Missing everyday idioms.** T-Lisp has `mapcar`/`filter` but no `reduce`; no counter/accumulator macros; no general formatter (only `string-append` + `number-to-string` chains); no value-dispatch (`case`); no bounded-counting loop (`dotimes`); no local mutual recursion (`labels`); no macro hygiene (`gensym`) or macro debug (`macroexpand`). Every non-trivial command re-implements these.

## Pre-existing Bugs (inventory of shipped code calling undefined forms)

A scan of `src/tlisp/core/**/*.tlisp` against the current interpreter found **three** undefined forms already depended on by shipped code. This SPEC fixes two of them (#1 `when`/`unless` in Phase 1, #3 `format` in Phase 2.3); the third (#2 `return-from`) is explicitly out of scope. They are documented here so the gap is explicit rather than silent.

1. **`when` / `unless`** — *fixed by Phase 1.2 (in scope).* Five call sites in shipped commands: `replace.tlisp:8`, `dired.tlisp:26`, `indent.tlisp:8`, `save.tlisp:8,11`. Neither macro is defined today; triggering any of these commands errors with an unbound symbol. `examples/init.tlisp.example:83-89` also attempts to define `when` via `&rest`, which the evaluator rejects. This SPEC closes the hole (Steps 1–3).

2. **`return-from`** — *not fixed; Tier 3, out of scope.* Two call sites: `replace.tlisp:10` (`(return-from query-replace)`) and `save.tlisp:10` (`(return-from save-buffer)`). `return-from`/`block` is a nonlocal-exit feature that RFC-016 defers to its own sub-RFC (§"Deferred to follow-up RFCs"). After this SPEC, those two sites get past `when`/`unless` but **still fail** on `return-from`. Fixing them is out of scope here.

3. **`format`** — *fixed by Phase 2.3 (in scope).* `markdown.tlisp` calls `format` **29 times**, yet `format` is **not implemented** as a builtin today (`grep` for `defineBuiltin("format")` / `env.define("format"` returns nothing). The shipped call sites use **C-style** directives — `%s` (69 occurrences) and `%d` (40) — e.g. `(format "%d: %s" (+ i 1) text)`, `(format "<h%d>%s</h%d>" level title level)`. RFC-016 Phase 2.3 specifies **CL-style** directives (`~a ~s ~d ~% ~~`). The two are incompatible. **Decision: support BOTH styles** (C-style `%s`/`%d`/`%%` and CL-style `~a`/`~s`/`~d`/`~%`/`~~`) so the 29 existing `markdown.tlisp` call sites work unchanged and RFC-016's CL-style surface is honored too. See Step 6 for the directive set and acceptance tests.

> Note: `markdown.tlisp` also contains the words `reduce`/`push`/`pop` but only as English prose in comments/strings (e.g. `"reduce heading level by 1"`, `~strikethrough~`) — not as form calls. They are not bugs.

## Solution Statement

Land RFC-016 Phases 1 and 2 in tier order. Each addition ships as the *simplest* form that satisfies editor needs:

- **Evaluator change (Phase 1.1 only):** extend `evalDefmacro` (+ its param validation) to parse a trailing `&rest`/`&body` keyword and bind the trailing args as a T-Lisp list. This is the *only* TypeScript evaluator change in either phase — everything else is macros or stdlib builtins.
- **Global macros (Phase 1.2, 2.x):** `when`, `unless`, `case`, `ecase`, `dotimes`, `prog1`, `prog2`, `push`, `pop`, `incf`, `decf`, `labels`, `flet` ship as T-Lisp macros. Because shipped command files use `when`/`unless` **unqualified** (no `require-module`), these must be registered into the **global builtins environment**, not an on-demand `std/control` module. *(See Design Decisions — this is a deviation from RFC-016 §1.2's stated location, forced by how the codebase resolves symbols.)*
- **Stdlib builtins (Phase 2.x):** `reduce`, `gensym`, `macroexpand`, and the `format` subset ship as TS builtins (they need to call arbitrary functions / mint fresh symbols / inspect macro state), registered alongside existing `mapcar`/`filter` in `stdlib.ts`.

All changes pass `bun run typecheck` with zero errors, and every form has a unit test derived from RFC-016's acceptance criteria.

## Relevant Files

Use these files to implement the feature:

- **`src/tlisp/evaluator.ts`** — the only evaluator touch. `evalDefmacro` (~line 2096) and its parameter-validation loop (~2138) gain `&rest`/`&body` parsing; the macro-call closure (~2150) binds the rest param. `createEvaluatorWithBuiltins` (~3590) is where `when`/`unless` and the other global macros are registered into `builtinsEnv` (mirror the existing `env.define("null", …)` pattern at ~3984). `macroexpand` needs read access to macro definitions and the evaluator's `eval` — registered here too.
- **`src/tlisp/stdlib.ts`** — `registerStdlibFunctions` (~line 53). Add `reduce`, `gensym`, and the `format` subset as builtins alongside `mapcar`/`filter` (~198–212). `reduce`/`format` need `call(fn, args)` like the existing higher-order builtins; `gensym` mints fresh uninterned symbols.
- **`src/tlisp/types.ts`** — `LambdaParameter` interface lives in `evaluator.ts:66`; `gensym` needs the symbol value shape (uninterned marker if one exists, else a unique `#:<n>` name convention).
- **`examples/init.tlisp.example`** — remove the now-broken hand-rolled `(defmacro when …)` / `(defmacro unless …)` at lines 83–89 (they become redundant once `when`/`unless` are global macros).

### New Files

- **`test/unit/tlisp-common-lisp-parity.test.ts`** — unit tests for every new form, each derived from RFC-016's acceptance criteria (the `(when t 1 2)` → `2` examples, etc.). Uses the established `createEvaluatorWithBuiltins` + `TLispParser` pattern from `test/unit/macros.test.ts`.

## Implementation Plan

### Phase 1: Foundation

The `&rest`/`&body` change is the foundation: Phase 1.2 (`when`/`unless`) and several Phase 2 macros (`case`, `dotimes`, `prog1`, `labels`) are themselves defined *as macros that use `&rest`* — so they cannot be written until the evaluator accepts `&rest` in `defmacro`. This is also the shared prerequisite with [RFC-015 Phase 0](../rfcs/RFC-015-pattern-matching-and-destructuring.md); landing it once satisfies both RFCs.

### Phase 2: Core Implementation

- `evalDefmacro` `&rest`/`&body` branch (Phase 1.1) — the lone evaluator change.
- Global macros registered in `builtinsEnv`: `when`, `unless` (Phase 1.2), then `case`/`ecase`/`dotimes`/`prog1`/`prog2`/`push`/`pop`/`incf`/`decf`/`labels`/`flet` (Phase 2).
- Stdlib builtins in `stdlib.ts`: `reduce`, `gensym`, `macroexpand`, `format` subset (Phase 2).

### Phase 3: Integration

- Surgical fix to `examples/init.tlisp.example` (remove the now-redundant broken macro defs).
- Verify the five shipped `.tlisp` call sites (`replace`, `dired`, `indent`, `save`) compile past `when`/`unless` without "unbound symbol" errors. *(Note: `save.tlisp:10` and `replace.tlisp:8` also use `return-from`, which is a Tier 3 feature explicitly out of Phase 1/2 scope — those remain unfixed by this SPEC and are flagged in Notes.)*
- Run `bun run typecheck`, the new test file, and the full unit suite to confirm zero regressions.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1 — `&rest`/`&body` in `defmacro` lambda-lists (Phase 1.1)

- [ ] In `evalDefmacro` (`src/tlisp/evaluator.ts` ~2096), after extracting `paramList = parameters.value as TLispValue[]`, scan for a trailing `&rest` or `&body` symbol. It must be the **second-to-last** element, followed by exactly one symbol (the rest-param name). Reject: `&rest` not followed by a symbol, `&rest` appearing twice, `&rest` not trailing, or `&rest`/`&body` as the only element. Return `EvalError` with the existing `{type:'EvalError', variant:'TypeError', details:{...}}` shape.
- [ ] Split `paramList` into `requiredParams` (everything before `&rest`) and `restParamName` (the symbol after). Keep `&body` as a pure cosmetic alias for `&rest` (identical semantics).
- [ ] Update the macro-call closure (~2150): the arity check becomes `if (args.length < requiredParams.length)` (was `!== paramList.length`). Bind each required param to `args[i]` as today; bind `restParamName` to a T-Lisp `list` of `args.slice(requiredParams.length)` (empty → `createList([])`, which is truthy-nil-equivalent). Verify against acceptance: `(defmacro my-list (&rest xs) \`(list ,@xs))` then `(my-list 1 2 3)` → `(1 2 3)`; `(defmacro f (a &rest b) …)` called as `(f 1)` binds `b` to `nil`.
- [ ] Do **not** touch `defun`/`parseLambdaParameters` — `&rest` is `defmacro`-only in Phase 1 (RFC-016 Open Question Q1; `defun` extension is a possible later Phase 2 item).
- [ ] Add unit tests: `&rest` collects trailing args; `&rest` with zero trailing → `nil`; `&body` is a synonym; a macro with no `&rest` still errors on wrong arity with the existing message; malformed `&rest` (no following symbol, mid-list, duplicate) returns `EvalError`.

### Step 2 — `when` / `unless` as global macros (Phase 1.2)

- [ ] In `createEvaluatorWithBuiltins` (`src/tlisp/evaluator.ts` ~3590), register `when` and `unless` into `builtinsEnv` (the `env` variable) as macros, mirroring how `defmacro` calls store macros via `createMacro`. Define them in TS as expansion functions producing `(if cond (progn body…) nil)` / `(if cond nil (progn body…))`, OR bootstrap them by executing `defmacro` forms against the env — whichever matches the existing `createMacro(macroFn, name)` + `env.define(name, macro)` pattern already used at evaluator.ts:2184–2185.
- [ ] Semantics per RFC-016: `(when cond form…)` → `(if cond (progn form…) nil)`; `(unless cond form…)` → `(if cond nil (progn body…))`; both return `nil` when the condition is unsatisfied; both accept ≥1 body forms.
- [ ] They are **global** (not behind `require-module`) because the shipped command files use them unqualified. Do not create `std/control` for this — see Design Decisions.
- [ ] Add unit tests: `(when t 1 2)` → `2`; `(when nil 1)` → `nil`; `(unless nil 1 2)` → `2`; `(unless t 1)` → `nil`; multi-form body returns the last.

### Step 3 — Fix the example init file (Phase 1.3)

- [ ] In `examples/init.tlisp.example`, delete the hand-rolled `(defmacro when …)` and `(defmacro unless …)` at lines ~83–89. Leave `save-and-quit` and other unrelated macros untouched.
- [ ] Acceptance: the example loads in a standalone interpreter without error (verify with a quick `execute()` of its source in a test or one-off check).

### Step 4 — `reduce` stdlib builtin (Phase 2.1)

- [ ] In `src/tlisp/stdlib.ts` `registerStdlibFunctions`, add `reduce` next to `mapcar`/`filter` (~198). Signature `(reduce fn init list)` — **positional**, NOT CL's keyword form. Accumulate `fn` left-to-right over `list` starting from `init`, using the existing `call(args[0]!, [acc, item])` pattern.
- [ ] Validation: exactly 3 args, `args[0]` callable, `args[2]` a list; else throw with a message matching the `"reduce requires a function, initial value, and list"` style of neighbors.
- [ ] Tests: `(reduce (lambda (a b) (+ a b)) 0 '(1 2 3))` → `6`; `(reduce (lambda (a b) (cons b a)) nil '(1 2 3))` → `(3 2 1)`; empty list returns `init`.

### Step 5 — `push` / `pop` / `incf` / `decf` macros (Phase 2.2)

- [ ] Register in `builtinsEnv` as macros (variable-place-only; RFC-016 restricts "place" to a symbol naming a variable).
  - `(incf x)` / `(incf x n)` → read `x`, add 1 or `n`, `(set! x …)`.
  - `(decf x)` / `(decf x n)` → same, subtract.
  - `(push x place)` → `(set! place (cons x place))`.
  - `(pop place)` → return `(car place)`, then `(set! place (cdr place))`.
- [ ] Document in a comment that generalized `setf` places are Tier 4 / out of scope.
- [ ] Tests: `(defvar c 0) (incf c) (incf c 5)` → `c` is `6`; `(defvar s nil) (push 1 s) (push 2 s)` → `(2 1)`; `(pop s)` returns `2` and leaves `s` as `(1)`.

### Step 6 — `format` subset builtin (Phase 2.3)

**Decision (locked): support BOTH `%`-style and `~`-style directives.** This avoids touching the 29 existing `markdown.tlisp` call sites (C-style) while honoring RFC-016's CL-style spec. Both styles share one argument stream, consumed left-to-right.

- [ ] In `stdlib.ts`, add `format` builtin supporting both directive families:
  - **CL-style** (RFC-016): `~a` (aesthetic/princ), `~s` (sexp/quoted), `~d` (decimal), `~%` (newline), `~~` (literal tilde).
  - **C-style** (matches shipped `markdown.tlisp`): `%s`, `%d`, `%%` (literal percent).
  - Scan the format string left-to-right; each directive consumes the next positional arg. `~%`, `~~`, and `%%` consume **no** args.
  - Unknown directive → `EvalError`/throw with the offending directive in the message.
- [ ] MUST NOT implement `~{ ~}`, `~[ ~]`, `~v`, `%f`/padding/width/iteration, or full CL mini-language (Tier 4-style scope creep). The set above is the complete directive set.
- [ ] Tests:
  - CL-style: `(format nil "Sum: ~d" 42)` → `"Sum: 42"`; `(format nil "~a and ~s" 'x 'y)` → `"x and …"`; `~%` → `"\n"`; `~~` → `"~"`.
  - C-style: `(format nil "%d: %s" 1 "x")` → `"1: x"`; `(format nil "100%%")` → `"100%"`.
  - Mixed (both styles, shared arg stream): `(format nil "~a = %d" 'x 5)` → `"x = 5"`.
  - Unknown directive errors (both styles): `(format nil "~z" 1)` and `(format nil "%x" 1)` error.
  - Shipped integration: at least 3 representative `markdown.tlisp` format calls produce expected output (e.g. `(format "%d: %s" 1 "x")` → `"1: x"`, `(format "<h%d>%s</h%d>" 1 "t" 1)` → `"<h1>t</h1>"`).

### Step 7 — `case` / `ecase` macros (Phase 2.4)

- [ ] Register in `builtinsEnv`. `(case key (vals form…) … (t form…))` — `vals` is a list of literal values matched against `key` by `equal`; `t` clause is the default. `(ecase key …)` — same, but signals `EvalError` if no clause matches and there is no `t` clause.
- [ ] Implement as a macro that expands to a `cond` chain over `(equal key 'v)` tests, with the `t` clause as the fallback.
- [ ] Tests: dispatch to the matching clause; `t` default fires when no match; `ecase` errors on no-match-without-default; a clause with a list of values matches any of them.

### Step 8 — `dotimes` macro (Phase 2.5)

- [ ] Register in `builtinsEnv`. `(dotimes (var count [result]) body…)` — bind `var` from `0` to `count-1`, run body each iteration; optional `result` form evaluated and returned after the loop. Desugar to `while` + a counter (or a TS builtin loop if the macro desugaring is awkward — prefer macro per RFC-016).
- [ ] Tests: `(dotimes (i 3) (push i acc))` accumulates `(2 1 0)`; `result` form returned; `count` of `0` runs zero times and returns the `result`/`nil`.

### Step 9 — `labels` / `flet` (Phase 2.6)

- [ ] Register in `builtinsEnv`. `(labels ((name (params) body…) …) body…)` — mutually recursive local functions (bindings see each other). `(flet ((name (params) body…) …) body…)` — non-recursive (bindings do not see each other).
- [ ] RFC-016 allows either an evaluator special form or a macro. Prefer a macro implemented via `let` + `set!` of function values if the environment supports the needed indirection; only add an evaluator special form if a macro cannot express mutual recursion. Document the choice in a comment.
- [ ] Tests: `labels` with two mutually-recursive functions computes correctly (e.g., a tiny even?/odd? pair); `flet` binding shadows a global and does **not** see its sibling binding.

### Step 10 — `gensym` + `macroexpand` (Phase 2.7)

- [ ] `gensym` in `stdlib.ts` — returns a fresh uninterned symbol each call. Use a monotonic counter and a `#:<n>` (or `#:G<n>`) name convention; ensure two successive calls produce symbols that are not `equal`.
- [ ] `macroexpand` as an evaluator builtin — takes a form, fully expands a macro call and returns the expansion (a non-macro form returns itself). Needs read access to macro definitions from the env; place the builtin in `evaluator.ts` where it can reach the macro lookup path.
- [ ] Tests: `(gensym)` twice → distinct, non-`equal` symbols; `(macroexpand '(when t 1))` → `(if t (progn 1) nil)` (or the registered expansion); `(macroexpand '(+ 1 2))` → `(+ 1 2)` (non-macro form unchanged).

### Step 11 — `prog1` / `prog2` macros (Phase 2.8)

- [ ] Register in `builtinsEnv`. `(prog1 first rest…)` → evaluate all, return the first's value. `(prog2 first second rest…)` → evaluate all, return the second's value. Trivial desugar to `let` + `progn`.
- [ ] Tests: return value and side-effect ordering.

### Step 12 — Validation

- [ ] Run `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck` — zero errors.
- [ ] Run `bun test test/unit/tlisp-common-lisp-parity.test.ts` — all new tests pass.
- [ ] Run `bun test test/unit/macros.test.ts test/unit/evaluator.test.ts test/unit/evaluator-either.test.ts` — no regressions in macro/evaluator behavior.
- [ ] Run `bun test` — full unit suite green.
- [ ] Manually confirm the five shipped `.tlisp` call sites parse/expand past `when`/`unless` (e.g., `(require-module 'editor/commands/replace)` loads without "unbound symbol `when`").

## Testing Strategy

### Unit Tests

All new tests live in `test/unit/tlisp-common-lisp-parity.test.ts`, using the established `createEvaluatorWithBuiltins` + `TLispParser` + `Either` pattern (see `test/unit/macros.test.ts:1-40`). Each form has ≥3 cases drawn directly from RFC-016 acceptance criteria: a happy path, a boundary case, and an error/edge case.

### Integration Tests

No new integration test files required for the language forms. The integration signal is: the shipped command modules (`editor/commands/replace`, `dired`, `indent`, `save`) load and expand `when`/`unless` without error (covered by Step 12's manual module-load check).

### Edge Cases

- `&rest` with **zero** trailing args → binds the rest param to `nil`/empty list, **not** an error.
- `&body` treated as a byte-for-byte synonym of `&rest`.
- `when`/`unless` with a single body form (no `progn` needed, but desugar uniformly).
- `case` with a clause whose values list is itself a list of literals; `t` default; `ecase` error path.
- `reduce` over an empty list returns `init` unchanged.
- `format` with fewer args than directives (error or omit — pick error, document it) and with an unknown directive (error).
- `gensym` uniqueness across many calls; `macroexpand` on a non-macro form is identity.
- `labels` mutual recursion actually recurses; `flet` shadowing does not leak to siblings.

## Acceptance Criteria

Phase 1 (bug fixes — must land first):
- [ ] `(defmacro my-list (&rest xs) \`(list ,@xs))` then `(my-list 1 2 3)` → `(1 2 3)`.
- [ ] `(defmacro needs-two (a b) …)` still errors on 1 or 3 args with the existing message.
- [ ] `(defmacro f (a &rest b) …)` called as `(f 1)` binds `b` to `nil`.
- [ ] `(when t 1 2)` → `2`; `(when nil 1)` → `nil`; `(unless nil 1 2)` → `2`; `(unless t 1)` → `nil`.
- [ ] The five shipped `.tlisp` call sites compile and expand `when`/`unless` without "unbound symbol" errors.
- [ ] `examples/init.tlisp.example` loads without error in a standalone interpreter.

Phase 2 (idioms — each independently shippable, each with its own passing tests):
- [ ] `(reduce (lambda (a b) (+ a b)) 0 '(1 2 3))` → `6`; `(reduce (lambda (a b) (cons b a)) nil '(1 2 3))` → `(3 2 1)`.
- [ ] `incf`/`decf`/`push`/`pop` operate on variable places as specified.
- [ ] `format` handles `~a ~s ~d ~% ~~` and errors on unknown directives; no iteration/conditional/padding directives.
- [ ] `case` dispatches by `equal`; `ecase` errors on no-match-without-default.
- [ ] `dotimes` runs body `count` times and returns the optional `result` form.
- [ ] `labels` supports mutual recursion; `flet` bindings do not see each other.
- [ ] `gensym` returns fresh non-`equal` symbols; `macroexpand` fully expands macro calls and is identity on non-macros.
- [ ] `prog1`/`prog2` return the first/second value with full side-effect ordering.

Cross-cutting:
- [ ] `bun run typecheck`, `bun run typecheck:src`, `bun run typecheck:test` all pass with zero errors.
- [ ] `bun test` full unit suite green; no regressions in `macros.test.ts` / `evaluator*.test.ts`.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Every command must execute without errors.

- `bun run typecheck:src` — typecheck the `src/` changes (evaluator + stdlib).
- `bun run typecheck:test` — typecheck the new test file.
- `bun run typecheck` — aggregate typecheck (the CI gate; `learnings.md`: Bun does not enforce types at runtime, this does).
- `bun test test/unit/tlisp-common-lisp-parity.test.ts` — the new forms' acceptance-criteria tests.
- `bun test test/unit/macros.test.ts test/unit/evaluator.test.ts test/unit/evaluator-either.test.ts` — confirm the `&rest` change and global macros did not regress existing macro/evaluator behavior.
- `bun test` — full unit suite; zero regressions.

## Notes

### Architecture deviation from RFC-016 §1.2 (intentional)
RFC-016 §1.2 says `when`/`unless` go in a new `std/control` stdlib module. **That will not work here:** the shipped command files (`replace.tlisp`, `dired.tlisp`, `indent.tlisp`, `save.tlisp`) use `when`/`unless` **unqualified** and contain **no** `(require-module "std/control")`. Symbol resolution walks from the module's local env up through `builtinsEnv`; an on-demand `std/control` module would never be loaded. Therefore `when`/`unless` (and the other always-wanted control macros) must be registered into the **global builtins environment** (`env` in `createEvaluatorWithBuiltins`), alongside `null`/`+`/etc. This matches the RFC's *intent* (make shipped code work) while diverging only on *placement*. Flagged for the RFC author; if they prefer `std/control` + an autoload mechanism, that is a separate change to the module loader and is out of this SPEC's scope.

### Pre-existing bugs in shipped code (full inventory)
See the **Pre-existing Bugs** section above for the complete inventory. Summary: of three undefined forms already depended on by shipped code, this SPEC fixes `when`/`unless` (#1, Phase 1) and `format` (#3, Phase 2.3 — supporting **both** `%`- and `~`-style directives), and does **not** fix `return-from` (#2, Tier 3, out of scope). After this SPEC, `replace.tlisp:10` and `save.tlisp:10` will still fail on `return-from`; that needs its own sub-RFC per RFC-016 §"Deferred to follow-up RFCs". Do **not** expand scope to fix `return-from` here.

### Shared prerequisite with RFC-015
The `&rest`-in-`defmacro` work (Step 1) is identical to [RFC-015 Phase 0](../rfcs/RFC-015-pattern-matching-and-destructuring.md). Landing it in this SPEC satisfies both RFCs; cross-link the commit so RFC-015's Phase 0 checkpoint can be marked done.

### What stays out (Tier 4, do not re-propose without a new RFC)
CLOS/MOP, full condition/restart system, full `LOOP`, bignums/ratios, CL package system, generalized `setf` places, separate compilation/fasl. See RFC-016 §"Explicitly Out of Scope".

### No new dependencies
Zero external dependencies are added (project constraint: zero deps, runs on Bun). `reduce`/`format`/`gensym` are plain TS using existing `call`, `createList`, `createSymbol` helpers. No `uv add` / `bun add` needed.
