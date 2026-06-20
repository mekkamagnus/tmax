# Feature: Generic E2E ADW Runner (YAML-driven, daemon-based, self-contained)

## Feature Description

Create a single, generic **ADW (AI Development Workflow) e2e test runner** that takes a YAML
playbook file describing the functionality to be viewed and verified, then fully executes it
end-to-end on its own — bringing up the daemon, opening fixtures, driving keys/eval, asserting
expected state, and tearing down. The point: an author writes a declarative YAML describing
*what to test*, and hands the file as an argument to the generic runner; the runner does the rest.

**ADW = AI Development Workflow.** An ADW is a workflow meant to be run and fully executed on
its own — no manual setup of tmux sessions, no pre-started daemon, no TUI a human must watch.
It starts from a clean slate, runs to completion, and exits non-zero on any failure so it can be
looped by an AI agent (or CI) until green. This is distinct from a *demo playbook*
(`demos/demo-runner.py`), whose purpose is visual narration in a live tmux/TUI session.

The repo already contains two ADW-style tests (`adws/adw-right-bracket-h.test.ts` and
`adws/adw-run-keybinding-tests.ts`) that each hardcode their daemon lifecycle and assertion
plumbing. This feature consolidates that plumbing into one reusable generic runner and makes the
YAML schema the single source of truth for an e2e workflow. The existing per-mode
`adw-run-keybinding-tests.ts` is the direct evolutionary ancestor; this feature refactors it into
the canonical generic runner and extends it (notably: the timing gap that blocks async features
like which-key).

## User Story

As an **AI agent (or developer) verifying editor functionality end-to-end**
I want to **write a YAML playbook describing keys/eval and expected results, then pass it to one generic runner that brings everything up, runs, and asserts**
So that **I can verify a feature works in the real daemon/client dispatch path without hand-writing daemon plumbing every time, and without needing a human-watched TUI.**

## Problem Statement

Today there are three overlapping mechanisms and none is the right primitive:

1. **`demos/demo-runner.py`** — YAML-driven but *visual-only*: it assumes a live tmux session +
   TUI frame, narrates for a human, and asserts nothing. It cannot verify "did the cursor land on
   line 4" — it just shows the screen and pauses.

2. **`adws/adw-right-bracket-h.test.ts`** — actually asserts, but the daemon lifecycle, client
   plumbing, and assertions are all hardcoded for one binding. Copying it per feature duplicates
   ~150 lines of boilerplate each time.

3. **`adws/adw-run-keybinding-tests.ts`** — already YAML-driven and already generic *in spirit*,
   but (a) it's scoped to "keybinding tests for major modes" rather than a general e2e workflow
   runner, (b) its settle timings (`sleep(120)` after keys, `sleep(150)` after eval) are
   hardcoded and too short for timer-driven features like which-key (popup fires after
   `whichKeyTimeout` ms, default 1000), and (c) it has no per-step `wait` knob, so async
   behaviors are untestable without a race.

The gap: a single generic ADW runner whose YAML schema is expressive enough to cover navigation,
mutations, mode checks, *and* async/timer-driven features (which-key), with deterministic timing.

## Solution Statement

Refactor `adws/adw-run-keybinding-tests.ts` into the canonical generic runner
`adws/adw-run-e2e.ts`, generalizing its YAML schema and closing the timing gap. The runner is
authored with the project's functional patterns (`rules/functional-programming.md`): operations
are wrapped in `Task`/`TaskEither` for lazy, composable, error-explicit control flow; the
ad-hoc `Result<T>` of the ancestor is replaced by the codebase's `Either<L, R>`; the playbook
runs as a `pipe`-built `PipelineBuilder`; validation accumulates errors with `Validation` rather
than failing fast; and nullable YAML fields use `Option`. (All these utilities exist and are
already idiomatic in the editor subsystem — see Relevant Files.)

- **Keep** the proven daemon-spawn model: spawn `src/server/server.ts` directly (no tmux, no TUI),
  poll until the socket is responsive on `(+ 1 1)`, tear down via `(editor-quit)` + SIGKILL
  fallback. This is what makes it self-contained — no external session required. The readiness
  poll and teardown are expressed as `TaskEitherUtils.retry`/`delay` chains so the polling
  loop and the SIGKILL fallback compose as a pipeline instead of nested `try/catch` + `await
  sleep` loops.
- **Add a per-step `wait` field** (ms) so async features can deterministically wait for a timer
  (e.g. which-key popup) before the *next* step queries state. Default keeps current behavior.
- **Generalize the YAML schema** so it describes any e2e workflow (not just "keybindings"):
  setup fixtures, `${VAR}` templating, steps with `keys` OR `eval`, `setup_cursor`, and an
  `expect` block with the existing matchers. Add a `section`/`name` field for readable output.
- **Keep the assertion matchers** that already exist (`cursor_line`, `cursor_column`,
  `line_text`, `line_text_matches`, `mode`, `buffer_contains`, `status_message`,
  `result_contains`) — they map cleanly to T-Lisp state queries and require no screen capture.
- **Ship a canonical `which-key` playbook** (`adws/playbooks/which-key.yaml`) as the proving
  ground, because which-key is the feature that is *hardest* to verify without this runner (it is
  async, timer-driven, and only queryable via T-Lisp: `which-key-active`, `which-key-prefix`,
  `which-key-bindings`, `keymap-prefix-p`, `keymap-prefix-bindings`).
- **Resolve the boolean-assertion idiom** explicitly: the matchers have no boolean check, so the
  documented pattern is `eval: '(if (which-key-active) "ACTIVE" "INACTIVE")'` →
  `result_contains: "ACTIVE"`. This is recorded in the schema doc + CONTEXT, not papered over.

### Functional Patterns (per `rules/functional-programming.md`)

The runner is authored in the project's FP style. Every behavior below maps to a real, existing
utility in `src/utils/` (verified present — no speculative modules):

| Runner concern | FP pattern | Concrete utility |
|---|---|---|
| Daemon readiness poll, fixture I/O, `wait` settle | `Task`/`TaskEither` (lazy, composable, error-explicit) over raw `Promise` | `TaskEitherUtils.retry`, `readFile`, `writeFile`, `delay` (`src/utils/task-either.ts`) |
| Client op success/failure (was ad-hoc `Result<T>`) | `Either<L, R>` instead of throwing | `Either` from `src/utils/task-either.ts` |
| Playbook execution as one chain | `pipe` + `PipelineBuilder` (composition over nesting) | `pipe.from(...).step(...).tap(...).effect(...).build()` (`src/utils/pipeline.ts`) |
| YAML field absence (`expect`, `wait`, `name`) | `Option<T>` over null/undefined checks | `Some`/`None`/`fold` (`src/utils/option.ts`) |
| Lint guard (collect *all* playbook errors before daemon start) | `Validation` applicative — error accumulation, not fail-fast | `Validation.success`/`failure` + `lift3` (`src/utils/validation.ts`) |
| Typed error channels | Discriminated unions on the left side | `FileSystemError`, `ValidationError` (`src/error/types.ts`) |
| State (passed-down runner context: socket path, client cmd, vars) | Immutable update, no mutation of a shared mutable object | spread into new context objects |

Why this matters for *this* runner specifically: the ancestor threads an ad-hoc
`{ ok: boolean; ... }` result through every function and mixes `try/catch` with `await sleep`
loops — workable, but each new async step (and the `wait` field adds one) deepens the nesting.
Expressing the daemon poll as `TaskEitherUtils.retry(evalReady, 50, 100)` and the playbook as a
`pipe` keeps the error path uniform and the additions linear. The lint guard is the clearest
win: the ancestor reports one error then stops; `Validation` collects every malformed step in a
single pass so an author fixes all of them per run.

## Relevant Files

These are the files to implement the feature. (The `$feature` skill's default Relevant Files
reference a Python/`uv` server+client app that does not apply to this TypeScript/Bun repository;
the files below are the actually-relevant ones.)

- **`adws/adw-run-keybinding-tests.ts`** — direct evolutionary ancestor. Daemon lifecycle
  (`startDaemon`/`stopDaemon`), client ops (`openFile`/`sendKeys`/`evalExpr`), state queries,
  assertion engine (`evaluateExpect`), and playbook loop (`runPlaybook`) are all here and
  proven. The generic runner is a refactor+extension of this file. **FP gap:** it threads an
  ad-hoc `{ ok: boolean; value | error }` `Result<T>` through every function and mixes
  `try/catch` with manual `await sleep` loops — this is what the refactor replaces with
  `TaskEither`/`pipe`/`Validation`.
- **`adws/adw-right-bracket-h.test.ts`** — the original hardcoded ADW test. Reference for the
  daemon-spawn pattern and confirmation that this model works end-to-end. Not modified.
- **`src/utils/task-either.ts`** — the `Task`/`TaskEither`/`Either`/`TaskEitherUtils` the runner
  is authored against. `retry`, `delay`, `readFile`, `writeFile` map onto the daemon poll, the
  `wait` settle, and fixture setup. Already used across `src/editor/api/*`.
- **`src/utils/pipeline.ts`** — `pipe` / `PipelineBuilder` for the playbook execution chain
  (`.step`/`.tap`/`.effect`/`.build()`), keeping additions linear instead of nested.
- **`src/utils/validation.ts`** — `Validation` applicative + `lift3` for the lint guard, so it
  accumulates *all* malformed steps in one pass rather than failing on the first.
- **`src/utils/option.ts`** — `Option<T>` (`Some`/`None`/`fold`) for nullable YAML fields
  (`name`, `wait`, `expect`).
- **`src/error/types.ts`** — `FileSystemError`, `ValidationError` (and friends) used as the
  typed left channels of the runner's `TaskEither`s instead of `string`.
- **`adws/modes/markdown.yaml`** — existing playbook exercising the full assertion surface
  (cursor, status, mode). Becomes the compatibility proof: it must still pass under the new
  generic runner unchanged.
- **`demos/demo-runner.py`** — the *visual* runner. Read to draw the ADW-vs-demo distinction
  clearly (narration, tmux, TUI, no assertions) and to reuse the `${VAR}` templating idiom and
  the `lint_playbook` backslash-in-eval guard (the JSON-RPC eval path corrupts backslashes —
  relevant to any playbook using regex).
- **`src/editor/editor.ts`** (lines ~1135–1215) — exposes the which-key state to T-Lisp:
  `which-key-enable`, `which-key-disable`, `which-key-timeout`, `which-key-active`,
  `which-key-prefix`, `which-key-bindings`. These are the only way to assert which-key without
  screen capture, and the playbook depends on them.
- **`src/tlisp/core/keymaps.tlisp`** — defines `keymap-prefix-p`, `keymap-prefix-bindings`,
  `keymap-all-bindings`, `current-keymap`. The playbook uses these for static keymap assertions.
- **`src/editor/utils/which-key-state.ts`** — the timer-driven state machine
  (`schedule(prefix, bindings, cb)` fires `active=true` after `timeout` ms). This is exactly why
  the per-step `wait` field is required: the popup is not active synchronously after the prefix key.
- **`bin/tmaxclient`** — the client the runner drives. Supports `--socket`, `--keys`, `--eval`,
  positional file open. Read-only reference; not modified.
- **`package.json`** — `test:daemon` script (the existing e2e daemon suite); the new ADW should
  be runnable alongside it. `typecheck`/`typecheck:test` for TS validation.

### New Files

- **`adws/adw-run-e2e.ts`** — the generic ADW runner (refactor of `adw-run-keybinding-tests.ts`,
  generalized + `wait` field). This is the deliverable an AI agent invokes with a YAML path.
- **`adws/playbooks/which-key.yaml`** — canonical e2e playbook for which-key, exercising the
  timing-sensitive behaviors (popup activation, C-g cancel, quick-type-skip, live binding,
  BUG-11 regression). Proves the runner handles async features.
- **`adws/playbooks/README.md`** — the YAML schema reference + the boolean-idiom note, so authors
  know how to write a new playbook without reading the runner source.

## Implementation Plan

### Phase 1: Foundation (generalize the runner, lift to FP)

Refactor `adw-run-keybinding-tests.ts` → `adw-run-e2e.ts`. Keep the daemon-spawn model and
assertion engine intact; the change is (a) generalize naming/schema from "keybinding tests for
modes" to "e2e workflows", (b) read playbooks from an explicit path argument (already supported
— make it the primary mode), and (c) add the per-step `wait` field with sane defaults.
**Concurrently lift the control flow to FP:** replace the ad-hoc `Result<T>` (`{ ok, value |
error }`) with `Either<L, R>`, and express daemon start/stop readiness as
`TaskEitherUtils.retry`/`delay` chains rather than `for` + `await sleep` + `try/catch`. Verify
zero regression by running the existing `adws/modes/markdown.yaml` against the new runner
unchanged.

### Phase 2: Core Implementation (timing + schema doc + accumulating lint)

Wire the `wait` field into `runStep` as a `TaskEitherUtils.delay(wait)` step in the pipeline
(both the `keys` and `eval` branches), defaulting to the prior 120/150ms via `Option.fold` on
the optional field. Document the full YAML schema in `adws/playbooks/README.md`, including the
boolean-idiom (no boolean matcher; wrap in `(if ... "X" "Y")` → `result_contains`). Port the
`lint_playbook` backslash-in-eval warning from `demo-runner.py`, but implement it with the
`Validation` applicative so it accumulates *all* offending steps in one pass
(`Validation.success`/`failure` + `lift`-style combine) instead of failing on the first.
Backslashes are corrupted by the JSON-RPC eval path; a playbook using regex must drive via keys.

### Phase 3: Integration (playbook pipeline + prove it on the hardest case)

Express the full playbook run as a `pipe.from(parseYAML).step(lint).step(setupFixtures).step(openFile).step(runSteps).effect(report)` chain, with cleanup in a `finally`-equivalent
(`TaskEither`'s guaranteed teardown) so temp files and the buffer are removed even on assertion
failure. Author `adws/playbooks/which-key.yaml` covering: static keymap population, popup
activation after a pause (requires `wait`), per-prefix binding contents, C-g cancel,
quick-type-skip (negative assertion + command-still-ran), runtime binding appears live, and the
BUG-11 prefix-reset regression. Run it green. This both validates the runner on an async feature
and locks in which-key behavior as a regression suite.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `adws/adw-run-e2e.ts` by refactoring the existing runner
- Copy `adws/adw-run-keybinding-tests.ts` → `adws/adw-run-e2e.ts`.
- Generalize the header docblock: this is the *generic e2e ADW runner*, taking one or more YAML
  playbook paths as arguments (not "keybinding tests for major modes").
- Change the no-args default: instead of scanning `adws/modes/*.yaml`, scan `adws/playbooks/*.yaml`.
  Keep explicit-path mode as the primary usage.
- **Replace the ad-hoc `Result<T>` type** (`{ ok: true; value } | { ok: false; error }`) with the
  codebase's `Either<L, R>` from `src/utils/task-either.ts`. Update the signatures of
  `runClient`, `openFile`, `sendKeys`, `evalExpr`, and every state query to return
  `TaskEither<RunnerError, T>` (or `Either` for the sync ones). Type the left channel with
  `FileSystemError` / `ValidationError` from `src/error/types.ts` instead of bare `string`.
- **Express daemon readiness as a `TaskEither` chain**: the `for (i < 50) { sleep; check }` poll
  in `startDaemon` becomes `TaskEitherUtils.retry(() => evalExpr("(+ 1 1)"), 50, 100)` with a
  `.map(r => r === "2")` readiness check; teardown (`stopDaemon`) composes the
  `(editor-quit)` call + socket-disappear poll + SIGKILL fallback as a single chain.
- Preserve the *logic* of: `openFile`, `sendKeys`, `evalExpr`, all state queries, `evaluateExpect`,
  and cleanup. Only the control-flow shape changes (Promise → Task/Either), not the assertions.

### Step 2: Add the per-step `wait` field (as a `TaskEither.delay`)
- Extend the `Step` interface with `wait?: number` (milliseconds).
- Model the optional field as `Option<number>`; resolve the effective delay with `fold`:
  `const settle = step.wait !== undefined ? step.wait : (branch === "keys" ? 120 : 150)`.
- In `runStep`, replace the hardcoded `await sleep(...)` with `await TaskEitherUtils.delay(settle).run()`
  in both branches. This is the single change that unlocks async/timer-driven features
  (which-key). Default preserves existing behavior, so `markdown.yaml` is unaffected.

### Step 3: Add the backslash-in-eval lint guard (accumulating, not fail-fast)
- Port `lint_playbook`'s regex check from `demos/demo-runner.py`: any `eval` step whose `expr`
  contains a backslash is rejected before daemon startup, with a message directing the author to
  drive via keys instead (JSON-RPC eval corrupts backslashes).
- **Implement with `Validation`** (`src/utils/validation.ts`): map each offending step to a
  `Validation.failure(message)` and combine so *all* offending steps are reported in one pass
  (use the applicative combine / `lift`-style traversal, not a `flatMap` that stops at the
  first). Run it at the top of `runPlaybook` before any setup, in every mode.

### Step 4: Write `adws/playbooks/README.md` (schema reference)
- Document: top-level fields (`name`, `mode`, `setup`, `steps`, `cleanup`).
- Document: setup `setup_file` action with `var`/`name`/`content` and `${VAR}` templating.
- Document: step fields (`name`, `keys` XOR `eval`, `setup_cursor`, `wait`, `expect`).
- Document: every `expect` matcher and the T-Lisp query it maps to.
- Document the **boolean idiom** explicitly with a worked example: there is no boolean matcher,
  so use `eval: '(if (which-key-active) "ACTIVE" "INACTIVE")'` + `result_contains: "ACTIVE"`.

### Step 5: Author `adws/playbooks/which-key.yaml`
Cover these scenarios (each an independent step with its own `setup_cursor`/`wait`):
- **Static keymap populated**: `(keymap-prefix-p normal-keymap "z")` → wrap to "YES" via
  `result_contains`. Same for `"g"` and `"C-w"`. No timing needed.
- **Popup activates after pause**: `(which-key-timeout 80)`, then `keys: "z"`, `wait: 200`, then
  `eval` `(concat (if (which-key-active) "ACTIVE" "INACTIVE") "|" (which-key-prefix))` →
  `result_contains: "ACTIVE|z"`.
- **Per-prefix binding contents**: after `z`+pause, `(which-key-bindings)` contains the scroll
  command; after `g`+pause it contains a goto command and does *not* contain the scroll command.
- **C-g cancels**: `z`+pause → active; then `keys: "C-g"` → `which-key-active` INACTIVE.
- **Quick typing skips popup**: `(which-key-timeout 5000)`, `keys: "zt"` (fast), assert
  `which-key-active` INACTIVE *and* the command ran (status/cursor changed).
- **Runtime binding live**: `(key-bind "g n" "(jump-to-line 5)" "normal")`, then `g`+pause,
  assert `(which-key-bindings)` contains the new binding.
- **BUG-11 regression**: `z`+pause, `C-g`, then `g` — assert `(which-key-prefix)` is "g" (not
  "zg") and no `Unsupported prefix` error appears.

### Step 6: Retire the duplicated runner
- After `adw-run-e2e.ts` is proven (markdown.yaml + which-key.yaml both green), delete
  `adws/adw-run-keybinding-tests.ts`. Move `adws/modes/markdown.yaml` → `adws/playbooks/markdown.yaml`.
- Update any reference to the old runner in docs/comments.

### Step 7: Validate — run the Validation Commands
- Run `bun run typecheck:test` (the runner lives under a TS context).
- Run the new runner against the markdown playbook (regression) and the which-key playbook
  (new coverage). Both must exit 0.

### Step 8: Compose the playbook run as a `pipe` pipeline
- Replace the imperative `runPlaybook` body (nested `try/finally` + sequential calls) with a
  `pipe.from(parseYAML).step(lint).step(setupFixtures).step(openFile).step(runSteps).effect(report).build()` chain from `src/utils/pipeline.ts`.
- Guarantee cleanup (kill buffer, unlink temp files) via a teardown that runs whether the chain
  succeeds or short-circuits on a `Left` — the FP equivalent of the existing `finally`. Keep the
  daemon `stopDaemon` in `main`'s outer `finally` (process-level teardown, outside the per-playbook pipeline).
- This is last so the pipeline composes the *already-working* pieces from Steps 1–6; if it
  complicates anything, the step-functions remain individually callable.

## Testing Strategy

### Unit Tests
This feature is itself a *test harness*, so "unit tests" are smaller playbooks that exercise one
matcher each. Add `adws/playbooks/_smoke.yaml`:
- A step asserting `cursor_line` after `setup_cursor`.
- A step asserting `result_contains` on a pure `eval`.
- A step using the boolean idiom.
- A step using `wait` (set a short timeout, sleep, assert state changed).
This smoke playbook is the runner's self-test.

### Integration Tests
- `adws/playbooks/markdown.yaml` (moved from `modes/`) — full assertion surface, regression proof.
- `adws/playbooks/which-key.yaml` — async/timer-driven feature, the hard case.

### Edge Cases
- **Stale daemon on the socket**: `startDaemon` already stops any existing daemon and force-unlinks
  the socket. Verify a second run while a daemon lives still starts clean.
- **Daemon not responsive** (socket appears but `(+ 1 1)` fails): the `TaskEitherUtils.retry`
  readiness chain must short-circuit to a `Left` with a clear message after exhausting attempts,
  not hang.
- **Backslash in eval expr**: `Validation` lint guard accumulates and rejects all offending steps
  before daemon start.
- **Both `keys` and `eval` on one step**: already rejected as mutually exclusive.
- **`wait` too short for the timer**: the which-key "popup activates" step would flake — the
  playbook uses `wait: 200` against a `which-key-timeout 80`, giving margin.
- **Cleanup on failure**: the pipeline teardown kills the buffer and unlinks temp files even when a
  step returns `Left` (assertion failure).

## Acceptance Criteria
1. `adws/adw-run-e2e.ts <playbook.yaml>` brings up its own daemon from a clean slate, runs the
   playbook, asserts every `expect`, tears down, and exits 0 on success / non-zero on any failure
   — with no tmux session or TUI frame required.
2. `adws/modes/markdown.yaml` (or its moved location) passes against the new runner with zero
   changes to its assertions (regression: the refactor preserves behavior).
3. The per-step `wait` field exists and defaults preserve prior settle times.
4. `adws/playbooks/which-key.yaml` passes, proving the runner can verify a timer-driven feature;
   specifically the "popup activates after pause" and "quick typing skips popup" steps both pass.
5. The backslash-in-eval lint guard rejects a playbook containing `\` in an `eval` expr before
   daemon startup, and reports *all* offending steps in one pass (accumulating, not fail-fast).
6. `bun run typecheck:test` (and `typecheck`) pass with zero errors.
7. `adws/playbooks/README.md` documents the schema, every matcher, and the boolean idiom.
8. The old `adws/adw-run-keybinding-tests.ts` is removed (no duplicate harness).
9. **FP conformance:** the runner uses `TaskEither`/`Either` (no ad-hoc `Result<T>` type, no raw
   `throw` for expected failures), `TaskEitherUtils.retry`/`delay` for polling and settle,
   `Option` for nullable YAML fields, `Validation` for the lint guard, and a `pipe`-built
   pipeline for the playbook run — matching `rules/functional-programming.md`. A grep for the
   old `{ ok: true; value` shape returns nothing in `adw-run-e2e.ts`.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.
- `bun run typecheck:test` — typecheck the runner (it is TS under the test context).
- `bun run typecheck` — full typecheck, no regressions.
- `bun adws/adw-run-e2e.ts adws/playbooks/_smoke.yaml` — runner self-test; must exit 0.
- `bun adws/adw-run-e2e.ts adws/playbooks/markdown.yaml` — regression; must exit 0 and report
  all steps passed.
- `bun adws/adw-run-e2e.ts adws/playbooks/which-key.yaml` — new async coverage; must exit 0,
  specifically including the "popup activates" and "quick typing skips" steps.
- `bun adws/adw-run-e2e.ts adws/playbooks/_smoke-bad-backslash.yaml` — lint guard; must exit
  non-zero *before* starting the daemon, printing the backslash warning. (A throwaway playbook
  with one `eval` step containing `\d`.)

## Notes
- **ADW vs Demo** (must stay clear in docs): a *demo* (`demos/demo-runner.py`) is visual, assumes
  tmux+TUI, narrates for a human, asserts nothing. An *ADW* is headless, brings up its own
  daemon, asserts, and exits with a status code. They share YAML idioms (`${VAR}` templating) but
  are different primitives. This feature delivers the ADW primitive; the demo runner is unchanged.
- **Why spawn `src/server/server.ts` directly** (not `bun run daemon`): the existing runner notes
  that `bun run daemon` adds an extra process layer; spawning the entry directly keeps teardown
  deterministic (one PID to SIGKILL as a last resort). Preserved from the ancestor.
- **Why no boolean matcher**: the assertion engine checks string substrings. Adding a boolean
  matcher is a one-line feature but out of scope here — the `(if ... "X" "Y")` idiom is cheap,
  explicit, and reads well in YAML. Documented rather than engineered away.
- **which-key is the canonical proof** because it is the feature that most exposes the gap
  between "looks right on screen" and "actually correct": it is async, timer-driven, and its
  only assertion surface is T-Lisp state. If the runner proves which-key, it proves the schema.
- **The `wait` field is the load-bearing change.** Without it, every async feature is untestable
  via this runner and reverts to flaky inter-process timing. Default values are deliberately
  unchanged so nothing regresses.
- **Why FP here, concretely:** the runner's control flow is almost entirely "try an async thing
  that can fail, then branch on success/failure, then maybe retry" — exactly what
  `TaskEither`/`retry`/`delay` factor out. Authoring it imperatively (as the ancestor does) means
  every new step re-implements the same `try/catch` + `await sleep` scaffolding; the FP version
  composes. The one place FP is a *clear* win rather than a stylistic preference is the lint
  guard: accumulating all malformed steps with `Validation` saves an author multiple run-fix
  cycles versus fail-fast. All referenced utilities (`task-either.ts`, `pipeline.ts`,
  `validation.ts`, `option.ts`, `error/types.ts`) were verified present and already in use across
  `src/editor/api/*` before this plan was written.
- **Do not over-engineer.** Per `AGENTS.md` §2 (Simplicity First): use `Reader`/`State` monads
  only if a real dependency-injection or state-threading need appears. The current design uses
  the four patterns that pull their weight (`TaskEither`, `Option`, `Validation`, `pipe`); the
  Reader/State/Applicative sections of the rules are available if a concrete need emerges, not
  mandated.
