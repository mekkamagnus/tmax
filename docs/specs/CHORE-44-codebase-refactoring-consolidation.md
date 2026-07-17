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
| Change 2 | **COMPLETE** | All 18 mutable bridge properties removed from `EditorAPIContext`; `tlisp-api.ts` has 0 bridge-field assignments and 0 reads (AC2.7, independently verified); writes route through `applyUpdate(Msg)` + 4 side-effectful methods; fold latent disconnect fixed; `editor-api-context.test.ts` strengthened with static + behavioral AC2.6/AC2.7 cases. | — |
| Change 3 | **COMPLETE** | `command-runtime.ts` extracted (queue/drain/correlation/classify); `binding-runtime.ts` owns full core/fallback/init policy; `editor.ts` holds only one-line facades + path resolution (AC3.7 verified); `main.tsx` bootstrap collapsed 3→1 `EditorState`; delegation tests cover CommandRuntime + BindingRuntime with fakes; AC3.5 notification-once preserved. | — |
| Change 4 | **COMPLETE** | evaluator.ts 5021→4005 lines; form-shapes validators for all named forms (AC4.1); single `special-form-dispatch.ts` classification (AC4.2); `module-forms.ts`/`test-forms.ts`/`function-calls.ts` extracted, evaluator delegates (AC4.7); per-instance `CoverageState` (AC4.8); TCO/async/macros/modules/trt/trace verified intact (full evaluator gate 154/0). | — |
| Change 5 | **COMPLETE** | Exact named result types for 18/23 methods + named `JsonObject` for 5 genuinely-dynamic serialized-state results (no `unknown`, param catch-all removed — AC5.7); router owns version/lookup/`-32602`/error-mapping (AC5.8); 4 domain handler files + `ServerContext`, server.ts 2353→1614 lines (AC5.9); declarative `SYNC_POLICY` + `server-frame-sync.test.ts` proving AC5.3–5.5; `server-rpc-router.test.ts`. Server gate 84/0 (no hangs). | — |
| Change 6 | **COMPLETE** | `:%s`/`:s`/`:dired` parsing → T-Lisp `command-line.tlisp` dispatcher; markdown list-continuation + indent → T-Lisp `post-newline.tlisp` hook; handlers are pure routers (AC6.2/6.3); `architecture-boundaries.test.ts` scans all 6 handlers (AC6.6). Found+fixed a Change 4 `set!` dispatch typo (a476392) that had broken 40 editor tests. Gate 209/0. | — |
| Change 7 | **COMPLETE** | `registry.ts` (`EditorAPIContribution` + `registerContributions` with typed duplicate rejection); `createEditorAPI` composes 43 contributions declaratively (no copy loops — AC7.3); ast+navigation share `ctx.caches` (AC7.4); inventory stays exactly 350 (AC7.1); `editor-api-registry.test.ts` (12 tests). Gate 67/0 + broad 173/0. | — |
| Change 8 | **COMPLETE** | `dispatcher-runtime.ts` (one impl of adwId/appendEvent/writeState/subprocess) + `pipeline.ts` (StageDescriptor + runLinearPipeline); 8 scripts → thin adapters (−789 lines); 3 pipeline configs declarative (AC8.2); `adw-dispatcher-runtime.test.ts` (39 tests). test:adw 420/1 (1 pre-existing from `682c5e3`, not chore-caused); module gate 176/0. | — |
| Change 9 | **COMPLETE** | `src/core/contracts/{primitives,buffer,terminal,filesystem,editor,workspace}.ts` canonical; `types.ts` 777→80-line barrel; `FunctionalTextBuffer→TextBuffer`, `FunctionalTextBufferImpl→TextBufferImpl`; `FunctionalTerminalIO`/`FunctionalFileSystem` removed (zero `Functional*` matches anywhere — AC9.2); `core-contracts.test.ts`. Gate 88/0 + broad 172/0 + bench 9/9 + typecheck 0. (ink-adapter.ts + save-operations.ts deleted — forced by interface removal; Change 10 still has deps/main.tsx work.) | — |
| Change 10 | **COMPLETE** | `main.tsx`→`main.ts`; `dependencies:{}` (ink/react/tsx/typescript removed); React jsx settings gone; zero `.tsx`; version from package.json; one bootstrap model path; dead files (frontend/types.ts, utils/writer.ts) deleted; README updated; `legacy-scaffolding-removed.test.ts`. build 3 binaries OK, `--version` parity, gate 46/0. | — |
| Change 11 | **COMPLETE** | `markdown.tlisp` → 0-defun aggregator; 7 feature modules (navigation/formatting/tables/links/execution/export/knowledge), 96 public fns unchanged (AC11.1/11.2); NEW `parsers/shared/{source-position,token-stream,node-factory}.ts` (mechanics only, AC11.6); all 4 native parsers migrated (AC11.4) with identical ASTs (AC11.5); `markdown-module-boundaries.test.ts` + `parser-shared-foundation.test.ts`. Gate 241/0; markdown.yaml passes; trt 101/4 (4 pre-existing). | — |
| Change 12 | **COMPLETE** | `createEditorFixture(options)` + `EditorFixtureOptions` + deterministic `dispose` (per-handle, BUG-16 compliant); all 37 test files migrated — zero `new Editor(` in tests (AC12.1); order-independent (AC12.4 fwd+rev 94/0); `editor-fixture-isolation.test.ts` (10 tests). Broad regression 209/0; test:integration 70/0; broad test:unit subset 2775/0 (full test:unit hits pre-existing BUG-16 server hang). | — |
| Step 13 | **COMPLETE** | `codebase-refactoring-consolidation.yaml` playbook (8 assertions, real keys) passes. Exposed+fixed 4 pre-existing bugs (`:%s` mapping, `markdown-list-continue` regex + `cond`, `:w`/`:q`/`:wq` undefined). Regression 158/0; markdown + vim-parity playbooks still pass. | — |
| Step 14 | **IN PROGRESS** | — | Run the full Validation Commands matrix + document completion; reconcile pre-existing `test:trt` (4 browse-detect) + `test:unit` BUG-16 hang. |

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

#### Current checkpoint status — COMPLETE (2026-07-17)

All 18 mutable deterministic bridge properties (`currentBuffer`, `buffers`, `cursorLine`, `cursorColumn`, `mode`, `lastCommand`, `statusMessage`, `viewportTop`, `viewportLeft`, `commandLine`, `mxCommand`, `spacePressed`, `cursorFocus`, `currentFilename`, `config`, `lspDiagnostics`, `foldRanges`, `searchMatches`) are removed from `EditorAPIContext` (AC2.6). The context now exposes `access`, `session`, `caches`, runtime services, one general write surface `applyUpdate(msg: Msg)`, and four explicit side-effectful methods (`setCurrentBuffer`, `setCursorLine`, `setCursorColumn`, `setCurrentFilename`) whose bodies are the former editor.ts setters preserved verbatim (tab/window/metadata/cursor-window sync). `spacePressed` (transient input state, not an EditorModel field) is exposed via `getSpacePressed`/`setSpacePressed`.

`src/editor/tlisp-api.ts` now has **zero** `ctx.<bridge> =` assignments and **zero** `ctx.<bridge>` reads (AC2.7, independently verified): all reads go through `access.getModel()` and all writes through `applyUpdate(Msg)` (e.g. `write({type:"SetStatusMessage",...})`) or the four side-effectful methods. The fold primitives now build a fresh `Map` and commit via `SetFoldRanges` — fixing a pre-existing latent disconnect where the old editor.ts context had no `foldRanges` getter (fold state is now genuinely model-backed). `model.buffers` is confirmed to be the live mutable `editor.buffers` Map, so buffer-registry mutations land correctly.

`editor-api-context.test.ts` was strengthened: static source scans assert `tlisp-api.ts` has no removed-field assignments AND no removed-field reads, and `editor-api-context.ts` declares none of the removed fields; behavioral cases prove `applyUpdate(SetStatusMessage)`, `setCurrentBuffer`, and the `message` primitive land on `access.getModel()`. `createTestAPIContext` now backs `access` with a real `EditorModel` + `update()` reducer.

Gate evidence (2026-07-17): spec Change 2 gate (`editor-api-context`, `tlisp-api`, `editor-state-boundary`, `functional-patterns`, `fold-ops`) → **79 pass / 0 fail**; `bun run typecheck` exit 0; `git diff --check` clean; `chore44-baseline-inventory.test.ts` green (no API names changed); broad regression net (editor/count/macro/undo/dired/search/visual/mode/cursor/buffer/markdown) 186 pass / 0 fail.

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

#### Current checkpoint status — COMPLETE (2026-07-17)

The command-queue/effect-drain machinery and the binding-load policy are extracted into collaborators; `Editor` retains only one-line delegation facades (plus path resolution that must live where `import.meta.dir` resolves). Listener notifications still fire exactly once per committed model update (AC3.5).

- **NEW `src/editor/runtime/command-runtime.ts`** (`CommandRuntime`): owns the `cmdQueue`, `cmdDraining` guard, `commandWaiters`, and `enqueueCmd` / `drainCommands` / `trackCommand` / `classifyCommand`. Imports only the pure functional core (`runCmd`, `Cmd`, `EditorRuntime`, `Msg`) + `Either`; depends on injected `getRuntime` and `commitMsg` (= `applyUpdate`). `Editor.enqueueCmd`/`trackCommand` are one-line facades; `drainCommands`/`classifyCommand` bodies removed from `editor.ts`.
- **`binding-runtime.ts` completed**: now owns the full policy — `REQUIRED_BINDING_FILES`, `FALLBACK_BINDINGS` (the fallback keymap string), `loadCoreBindings` (keymaps + required files + on-failure fallback + post-load line-numbers toggle), `loadFallbackBindings`, `loadInitFile` (XDG + `~/.config/tmax/init.tlisp`), `ensureCoreBindingsLoaded`. `editor.ts`'s `loadCoreBindings`/`loadFallbackBindings`/`loadInitFile`/`ensureCoreBindingsLoaded`/`loadBindingsFromFile` are one-line facades that resolve paths and delegate. AC3.7 (independently verified): `editor.ts` contains no `normal.tlisp`/`insert.tlisp`/… required-file loop, no `FALLBACK`/`requiredBindingFiles`, no drain `while`/`runCmd` loop.
- **`main.tsx` bootstrap consolidated**: the three `initialState = {…}; editor.setEditorState(initialState)` branches collapsed into ONE shared path (compute `(filename, content, statusMessage)` → one `EditorState` → one `setEditorState`). Status text and buffer naming preserved. (A public `Editor.bootstrapForFile` was deliberately NOT added to avoid changing the frozen method inventory AC3.1; the deeper createBuffer/openFile model-path migration is Change 10's AC10.4.)
- **`editor-runtime-delegation.test.ts`** extended: `CommandRuntime` fake-dep tests (FIFO drain, follow-up Msgs committed via `commitMsg` exactly once [AC3.5], `trackCommand` settlement, serial drain), `BindingRuntime` policy tests (core load order + line-numbers toggle, fallback on missing required file, init-file path + fallback, `silent`), and AC3.7/AC3.3 static + import-scan assertions.

Honest note: the `CmdFailed` drain branch is unreachable through fakes (current `runCmd` wraps every error as a Right-with-failed-follow-up), so its test substitutes the reachable equivalent (Right-with-`EvalTlispFailed` committed once). The branch remains as defensive code.

Gate evidence (2026-07-17): spec Change 3 targeted gate (`editor-runtime-delegation`, `editor`, `editor-state-boundary`, `init-file`, `workspace-serialization`, `chore44-baseline-inventory`) → **71 pass / 0 fail**; `bun run typecheck` exit 0; `git diff --check` clean; `plugin-isolation` integration green; frozen Editor method inventory unchanged.

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

#### Current checkpoint status — COMPLETE (2026-07-17)

The evaluator facade shrank from 5021 → 4005 lines and now delegates module/test/function-call handling to extracted modules while keeping the TCO trampoline + async dispatch intact. TCO, async semantics, macros, modules, trt, traces, and coverage behavior are byte-for-byte preserved (constraint #4).

- **AC4.1** — `form-shapes.ts` extended with pure shared validators for `if`, `let`/`let*`/`async-let`, `quote`, `quasiquote`, `cond`, `progn`, `and`, `or`, `while`, `dolist`, `defun`/`lambda`, `provide`/`featurep`/`require`, `deftest`. Both sync and async paths call them; 16 new validation-error parity cases in `evaluator-sync-async-parity.test.ts` assert identical variant + message.
- **AC4.2** — NEW `special-form-dispatch.ts` is the single classification table (`classifyForm`/`isSpecialForm`/`hasAsyncExecutor`). The local `SPECIAL_FORMS` set was removed from `evaluator.ts`; both `evalList`/`evalListAsync` consult the one table.
- **AC4.3** — confirmed: `testRegistry`/`suiteRegistry`/`currentSuite`/`moduleRegistry`/`debugState` are already instance fields; no module-global mutable registry remains in `evaluator.ts`.
- **AC4.7** — NEW `module-forms.ts` (provide/featurep/require/current-module/defmodule/require-module + loadModuleFromDisk), `test-forms.ts` (deftest/suite/fixture handlers — dormant in TS; the live framework is self-hosted `trt`), `function-calls.ts` (macro-expansion detection, coverage mark, trace enter/exit helpers). `evaluator.ts` no longer contains the `provide`/`require`/`deftest`/`testRegistry.set`/`suiteRegistry.set` handler bodies — it delegates. NEW `evaluator-module-boundaries.test.ts` proves this statically. The tail-call emission (`createTailCall`) + trampoline drive stay in `evaluator.ts` (moving them would risk AC4.4).
- **AC4.8** — NEW `coverage-state.ts` `CoverageState` class; each `TLispEvaluator` owns `readonly coverage: CoverageState = new CoverageState()`. The former `test-coverage.ts` module globals are gone from the live path; `test-coverage.ts` is retained only as a dead compatibility shim (no production importer — a Change 10 cleanup candidate). `interpreter.ts`/`trt/bootstrap.ts` route coverage through `interpreter.coverage` (per-instance). `evaluator-instance-isolation.test.ts` strengthened to 8 cases (coverage enable/threshold/mark/reset, traces, debug stack, test/module registries).

Gate evidence (2026-07-17): full evaluator gate (evaluator, evaluator-either, evaluator-with-either, evaluator-sync-async-parity, evaluator-instance-isolation, evaluator-module-boundaries, tlisp-async, tlisp-make-promise, tail-call, tail-call-performance, macros, quasiquote-either, module-system, trt-bootstrap, tlisp-trace) → **154 pass / 0 fail**; `bun run typecheck` exit 0; `git diff --check` clean; `chore44-baseline-inventory` green. TCO verified (tail-call-performance 4/4); async preserved (tlisp-async + make-promise green).

Honest notes: (1) The TS `deftest`/`deffixture`/`suite-*` handlers are dormant (the live test framework is the T-Lisp `trt` package) but were still extracted per AC4.7 with dormancy documented. (2) The `test-coverage.ts` shim holds a dead module-level `defaultState`; it has no production importer and does not affect evaluator isolation (AC4.8 isolation test green), but strict removal is deferred to Change 10.

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

#### Current checkpoint status — COMPLETE (2026-07-17)

JSON-RPC routing is now exhaustive and type-safe; `TmaxServer` shrank from 2353 → 1614 lines and owns only socket/framing/lifecycle/orchestration. Every method, error code, result shape, and frame-sync behavior is preserved.

- **AC5.7** — `RpcMethodMap` has exact named result types for 18/23 methods (`OpenResult`, `EvalResult`, `SaveFileResult`, `WorkspaceListResult`, …) and the `[key: string]: unknown` catch-all on `FrameTarget` (the param escape hatch) is removed. The remaining 5 results that are genuinely-dynamic serialized state — `render-state` (the full render view model), `status`, `clients[]`, `frames[]`, and the `keypress` view-model branch — use a single named `JsonObject = { [key: string]: unknown }` type whose authoritative shape lives in `serialize.ts`. Rationale: these are serialized daemon/editor view models; fully typing them in the RPC map would duplicate and risk drift from the serializer, so a named dynamic-object type is the honest contract (deliberately not a blanket `unknown` and not the removed param catch-all). No `result: unknown` placeholder remains.
- **AC5.8** — the router (`rpc/router.ts`) now owns JSON-RPC version validation (`-32600`), method lookup (`-32601`), per-method param type guards returning `-32602` with `{field, expected}` data, request-ID preservation, and wire error mapping (`RpcError` passthrough + thrown errors → `-32010` with T-Lisp diagnostic data). `processRequest` is a 6-line delegator to `routeRequest`. `server-rpc-router.test.ts` (28 tests) covers every error code + one success fixture per method group.
- **AC5.9** — NEW `handlers/editing.ts`, `frames.ts`, `workspaces.ts`, `lifecycle.ts` + `handlers/context.ts` (`ServerContext` interface — handlers depend on it, NOT the concrete `TmaxServer`). Every `handleOpen`/`handleEval`/`handleWorkspace*`/… body moved out; `server.ts` retains only `handleConnection` (socket infra, AC5.6).
- **AC5.3–5.5** — a single declarative `SYNC_POLICY` table in `router.ts` declares each method's category (`readonly` / `frame-scoped` / `stateless` / `workspace-override`). The sync calls are preserved verbatim inside the moved handler bodies (byte-for-byte, including `EDITOR_QUIT_SIGNAL` and `workspaceOverride` early-returns — a pure wrapper would have risked behavior drift on those paths); the table is the authoritative declaration and `server-frame-sync.test.ts` (9 spy-based tests) proves the invariants: `render-state` syncs 0/0/0 (AC5.3), frame `keypress` = frame→editor once then editor→frame once (AC5.4), stateless mutations = editor→all-frames once (AC5.5).
- AC5.2: no `params: any`/`Promise<any>`, no `switch (request.method)` (static checks pass).

Gate evidence (2026-07-17): spec server gate (`server-rpc-router`, `server-frame-sync`, `server-client`, `server-daemon`, `server-daemon-hardening`, `server-observability`, `server-save-file`, `server-serialization`, `daemon-capture-parity`, `workspace-lifecycle`) → **84 pass / 1 skip / 0 fail** (no hangs — BUG-16 did not recur); `bun run typecheck` exit 0; `git diff --check` clean; frozen RPC method inventory unchanged.

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

#### Current checkpoint status — COMPLETE (2026-07-17)

Command-line parsing and post-newline mode policy moved out of TypeScript handlers into T-Lisp; handlers are pure routers.

- **AC6.2** — NEW `src/tlisp/core/commands/command-line.tlisp` `(editor-dispatch-command-line cmd-line)` does the `:%s/find/replace/[gic]`, `:s/find/replace`, `:dired`, `:dired <dir>` parsing via `string-match`/`match-string` (JS RegExp) and dispatches to `dired`/`query-replace`/`replace-find-matches`+`replace-apply-all`/`editor-execute-command-line`. find/replace pass as runtime string values (no source-embedding/escaping). `command-handler.ts` Enter branch is one `(editor-dispatch-command-line …)` call — no `:%s`/`s/`/`dired` regex or strings remain.
- **AC6.3** — NEW `src/tlisp/core/commands/post-newline.tlisp` `(post-newline-hook)` does `(indent-apply-line (cursor-line))` (guarded by `condition-case`) then `(if (equal (major-mode-get) "markdown") (condition-case (markdown-list-continue) …))`. `insert-handler.ts` Enter branch is `(insert-newline)` then `(post-newline-hook)` — no `markdown`/`getCurrentMajorMode`/indent-policy in TypeScript.
- Modules registered in `src/tlisp/core/bindings/normal.tlisp` (`require-module` after `replace`/`dired`/`markdown`).
- **AC6.6** — `architecture-boundaries.test.ts` extended to scan ALL six handlers + the port for: `from "../editor.ts"`, `:%s`/`%s/`/`:s/`, `markdown`/`markdown-list-continue`, `indent-apply-line`/`indent-apply`, `=== "markdown"`, `majorMode === "markdown"`. (`getCurrentMajorMode` is permitted because every handler legitimately passes it to `resolveMapping` for keymap routing — that is routing, not mode policy; the canonical spec Validation command line 859 only forbids `from "../editor.ts" | :%s | majorMode === "markdown"`.) AC6.1 (no editor.ts import) and AC6.4 (no cycle) hold.
- **AC6.5** — behavior preserved: the exact command-line patterns still mutate the buffer identically; Enter still inserts a newline + applies indent + continues markdown lists in markdown mode.

**Critical regression found and fixed mid-Change-6:** while validating, the Change 6 targeted gate showed 40 failures (count-prefix/vim-dispatch/minibuffer-input/macro-recording). Bisect isolated these to Change 4 (commit `f41206a`), NOT Change 6: a one-character typo in `src/tlisp/evaluator/special-form-dispatch.ts` (`set:` instead of `"set!":`) made `isSpecialForm("set!")` false, so the ASYNC path mis-dispatched every `(set! …)` — which all key bindings use (the vim-parity modules mutate state via `set!`). The SYNC path kept `case "set!"`, masking it from Change 4's evaluator-only gate. Fixed in commit `a476392`; the 4-file gate went 43/40 → 83/0.

Gate evidence (2026-07-17): Change 6 targeted gate (`architecture-boundaries`, `minibuffer-input`, `query-replace`, `dired`, `macro-recording`, `count-prefix`, `visual-mode-selection`, `vim-dispatch`, `markdown-commands`, `markdown-spec-039`) → **209 pass / 0 fail**; `bun run typecheck` exit 0; `git diff --check` clean; frozen inventory green.

**Pre-existing failure (recorded, not caused by this chore):** `bun run test:trt` reports `101 passed / 4 failed` — the 4 failures are `browse-detect-at-point-*` in `browse-url.test.tlisp`. Verified pre-existing at the starting commit `21f8ce3` (same 101/4) and unrelated to Change 6 (browse-URL detection, not command-line/post-newline). They are inherited in-progress work (constraint #8 — preserve unrelated Vim-parity work) and are deferred; Step 14 will reconcile the full validation matrix.

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

#### Current checkpoint status — COMPLETE (2026-07-17)

NEW `src/editor/api/registry.ts` defines `EditorAPIContribution` (`name` + `factory(ctx) => Map<string, TLispFunctionImpl>`) and `registerContributions(ctx, contributions): Either<AppError, Map<…>>` — merges in declared order into a fresh Map; a cross-contribution duplicate primitive returns a typed `Left` (`ConstraintViolation`, constraint `unique-primitive-name-across-contributions`) naming BOTH contributions + the primitive. `createEditorAPI(ctx)` now builds 43 contributions and delegates to `registerContributions` (throws on `Left` so a composition bug can't ship silently). Each contribution's factory extracts its own deps from `ctx`; `create*Ops` signatures/behavior are unchanged. The `buffer-get-line`→`buffer-line` alias lives inside the `buffer` contribution (legitimate same-impl, two names within one Map — doesn't trip cross-contribution detection). `http-request` now owns its own per-editor id counter (was shared with subprocess; still unique per-editor).

- **AC7.1** — inventory stays exactly 350 names (`.chore44-baseline/api-names-static.txt`); `chore44-baseline-inventory.test.ts` green.
- **AC7.2** — duplicate rejection returns the typed failure naming both contributions.
- **AC7.3** — `tlisp-api.ts` has zero `for (const [key,value] of …entries()) api.set(…)` copy loops (verified by static scan).
- **AC7.4** — ast + navigation contributions both read `ctx.caches` (same reference); proven by a spy test.
- **AC7.5** — two `createEditorAPI(createTestAPIContext())` calls share no state.

NEW `test/unit/editor-api-registry.test.ts` (12 tests) covers all five ACs. Gate evidence (2026-07-17): Change 7 targeted gate (`editor-api-registry`, `tlisp-api`, `architecture-boundaries`, `lsp-diagnostics-tlisp-api`, `fikra-primitives`) → **67 pass / 0 fail**; broad editor regression (count-prefix, vim-dispatch, minibuffer-input, macro-recording, markdown-commands, dired, visual-mode-selection, editor, query-replace) → **173 pass / 0 fail**; `bun run typecheck` exit 0; `git diff --check` clean.

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

#### Current checkpoint status — COMPLETE (2026-07-17)

NEW `adws/adws-modules/dispatcher-runtime.ts` holds the ONE implementation each of `adwId`, `appendEvent`, atomic `writeState`, `run`/`runCapture` subprocess capture, `spawnStage`, `tokensOf`, `readWorkspaceState`, `recoverSpecPathFromEvents` (+ re-exports `findWorkspaceBySpecPath`/`normalizeSpecPath`). NEW `adws/adws-modules/pipeline.ts` provides `StageDescriptor`/`PipelineStageInfo` + `runLinearPipeline`. The 8 stage/orchestrator scripts were refactored to thin CLI adapters (−789 lines); CLI syntax, subprocess behavior, workspace identity, resume, worktree isolation, event order, state/result schemas, heartbeat, retry, and exit codes are preserved.

- **AC8.1** — `adwId`/`appendEvent`/`writeState` each have exactly ONE `function` implementation (in `dispatcher-runtime.ts`; call sites use 1-line const-arrow wrappers, verified by static scan).
- **AC8.2** — the three pipeline variants are declarative configs of shared runner primitives: 2-stage (`adw-plan-reviewspec`) and 3-stage (`adw-plan-reviewspec-build`) are driven end-to-end by `runLinearPipeline`; the 5-stage (`adw-plan-review-build-patch`) declares `STAGE_DESCRIPTORS` (`PIPELINE_STAGES`) and consumes every shared primitive (`spawnStage`/`tokensOf`/`appendEvent`/`writeState`/`adwId`/`readWorkspaceState`), retaining its unique build↔patch retry loop + worktree + goal-exhausted logic (migrating that loop would risk the load-bearing SPEC-065/BUG-20/BUG-16/BUG-18 behavior).
- **AC8.3** — CLI/args/exit/state-JSON/event-JSONL/result-JSON/resume/worktree unchanged (proven by `test:adw`).
- **AC8.4** — goal-exhausted/goal-met + build↔patch retry unchanged (covered by `adw-pipeline-loop`/`adw-feedback-stall`).
- **AC8.5** — all 5 stage scripts remain independently invokable with `--id` (verified `--help` exits 0).
- NEW `test/unit/adw-dispatcher-runtime.test.ts` (39 tests): IDs, atomic state writes, event order, spec resolution, subprocess normalization, failures — golden-key assertions (no random id/timestamp snapshots).

Honest scope notes: `adw-test.ts`/`adw-patch-review.ts` keep their specialized `runRaw`/`runCapture` (wall-clock timeouts + detached process-group + drain-on-end — BUG-16/BUG-18 load-bearing for `test:unit` hangs and long audits); the simple shared `run`/`runCapture` ARE consolidated. The 5-stage `runPipeline` body is not delegated to `runLinearPipeline` (its retry/worktree/goal loop is unique and high-risk); AC8.2 is met via the declarative stage descriptors + full consumption of shared primitives.

Gate evidence (2026-07-17): `bun run test:adw` → **420 pass / 1 fail** (the 1 failure is `adw-patch-review-gates-phase.test.ts`, PRE-EXISTING — root cause commit `682c5e3` predates CHORE-44; verified failing at Change-7 HEAD and at the starting commit; unrelated to Change 8); module gate (`adw-dispatcher-runtime`, `builder`, `worktree`, `tmux-launcher`, `heartbeat`, `live-filter`, `remote`, `spec-frontmatter`) → **176 pass / 0 fail**; `bun run typecheck` exit 0; `git diff --check` clean; baseline inventory green.

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

#### Current checkpoint status — COMPLETE (2026-07-18, independently verified)

Split landed: `src/core/contracts/{primitives,buffer,terminal,filesystem,editor,workspace}.ts` are the canonical homes; `src/core/types.ts` is now a temporary compatibility re-export barrel; `src/core/mod.ts` re-exports canonical contracts. The 777-line `types.ts` shrank to a ~80-line barrel.

Canonical choices implemented:
- **Buffer:** `TextBuffer` (Either-returning immutable ops) in `contracts/buffer.ts`; `TextBufferImpl` (the renamed `FunctionalTextBufferImpl`) in `src/core/buffer.ts` implements it byte-for-byte (gap-buffer algorithm unchanged; the internal `FunctionalGapBuffer` was also renamed to `GapBufferEngine` to avoid the now-misleading prefix). AC9.1: exactly ONE `TextBuffer` interface — the prior legacy sync `void`-returning `TextBuffer` (types.ts line 690) was a duplicate with no live consumers (only commented-out examples in `utils/lens.ts`/`utils/state.ts`, a dead-import in `buffer.test.ts`, and the deleted `utils/save-operations.ts`), so it was consolidated away.
- **Terminal:** `TerminalIO` (promise-based) canonical. The prior `FunctionalTerminalIOImpl` is now the internal `TerminalEngine` class (not on the AC9.2 forbidden list; the TaskEither-returning engine that `TerminalIOImpl` adapts to the canonical promise-based contract). `TerminalUtils` operate against the engine surface at the effect-composition boundary.
- **Filesystem:** `FileSystem` (promise-based) canonical. The prior `FunctionalFileSystemImpl` engine is merged into `FileSystemImpl` as static `*E` TaskEither-returning helpers (`readFileE`, `writeFileE`, `existsE`, `statE`, `removeE`, `backupE`, `atomicSaveE`, `createDirE`); the public methods (`readFile`, `writeFile`, etc.) unwrap them to the canonical promise-based contract. `FileSystemUtils` retained as free-function TaskEither composition helpers.

Two dead files deleted (both already Change 10 targets — deleted here only because they blocked the typecheck:src green gate after the parallel `Functional*` interfaces were removed): `src/frontend/ink-adapter.ts` (only importer was the deleted `frontend/types.ts` reach; the dead Ink/React adapter the spec explicitly lists for Change 10 removal) and `src/utils/save-operations.ts` (zero importers; pre-existing latent type bug against the new canonical `TextBuffer.getContent(): Either` surfaced once the legacy sync interface went away). Change 10 will still need to remove `ink`/`react`/`tsx` deps + `frontend/types.ts` + `main.tsx` rename; no scope creep here.

Consumers migrated: `test/unit/core-functional.test.ts` rewritten to use canonical `FileSystemImpl.*E`/`TerminalEngine`/`TextBufferImpl`/`BufferUtils`/`FileSystemUtils`; `test/unit/error-handling.test.ts` migrated to `TerminalEngine`. All ~80 production/test/bench import sites of the buffer contract migrated to `TextBuffer`/`TextBufferImpl` via mechanical sed.

Gate evidence (2026-07-18): `bun run typecheck` exit 0 (all 4 sub-checks: src/test/tmax-use/bench); Change 9 targeted gate + new `core-contracts.test.ts` → **88 pass / 0 fail / 1369 expect()** across 9 files; `buffer-perf-invariants.test.ts` 27/0 (AC9.4 preserved); `bun run bench` 9/9 PASS; `chore44-baseline-inventory.test.ts` 7/0; static scan `! rg -n "FunctionalTextBuffer|FunctionalTerminalIO|FunctionalFileSystem|FunctionalTextBufferImpl|FunctionalTerminalIOImpl|FunctionalFileSystemImpl" src test bench tmax-use adws` is EMPTY; `git diff --check` clean; broad editor regression (editor/editor-instance-isolation/count-prefix/evaluator/server-client/markdown-commands) 109/0; cross-cutting slice (adw-dispatcher-runtime/evaluator-sync-async-parity/server-rpc-router/architecture-boundaries/editor-api-registry) 124/0.

Honest scope notes: (1) the spec's claim of "5 + 3 files" for TerminalIO consumers was overstated — only 3 files (`ink-adapter.ts` deleted, `core-functional.test.ts`, `error-handling.test.ts`) actually referenced `FunctionalTerminalIOImpl`; production never used it directly (always via `TerminalIOImpl`). (2) `src/core/types.ts` is now the temporary compat barrel the spec calls for; new code should import contract files directly. Modulo Change 10 cleanup, the barrel remains the simplest import path for legacy callers.

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

#### Current checkpoint status — COMPLETE (2026-07-18, independently verified)

Confirmed-dead Ink/React/tsx scaffolding is gone; Bun is the direct runtime; the entry point is `src/main.ts`; package metadata is the single version source; the duplicated startup bootstrap is one model path. All CLIs and build outputs preserved.

- **AC10.1** — `package.json` `dependencies` is now `{}` (removed `ink`, `react`, `typescript`, `tsx`); `typescript` moved to `devDependencies`; `@types/react` removed (`@types/node` + `@types/bun` kept — `@types/node` stays explicit per learnings). `tsconfig.json` React JSX settings (`jsx: react-jsxdev`, `jsxImportSource: react`) removed; `include` no longer lists `*.tsx`. Zero `.tsx` files under `src/`. (`src/frontend/ink-adapter.ts` + `src/utils/save-operations.ts` were already deleted in Change 9; this change also deletes `src/frontend/types.ts` + `src/utils/writer.ts` — both zero-importer dead.)
- **AC10.2** — `src/main.tsx` → `src/main.ts` (git mv); `start`/`dev`/`check`/`build:tmax` scripts now invoke Bun directly (`bun src/main.ts …`); `bin/tmax`, `scripts/build-binaries.ts`, README/AGENTS/CLAUDE entry-point docs, editor.ts/steep comments, and the two shell test scripts updated. `bun run start -- --help`, `bun run check`, and `bun run build` (→ `dist/tmax`, `dist/tlisp`, `dist/tmax-use`) all exit 0.
- **AC10.3** — `src/main.ts` reads `import pkg from "../package.json" with { type: "json" }`; `const VERSION = pkg.version`. Hard-coded `"0.2.0"` removed. `bun run start -- --version` and `./dist/tmax --version` both print `tmax v0.2.0 …` (compiled-in parity). (`tsconfig` `module` → `esnext` to honor the import attribute — Bun's recommended setting.)
- **AC10.4** — startup no longer constructs an `EditorState` object literal; one shared path computes `(bufferName, filename, content, statusMessage)` for empty/existing/new-file and bootstraps via `editor.createBuffer(...)` + `applyUpdate(SetCurrentFilename/SetStatusMessage)`. Status text + buffer naming preserved.
- **AC10.5** — `writer.ts` + `save-operations.ts` (zero consumers) deleted; every retained FP utility (`task-either` 242 consumers, `validation` 30, `state` 15, `adt`/`lens`/`pipeline`/`reader`/`option`/`effect` 1-2 each) has a production consumer.
- README/AGENTS/CLAUDE architecture claims updated from "Ink/React/Steep interchangeable frontends" to the actual native Steep/ANSI frontend architecture.
- NEW `test/unit/legacy-scaffolding-removed.test.ts` (8 tests): asserts no ink/react/tsx deps, no jsx settings, no `.tsx`, the 4 dead files absent + `main.ts` present, version parity via package.json import.

Gate evidence (2026-07-18): Change 10 gate + broad regression (legacy-scaffolding-removed, main, cli-flag, frontend-input, steep-input, bench-harness, editor-instance-isolation, server-client, baseline) → **46 pass / 0 fail**; `bun run build` exit 0 (3 binaries); `bun run typecheck` exit 0; `git diff --check` clean.

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

#### Current checkpoint status — COMPLETE (2026-07-18, independently verified)

**Part A — Markdown split.** `src/tlisp/core/commands/markdown.tlisp` is now a 0-`defun` aggregator (`require-module` of all 7 feature modules + `(provide "markdown-commands")`). The 7 modules under `src/tlisp/core/commands/markdown/`: `navigation` (19 defuns), `formatting` (25), `tables` (12), `links` (12), `execution` (4), `export` (6), `knowledge` (19) — each public `markdown-*` function in exactly one module (AC11.2). The 96-function public inventory is unchanged (AC11.1); the 58 `markdown-mode.tlisp` bindings are unchanged.

**Part B — shared parser mechanics.** NEW `src/syntax/ast/parsers/shared/{source-position,token-stream,node-factory}.ts` (308 lines, MECHANICS only — `buildLineMap`/`positionAt`/`spanFrom`/`TokenStream`/`makePosition`/`makeSpan`/`errorNode`/`bindNodeFactory`; no token enums, no grammar rules, no combinators — AC11.6). All 4 native parsers migrated (AC11.4): c-parser uses source-position + token-stream + node-factory; go-parser uses node-factory (its lexer is the stream); python-parser uses source-position + node-factory; typescript-parser uses source-position + node-factory. (Only c-parser adopts `TokenStream` — Go's lexer is already a stream and TypeScript relies on negative-lookahead `peek(-1)` the generic stream doesn't model; the spec's "where applicable" qualifier covers this, and AST parity [AC11.5] was chosen over forcing an ill-fitting stream.)

- **AC11.3/AC11.5** — all Markdown + parser tests pass; parsing fixtures produce IDENTICAL serialized ASTs/spans/labels/errors (5 per-language parity snapshots in the new foundation test).
- NEW `test/unit/markdown-module-boundaries.test.ts` (module loading, unique export ownership, public inventory, no duplicate definitions) + `test/unit/syntax/parser-shared-foundation.test.ts` (36 tests: token-stream edge cases, source-position incl. Unicode/newlines, node parent links, 5 language parity snapshots).

Gate evidence (2026-07-18): full Change 11 gate (5 markdown + 4 parser + foundation + 4 AST tests) → **241 pass / 0 fail**; `bin/tmax-use test tmax-use/playbooks/markdown.yaml` → **1 passed**; `bun run test:trt` → 101/4 (the 4 are the pre-existing `browse-detect-at-point-*`, identical to baseline, unrelated); `bun run typecheck` exit 0; `git diff --check` clean; `chore44-baseline-inventory` green.

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

#### Current checkpoint status — COMPLETE (2026-07-18, independently verified)

`test/helpers/editor-fixture.ts` now exposes `createEditorFixture(options)` → `{editor, terminal, filesystem, executeTlisp, dispose}` with `EditorFixtureOptions` (initialContent, bufferName, terminal, filesystem, initFilePath, start, loadRealCoreBindings, disposeTimeouts). `dispose()` is idempotent: `editor.stop()` + per-handle `whichKeyHandle.deactivate()` (NO broad `removeAllListeners` — BUG-16 compliant). `createStartedEditor` is now a thin wrapper. All 37 test files (~75 construction sites) migrated to the fixture — every `new Editor(` in `test/unit` + `test/integration` is gone (AC12.1). Each test's setup intent preserved via options: custom mocks → `terminal`/`filesystem`; init-file → `initFilePath`; no-start/tune-before-start → `start:false`; failing/missing bindings → `filesystem: FailingBindingsFileSystem()` or `loadRealCoreBindings:false` (AC12.3).

- **AC12.1** — `rg 'new Editor\(' test/unit test/integration` is EMPTY (static scan in the isolation test enforces it).
- **AC12.2** — every fixture editor has real core bindings by default + deterministic cleanup (verified by isolation test).
- **AC12.4** — the state-sensitive set (count-prefix, macro-recording, visual-mode-selection, dired, init-file, string-escaping, module-system) passes identically forward (94/0/247) AND reversed (94/0/247).
- **AC12.5** — no editor test uses broad `removeAllListeners`/sleep; only server tests (exempt) retain their cleanup.
- NEW `test/unit/editor-fixture-isolation.test.ts` (10 tests): defaults, custom deps, no-start, init-file, missing/failing bindings, two concurrent fixtures, idempotent dispose, + the AC12.1 static scan.

Gate evidence (2026-07-18): AC12.4 both directions 94/0; broad regression (17 files: editor/isolation/count/macro/init/string-escaping/module-system/markdown/dired/visual/server-client/evaluator + 3 integration + baseline) → **209 pass / 0 fail**; `bun run test:integration` → **70 pass / 0 fail**; `bun run typecheck` exit 0; `git diff --check` clean; `chore44-baseline-inventory` green.

**Pre-existing (not chore-caused):** `bun run test:unit` hits the known BUG-16 inactivity-timer hang on `server-daemon-hardening.test.ts` + `server-observability.test.ts` (server tests, untouched by Change 12). The broad subset excluding those two is **2775 pass / 0 fail across 192 files**. Step 14 reconciles the full `test:unit` run (the BUG-16 memory notes it passes under the `--dots` reporter).

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

### Step 13 — Add the cross-cutting tmax-use regression playbook — COMPLETE (2026-07-18)

`tmax-use/playbooks/codebase-refactoring-consolidation.yaml` created with `cleanup: true`, a Markdown setup file (heading + list item + ordinary text + numeric line), and all 8 assertions driving real keys (eval used only for the simple evaluator check #2): (1) `.md` → markdown major-mode; (2) `(+ 1 41)`→42; (3) `A<Return>item two` continues the list → `- item two`; (4) Escape → normal; (5) `:%s/alpha/omega/g` → `omega line`; (6) `yyp` duplicates the heading; (7) `:w` → `Saved` status; (8) headless capture contains the edited text. **Result: `1 passed` (6.2s).**

Authoring this playbook exposed and fixed four pre-existing bugs (the spec required these key-driven behaviors, so restoring them is in scope — they predate CHORE-44):
- `:%s/find/replace/[gic]` dispatched to interactive `query-replace` (which also errored on an undefined `when`) — never mutated the buffer. Now does a non-interactive whole-buffer replace-all (`replace-state-init` + `replace-apply-all`) via `command-line.tlisp` (vim `:%s/.../g` semantics). Same fix applied to `:s`.
- `markdown-list-continue` (Change 11 `formatting.tlisp`) had two latent bugs: its regexes used the Emacs dialect (`\(` `\)` `\s` `\d`) which JS `RegExp` (T-Lisp `string-match`) doesn't honor, AND its `cond` clause bodies had >2 elements (T-Lisp `cond` requires exactly `(test expr)`). Both fixed (JS-RegExp-correct patterns + `progn`-wrapped bodies) — list continuation now actually works.
- `:w`/`:q`/`:wq` were undefined as T-Lisp symbols, so the eval fallthrough errored. `command-line.tlisp` now maps them explicitly (`w`→`file-save`, `wq`/`x`→save+quit, `q`/`q!`/`quit`→`editor-quit`).

Regression: markdown/query-replace/vim-dispatch/architecture-boundaries/count-prefix (7 files) → 158/0; existing `markdown.yaml` + `vim-parity-edit.yaml` playbooks still pass.

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
