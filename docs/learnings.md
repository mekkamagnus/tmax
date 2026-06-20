# Learnings

## Type Safety: Bun does not enforce TypeScript

Bun strips types at runtime without checking them. `bun test` and `bun run start` pass even with hundreds of type errors. ALWAYS run `bunx tsc --noEmit` (or the `typecheck` script) after changes. The CI pipeline enforces this, but run it locally before pushing.

**Rule:** Every PR must pass `bun run typecheck` with zero errors.

## Architecture: Completion is editor logic

Treat completion and minibuffer behavior as editor logic under the Emacs C/Lisp split. T-Lisp owns completion tables, matching styles, annotations, candidate ordering, navigation, selection, key semantics, and commands. TypeScript may expose only factual/runtime/display primitives, generic frame-local transport, and rendering of a T-Lisp-produced view model.

## Workflow: Debug tmax through the daemon first

When debugging tmax, start with the daemon/client API (`tmaxclient --status`, `--frames`, `--messages`, `--key`, `--eval`) before creating tmux sessions or injecting terminal keys. Use the existing `tmax` tmux session for manual observation, and create isolated `tmax-ui-*` sessions only through the UI harness for renderer tests. Stale `tmax-ui-*` sessions should be audited before starting new manual sessions.

## Workflow: Resuming an adw stage requires `--id`

When resuming an interrupted adw pipeline stage by running a child dispatcher directly (e.g. `bun adws/adw-spec-review.ts <spec>` after the orchestrator's stage 2 timed out), **always pass `--id <workspace-id>`** to continue in the same workspace. Omitting `--id` mints a fresh workspace id, scattering the stage's events across a new `agents/{new-id}/` dir and breaking the single-workspace-per-spec contract.

**Rule:** To resume stage N of workspace `<id>`, run `bun adws/adw-<stage>.ts --id <id> <args>` — never the bare `bun adws/adw-<stage>.ts <args>`. The orchestrator passes `--id` automatically; manual resumes must do the same. If you forget, the errant workspace must be reconciled (events merged chronologically into the original `agents/{id}/`, then the errant dir deleted) — which is error-prone manual work.

**Corollary — the 10-minute task ceiling vs. real pipeline durations.** A full `plan → review → build` run takes 30–60+ minutes (plan ~8min, codex review ~5min, codex upgrade ~5min, `/implement` ~15–30min). Background tasks are killed at ~10 minutes. For live e2e pipeline runs, either run each stage separately (with `--id` to stay in one workspace) or accept that a single orchestrator invocation will be killed mid-flight. Don't expect one `bun adws/adw-plan-reviewspec-build.ts` call to complete inside the task ceiling.

## T-Lisp language gotchas (verified against src/tlisp)

Persistent surprises that cost real debugging time. Check these before assuming a `.tlisp` file is correct.

1. **`eq` does NOT work on symbols.** `(eq 'foo 'foo)` returns `nil`. Use `equal` for symbol/value comparison. The codebase idiom is `equal` (see `trt/assertions.tlisp:167` `(equal type-sym 'string)`); `eq` is only safe for numbers and the singleton `t`/`nil` booleans.
2. **String literals cannot span multiple lines.** A docstring like `"foo\nbar"` written across two source lines is an unterminated string. Keep docstrings on one line.
3. **`nil` is type `"nil"`, not an empty list.** `(cons 1 nil)` errors with "cons requires second argument to be a list". Seed list accumulators with `(list)`, not `nil`. `(null nil)` and `(null (list))` are both `t`, but `cons`/`listp` distinguish them (`(listp nil)` is `nil`).
4. **`t` is the boolean true, not a symbol.** A parameter named `t` — e.g. `(defun run (t) …)` — fails with "lambda parameter must be a symbol" (`paramType: "boolean"`). Rename to `task`/`thunk`/etc. Same applies to any binding name that collides with `t`/`nil`.
5. **`cond` clauses take exactly 2 elements** (condition + expression). Multiple body forms need `(progn …)`: `(t (progn a b))`, not `(t a b)`.
6. **Promises are transient — the async evaluator auto-unwraps every call result** (`evaluator.ts:2419`/`:2426`, `awaitIfPromise`). A promise returned by any function (including `make-promise`) is resolved at the call boundary and does not survive as a first-class value. You cannot bind a promise and later feed it to `promise-then`/`promise-value` — the binding holds the unwrapped value. `make-promise` supports deferred-async (its resolution becomes the enclosing expression's value) but not promise-as-value without an evaluator change (RFC-018 Step 1.4b).
7. **`async-let` only works under the async evaluator** (`executeAsync`). The standalone CLI's top level uses sync `execute`, so a top-level `async-let` form reports "Undefined symbol: async-let". Test async behavior through `interpreter.executeAsync!` (see `test/unit/tlisp-async.test.ts`), not the CLI.

**Rule:** when writing `.tlisp`, verify against the actual interpreter early (a `(require-module …)` + a few `(print …)` forms via `bun run src/tlisp/cli.ts`) rather than assuming Common-Lisp semantics. T-Lisp is Emacs-ish but has sharp edges above.
