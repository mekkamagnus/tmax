# Learnings

## Workflow: Repository-local tmax must run repository code

When `tmax` is invoked from inside the tmax repository, launcher and demo validation must prove that the daemon and client originate from the current checkout. A globally installed `tmax` is not an acceptable substitute, even when it appears earlier on `PATH`. Tests and playbooks that claim to exercise normal launch behavior must use the same repository-local entry path a developer uses and must detect stale or foreign daemon code.

**Rule:** Reproduce launcher and UI behavior through the repository-local `tmax` command, verify the daemon/client source identity, and reject stale global or pre-refactor processes before accepting an e2e result.

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

## Workflow: Never delete a worktree that has uncommitted implementation files

When a build stage fails at a **gate** (typecheck, e2e) but claude's `/implement` dispatch **succeeded**, the worktree contains ~50 minutes of uncommitted implementation work. Deleting the worktree (`git worktree remove --force` + `rm -rf agents/<id>`) throws all of it away. The orchestrator will re-dispatch claude on resume, forcing a full re-implementation.

**Before cleanup, check:** `git -C <worktree> status --short` — if it shows new/modified files, the dispatch succeeded and the implementation exists. Either:
- **Fix the gate issue and resume** without removing the worktree (claude re-dispatches but the files are already there)
- **Cherry-pick or copy the files** to a temp branch before cleanup

**Gate failures vs. dispatch failures:** A gate failure (typecheck, e2e) means the implementation is good but the environment/dependencies have issues — this is fixable without re-implementation. A dispatch failure (claude exited non-zero, rate limit, timeout with no files written) means there's nothing to preserve.

**Rule:** `git -C <worktree> status --short` before any `worktree remove`. If files exist, preserve them.

## Pipeline: Ensure @types/node is an explicit devDependency

The typecheck gate runs `bunx tsc --noEmit --project tsconfig.src.json` in the **worktree**, which has its own `node_modules/` (populated by `bun install` at worktree creation). If `@types/node` is only a transitive dependency (pulled in by `@types/bun`), tsc fails with `Cannot find name 'process'` across all `src/` files — even though the main checkout works fine (its `node_modules/` has the transitive dep).

**Fix:** Add `"@types/node"` explicitly to `devDependencies` in `package.json` and add `"types": ["node", "bun"]` to `tsconfig.json`. This ensures every worktree gets `@types/node` via `bun install`.

**Rule:** Any type used by `src/` code must be an explicit devDependency, not just a transitive one.

## Pipeline: Uncommitted changes don't propagate to worktrees

Worktrees are created from the committed HEAD (`base_sha`), not the working tree. If you edit files in the main checkout (model defaults, permissions flags, tsconfig fixes) but don't commit them, the worktree gets the old code. This causes confusing failures where "I just fixed this" doesn't take effect.

**Rule:** Commit fixes to main before launching a pipeline that creates worktrees. Verify with `git diff HEAD -- <file>` that changes are committed.

## Pipeline: `/goal` mode works but Claude ignores the worktree cwd (SPEC-065 regression)

CHORE-40 added `/goal` mode to the build stage. The CHORE-39 re-run (workspace `01KW4T4HZ6`) proved `/goal` delivers ~3× the work of the previous 3-session run: 451 goal turns, 83 minutes, $22.53, 3 commits delivering Phases 2–4. The mechanism works as designed — Claude iterates within one session, running typecheck/tests between phases, then emits `ADW_GOAL_EXHAUSTED` with a summary.

**But:** Claude committed its work to `main` in the main repo, NOT to the worktree's `adw/<id>` branch. The worktree was empty. Root cause: Claude's working-directory awareness hardcodes `cd /Users/.../tmax` (the main repo) on every Bash command — 80 commands cd'd to main, only 12 referenced the worktree path. The `ADW_WORKTREE` env var sets the spawn cwd correctly, but Claude's own `cd` overrides it on every command.

**Rule:** Worktree isolation via cwd is insufficient for `/goal` mode. Claude must be told (in the prompt) that its working directory is the worktree, OR the build stage must detect commits-on-wrong-branch and refuse/cherry-pick. This is BUG-22 (to be filed): "Claude `/goal` mode commits to main instead of worktree branch."

## Pipeline: `goal-exhausted` then post-build typecheck gate = hard failure

When `/goal` exits exhausted (goal not met), the orchestrator runs a post-build typecheck gate. If the tree isn't fully green at that point (Claude's self-reported "green" was optimistic), the gate fails with exit code 2 and the pipeline dies before patch-review can run. This defeats the two-layer model: the outer loop never gets a chance to retry.

**Rule:** `goal-exhausted` should NOT trigger the hard typecheck gate. The gate should run only on `goal-met`. On `goal-exhausted`, skip straight to patch-review (which produces the `gaps` verdict that drives the retry loop). This is BUG-23 (to be filed).

## Testing: `0w` count-prefix regression is a test-isolation issue

The CHORE-39 refactor (`this.state` → `this.model`) introduced a state-leak between tests: `0w` passes in isolation but fails when run with siblings in `count-prefix.test.ts`. The digit logic is unchanged; the leak is in how editor state resets between tests. When refactoring editor internals, run the FULL test file (not just the targeted test) to catch cross-test state leaks.

## Pipeline: BUG-22 — Claude hardcodes `cd <main-repo>`, ignoring the worktree spawn cwd

**Rule:** The adw build stage spawns Claude with `cwd: <worktree>`, but Claude's Bash tool calls contain `cd /Users/.../tmax` (the main repo), overriding the spawn cwd. Every build's edits land in the main repo, not the worktree branch — losing the diff for patch-review and requiring manual recovery. Fix: `buildImplementPrompt()` prepends a worktree directive to the prompt text instructing Claude to work relative to its current directory and never `cd` to a hardcoded path. This is a prompt-level fix because the spawn cwd is correct; Claude just ignores it. When recovering work after a pipeline run, check BOTH the worktree AND the main repo working tree.

## Pipeline: BUG-16 — test:unit cumulative hang is deeper than shutdown cleanup

**Rule:** The `server-daemon-hardening.test.ts` and `server-observability.test.ts` files hang the full `test:unit` suite. Attempted fixes (destroyAllConnections in shutdown, removeAllListeners, SIGTERM removal, forceShutdown on rejected second servers) either didn't resolve the hang or introduced regressions (removeAllListeners wiped error handlers; SIGTERM removal was too aggressive). The leak is NOT just the shutdown path — it involves half-open sockets from rejected second-server starts AND possibly editor-internal timers. The `run-unit-tests.ts` wrapper force-kills after the summary line, but when a test hangs mid-suite (no summary appears), the wrapper waits for its hard timeout. Do NOT attempt to fix BUG-16 with broad `removeAllListeners` or `process.removeAllListeners` calls — they break legitimate handlers. The fix needs per-handle identification via `process._getActiveHandles()` in the specific hanging tests.

## Testing: Evaluator changes need broad editor/handler regression, not just evaluator tests

The evaluator has TWO execution paths — sync (`execute`→`evalList`) and async (`executeAsync`→`evalListAsync`) — with SEPARATE dispatch. The editor routes every key binding through the ASYNC path (`executeCommandAsync`→`evalListAsync`), while direct `interpreter.execute()` probes and many internals use the SYNC path.

**Rule:** When refactoring `src/tlisp/evaluator.ts` (or `src/tlisp/evaluator/*`), the evaluator-only test gate (`evaluator.test.ts`, `tail-call.test.ts`, `macros.test.ts`, …) is NOT sufficient. Always also run a broad editor/handler regression (`count-prefix`, `vim-dispatch`, `minibuffer-input`, `macro-recording`, `visual-mode-selection`, `markdown-commands`) — these drive behavior through `handleKey`→async eval and catch async-path bugs the sync-only evaluator gate masks.

**Concrete failure (CHORE-44 Change 4):** extracting the special-form table into `special-form-dispatch.ts` mistyped the `set!` key as `set` (dropped `!`). `isSpecialForm("set!")` returned false, so `evalListAsync` mis-dispatched every `(set! …)` as a function call → "Undefined symbol: set!". The SYNC path kept its `case "set!"`, so direct eval probes worked and the evaluator gate stayed green — but 40 editor tests broke because the vim-parity T-Lisp modules mutate state via `set!` on the async path. The bug shipped across Changes 4–5 because each change's narrow gate missed it. Bisect (`git checkout <commit>` + run the 4 suspect files) isolated it to the exact commit.

**Diagnostic trick:** if a T-Lisp primitive is "Undefined symbol" but TS builtins (`count-get`) work, suspect the async special-form dispatch table, not module loading. Probe both `(vim-n 1)` (module-loaded) and `(count-get)` (TS builtin) to distinguish.
