# Chore: Codebase refactoring consolidation across editor, evaluator, server, tooling, and tests

## Chore Description

Refactor the twelve highest-leverage maintenance seams identified by the codebase-wide audit without adding features or changing user-visible behavior. The current implementation is functional and type-safe, but complexity is concentrated in process-global editor state, a partially completed editor state migration, several very large orchestration classes, duplicated infrastructure, parallel legacy/functional contracts, and confirmed dead scaffolding.

This is intentionally one umbrella specification because the changes share architectural boundaries and validation requirements. It MUST be implemented as twelve separately reviewable changes in the order listed under `Step by Step Tasks`. Do not combine the entire chore into one unreviewable rewrite. At the end of every change, run that change's targeted gate and do not start the next change until the tree is green.

### Overall objective

Reduce coupling and duplicated state while preserving all existing editor behavior, public TypeScript APIs, T-Lisp command names, JSON-RPC method names and response shapes, ADW workspace/event formats, command-line behavior, renderer output, and standalone build outputs. After completion:

- each `Editor` and each `TLispEvaluator` owns its mutable session state;
- the Elm-style `EditorModel` and typed runtime context are the only editor state path;
- `Editor`, `TLispEvaluator`, and `TmaxServer` remain stable facades over smaller cohesive modules;
- TypeScript handlers only route input and T-Lisp owns editor policy;
- editor API registration and ADW pipeline composition are declarative and collision-safe;
- core contracts have one canonical interface per domain;
- dead Ink/React and unused functional scaffolding are removed;
- the Markdown command library and native parser mechanics are split by responsibility;
- editor tests use one isolation-safe fixture;
- all required typecheck, unit, integration, trt, e2e, and build gates pass.

### Non-negotiable architecture constraints

1. **Preserve the C/Lisp boundary.** TypeScript owns raw buffer/cursor/display/runtime primitives. T-Lisp owns key semantics, modes, command parsing, operator state machines, completion, search policy, and command composition.
2. **Preserve the daemon sync invariant.** `render-state` is read-only; frame-scoped keypresses sync frame → editor before the key and editor → frame after it; stateless keypresses update the editor and then all frames.
3. **Preserve synchronous T-Lisp APIs.** `execute()` and synchronous evaluator behavior remain synchronous. Do not replace the whole evaluator with an async-only public API.
4. **Preserve TCO and async semantics.** Existing tail-call, promise auto-unwrapping, `async-let`, module, macro, trt, and diagnostic behavior must remain byte-for-byte compatible where tests assert output.
5. **Preserve external contracts.** Do not rename public `Editor` methods, JSON-RPC methods, CLI flags, ADW state/event fields, T-Lisp command names, or playbook schema fields.
6. **Keep zero runtime dependencies.** Development-only type packages may remain, but the shipped editor must not require Ink, React, `tsx`, or another parser/runtime package.
7. **Do not suppress failures.** Do not loosen TypeScript settings, delete assertions, increase timeouts to conceal hangs, add expected failures, or skip required tests.
8. **Respect existing work.** This spec is written against a working tree that already contains unrelated Vim-parity work. Implementation must preserve unrelated changes and avoid broad formatting rewrites.

### Change objectives summary

1. **Per-instance editor state:** eliminate process-global mutable editor session state and make two concurrent editors independent.
2. **Complete the editor state migration:** remove the legacy `TlispEditorState` compatibility path and underscored runtime escape hatches.
3. **Decompose the `Editor` facade:** retain the public class while moving binding, plugin, workspace, logging, and command-runtime responsibilities into cohesive collaborators.
4. **Decompose and unify evaluator mechanics:** share validation/dispatch between sync and async evaluation and extract module, test, and debug responsibilities.
5. **Typed RPC server:** replace the monolithic request switch and `any` parameters with a typed router and domain handlers.
6. **Thin key handlers:** move command and mode policy to T-Lisp and break the `Editor`/handler dependency cycle.
7. **Declarative editor API registry:** replace manual Map merging with typed contributions and duplicate-name validation.
8. **Shared ADW dispatcher runtime:** consolidate repeated ID, event, state, subprocess, resume, and pipeline code.
9. **Canonical core contracts:** split `core/types.ts` and remove parallel terminal/filesystem/buffer contract hierarchies.
10. **Dead scaffolding and dependency cleanup:** remove unused Ink/React and utility code, simplify Bun startup, and remove duplicated bootstrap state construction.
11. **Split large language modules:** divide Markdown commands into feature modules and extract only proven shared parser mechanics.
12. **Standard editor test fixture:** migrate editor tests to one isolation-safe construction and cleanup path.

### Implementation checkpoint — 2026-07-17

This checkpoint supersedes progress claims from the exhausted Claude `/goal` session that ran from 2026-07-16 through 2026-07-17. That session described Changes 1–5 as complete, but the repository review found that each still has unmet implementation requirements or acceptance criteria. Treat the statuses below as the authoritative handoff.

Status meanings:

- **COMPLETE:** every implementation requirement and acceptance criterion is satisfied, every required new file/test exists, the targeted gate passes in one unmasked invocation, and the full typecheck is green.
- **PARTIAL:** useful implementation exists and its completed subparts are identified, but at least one requirement, acceptance criterion, or required test remains.
- **NOT STARTED:** no material implementation for that numbered change exists. Incidental related code does not count as progress.

| Step/change | Status | Completed checkpoint | Required pickup point |
|---|---|---|---|
| Step 0 | **COMPLETE** | `.chore44-baseline/` holds all inventories (editor methods, Markdown fns, static + runtime API names, RPC methods, ADW state keys, ADW event types, CLI exit codes). `test/unit/chore44-baseline-inventory.test.ts` asserts each as a frozen expected set (6 tests green). | — |
| Change 1 | **COMPLETE** | All session state groups (kill ring, registers, delete/yank, yank-pop, visual, macros, search, dired, syntax, replace, undo/redo, major-mode) live on `EditorModel.session: EditorSessionState`; `EditorSession` is an accessor over model state; `major-mode-ops` module-globals deleted (real isolation bug fixed); isolation test covers every group two-editor. | — |
| Change 2 | **PARTIAL** | `EditorAPIContext` exists; `TlispEditorState`, compatibility projection functions, and underscored hook names are gone; typed-context tests exist. | Remove the renamed mutable bridge fields and direct `ctx.* =` state mutations. Make `access`/`State`/`Msg`/`Cmd` the only deterministic state path. |
| Change 3 | **PARTIAL** | Logging, plugin, binding-file, and workspace algorithms have collaborators with delegation tests. | Extract the command queue/drain/correlation implementation and the remaining core/fallback/init binding policy. Complete bootstrap consolidation and test every collaborator with fakes. |
| Change 4 | **PARTIAL** | Sync/async parity and evaluator-instance tests exist; `if`/`let` validation is shared; async dispatch uses one recognition set for delegated forms; core test registries are instance fields. | Extract every required validator and the named module/test/function-call/special-form modules; move remaining evaluator-owned mutable coverage/debug state per instance; keep the evaluator as a thin facade/trampoline. |
| Change 5 | **PARTIAL** | `RpcMethodMap` and a dispatch table exist; the request-method switch and `params: any`/`Promise<any>` signatures are gone. | Give every method exact result types; add runtime version/params validation and error mapping in the router; split domain handlers; centralize sync wrappers; add both required tests. |
| Change 6 | **PARTIAL** | `EditorDispatchPort` exists; `KeyMapping`/`resolveMapping` moved to `key-resolution.ts`; handlers no longer import `editor.ts`. | Move substitute/Dired parsing and Markdown/indent policy to T-Lisp, finish all policy routing, and run the complete Change 6 gate without output-truncating pipelines. |
| Changes 7–12 | **NOT STARTED** | No numbered change has its principal implementation/test files. | Resume in order only after Changes 1–6 meet their completion gates. |
| Steps 13–14 | **NOT STARTED** | Existing unrelated Vim/Markdown playbooks remain available. | Create the cross-cutting CHORE-44 playbook only after Changes 1–12 are complete, then run the full validation matrix. |

### Definition of complete for every numbered change

An agent MUST NOT change a status to **COMPLETE** merely because a grep passes, the source typecheck passes, or a subset of tests passes. For each numbered change, all of the following are mandatory:

1. Every bullet under that change's `Implementation requirements` is implemented or the spec is explicitly revised with a documented rationale before code is changed.
2. Every acceptance criterion has direct evidence: a static assertion, focused test, existing regression test, or an inspected public inventory. Behavioral claims cannot be satisfied “by construction” without a test when the criterion names observable behavior.
3. Every required production file and test file for that change exists. If investigation proves a named file is genuinely unnecessary, revise this spec first instead of silently treating it as N/A.
4. The targeted gate runs as one command and exits 0. Do not pipe a test command through `tail`, `head`, `rg`, or another command that can mask the test runner's exit code; capture full output or use `set -o pipefail` when filtering is unavoidable.
5. `bun run typecheck` and `git diff --check` both exit 0 after the change.
6. The implementation handoff records the command, exit code, and concise result for each criterion. A known unrelated failure may be documented, but the change remains **PARTIAL** until the required gate itself is green or this spec is deliberately amended.
7. Do not begin the next numbered change while the current change is **PARTIAL**. The 2026-07-17 checkpoint contains overlapping partial work only because the prior long-running session advanced prematurely; continuation must close the gaps in numerical order.

## Relevant Files

Use these files to resolve the chore:

- `README.md` — update architecture, runtime dependency, entry-point, and frontend claims after the refactors are complete.
- `package.json`, `bun.lock`, `tsconfig.json`, `tsconfig.src.json`, `tsconfig.test.json`, `tsconfig.tmax-use.json`, `tsconfig.bench.json` — scripts, dependencies, entry points, and compiler boundaries affected by Changes 9 and 10.
- `src/editor/editor.ts` — stable public editor facade; currently owns too many responsibilities.
- `src/editor/tlisp-api.ts` — current compatibility adapter and manual editor API composition root.
- `src/editor/functional/model.ts`, `messages.ts`, `update.ts`, `cmd.ts`, `runtime.ts`, `index.ts` — authoritative immutable model, reducer, and effect boundary established by CHORE-39 through CHORE-43.
- `src/editor/api/*.ts` — editor primitives and the process-global mutable state to move into the model or per-editor runtime caches.
- `src/editor/handlers/*.ts` — key routers that must depend on a narrow port and contain no command policy.
- `src/editor/key-resolution.ts`, `src/editor/keymap-sync.ts`, `src/editor/mode-loader.ts`, `src/editor/mode-state.ts`, `src/editor/auto-mode.ts` — existing seams to reuse rather than duplicating key/mode logic.
- `src/editor/log-entry.ts`, `log-store.ts`, `log-persist.ts`, `message-log.ts` — logging responsibilities to delegate from `Editor`.
- `src/tlisp/evaluator.ts`, `interpreter.ts`, `types.ts`, `values.ts`, `parser.ts`, `tokenizer.ts`, `environment.ts`, `async.ts` — evaluator public contracts and sync/async execution.
- `src/tlisp/module-loader.ts`, `module-loader-standalone.ts`, `module-registry.ts`, `test-coverage.ts`, `trt/**` — module, test, and coverage responsibilities extracted from evaluator internals.
- `src/tlisp/core/commands/*.tlisp`, especially `markdown.tlisp`, `edit-commands.tlisp`, `insert-entries.tlisp`, `operators.tlisp`, and `motions.tlisp` — Lisp-owned command policy and the Markdown split.
- `src/tlisp/core/bindings/*.tlisp` and `src/tlisp/core/modes/markdown-mode.tlisp` — binding/module loading updates that must preserve every current key and command name.
- `src/server/server.ts`, `src/server/serialize.ts` — JSON-RPC transport, lifecycle, frame sync, workspace handling, and serialization.
- `src/client/tui-client.ts`, `bin/tmax`, `bin/tmaxclient`, `bin/tlisp`, `bin/tmax-use` — external consumers whose CLI and RPC contracts must remain unchanged.
- `src/core/types.ts`, `buffer.ts`, `terminal.ts`, `filesystem.ts`, `workspace.ts`, `scrollback.ts` — parallel contracts and central type coupling.
- `src/main.tsx` — Bun entry point, repeated initial editor-state construction, hard-coded version, and obsolete `.tsx` extension.
- `src/frontend/ink-adapter.ts`, `src/frontend/types.ts` — confirmed unused Ink/React scaffolding to remove.
- `src/frontend/frontends/types.ts`, `src/frontend/render/*.ts`, `src/steep/**` — live frontend contracts that must continue to compile and render unchanged.
- `src/syntax/ast/types.ts`, `registry.ts`, `incremental.ts`, and `parsers/*.ts` — parser contracts and duplicated token-stream/source-position mechanics.
- `src/utils/task-either.ts`, `state.ts`, `writer.ts`, `save-operations.ts`, `reader.ts`, `effect.ts`, `lens.ts`, `pipeline.ts` — retain widely used utilities; remove only confirmed unused modules and avoid a wholesale FP rewrite.
- `adws/*.ts`, `adws/adws-modules/*.ts`, `adws/README.md` — repeated dispatcher/orchestrator infrastructure and documented external contracts.
- `scripts/run-unit-tests.ts`, `scripts/build-binaries.ts`, `scripts/repl.ts` — test/build/start behavior affected by entry-point and fixture changes.
- `test/helpers/editor-fixture.ts`, `test/helpers/test-helpers.ts`, `test/mocks/filesystem.ts`, `test/mocks/terminal.ts`, `test/fixtures/server-test-helpers.ts` — shared test construction and cleanup infrastructure.
- `test/unit/**/*.test.ts`, `test/integration/**/*.test.ts`, `test/tlisp/*.test.tlisp` — regression coverage listed per change below.
- `tmax-use/playbooks/README.md`, `_smoke.yaml`, `vim-parity-edit.yaml`, `markdown.yaml` — playbook schema and examples to follow.
- `docs/adrs/ADR-0094-adw-pipeline-architecture.md`, `ADR-0098-tlisp-fp-foundations.md`, `ADR-0111-editor-functional-elm-architecture.md`, `ADR-0114-editor-functional-core-deepening.md` — existing decisions this chore must complete rather than contradict.
- `rules/typescript.md`, `rules/functional-programming.md`, `rules/editor.md`, `rules/tlisp.md`, `rules/testing.md`, `rules/daemon-client.md`, `src/editor/Claude.md`, `src/tlisp/Claude.md` — path-specific implementation rules.

### New Files

- `src/editor/functional/domain-state.ts` — readonly nested editor-session state types and initial-state factories for registers, kill ring, search, visual selection, undo, replace, Dired, syntax, and macros.
- `src/editor/runtime/caches.ts` — per-editor non-serializable derived caches such as AST/parse trees and plugin submission/cache state.
- `src/editor/runtime/editor-api-context.ts` — the single typed model/runtime context supplied to editor API contributions.
- `src/editor/runtime/binding-runtime.ts` — core binding, init-file, and module loading delegated by `Editor`.
- `src/editor/runtime/plugin-runtime.ts` — plugin discovery, wrapping, loading, and macro persistence delegated by `Editor`.
- `src/editor/runtime/workspace-runtime.ts` — workspace import/export and buffer metadata reconciliation delegated by `Editor`.
- `src/editor/runtime/logging-runtime.ts` — message/daemon/program log updates and persistence delegated by `Editor`.
- `src/editor/runtime/command-runtime.ts` — command queue, effect drain, command correlation, and T-Lisp command execution delegated by `Editor`.
- `src/editor/handlers/editor-dispatch-port.ts` — narrow interface used by handlers instead of the concrete `Editor` class.
- `src/editor/api/registry.ts` — typed editor API contribution registry with deterministic merge and duplicate-name rejection.
- `src/tlisp/evaluator/form-shapes.ts` — pure special-form argument validation and parsed form shapes shared by sync and async execution.
- `src/tlisp/evaluator/special-form-dispatch.ts` — one special-form classification table used by both evaluator paths.
- `src/tlisp/evaluator/module-forms.ts` — module/provide/require form implementation extracted from the evaluator facade.
- `src/tlisp/evaluator/test-forms.ts` — per-evaluator trt/deftest/suite/fixture registration and special forms.
- `src/tlisp/evaluator/function-calls.ts` — shared macro expansion, argument preparation, tracing, coverage, and call-result normalization helpers.
- `src/server/rpc/types.ts` — JSON-RPC request/result map and typed method context.
- `src/server/rpc/router.ts` — method lookup, validation, error mapping, and dispatch.
- `src/server/rpc/handlers/editing.ts` — open/save/eval/command/query/insert/key/capture methods.
- `src/server/rpc/handlers/frames.ts` — frame/client/status/render/client-event methods and sync wrappers.
- `src/server/rpc/handlers/workspaces.ts` — workspace list/new/load/switch/save/kill/rename/move-window methods.
- `src/server/rpc/handlers/lifecycle.ts` — ping/shutdown and lifecycle-facing methods.
- `adws/adws-modules/dispatcher-runtime.ts` — shared ADW id, paths, event/state writing, input resolution, and subprocess capture.
- `adws/adws-modules/pipeline.ts` — typed stage definitions and generic sequential/retry/resume runner.
- `src/core/contracts/primitives.ts` — `Position`, `Range`, size, and filesystem-stat primitives.
- `src/core/contracts/buffer.ts` — canonical persistent buffer contract.
- `src/core/contracts/terminal.ts` — canonical terminal runtime contract.
- `src/core/contracts/filesystem.ts` — canonical filesystem runtime contract.
- `src/core/contracts/editor.ts` — editor configuration, public state, keys, windows, tabs, and rendering-facing contracts.
- `src/core/contracts/workspace.ts` — workspace/frame/persistence contracts.
- `src/tlisp/core/commands/markdown/navigation.tlisp` — heading, fold, tag, footnote, and position navigation.
- `src/tlisp/core/commands/markdown/formatting.tlisp` — inline toggles, headings, lists, checkboxes, and subtree transformations.
- `src/tlisp/core/commands/markdown/tables.tlisp` — table alignment, formulas, and LaTeX table conversion.
- `src/tlisp/core/commands/markdown/links.tlisp` — ordinary links, anchors, include links, and browser dispatch.
- `src/tlisp/core/commands/markdown/execution.tlisp` — fenced code discovery, execution, and result cleanup.
- `src/tlisp/core/commands/markdown/export.tlisp` — HTML, text, and LaTeX export.
- `src/tlisp/core/commands/markdown/knowledge.tlisp` — frontmatter, wiki links, backlinks, templates, daily notes, and renaming.
- `src/syntax/ast/parsers/shared/source-position.ts` — shared offset/line/column conversion.
- `src/syntax/ast/parsers/shared/token-stream.ts` — generic lookahead/advance/match/expect mechanics, not grammar rules.
- `src/syntax/ast/parsers/shared/node-factory.ts` — AST node/span/error-node construction helpers.
- `test/unit/editor-instance-isolation.test.ts` — proves editor session state and caches do not leak between editors.
- `test/unit/editor-api-context.test.ts` — proves only the typed model/runtime context is accepted.
- `test/unit/editor-api-registry.test.ts` — proves API inventory, deterministic merge, and duplicate rejection.
- `test/unit/editor-runtime-delegation.test.ts` — proves facade collaborators preserve behavior and public method delegation.
- `test/unit/evaluator-sync-async-parity.test.ts` — table-driven parity tests for shared forms.
- `test/unit/evaluator-instance-isolation.test.ts` — proves test/module/debug state does not leak between evaluator instances.
- `test/unit/server-rpc-router.test.ts` — typed route, validation, unknown-method, and error-code tests.
- `test/unit/server-frame-sync.test.ts` — explicit tests for every sync direction invariant.
- `test/unit/adw-dispatcher-runtime.test.ts` — shared state/event/subprocess/runtime contract tests.
- `test/unit/core-contracts.test.ts` — canonical contract export and removed-legacy-name assertions.
- `test/unit/legacy-scaffolding-removed.test.ts` — confirms dead files/dependencies/entry points cannot return unnoticed.
- `test/unit/markdown-module-boundaries.test.ts` — proves split modules load once and preserve the public command inventory.
- `test/unit/syntax/parser-shared-foundation.test.ts` — shared parser mechanics and language parser parity.
- `test/unit/editor-fixture-isolation.test.ts` — proves fixture setup/cleanup and independent editors.
- `tmax-use/playbooks/codebase-refactoring-consolidation.yaml` — end-to-end parity for startup, eval, Markdown insert continuation, command-mode substitution, Vim editing, save, and capture.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom. Each numbered change is a separate commit or review unit. Do not begin a change while the previous change's targeted tests are red.

### Step 0 — Record the green baseline before refactoring

#### Current checkpoint status — COMPLETE (2026-07-17)

All inventories captured under `.chore44-baseline/` and asserted as frozen expected sets in `test/unit/chore44-baseline-inventory.test.ts` (6 tests, 51 assertions, green). Reconciled files:

- `rpc-methods.txt` — regenerated from the real 23-method `RpcMethodMap` (the prior file held stale line numbers from the removed `switch`).
- `api-names-static.txt` — regenerated to the live `createEditorAPI()` inventory (350 names; the deterministic, Change-7-governed core).
- `api-names-current.txt` — regenerated to the runtime-after-start superset (533 names = 350 core ∪ stdlib ∪ `editor.ts` `defineRaw` additions); verified superset ⊇ core.
- `markdown-fns.txt` — confirmed current (96 public `markdown-*` defuns).
- `adw-state-keys.txt` (new), `adw-event-types.txt` (new), `cli-exit-codes.txt` (new) — ADW state/event/result JSON keys and CLI exit codes.

Gate evidence: `bun test test/unit/chore44-baseline-inventory.test.ts` → 6 pass / 0 fail. Incidental fix: `isRpcMethod` in `src/server/rpc/router.ts` used `method in HANDLES` on a `Set` (always false); corrected to `HANDLES.has(method)` so the exported route-membership helper actually works. `bun run typecheck` and `git diff --check` green.

- Record `git status --short` and preserve all pre-existing changes.
- Run the complete baseline commands listed in `Validation Commands`. If a baseline command fails, record the exact pre-existing failure in this spec's implementation notes before changing code; do not silently treat it as caused by this chore.
- Capture the current public inventories used for parity tests:
  - all `Editor` public method names;
  - every JSON-RPC method in `TmaxServer.processRequest`;
  - every function exported by `editor/commands/markdown`;
  - every key binding in `markdown-mode.tlisp`;
  - every function name in the `createEditorAPI()` result after a started editor loads;
  - ADW state/event/result JSON keys and CLI exit codes covered by existing tests.
- Add these inventories as explicit expected sets in the relevant tests rather than relying only on line counts.

### Change 1 — Make all editor session state per-instance

#### Total objective

Two concurrently running `Editor` instances must be completely independent. Mutating registers, kill ring, undo, search, visual selection, macros, Dired state, syntax state, replace state, mode registry, or caches in one editor must not affect the other editor or a later test.

#### Current checkpoint status — COMPLETE (2026-07-17)

All deterministic session state now lives as a readonly nested `EditorModel.session: EditorSessionState` field (initialized by `initialModel()` via `createEditorSessionState()`), and `EditorSession` is a thin accessor layer bound over that model-held state — it owns no separate mutable truth (AC1.6). Every state group named in `Implementation requirements` is covered:

- `EditorSessionState` (new, in `domain-state.ts`) holds the mutable state objects for kill ring, registers, delete/yank registers, yank-pop, visual, macros, search, dired, syntax, replace, undo/redo, and major mode.
- `createEditorSession(state)` binds the existing `bind*` ops over the model-supplied `state` (no longer creates state). The `model.session` reference is stable across reducer spreads, so bound ops remain valid for the editor's lifetime.
- Factories migrated to read/write `access.getModel().session.<group>` in place: `search-ops`, `dired-ops`, `syntax-ops`, `replace-ops`, `major-mode-ops`, and `undo-redo-ops` (now receives the state object as its first param).
- **Real isolation bug fixed:** `major-mode-ops.ts` module-globals (`modeRegistry`, `autoModeRules`, `fallback`) and their `getMajorModeRegistry`/`getAutoModeRules` exporters are deleted; the registry/rules now live on `model.session.majorMode`. `editor.ts`'s redundant `private autoModeRules` removed; `getAutoModeRules()` delegates to the model. (`undo-tree.ts` is confirmed unwired — only its own test consumes it — so left unchanged.)
- `model.session` is NOT projected into the public `EditorState` (`modelToEditorState`/`editorStateToModelPatch` exclude it), so it is not serialized into workspace JSON (AC1.4 preserved).

AC1.7 coverage: `editor-instance-isolation.test.ts` now has two-editor cases for registers, kill ring, yank-pop, undo, search/isearch, visual, macros, dired, syntax, replace, major-mode (the module-global-leak regression test), and AST caches. Two `major-mode.test.ts` cases that previously asserted the *buggy* module-global sharing were rewritten to assert per-instance isolation (the correct Change 1 invariant).

Gate evidence (2026-07-17): exact spec targeted gate `bun test editor-instance-isolation count-prefix macro-recording register-prefix incremental-search undo-redo undo-tree visual-mode-selection dired ast-ops` → **193 pass / 0 fail**; `bun run typecheck` exit 0; `git diff --check` clean; `chore44-baseline-inventory.test.ts` 7/7 (no API names changed).

#### Implementation requirements

- Add readonly nested state types and initializers in `src/editor/functional/domain-state.ts` and add the appropriate fields to `EditorModel` and `initialModel()`.
- Move these module globals into `EditorModel` domain state and update their operations through `EditorModelAccess`/`State`:
  - `macro-recording.ts`: `macroState`;
  - `yank-pop-ops.ts`: `yankPopState`;
  - `kill-ring.ts`: `killRingState`;
  - `yank-ops.ts`, `delete-ops.ts`, `text-objects.ts`, `evil-integration.ts`: all register storage;
  - `undo-redo-ops.ts`, `undo-tree.ts`: undo transaction/tree state;
  - `search-ops.ts`: last search and incremental-search state;
  - `dired-ops.ts`: path, marked rows, and show-hidden state;
  - `syntax-ops.ts`: active language, enabled flag, and stored spans;
  - `visual-ops.ts`: visual selection;
  - `replace-ops.ts`: replace session state;
  - `major-mode-ops.ts`: mutable registry/fallback mode when editor-specific.
- Move derived, non-serializable state into one `EditorRuntimeCaches` instance created by the `Editor` constructor:
  - `ast-ops.ts` AST and parse-tree caches;
  - `navigation-ops.ts` AST cache reference;
  - editor-specific plugin repository/submission caches.
- Keep only truly immutable process-wide data at module scope: constant keyword sets, static regexes, immutable tables, and pure functions.
- Remove reset functions whose only purpose was clearing process-global editor state. If a public test helper still needs reset semantics, replace it with a model message that resets only the target editor.
- Do not serialize derived caches into workspace files. Deterministic user state may be persisted only if the existing workspace contract already persisted it; otherwise initialize it per editor.

#### Acceptance criteria

- **AC1.1:** `rg '^let ' src/editor/api` finds no top-level mutable editor-session variables in the listed modules.
- **AC1.2:** two editors can hold different registers, searches, undo histories, visual selections, macros, and Dired state simultaneously.
- **AC1.3:** creating or stopping one editor does not reset another editor.
- **AC1.4:** AST and parser caches are not shared between editors and are not included in serialized workspace JSON.
- **AC1.5:** existing editor behavior and command names are unchanged.
- **AC1.6:** `EditorModel` and `initialModel()` contain readonly initialized fields for every deterministic state group listed in `Implementation requirements`; `EditorSession` may aggregate accessors but may not own separate mutable truth.
- **AC1.7:** the two-editor isolation test contains an explicit case or table row for registers, kill ring, yank-pop, undo/undo-tree, search/isearch, visual selection, macros, Dired, syntax, replace, major-mode state, and AST/parser caches.

Completion gate: AC1.1–AC1.7 and the full targeted test invocation must pass together, followed by `bun run typecheck` and `git diff --check`.

#### Testing requirements

- Add `editor-instance-isolation.test.ts` with two concurrently started editors. Exercise at least one public/T-Lisp operation for every state group listed above, then assert editor B remains at its initial state.
- Run the full `count-prefix.test.ts`, `macro-recording.test.ts`, `register-prefix.test.ts`, `incremental-search.test.ts`, `undo-redo.test.ts`, `undo-tree.test.ts`, `visual-mode-selection.test.ts`, `dired.test.ts`, and `ast-ops.test.ts` files together to catch cross-test leaks.
- Targeted gate: `bun test test/unit/editor-instance-isolation.test.ts test/unit/count-prefix.test.ts test/unit/macro-recording.test.ts test/unit/register-prefix.test.ts test/unit/incremental-search.test.ts test/unit/undo-redo.test.ts test/unit/undo-tree.test.ts test/unit/visual-mode-selection.test.ts test/unit/dired.test.ts test/unit/ast-ops.test.ts`.

### Change 2 — Complete the typed editor state/API migration

#### Total objective

Make `EditorModel` plus an explicit runtime context the only editor API state path. Remove the legacy compatibility model projection and all underscored callbacks that let API code reach around the typed boundary.

#### Current checkpoint status — PARTIAL (2026-07-17)

Completed:

- Added `src/editor/runtime/editor-api-context.ts` and changed `createEditorAPI` to accept it.
- Removed `TlispEditorState`, `compatModelFromState`, `compatModelToState`, `liveModel`, and the named underscored escape hatches.
- Added `createTestAPIContext()` and `editor-api-context.test.ts`; migrated direct `createEditorAPI` tests to the typed helper.

Remaining:

- `EditorAPIContext` still declares mutable deterministic bridge fields such as `currentBuffer`, `cursorLine`, `cursorColumn`, `mode`, `statusMessage`, and `commandLine` in parallel with `access`.
- `src/editor/tlisp-api.ts` still performs direct assignments such as `ctx.cursorLine =`, `ctx.currentBuffer =`, and `ctx.statusMessage =`. Replace these with `EditorModelAccess`, `State`, or explicit `Msg`/`Cmd` transitions.
- Strengthen `editor-api-context.test.ts` to prove state commits use the model path and that missing required runtime services are rejected without casts.

#### Implementation requirements

- Define `EditorAPIContext` in `src/editor/runtime/editor-api-context.ts`. It must expose:
  - `access: EditorModelAccess` for deterministic state reads/writes;
  - typed runtime services needed by primitives (`terminal`, `filesystem`, evaluator callbacks, logging, mode/module registries, and runtime caches);
  - no `any`, no mutable `TlispEditorState`, and no underscored optional hooks.
- Change `createEditorAPI` to accept `EditorAPIContext`; remove `TlispEditorState`, `compatModelFromState`, `compatModelToState`, and the legacy `liveModel` branch.
- Replace `_evalTlisp`, `_getCurrentMajorMode`, `_setCurrentMajorMode`, `_getMinorModeRegistry`, `_getBufferModeStates`, `_getCurrentBufferKey`, `_getGlobalizedMinorModes`, `_getModuleRegistry`, `_setBufferModified`, and equivalent escape hatches with named typed members on `EditorAPIContext`.
- Migrate direct `createEditorAPI()` unit tests to construct a real context through `test/helpers/editor-fixture.ts`; do not keep production compatibility code only for tests.
- Ensure every state-changing API primitive commits through `State<EditorModel, Either<AppError, TLispValue>>`, `StateTaskEither`, or an explicit `Msg`/`Cmd`. No primitive may mutate a compatibility object.

#### Acceptance criteria

- **AC2.1:** `TlispEditorState` no longer exists in production source.
- **AC2.2:** none of the underscored runtime escape-hatch names remain in `src/editor`.
- **AC2.3:** every API factory has a typed context/model signature and zero `as any`/`unknown as` bypasses.
- **AC2.4:** public `Editor.getState()`, `getEditorState()`, and `setEditorState()` remain behaviorally compatible and preserve boundary cloning.
- **AC2.5:** all API functions present in the Step 0 inventory remain registered with the same names.
- **AC2.6:** `EditorAPIContext` contains `access` plus runtime-only services; it does not duplicate deterministic `EditorModel` fields as mutable bridge properties.
- **AC2.7:** `src/editor/tlisp-api.ts` contains no direct assignment to deterministic context state. A static test must scan for assignments to the removed bridge-field names, and behavioral tests must prove model updates still occur.

Completion gate: AC2.1–AC2.7, the exact Step 0 API inventory comparison, and the targeted tests must pass together, followed by `bun run typecheck` and `git diff --check`.

#### Testing requirements

- Add `editor-api-context.test.ts` proving context construction, state commits, runtime service calls, and compile/runtime rejection of missing dependencies.
- Update `tlisp-api.test.ts`, `editor-state-boundary.test.ts`, `functional-patterns.test.ts`, and API-specific tests to use the typed context.
- Targeted gate: `bun test test/unit/editor-api-context.test.ts test/unit/tlisp-api.test.ts test/unit/editor-state-boundary.test.ts test/unit/functional-patterns.test.ts`.

### Change 3 — Decompose `Editor` while preserving it as the public facade

#### Total objective

Keep `Editor` as the one public integration object, but make it a composition root and delegating facade rather than the owner of binding loading, plugin loading, workspace reconciliation, logging persistence, command draining, and every file/buffer lifecycle detail.

#### Current checkpoint status — PARTIAL (2026-07-17)

Completed:

- Added and delegated `LoggingRuntime`, `PluginRuntime`, `BindingRuntime`, and `WorkspaceRuntime` responsibilities.
- Added `editor-runtime-delegation.test.ts` with focused collaborator/delegation coverage.
- Runtime collaborators do not import the concrete `Editor` class.

Remaining:

- `Editor` still implements `loadCoreBindings`, `loadFallbackBindings`, `loadInitFile`, command ownership waiters, command enqueueing, and `drainCommands`. Extract these into the specified binding/command collaborators rather than marking `command-runtime.ts` N/A.
- Create `src/editor/runtime/command-runtime.ts` and move command queue, effect drain, correlation, and command execution coordination behind explicit dependencies.
- Finish binding runtime ownership of core/fallback/init-file policy, not only the low-level `loadBindingsFromFile` helper.
- Complete the shared bootstrap construction required by this change and prove listener notifications remain exactly once per committed model update.

#### Implementation requirements

- Extract the cohesive runtime collaborators listed in `New Files`.
- Construct each collaborator exactly once in the `Editor` constructor using explicit dependencies. Do not use a service locator or global singleton.
- Move code by responsibility, preserving existing algorithms first. Do not redesign behavior while moving it.
- Keep the full public method contract from ADR-0111. Existing callers in `main`, server, Steep, tests, and fixtures must compile unchanged.
- `Editor` must remain responsible for:
  - owning the current `EditorModel`;
  - applying reducer messages;
  - wiring the interpreter/API/runtime collaborators;
  - lifecycle coordination;
  - public method delegation and state-change notifications.
- Extract shared bootstrap construction so direct startup calls `Editor.createBuffer()`/`openFile()` rather than constructing three separate `EditorState` objects in `main`.
- Avoid circular imports: runtime collaborators may depend on interfaces/types, not import the concrete `Editor` class.

#### Acceptance criteria

- **AC3.1:** all Step 0 public `Editor` method names and signatures remain available.
- **AC3.2:** the extracted collaborators can be unit-tested with fake dependencies without constructing a full terminal editor.
- **AC3.3:** no runtime collaborator imports `src/editor/editor.ts`.
- **AC3.4:** `Editor` contains no plugin file parsing, workspace serialization/reconciliation algorithm, log file formatting, or command-queue loop implementation; it delegates those responsibilities.
- **AC3.5:** state-change listeners still fire once per committed model change, with no duplicate notification caused by delegation.
- **AC3.6:** `logging-runtime.ts`, `plugin-runtime.ts`, `binding-runtime.ts`, `workspace-runtime.ts`, and `command-runtime.ts` all exist, own the responsibilities assigned in `New Files`, and are each covered by fake-dependency tests.
- **AC3.7:** static assertions confirm `Editor` contains no implementations named `drainCommands`, core/fallback/init-file parsing/loading algorithms, plugin parsing, workspace serialization/reconciliation, or log formatting; public methods may remain as one-line delegation facades.

Completion gate: AC3.1–AC3.7, an exact public-method inventory comparison, and the targeted tests must pass together, followed by `bun run typecheck` and `git diff --check`.

#### Testing requirements

- Add `editor-runtime-delegation.test.ts` with fakes for each collaborator and assertions for delegation, error propagation, and notification count.
- Keep `editor.test.ts`, `editor-state-boundary.test.ts`, `init-file.test.ts`, `plugin-isolation.test.ts`, `macro-persistence.test.ts`, `workspace-serialization.test.ts`, and `message-log.test.ts` green.
- Targeted gate: `bun test test/unit/editor-runtime-delegation.test.ts test/unit/editor.test.ts test/unit/editor-state-boundary.test.ts test/unit/init-file.test.ts test/unit/macro-persistence.test.ts test/unit/workspace-serialization.test.ts test/unit/message-log.test.ts test/integration/plugin-isolation.test.ts`.

### Change 4 — Decompose evaluator responsibilities and share sync/async mechanics

#### Total objective

Reduce semantic drift between synchronous and asynchronous evaluation while retaining both public execution modes, tail-call optimization, macro expansion, diagnostics, modules, trt, and promise behavior.

#### Current checkpoint status — PARTIAL (2026-07-17)

Completed:

- Added table-driven sync/async parity coverage and evaluator-instance isolation coverage.
- Added pure shared validation for `if` and the `let` family in `form-shapes.ts`.
- Reduced the async special-form switch to genuinely async forms and delegated other recognized forms through one `SPECIAL_FORMS` set.
- Moved the evaluator's core test/suite/current-suite registries from module globals to instance fields; existing TCO/evaluator targeted tests were reported green before later changes.

Remaining:

- Extract validators for every form named in `Implementation requirements`, not only `if` and `let`. Add parity cases for validation errors and source metadata for each form.
- Create `special-form-dispatch.ts`, `module-forms.ts`, `test-forms.ts`, and `function-calls.ts`; the corresponding implementations still reside in the approximately 5,000-line evaluator facade.
- Audit and move mutable coverage/debug/test-support state outside `TLispEvaluator` (for example `test-coverage.ts`) to evaluator-owned instances where the requirement calls for isolation.
- Re-run the entire Change 4 gate after extraction; earlier targeted results do not validate the unfinished decomposition.

#### Implementation requirements

- First add parity tests before moving evaluator code.
- Extract pure form-shape validation for `quote`, `if`, `let`, `let*`, `async-let`, `cond`, `progn`, `while`, `dolist`, `and`, `or`, function definitions, and module/test forms. Both sync and async paths must call the same validators.
- Use one special-form classification table. Sync and async dispatch may select different executors, but the list of recognized forms and error metadata must not be duplicated in two switches.
- Extract module/provide/require behavior, test/suite/fixture behavior, and function-call/macro/tracing behavior into the named evaluator modules.
- Make test/suite/current-suite registries instance-owned. Creating one interpreter/evaluator must not expose tests or suite state to another.
- Keep `TLispEvaluator` in `src/tlisp/evaluator.ts` as the public facade and trampoline owner. Do not change constructor or evaluator public method signatures unless an internal-only method is being moved.
- Preserve exact source spans, diagnostic codes, stack traces, trace events, coverage calls, TCO, and promise auto-unwrapping.
- Do not make synchronous `execute()` call an async function or return a promise.

#### Acceptance criteria

- **AC4.1:** every form supported by both execution paths uses the same validation/parser helper and produces equivalent Right/Left results.
- **AC4.2:** `evalList` and `evalListAsync` no longer contain independent full special-form switch tables.
- **AC4.3:** module/test registries are not top-level mutable variables.
- **AC4.4:** a 100,000-step tail-recursive program still completes without stack overflow in the existing performance test budget.
- **AC4.5:** async-only `async-let` remains rejected by the sync CLI and accepted by `executeAsync` exactly as documented.
- **AC4.6:** all existing module, macro, quasiquote, diagnostic, trace, trt, and coverage tests pass unchanged.
- **AC4.7:** all five named evaluator extraction files exist, and a static boundary test proves `TLispEvaluator` is the public facade/trampoline rather than the owner of module, test/suite, and function-call implementations.
- **AC4.8:** no evaluator/test-coverage module contains process-global mutable registry, coverage, trace, or debug state that can leak between evaluator instances; the isolation test exercises each retained state category.

Completion gate: AC4.1 must cover every form explicitly named in the requirements; AC4.1–AC4.8 and the full targeted gate must pass together, followed by `bun run typecheck` and `git diff --check`.

#### Testing requirements

- Add table-driven `evaluator-sync-async-parity.test.ts` covering literals, symbols, quote/quasiquote, `if`, `let`, `let*`, `cond`, `progn`, `while`, `dolist`, `and`, `or`, macros, user functions, error variants, and source spans.
- Add `evaluator-instance-isolation.test.ts` registering different tests/modules/traces in two evaluator instances.
- Run `evaluator.test.ts`, `evaluator-either.test.ts`, `evaluator-with-either.test.ts`, `tlisp-async.test.ts`, `tlisp-make-promise.test.ts`, `tail-call.test.ts`, `tail-call-performance.test.ts`, `macros.test.ts`, `quasiquote-either.test.ts`, `module-system.test.ts`, `trt-bootstrap.test.ts`, and `tlisp-trace.test.ts`.
- Targeted gate: run all files named in the previous two bullets in one `bun test` invocation.

### Change 5 — Introduce a typed JSON-RPC router and domain handlers

#### Total objective

Make JSON-RPC routing exhaustive and type-safe while shrinking `TmaxServer` to socket ownership, connection lifecycle, shared daemon/editor state, and orchestration. Preserve every method, error code, result shape, and frame synchronization behavior.

#### Current checkpoint status — PARTIAL (2026-07-17)

Completed:

- Added `src/server/rpc/types.ts` and `router.ts` with a 23-method map and dispatch record.
- Removed `switch (request.method)` and replaced handler `params: any`/`Promise<any>` annotations with named parameter types/`unknown` results.
- Existing small server/client/serialization subsets and the full typecheck were reported green during the interrupted session.

Remaining:

- Replace `unknown` result types and the catch-all `[key: string]: unknown` parameter escape hatch with exact per-method wire contracts.
- Add runtime type guards for every method and return `-32602` for invalid params with useful field data.
- Move JSON-RPC version checking, unknown-method handling, internal `-32010` mapping, diagnostic data, and request-ID preservation into the router boundary specified here.
- Create all four domain handler modules and move the `handle*` implementations out of `server.ts`.
- Centralize and test read-only, frame-scoped, stateless, and workspace-override synchronization wrappers.
- Add `server-rpc-router.test.ts` and `server-frame-sync.test.ts`; neither currently exists.

#### Implementation requirements

- Define a `RpcMethodMap` mapping every existing method to exact params/result types. Include `open`, `eval`, `command`, `query`, `ping`, `insert`, `keypress`, `render-state`, `client-event`, `status`, `clients`, `frames`, every workspace method, `capture`, `save-file`, and `shutdown`.
- Represent absent params explicitly as `undefined` or an empty object; do not use `any`.
- Implement a router table keyed by method name. The router must:
  - validate JSON-RPC version;
  - reject unknown methods with `-32601`;
  - reject invalid params with `-32602` and useful data;
  - map internal failures to the existing `-32010` error contract, including T-Lisp diagnostics;
  - preserve request IDs.
- Split method handlers by domain as listed in `New Files`.
- Centralize frame/workspace synchronization wrappers so handlers declare whether they are read-only, frame-scoped mutation, stateless mutation, or workspace override.
- Keep socket locking, stale-socket detection, newline framing, connection buffering, and shutdown ownership in `TmaxServer`.
- Do not add a validation dependency; use TypeScript type guards and existing validation utilities.

#### Acceptance criteria

- **AC5.1:** every Step 0 RPC method is present once in the typed method map.
- **AC5.2:** `server.ts` has no `switch (request.method)` and RPC handler params/results contain no `any`.
- **AC5.3:** `render-state` never calls frame→editor or editor→frame synchronization.
- **AC5.4:** frame keypress synchronizes frame→editor exactly once before handling and editor→frame exactly once afterward.
- **AC5.5:** stateless keypress synchronizes editor→all frames after handling.
- **AC5.6:** socket framing, lock ownership, workspace overrides, diagnostics, and shutdown response-before-close behavior remain unchanged.
- **AC5.7:** `RpcMethodMap` contains exact JSON-compatible result types and exact parameter fields for every method; it contains no `unknown` result placeholder or catch-all index signature.
- **AC5.8:** the router—not `TmaxServer.processRequest`—owns JSON-RPC version validation, method lookup, parameter validation, request-ID preservation, and wire error mapping, with direct unit coverage for every error code.
- **AC5.9:** the four required domain handler files and both required test files exist; `server.ts` contains socket/lifecycle/orchestration code but no domain `handleOpen`/`handleEval`/workspace/frame method bodies.

Completion gate: AC5.1–AC5.9 and every required server test must pass in one unmasked targeted invocation, followed by `bun run typecheck` and `git diff --check`.

#### Testing requirements

- Add `server-rpc-router.test.ts` with one success fixture per method group plus invalid version, invalid params, unknown method, thrown error, and diagnostic error cases.
- Add `server-frame-sync.test.ts` using spies to assert exact sync direction and call counts.
- Run existing `server-client.test.ts`, `server-daemon.test.ts`, `server-daemon-hardening.test.ts`, `server-observability.test.ts`, `server-save-file.test.ts`, `server-serialization.test.ts`, `daemon-capture-parity.test.ts`, `test-ai-agent-control.test.ts`, and `workspace-lifecycle.test.ts`.
- Targeted gate: run all files in the previous two bullets together. Do not use broad `removeAllListeners` cleanup; follow the BUG-16 learning.

### Change 6 — Make TypeScript key handlers pure routers

#### Total objective

Remove command-specific decisions from TypeScript handlers, move them into T-Lisp, and break the current `Editor`/handler import cycle. Handlers should normalize/route keys and invoke one typed dispatch surface only.

#### Current checkpoint status — PARTIAL (2026-07-17)

Completed:

- Added `src/editor/handlers/editor-dispatch-port.ts` and migrated all six handlers away from imports of `editor.ts`.
- Moved `KeyMapping` and `resolveMapping` to `key-resolution.ts`, retaining re-exports for public compatibility.
- AC6.1 and the source typecheck pass. Independently rerun `architecture-boundaries`, `macro-recording`, `count-prefix`, and `vim-dispatch` files pass; the prior “9 fail” summary was concurrent-load timeout noise, not a reproduced assertion failure.

Remaining:

- `command-handler.ts` still owns Dired selection and substitute parsing.
- `insert-handler.ts` still checks Markdown major mode and invokes indentation/list continuation policy.
- Finish the T-Lisp command-line dispatcher and generic post-insert/newline hook, extend static architecture tests to all handlers, and run every named Change 6 test plus trt in the exact targeted gate.

#### Implementation requirements

- Define `EditorDispatchPort` with only the methods handlers actually require. Handlers must import this interface, not the concrete `Editor` class.
- Move `resolveMapping` out of `editor.ts` into existing `key-resolution.ts`; handlers may import the pure helper if still needed.
- Move `:%s`, `:s`, `:dired`, and other command-line parsing from `command-handler.ts` into a T-Lisp command-line dispatcher.
- Move Markdown list continuation and mode-specific insert post-processing from `insert-handler.ts` into T-Lisp hooks/commands. The handler may invoke a generic post-insert/newline hook; it must not check `majorMode === "markdown"`.
- Move visual-text-object, register, macro, operator, and count decisions behind T-Lisp dispatch functions where feasible. Preserve the documented cancellation/recording order.
- Keep TypeScript-only routing limited to raw printable/special-key classification, invoking the T-Lisp dispatcher, scheduling the renderer-owned which-key timer, and mapping clean quit signals.
- Update core binding/module load lists for any new T-Lisp module.

#### Acceptance criteria

- **AC6.1:** no handler imports a value from `editor.ts`; no handler imports the concrete `Editor` type.
- **AC6.2:** command handler contains no substitute/Dired regex or command names.
- **AC6.3:** insert handler contains no Markdown, indentation-policy, or major-mode decision.
- **AC6.4:** the source import graph has no strongly connected component containing `editor.ts` and handlers.
- **AC6.5:** every current key sequence, cancellation path, macro-recording path, insert newline behavior, command-mode substitution, and visual behavior remains unchanged.
- **AC6.6:** a static architecture test scans every file in `src/editor/handlers/` and fails on imports of `editor.ts`, substitute/Dired command strings or regexes, Markdown names, indentation policy, or major-mode branching.

Completion gate: AC6.1–AC6.6, the complete targeted test list, and `bun run test:trt` must pass without output masking, followed by `bun run typecheck` and `git diff --check`.

#### Testing requirements

- Extend `architecture-boundaries.test.ts` with static assertions for all handlers, not only normal/insert.
- Add/extend T-Lisp tests for command-line parsing and insert hooks; use trt for Lisp-owned behavior.
- Run `minibuffer-input.test.ts`, `query-replace.test.ts`, `dired.test.ts`, `macro-recording.test.ts`, `count-prefix.test.ts`, `visual-mode-selection.test.ts`, `vim-dispatch.test.ts`, `markdown-commands.test.ts`, and `markdown-spec-039.test.ts`.
- Targeted gate: `bun test test/unit/architecture-boundaries.test.ts test/unit/minibuffer-input.test.ts test/unit/query-replace.test.ts test/unit/dired.test.ts test/unit/macro-recording.test.ts test/unit/count-prefix.test.ts test/unit/visual-mode-selection.test.ts test/unit/vim-dispatch.test.ts test/unit/markdown-commands.test.ts test/unit/markdown-spec-039.test.ts && bun run test:trt`.

### Change 7 — Replace manual editor API Map merging with a declarative registry

#### Total objective

Make the T-Lisp primitive inventory explicit, deterministic, typed, and collision-safe. `tlisp-api.ts` should describe contributions, not manually copy every Map entry and rebuild the same dependency callbacks.

#### Current checkpoint status — NOT STARTED (2026-07-17)

`src/editor/api/registry.ts` and `test/unit/editor-api-registry.test.ts` do not exist. Do not count the shared API context or per-editor caches from Changes 1–2 as Change 7 completion; begin only after Change 6 is complete.

#### Implementation requirements

- Define `EditorAPIContribution` with a stable contribution name and a factory from `EditorAPIContext` to a readonly Map/record of `TLispFunctionImpl`.
- Define `registerContributions()` that merges contributions in declared order and returns a typed error on duplicate primitive names. Never silently overwrite an existing function.
- Convert each `create*Ops` factory to one contribution. Pure constant contributions may reuse an empty/no-runtime context subset.
- Build shared cursor/buffer/module/runtime helpers once in `EditorAPIContext`; do not recreate equivalent `getBufferText`/`getCursorOffset` callbacks for AST and navigation.
- Keep `createEditorAPI()` as the public composition function and preserve its returned Map shape.
- Add an explicit, reviewed contribution order only for genuine dependencies; document why any ordering dependency exists.

#### Acceptance criteria

- **AC7.1:** the API inventory exactly equals the Step 0 inventory.
- **AC7.2:** duplicate names return a deterministic typed failure naming both contributions.
- **AC7.3:** `tlisp-api.ts` contains no repeated loops copying `entries()` into the combined Map.
- **AC7.4:** AST/navigation share the same per-editor cache object without module-global setter wiring.
- **AC7.5:** contribution construction is deterministic across two editors and does not share state.

#### Testing requirements

- Add `editor-api-registry.test.ts` for complete inventory, deterministic ordering, duplicate rejection, and independent construction.
- Keep `tlisp-api.test.ts`, `architecture-boundaries.test.ts`, `lsp-diagnostics-tlisp-api.test.ts`, `fikra-primitives.test.ts`, and API-specific unit tests green.
- Targeted gate: `bun test test/unit/editor-api-registry.test.ts test/unit/tlisp-api.test.ts test/unit/architecture-boundaries.test.ts test/unit/lsp-diagnostics-tlisp-api.test.ts test/unit/fikra-primitives.test.ts`.

### Change 8 — Consolidate ADW dispatcher and pipeline infrastructure

#### Total objective

Remove repeated infrastructure from stage scripts and three orchestrators while preserving CLI syntax, stage subprocesses, workspace identity, resume behavior, worktree isolation, event ordering, state/results schemas, heartbeat output, retry semantics, and exit codes.

#### Current checkpoint status — NOT STARTED (2026-07-17)

`dispatcher-runtime.ts`, `pipeline.ts`, and `adw-dispatcher-runtime.test.ts` do not exist. Preserve the existing ADW code until parity inventories and tests are in place.

#### Implementation requirements

- Move shared ID generation, path resolution, `appendEvent`, atomic `writeState`, input/spec resolution, workspace lookup, subprocess output capture, token extraction, and common argument parsing helpers into `dispatcher-runtime.ts`.
- Model a stage with a typed descriptor containing stage name, script, argument builder, completion predicate, state transition, and optional retry policy.
- Implement a generic pipeline runner supporting the existing plan→review, plan→review→build, and full plan→review→build→test→patch-review configurations.
- Keep the existing top-level scripts as thin CLI adapters so documented commands and imports used by tests remain valid.
- Preserve `--id`, `--resume`, `--from-stage`, worktree validation/recreation, `base_sha`, goal status, retry progress/stall detection, heartbeat, output files, and event chronology exactly.
- Eliminate duplicate definitions only after parity tests exist; do not delete a legacy script until its replacement CLI test is green.

#### Acceptance criteria

- **AC8.1:** `adwId`, `appendEvent`, `writeState`, shared input resolution, and subprocess capture have one implementation each.
- **AC8.2:** all three pipeline variants are declared as configurations of one runner.
- **AC8.3:** existing CLI help, args, stdout/stderr contracts, exit codes, state JSON, event JSONL, result JSON, resume, and worktree behavior are unchanged.
- **AC8.4:** goal-exhausted/goal-met and build↔patch retry behavior remain exactly as covered by current tests.
- **AC8.5:** stage scripts remain independently invokable with `--id`.

#### Testing requirements

- Add `adw-dispatcher-runtime.test.ts` for IDs, atomic state writes, event append order, input resolution, subprocess result normalization, and failures.
- Update/run every `adw-*.test.ts`, plus `builder.test.ts`, `worktree.test.ts`, `tmux-launcher.test.ts`, `heartbeat.test.ts`, `live-filter.test.ts`, `remote.test.ts`, and `spec-frontmatter.test.ts`.
- Add golden object assertions for state/event/result keys; do not snapshot timestamps or random IDs.
- Targeted gate: `bun run test:adw` followed by the additional named module tests.

### Change 9 — Split and canonicalize core contracts

#### Total objective

Replace the 777-line central type file and parallel legacy/functional interfaces with one canonical contract per domain, while preserving runtime behavior and the persistent `Either`-returning buffer semantics.

#### Current checkpoint status — NOT STARTED (2026-07-17)

No `src/core/contracts/` split exists and all legacy `Functional*` names remain. Begin with contract inventory/tests; do not mix this migration into unfinished editor/evaluator/server work.

#### Implementation requirements

- Split contracts into the files listed under `New Files` and migrate imports by domain.
- Use these canonical choices:
  - the current `FunctionalTextBuffer` semantics are canonical; rename the contract to `TextBuffer` and keep `Either`-returning immutable operations;
  - the current promise-based `TerminalIO` used by `Editor`, server, Steep, and mocks is canonical; remove `FunctionalTerminalIO` and its wrapper hierarchy;
  - the current promise-based `FileSystem` used by `Editor`, server, and mocks is canonical; remove `FunctionalFileSystem` and its wrapper hierarchy;
  - use `TaskEither` at effect composition boundaries (`Cmd`, ADW, validation) rather than maintaining two whole IO object models.
- Rename `FunctionalTextBufferImpl` to `TextBufferImpl` and migrate production/tests/benchmarks. Preserve immutable-return behavior and performance invariants.
- Make `src/core/types.ts` a temporary re-export compatibility barrel during the migration. Before completion, production imports should use domain contract files directly; keep the barrel only if a documented public import depends on it.
- Keep validators/type guards near their owning contract instead of a global mixed object.
- Do not change workspace JSON format, buffer serialization, terminal escape behavior, or filesystem error messages.

#### Acceptance criteria

- **AC9.1:** exactly one `TextBuffer`, one `TerminalIO`, and one `FileSystem` interface exist.
- **AC9.2:** `FunctionalTextBuffer`, `FunctionalTerminalIO`, `FunctionalFileSystem`, and corresponding `*Impl` wrapper names no longer exist.
- **AC9.3:** editor, server, frontends, mocks, benchmarks, and serialization use canonical contracts directly.
- **AC9.4:** persistent buffer operations still return fresh buffers and pass performance invariants.
- **AC9.5:** workspace and server serialization output remains compatible with existing fixtures.

#### Testing requirements

- Add `core-contracts.test.ts` that imports every canonical contract and statically asserts removed names are absent.
- Update/run `buffer.test.ts`, `buffer-perf-invariants.test.ts`, `core-functional.test.ts`, `filesystem.test.ts`, `terminal.test.ts`, `workspace-serialization.test.ts`, `server-serialization.test.ts`, and `migration-validation.test.ts`.
- Run `bun run bench` once as a non-regression smoke check; record results but do not introduce unstable timing assertions beyond existing performance tests.
- Targeted gate: run all named tests plus `bun run typecheck` and `bun run bench`.

### Change 10 — Remove dead scaffolding and simplify Bun bootstrap

#### Total objective

Remove confirmed unused Ink/React and utility code, make Bun the direct runtime, eliminate repeated initial-state construction, and make package metadata the version source while preserving all CLIs and build outputs.

#### Current checkpoint status — NOT STARTED (2026-07-17)

The Ink/React files and dependencies, `.tsx` entry point, duplicated bootstrap, and named utility files remain. Treat all Change 10 work as pending.

#### Implementation requirements

- Delete `src/frontend/ink-adapter.ts` and `src/frontend/types.ts` after verifying no live imports.
- Remove `ink`, `react`, `@types/react`, and `tsx` from package manifests/lockfile. Move `typescript` to `devDependencies`; runtime `dependencies` should be empty unless a live runtime import proves otherwise.
- Rename `src/main.tsx` to `src/main.ts`; update scripts, build commands, docs, tests, and shebang consumers.
- Change `start`, `dev`, and `check` scripts to invoke Bun directly. Preserve all flags and exit codes.
- Remove React JSX compiler settings when no `.tsx` runtime source remains.
- Read version from `package.json` through a bundler-compatible JSON import or a single generated constant verified against package metadata. Do not keep an independent hard-coded `0.2.0` in `main`.
- Replace the three repeated startup `EditorState` object literals with calls to `Editor`/model bootstrap APIs. Opening an existing or missing filename must preserve current status text and buffer naming.
- Delete `src/utils/writer.ts` and `src/utils/save-operations.ts` after confirming zero consumers. Audit `reader`, `effect`, `lens`, and `pipeline`; retain any live module. Do not delete `task-either.ts` or `state.ts`.
- Update README claims from “Ink/React/Steep interchangeable frontends” to the actual live Steep/ANSI frontend architecture.

#### Acceptance criteria

- **AC10.1:** no Ink/React/tsx production files, imports, dependencies, or compiler settings remain.
- **AC10.2:** `bun run start -- --help`, `bun run check`, all three build targets, and unified `bin/tmax` behavior remain valid.
- **AC10.3:** package version and `tmax --version` always match through one source of truth.
- **AC10.4:** startup uses one initial model path for empty, existing-file, and new-file cases.
- **AC10.5:** confirmed unused utility files are removed and all retained FP utilities have at least one production consumer or an explicit documented test-framework purpose.

#### Testing requirements

- Add `legacy-scaffolding-removed.test.ts` reading package/compiler/source manifests and checking deleted dependencies/files and version parity.
- Update/run `main.test.ts`, `cli-flag.test.ts`, `frontend-input.test.ts`, `steep-input.test.ts`, `bench-harness.test.ts`, and build tests.
- Targeted gate: `bun test test/unit/legacy-scaffolding-removed.test.ts test/main.test.ts test/integration/cli-flag.test.ts test/unit/frontend-input.test.ts test/unit/steep-input.test.ts test/unit/bench-harness.test.ts && bun run check && bun run build`.

### Change 11 — Split Markdown commands and shared parser mechanics

#### Total objective

Break the two largest language-oriented maintenance areas into cohesive files without changing Markdown public commands/key bindings or AST output. Extract only repeated parser mechanics; keep language grammars independent and dependency-free.

#### Current checkpoint status — NOT STARTED (2026-07-17)

The Markdown feature-module directory, shared parser foundation, and both boundary/parity tests do not exist. Existing unrelated Markdown/Vim edits and playbooks are baseline behavior to preserve, not Change 11 progress.

#### Implementation requirements — Markdown

- Move existing functions into the seven feature modules listed in `New Files`; do not rename public `markdown-*` functions.
- Keep `src/tlisp/core/commands/markdown.tlisp` as a loader/compatibility aggregator that `require-module`s every feature module and retains `(provide "markdown-commands")`.
- Each public function must be exported by exactly one feature module. Existing unqualified calls continue to resolve uniquely. Step 0 found no production qualified `editor/commands/markdown/...` callers; add a test so a future qualified dependency cannot be missed.
- Update core module loading and `markdown-mode.tlisp` only as required to load the aggregator once. Do not duplicate function definitions in the aggregator.
- Keep shared private helpers in the feature that owns them or a small shared module only when at least two features use them.

#### Implementation requirements — parsers

- Extract source-position conversion, token-stream mechanics, and node/span construction into the three shared parser files.
- Define a small generic token contract (`kind/type`, text/value, start/end) sufficient for lookahead and matching. Do not force all languages to share token enums or grammar rules.
- Migrate TypeScript, Python, C, and Go parsers incrementally, one parser at a time, running that parser's complete test file after each migration.
- Preserve AST node kinds, labels, spans, parent links, error nodes, parser registry behavior, and incremental parse fallback.
- Do not add Tree-sitter, a parser generator, or another dependency.

#### Acceptance criteria

- **AC11.1:** the Markdown public function inventory and all key bindings exactly equal Step 0.
- **AC11.2:** each Markdown function has one definition and one exporting module; the aggregator contains no feature implementation.
- **AC11.3:** all existing Markdown unit/trt/e2e tests pass without weakened assertions.
- **AC11.4:** all four native parsers use shared source-position, token-stream, and node helpers where applicable.
- **AC11.5:** parsing existing fixtures produces identical serialized ASTs, spans, labels, and errors.
- **AC11.6:** no generic shared grammar abstraction is introduced.

#### Testing requirements

- Add `markdown-module-boundaries.test.ts` for module loading, unique export ownership, public inventory, and no duplicate definitions.
- Add `syntax/parser-shared-foundation.test.ts` for token-stream edge cases, source positions including Unicode/newlines, node parent links, and parity fixtures for each language.
- Run `markdown-commands.test.ts`, `markdown-follow-link.test.ts`, `markdown-spec-039.test.ts`, `markdown-tokenizer.test.ts`, all `syntax/parsers/*.test.ts`, AST navigation/incremental/serializer/tree tests, and `bun run test:trt`.
- Run `bin/tmax-use test tmax-use/playbooks/markdown.yaml` after the Markdown split.
- Targeted gate: all tests and the playbook named in this subsection.

### Change 12 — Standardize editor test construction and cleanup

#### Total objective

All tests that need an editor must use one fixture capable of injecting terminals, filesystems, init files, binding behavior, startup options, and deterministic cleanup. Test order must not affect results, and tests must not rely on process-global reset helpers.

#### Current checkpoint status — NOT STARTED (2026-07-17)

`editor-fixture.ts` gained helpers for Changes 1–2, but `createEditorFixture()`, the complete options/disposal contract, the static direct-construction guard, and `editor-fixture-isolation.test.ts` do not exist. This change remains not started until its principal fixture API is implemented.

#### Implementation requirements

- Expand `test/helpers/editor-fixture.ts` with a typed `EditorFixtureOptions` supporting:
  - initial content and buffer name;
  - custom `TerminalIO` and `FileSystem`;
  - custom init-file path;
  - start/no-start mode;
  - real core bindings by default and explicit missing/failing binding fixtures;
  - automatic editor stop and timer/which-key cleanup;
  - optional temporary filesystem/socket cleanup callbacks.
- Provide `createEditorFixture()` returning `{ editor, terminal, filesystem, executeTlisp, dispose }` and keep `createStartedEditor()` as a convenience wrapper.
- Migrate every `new Editor(...)` in `test/unit` and `test/integration` to the fixture, including constructor/error cases by passing custom dependencies.
- Use `afterEach`/`try-finally` to call `dispose`; do not rely on global process listener removal.
- Consolidate duplicate binding-file setup into the fixture and remove test-local incomplete binding stubs unless the test explicitly verifies missing bindings.
- Add a static guard preventing new direct editor construction outside the fixture.

#### Acceptance criteria

- **AC12.1:** `rg 'new Editor\(' test/unit test/integration` returns no matches.
- **AC12.2:** every fixture-created editor has real bindings by default and deterministic cleanup.
- **AC12.3:** tests that need failing/missing dependencies express them through fixture options, not ad hoc constructors.
- **AC12.4:** running historically state-sensitive test files together and in reversed order produces identical results.
- **AC12.5:** no test adds broad `process.removeAllListeners`, socket `removeAllListeners`, or arbitrary sleep cleanup.

#### Testing requirements

- Add `editor-fixture-isolation.test.ts` covering defaults, custom dependencies, no-start, init-file, missing bindings, two concurrent fixtures, and disposal.
- Add a static assertion test that scans unit/integration tests for direct `new Editor`.
- Run all 38 currently direct-construction files together, especially `count-prefix.test.ts`, `macro-recording.test.ts`, server tests, and integration keymap tests.
- Targeted gate: `bun test test/unit/editor-fixture-isolation.test.ts` followed by `bun run test:unit` and `bun run test:integration`.

### Step 13 — Add the cross-cutting tmax-use regression playbook

- Read `tmax-use/playbooks/README.md`, `_smoke.yaml`, `vim-parity-edit.yaml`, and `markdown.yaml` immediately before authoring.
- Create `tmax-use/playbooks/codebase-refactoring-consolidation.yaml` with `cleanup: true` and a Markdown setup file containing a heading, a list item, ordinary text, and a numeric line.
- The playbook must drive real keys where behavior is key-driven and include these independent assertions:
  1. the `.md` file activates Markdown mode;
  2. a simple evaluator expression returns the expected result;
  3. insert-mode Enter on `- item one` auto-continues the Markdown list and typed text produces `- item two`;
  4. Escape returns to normal mode;
  5. `:%s/alpha/omega/g` entered through real command-mode keys changes buffer text;
  6. a Vim edit/yank/paste sequence changes the buffer exactly as expected;
  7. `:w` reports a saved status and the file remains associated with the current buffer;
  8. headless capture contains the edited text and status line.
- Do not use `eval` to bypass the key path for insert, command mode, substitution, Vim editing, or save.
- Run the new playbook alone before the full playbook suite.

### Step 14 — Run all validation commands and document completion

- Run every command in `Validation Commands` in order.
- Record command, exit code, and concise result in the implementation handoff.
- If any command fails, the chore is incomplete. Do not delete, skip, loosen, or relabel the failing check.
- Confirm `git diff --check` is clean and review `git diff --stat` to ensure changes map to the twelve objectives.
- Confirm no unrelated user files were reverted or reformatted.
- Update the `Implementation checkpoint` table only from evidence produced by the final tree. Every row must be **COMPLETE** before declaring CHORE-44 complete.
- Preserve raw test-run exit codes. A command such as `bun test ... | tail` is invalid completion evidence unless `set -o pipefail` is active and the full failure output is retained.

## Tests & E2E Playbooks

This chore must be verified by both unit tests and a tmax-use e2e playbook. Author them as part of the implementation.

### Unit tests

- **Change 1:** `editor-instance-isolation.test.ts`; state-domain tests run together.
- **Change 2:** `editor-api-context.test.ts`; updated T-Lisp API and state-boundary tests.
- **Change 3:** `editor-runtime-delegation.test.ts`; existing editor/plugin/workspace/log tests.
- **Change 4:** `evaluator-sync-async-parity.test.ts` and `evaluator-instance-isolation.test.ts`; complete evaluator/module/macro/TCO/async/trt set.
- **Change 5:** `server-rpc-router.test.ts` and `server-frame-sync.test.ts`; complete daemon/server/workspace set.
- **Change 6:** expanded `architecture-boundaries.test.ts`, trt command/insert tests, and existing mode/command tests.
- **Change 7:** `editor-api-registry.test.ts`; API inventory and contribution isolation.
- **Change 8:** `adw-dispatcher-runtime.test.ts`; all ADW and worktree/tmux/heartbeat module tests.
- **Change 9:** `core-contracts.test.ts`; core, serialization, and performance tests.
- **Change 10:** `legacy-scaffolding-removed.test.ts`; CLI/start/build/frontend tests.
- **Change 11:** `markdown-module-boundaries.test.ts` and `syntax/parser-shared-foundation.test.ts`; Markdown and parser suites.
- **Change 12:** `editor-fixture-isolation.test.ts`; full unit/integration order-isolation run.
- Every new behavior or invariant needs at least one test that fails on the pre-refactor implementation or on a deliberate regression.
- Do not test only file names or line counts when a behavioral assertion is possible. Static boundary tests supplement, not replace, behavior tests.
- Targeted tests must pass before `bun run test:unit` is treated as meaningful.

### tmax-use e2e playbook

- Create `tmax-use/playbooks/codebase-refactoring-consolidation.yaml` exactly as specified in Step 13.
- This playbook is required even though most changes are internal because Changes 1–7 and 9–11 touch the full key→T-Lisp→model→daemon→renderer path.
- Run it locally with `bin/tmax-use test tmax-use/playbooks/codebase-refactoring-consolidation.yaml`.
- Also run the existing `markdown.yaml`, `vim-parity-edit.yaml`, `vim-operator-motion.yaml`, and then `bun run test:tmax-use`.

### New Files

- Production files: all files listed in `Relevant Files > New Files`, covering editor domain state/runtime collaborators/API registry, evaluator modules, RPC router/handlers, ADW runtime/pipeline, core contracts, Markdown submodules, and shared parser mechanics.
- Unit tests:
  - `test/unit/editor-instance-isolation.test.ts`
  - `test/unit/editor-api-context.test.ts`
  - `test/unit/editor-api-registry.test.ts`
  - `test/unit/editor-runtime-delegation.test.ts`
  - `test/unit/evaluator-sync-async-parity.test.ts`
  - `test/unit/evaluator-instance-isolation.test.ts`
  - `test/unit/server-rpc-router.test.ts`
  - `test/unit/server-frame-sync.test.ts`
  - `test/unit/adw-dispatcher-runtime.test.ts`
  - `test/unit/core-contracts.test.ts`
  - `test/unit/legacy-scaffolding-removed.test.ts`
  - `test/unit/markdown-module-boundaries.test.ts`
  - `test/unit/syntax/parser-shared-foundation.test.ts`
  - `test/unit/editor-fixture-isolation.test.ts`
- T-Lisp tests: add focused `.test.tlisp` files under `test/tlisp/` for command-line dispatch and insert hooks if existing files cannot cleanly own those cases.
- E2E: `tmax-use/playbooks/codebase-refactoring-consolidation.yaml`.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions. Every command must exit 0 unless the command explicitly asserts that `rg` finds no matches.

- `git status --short` — record and preserve pre-existing working-tree changes before and after implementation.
- `git diff --check` — no whitespace errors.
- `bun run typecheck:src` — production source contracts pass.
- `bun run typecheck:test` — test contracts pass.
- `bun run typecheck:tmax-use` — playbook runner contracts pass.
- `bun run typecheck:bench` — benchmark imports compile after core contract renames.
- `bun run typecheck` — authoritative full-project typecheck.
- `bun test test/unit/editor-instance-isolation.test.ts test/unit/editor-api-context.test.ts test/unit/editor-api-registry.test.ts test/unit/editor-runtime-delegation.test.ts test/unit/editor-fixture-isolation.test.ts` — editor state/runtime/fixture target gate.
- `bun test test/unit/evaluator-sync-async-parity.test.ts test/unit/evaluator-instance-isolation.test.ts test/unit/evaluator.test.ts test/unit/tlisp-async.test.ts test/unit/tail-call.test.ts test/unit/tail-call-performance.test.ts test/unit/macros.test.ts test/unit/module-system.test.ts test/unit/trt-bootstrap.test.ts test/unit/tlisp-trace.test.ts` — evaluator target gate.
- `bun test test/unit/server-rpc-router.test.ts test/unit/server-frame-sync.test.ts test/unit/server-client.test.ts test/unit/server-daemon.test.ts test/unit/server-daemon-hardening.test.ts test/unit/server-observability.test.ts test/unit/server-save-file.test.ts test/unit/server-serialization.test.ts test/unit/daemon-capture-parity.test.ts test/integration/workspace-lifecycle.test.ts` — server/RPC target gate.
- `bun run test:adw` — ADW dispatcher/orchestrator suite.
- `bun test test/unit/adw-dispatcher-runtime.test.ts test/unit/builder.test.ts test/unit/worktree.test.ts test/unit/tmux-launcher.test.ts test/unit/heartbeat.test.ts test/unit/live-filter.test.ts test/unit/remote.test.ts test/unit/spec-frontmatter.test.ts` — shared ADW module target gate.
- `bun test test/unit/core-contracts.test.ts test/unit/buffer.test.ts test/unit/buffer-perf-invariants.test.ts test/unit/core-functional.test.ts test/unit/filesystem.test.ts test/unit/terminal.test.ts test/unit/workspace-serialization.test.ts test/unit/server-serialization.test.ts test/integration/migration-validation.test.ts` — core contract target gate.
- `bun test test/unit/legacy-scaffolding-removed.test.ts test/main.test.ts test/integration/cli-flag.test.ts test/unit/frontend-input.test.ts test/unit/steep-input.test.ts test/unit/bench-harness.test.ts` — dependency/bootstrap target gate.
- `bun test test/unit/markdown-module-boundaries.test.ts test/unit/markdown-commands.test.ts test/unit/markdown-follow-link.test.ts test/unit/markdown-spec-039.test.ts test/unit/markdown-tokenizer.test.ts test/unit/syntax/parser-shared-foundation.test.ts test/unit/syntax/parsers/c-parser.test.ts test/unit/syntax/parsers/go-parser.test.ts test/unit/syntax/parsers/python-parser.test.ts test/unit/syntax/parsers/typescript-parser.test.ts test/unit/syntax/ast-incremental.test.ts test/unit/syntax/ast-navigation.test.ts test/unit/syntax/ast-serializer.test.ts test/unit/syntax/ast-tree-ops.test.ts` — language-module target gate.
- `bun run test:trt` — all T-Lisp-authored behavior tests pass.
- `bun run test:unit` — all unit tests pass with zero regressions.
- `bun run test:integration` — all integration tests pass with zero regressions.
- `bun run test` — combined Bun suite passes.
- `bin/tmax-use test tmax-use/playbooks/codebase-refactoring-consolidation.yaml` — new cross-cutting e2e playbook passes.
- `bin/tmax-use test tmax-use/playbooks/markdown.yaml` — split Markdown commands preserve behavior.
- `bin/tmax-use test tmax-use/playbooks/vim-parity-edit.yaml` — handler/API/model refactors preserve editing.
- `bin/tmax-use test tmax-use/playbooks/vim-operator-motion.yaml` — operator/motion routing remains intact.
- `bun run test:tmax-use` — full tmax-use e2e suite passes.
- `bun run bench` — benchmark harness runs after core contract migration; report results.
- `bun run check` — Bun entry-point smoke check passes.
- `bun run build` — `dist/tmax`, `dist/tlisp`, and `dist/tmax-use` build successfully.
- `bun run start -- --version` — output version matches `package.json`.
- `bash -lc 'test "$(rg -n "^let " src/editor/api/macro-recording.ts src/editor/api/yank-pop-ops.ts src/editor/api/kill-ring.ts src/editor/api/yank-ops.ts src/editor/api/delete-ops.ts src/editor/api/text-objects.ts src/editor/api/evil-integration.ts src/editor/api/undo-redo-ops.ts src/editor/api/undo-tree.ts src/editor/api/search-ops.ts src/editor/api/dired-ops.ts src/editor/api/syntax-ops.ts src/editor/api/visual-ops.ts src/editor/api/replace-ops.ts src/editor/api/major-mode-ops.ts || true)" = ""'` — no top-level mutable editor session state remains in API modules.
- `bash -lc '! rg -n "TlispEditorState|_evalTlisp|_getCurrentMajorMode|_setCurrentMajorMode|_getMinorModeRegistry|_getBufferModeStates|_getCurrentBufferKey|_getGlobalizedMinorModes|_getModuleRegistry|_setBufferModified" src/editor'` — no compatibility state or underscored runtime escape hatches remain.
- `bash -lc '! rg -n "params: any|Promise<any>" src/server/rpc src/server/server.ts'` — RPC handler contracts contain no `any`.
- `bash -lc '! rg -n "switch \(request\.method\)" src/server/server.ts'` — the monolithic RPC method switch is removed.
- `bash -lc '! rg -n "from [\"'\"']\.\./editor\.ts[\"'\"']|:%s|majorMode === [\"'\"']markdown[\"'\"']" src/editor/handlers'` — handlers do not import the concrete editor or contain known command/mode policy.
- `bash -lc 'for n in adwId appendEvent writeState; do test "$(rg -n "function $n" adws --glob "*.ts" | wc -l | tr -d " ")" -le 1 || exit 1; done'` — core ADW infrastructure has one implementation.
- `bash -lc '! rg -n "FunctionalTextBuffer|FunctionalTerminalIO|FunctionalFileSystem|FunctionalTextBufferImpl|FunctionalTerminalIOImpl|FunctionalFileSystemImpl" src test bench tmax-use adws'` — legacy parallel core contract names are gone.
- `bash -lc 'test ! -e src/frontend/ink-adapter.ts && test ! -e src/frontend/types.ts && test ! -e src/utils/writer.ts && test ! -e src/utils/save-operations.ts && test ! -e src/main.tsx && test -e src/main.ts'` — confirmed dead files and old entry point are removed.
- `bash -lc '! rg -n "\"(ink|react|tsx)\"|@types/react" package.json && ! rg -n "jsxImportSource|react-jsx" tsconfig.json'` — obsolete dependencies and React compiler settings are removed.
- `bash -lc 'test "$(rg -n "new Editor\(" test/unit test/integration | wc -l | tr -d " ")" -eq 0'` — all editor tests use the shared fixture.

## Notes

- **2026-07-17 checkpoint commit:** the current tree intentionally contains partial CHORE-44 work plus pre-existing Vim-parity, documentation, test-runner, and playbook work. The user explicitly requested committing the complete working tree as a preservation checkpoint. Do not interpret that commit as proof that CHORE-44 or any numbered change is complete.
- **Resume order:** finish Step 0, then close Change 1's model/isolation gaps, Change 2's mutable-context gap, Change 3's command/binding extraction, Change 4's evaluator extraction, Change 5's router/domain-handler work, and Change 6's T-Lisp policy migration before beginning Change 7.
- **Verified checkpoint evidence:** on 2026-07-17, `bun run typecheck` passed; independently run `architecture-boundaries.test.ts` passed 3/3, `macro-recording.test.ts` 25/25, `count-prefix.test.ts` 27/27, and `vim-dispatch.test.ts` 24/24. This is checkpoint evidence only, not the full validation matrix.
- **Checkpoint e2e result:** `bun run test:tmax-use` completed with 27 passed and 7 failed. Every failure reported `daemon not responsive ... socket not yet present`; representative failures `eval-02-insert-mode-lifecycle.yaml` and `smoke.tmax-use.ts` passed when immediately rerun alone. Treat the full-suite result as a real unresolved startup-race failure until the complete command exits 0; do not mark e2e validation complete from the individual retries.
- **Implementation order matters.** Change 1 removes the most dangerous state leaks; Change 2 gives later extractions one typed context; Changes 3, 6, and 7 then reduce editor coupling. Do not start by moving the giant classes into arbitrary files while the old state path remains.
- **The existing Elm architecture is the target.** Do not replace it with a new event bus, dependency-injection framework, Redux-style library, or service locator.
- **`TaskEither` and `State` are established.** They have real production usage and are not dead scaffolding. Change 10 removes only confirmed unused utilities.
- **The core contract choice is intentionally pragmatic.** The persistent buffer keeps `Either`; terminal/filesystem keep the promise-based interface used by the live runtime. This removes wrapper duplication without forcing a second unrelated async rewrite.
- **No external parser dependency.** Shared parser helpers are mechanics only. Each language grammar stays explicit and independently testable.
- **T-Lisp module split compatibility.** Public `markdown-*` names must remain uniquely resolvable. If module-qualified calls are discovered during implementation, update them deliberately and add them to the compatibility test before moving functions.
- **Server cleanup caution.** The repository learning for BUG-16 forbids broad listener removal. Diagnose and close only handles created by the relevant fixture/server.
- **ADW worktree caution.** Run pipeline implementation in its actual worktree and preserve uncommitted work. Manual stage resumes must include `--id`.
- **Do not use line count alone as completion.** Smaller facades are expected, but behavioral inventories, isolation tests, typed boundaries, and full gates determine completion.
- **Commit boundaries.** Use one commit per numbered change, with smaller sub-commits for evaluator, server, Markdown, and parser migrations if needed. Each commit must be green and independently revertible.
- **Documentation synchronization.** After code is green, update README and affected ADR consequences/status sections. Do not rewrite historical specs or audit logs to pretend the previous architecture never existed.
