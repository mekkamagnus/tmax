# Chore: T-Lisp functional-programming foundations (make-promise + core/monads)

## Chore Description

Document and lock in the Tier 1 functional-programming additions to T-Lisp that were implemented as part of RFC-018 (`docs/rfcs/RFC-018-tlisp-scripting-primitives.md`), Steps 1.4 and 1.5. These shipped a `make-promise` primitive (letting user T-Lisp code introduce its own deferred/async computation) and a `core/monads` module (`Option`/`Either`/`Result`/`Validation`/`State`/`Reader`/sync-`Task`), proving that every synchronous monad/applicative in `rules/functional-programming.md` is constructible in pure T-Lisp from closures + tagged lists — no new value types, no evaluator change.

This chore is the *paperwork* side of work that is already code-complete and tested: confirm the implementation is in place, the tests pass, the module resolves in both the editor and standalone runtimes, and the learnings are recorded. No new code is expected unless verification surfaces a regression.

### What was implemented
- **`make-promise`** (`src/tlisp/stdlib.ts`) — an async builtin producing a deferred computation from a zero-arg thunk. Ships the *deferred-async* behavior. Promise-*as-value* (holding/chaining a promise across steps) is blocked by the evaluator's call-result auto-unwrap (`evaluator.ts:2419`/`:2426`) and is tracked as RFC-018 Step 1.4b, NOT claimed here.
- **`core/monads`** (`src/tlisp/core/monads.tlisp`) — module `std/monads` exporting `Option`, `Either`, `Result`, `Validation`, `State`, `Reader`, sync `Task`. All built on tagged lists + closures.
- **Module loader** (`src/tlisp/module-loader.ts`) — `coreModulePaths` extended to resolve `std/*` modules under `coreRoot` (in addition to `editor/*`), so one physical file is the single source of truth for both runtimes.

### Tests
- `test/tlisp/monads.test.tlisp` — 28 trt tests (monad laws for `Either`/`Option`/`State`/`Reader`, `Validation` accumulation, `Task` laziness). 28/28 pass.
- `test/unit/tlisp-make-promise.test.ts` — 5 unit tests pinning deferred-async semantics. 5/5 pass.

## Relevant Files
Use these files to verify the chore is complete:

- `src/tlisp/stdlib.ts` — contains the `make-promise` async builtin (registered immediately after `promise-then`, ~line 184). Verify it exists and is wired via `defineAsyncBuiltin`.
- `src/tlisp/core/monads.tlisp` — the `std/monads` module. Verify it loads, paren-balances (no multi-line string literals — see learnings), and closes its `defmodule`.
- `src/tlisp/module-loader.ts` — `coreModulePaths` must accept both `editor/` and `std/` prefixes and resolve them under `coreRoot`.
- `test/tlisp/monads.test.tlisp` — the trt suite; must pass 28/28.
- `test/unit/tlisp-make-promise.test.ts` — the unit suite; must pass 5/5.
- `docs/rfcs/RFC-018-tlisp-scripting-primitives.md` — Steps 1.4, 1.4b, 1.5 document the design and the honest auto-unwrap limitation.
- `docs/learnings.md` — "T-Lisp language gotchas" section records the six sharp edges hit during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Confirm `make-promise` is registered and behaves
- Verify `make-promise` is defined in `src/tlisp/stdlib.ts` via `defineAsyncBuiltin`, mirroring the `promise-then` shape (asyncMode guard, `resolveCallable` on the thunk, `TypeError` for non-callable thunk).
- Confirm it is *not* re-exported or duplicated anywhere.

### Confirm `core/monads` module loads in both runtimes
- Load via the editor runtime (`tmax --test` path resolves `std/monads` from `src/tlisp/core`).
- Load via the standalone interpreter (`createStandaloneInterpreter` resolves `std/monads` from the default `coreRoot` `src/tlisp/core`).
- Confirm the file's `defmodule` form is closed (final `)`) and contains no multi-line string literals.

### Confirm the loader change is correct and isolated
- `src/tlisp/module-loader.ts` `coreModulePaths` must branch on `editor/` OR `std/` prefixes only; all other resolution paths (embedded modules, `searchRoots`, plugin candidates) unchanged.
- Confirm existing `editor/*` and `std/strings`/`std/lists` resolution still works (the module-system tests must remain green).

### Verify learnings are recorded
- `docs/learnings.md` "T-Lisp language gotchas" section must list: `eq` fails on symbols (use `equal`), no multi-line strings, `nil`≠empty-list for `cons`/`listp`, `t` cannot be a parameter name, `cond` clauses take exactly 2 elements, promise auto-unwrap, `async-let` requires `executeAsync`.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run typecheck:src` — TypeScript clean for src (must exit 0).
- `bun run typecheck:test` — TypeScript clean for test (must exit 0).
- `bun run typecheck` — Full typecheck (must exit 0).
- `bun test test/unit/tlisp-make-promise.test.ts --timeout 30000` — make-promise unit tests (5/5 pass).
- `bun test test/unit/module-system.test.ts --timeout 30000` — module loader regressions (the `std/*` resolution change must not break existing resolution).
- `bun run src/tlisp/cli.ts -e "(require-module std/monads)"` then a follow-up form exercising each construct — confirms the module loads and is callable in the standalone runtime. Concretely:
  - `bun run src/tlisp/cli.ts -e "(progn (require-module std/monads) (print (either-bind (either-right 5) (lambda (x) (either-right (+ x 1))))))"` → prints `(right 6)`.

## Notes

- **Promise-as-value is explicitly out of scope for this chore.** RFC-018 Step 1.4b tracks the surgical evaluator change (`held` flag on `TLispPromise`) needed for the async `Task`/`TaskEither` family. Do NOT claim promises are first-class values; they are transient under auto-unwrap (`evaluator.ts:2419`/`:2426`).
- **Compiled-binary parity is a known gap (RFC-018 Q6).** `std/monads` resolves from disk via `coreRoot`, which works for the project default (`bun` from source). A `bun build --compile` binary would need `std/monads` added to `STANDALONE_STDLIB_MODULES` (`src/tlisp/stdlib-assets.ts`). Not required for this chore since the project runs from source.
- This chore is documentation/verification only — the implementation already landed alongside RFC-018. If any validation command fails, treat it as a regression to fix, not new feature work.
