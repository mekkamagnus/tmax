---
goal: "bun run typecheck and bun run test:unit and bun run test:integration and bun run test:tmax-use and bun run build all pass, AND bash -lc 'failed=0; for f in src/editor/editor.ts src/editor/handlers/*.ts src/editor/api/*.ts src/editor/tlisp-api.ts; do count=$(rg -c \"as any\" \"$f\" || true); count=${count:-0}; printf \"%s:%s\\n\" \"$f\" \"$count\"; if [ \"$count\" -ne 0 ]; then failed=1; fi; done; exit \"$failed\"' exits 0, AND the unsafe-cast/bypass check in Validation Commands exits 0, AND bash -lc 'count=$(rg -c \"this\\\\.state\\\\.\" src/editor/editor.ts || true); count=${count:-0}; printf \"src/editor/editor.ts:%s\\n\" \"$count\"; test \"$count\" -eq 0' exits 0, AND the per-file State-monad adoption loop in Validation Commands exits 0"
---

# Chore: Functional editor rewrite — Elm Architecture + State monad

## Chore Description

Rewrite the large `Editor` class (`src/editor/editor.ts`) from mutable OOP to a functional **Elm Architecture** (model / update / view) that threads state through the existing `State<S, A>` monad (`src/utils/state.ts`). The current implementation violates `rules/functional-programming.md` ("Immutable State", "Composition Over Inheritance") and violates `src/editor/Claude.md` ("TypeScript here provides primitives ONLY") in spirit, because handlers reach into editor internals and mutate them.

### The problem, concretely

1. **Mutable `this.state`** — `editor.ts` has 169 references to `this.state` and ~205 `.state.` field accesses. State is mutated in place across `handleKey`, `openFile`, `saveFile`, `setEditorState`, mode transitions, viewport updates, etc.
2. **`as any` escape hatches** — `editor.ts` has 5; the handlers (`normal`/`insert`/`visual`/`command`/`mx`/`replace`) have 84 combined (`command-handler.ts:23`, `normal-handler.ts:19`, `insert-handler.ts:19`, `replace-handler.ts:16`, `visual-handler.ts:9`, `mx-handler.ts:2`). Patterns like `(editor as any).state.commandLine += key` and `(editor as any).getInterpreter()` let handlers mutate editor internals without going through any typed API.
3. **Unused functional scaffolding** — `State<S, A>` and `StateTaskEither<S, L, A>` exist in `src/utils/state.ts` with full monadic operations (`map`, `flatMap`, `modify`, `gets`, `stateUtils.updateProperty`, `stateCombiners.sequence`, etc.) and **zero call sites** in `src/`. `Either`/`TaskEither`/`Task` in `src/utils/task-either.ts` are used in some `api/*.ts` modules but not consistently.
4. **Closure-over-mutable-state in T-Lisp API** — `createEditorAPI(state: TlispEditorState)` and the `create*Ops` factories close over a mutable `state` object and mutate it (`state.commandLine += ...`, `state.mode = ...`). This is why `tlisp-api.ts` has 35 `as any` casts of its own.

### The target

Elm Architecture with three pure layers, plus a thin impure runtime:

- **model** — `EditorModel`: an immutable record containing deterministic editor state, not impure runtime resources. It is deliberately **separate from** the public `EditorState` type because `EditorState.buffers` is currently mutable (`Map<string, FunctionalTextBuffer>`) and public accessors expose that shape to callers. `EditorModel` uses readonly fields and readonly collection views (`ReadonlyMap`, `ReadonlySet`, `readonly T[]`) internally; public `EditorState` values are projected/cloned at the boundary. Terminal, filesystem, interpreter, LSP client, timers/handles, log sinks, and lifecycle booleans stay on the runtime side unless explicitly listed as model fields below.
- **update** — `update(model, msg): UpdateResult`, where `UpdateResult = { readonly model: EditorModel; readonly cmds: readonly Cmd<Msg>[] }`. Pure. Every current `this.state.X = Y` becomes a `Msg` constructor dispatched through `update`; effects initiated by `update` (file IO, log writes, async runtime work) are represented only as returned `Cmd`s. `update` is a direct Elm-style reducer: each case returns `UpdateResult` with immutable object/collection helpers. It must not require callers to run a `State` computation. The `State` monad requirement applies to editor API primitives in `src/editor/api/*.ts` and the `tlisp-api.ts` adapter.
- **view** — already pure in `src/frontend/render/*.ts` (`renderStatusLine(state, width)`, `renderBufferLines(...)`, `computeWhichKeyPopup(...)`, etc.). No change needed beyond feeding them `modelToEditorState(model)` or another typed read-only view that preserves the existing render contracts.
- **runtime** — the new `Editor` class holds `private model: EditorModel`, exposes synchronous `applyUpdate(msg: Msg): EditorModel` to dispatch messages, and enqueues returned `Cmd`s for asynchronous execution through `TaskEither`-based effect handlers. `applyUpdate` updates the model immediately and returns it; command results are later fed back as follow-up `Msg`s through the same queue. Public async methods such as `handleKey`, `openFile`, and `saveFile` await command draining when their existing observable behavior requires it. The public method surface (`start`, `stop`, `handleKey`, `openFile`, `saveFile`, `getEditorState`, `setEditorState`, `getState`, `createBuffer`, `getInterpreter`, `onStateChange`, `getWhichKeyHandle`, … — see "Public API contract" below) is preserved so consumers (`src/main.tsx`, `src/server/server.ts`, `src/steep/assam.ts`, `src/frontend/frontends/types.ts`, and ~25 test files) compile unchanged.
- **api primitives** — each `src/editor/api/*.ts` factory changes signature from "close over mutable state" to "return `State<EditorModel, A>` (or `StateTaskEither<EditorModel, AppError, A>` for async)". The editor runtime runs the returned computation against `this.model` and stores the result.
- **handlers** — each handler becomes mutation-pure with respect to editor state: it may read `editor.getModel()`, dispatch `Msg`s, compose `State` computations returned by api primitives, and invoke the existing interpreter runtime boundary for T-Lisp command strings; it must not mutate model/state directly. Zero `as any`. Zero direct state writes. This explicitly scopes handler purity to state mutation only, preserving current T-Lisp execution flow while removing the unsafe state access.

This converts the current god class into a smaller runtime plus a pure, testable functional core.

### Architectural rule reaffirmed

Per `src/editor/Claude.md`: TypeScript in `src/editor/` provides **primitives only** (buffer insert/delete, cursor get/set, character scan); editor **logic** (key bindings, command behavior, operator state machines, count prefix, mode transitions) lives in T-Lisp under `src/tlisp/core/`. The rewrite does **not** pull logic into TypeScript — it makes the TypeScript primitives and routers pure and immutable, eliminating the `as any` casts and direct mutations that today bypass the typed surface.

### Out of scope

- T-Lisp core library refactors (`src/tlisp/core/**/*.tlisp`) — untouched.
- Frontend render functions (`src/frontend/render/*.ts`) — already pure, no change.
- `FunctionalTextBufferImpl` (`src/core/buffer.ts`) — already persistent, used as-is.
- New editor features — this is a structural rewrite, not feature work.

## Relevant Files

Use these files to resolve the chore:

### Functional core (NEW — additive layer)

- `src/editor/functional/model.ts` — `EditorModel` type, `initialModel(options?: { readonly initFilePath?: string }): EditorModel` factory, `modelToEditorState(model): EditorState` adapter. `EditorModel` does **not** extend `EditorState`; the adapter clones/projects readonly internal collections into the current public `EditorState` shape. Do not pass `terminal` or `filesystem` into `initialModel`; those are impure runtime dependencies owned by `EditorRuntime`. The default core load path from this file must resolve to existing `src/tlisp/core`; from `src/editor/functional/model.ts`, use `${import.meta.dir}/../../tlisp/core` or centralize this in a shared helper imported by both `editor.ts` and `model.ts`.
- `src/editor/functional/messages.ts` — `Msg` discriminated union. One constructor per current mutation site (e.g., `SetMode`, `SetStatusMessage`, `SetCommandLine`, `AppendCommandLine`, `SetCursorPosition`, `SetViewport`, `UpsertBuffer`, `SwitchBuffer`, `SetCurrentFilename`, `SetCountPrefix`, `SetSpacePressed`, `SetWindowPrefix`, `SetWhichKeyActive`, `SetLspDiagnostics`, `SetWindows`, `SetTabs`, `UpsertBufferModeState`, `SetCurrentMajorMode`, `ToggleMinorMode`, `UpsertBufferMetadata`, `SetMinibufferState`, …). Tagged unions give exhaustive `switch` checking in `update`.
- `src/editor/functional/update.ts` — `UpdateResult` type and `update(model: EditorModel, msg: Msg): UpdateResult`. Pure direct reducer. Every `case` returns `{ model: freshModel, cmds }`; no in-place mutation and no IO. Use immutable helper functions and the same update style as `stateUtils.updateProperty` where helpful, but do not make `update` itself return or expose `State`. `State.modify` / `stateUtils.updateProperty` are mandatory in the API primitive migration in Phase 4.
- `src/editor/functional/cmd.ts` — `Cmd<Msg>` type (effects: `SaveFile`, `OpenFile`, `EvalTlisp`, `LogMessage`, `LogProgram`) and `runCmd(cmd, runtime): TaskEither<AppError, Msg[]>` that executes effects via `TaskEither` and yields follow-up `Msg`s. `NotifyStateChange` is intentionally **not** a `Cmd`; listener notification is synchronous in `applyUpdate` only, so there is one notification per committed model change.
- `src/editor/functional/runtime.ts` — `EditorRuntime` interface the new `Editor` class implements: `evalTlisp`, `readFile`, `writeFile`, `logMessage`, `logProgram`, `toAppError`. Pure-ish boundary; the `Editor` is the only implementation.

### State monad (existing — finally adopted)

- `src/utils/state.ts` — `State<S, A>`, `StateTaskEither<S, L, A>`, `stateUtils` (especially `updateProperty`, `modifyProperty`, `getProperty`, `updateMap`, `removeFromArray`), `stateCombiners.sequence`. Used by API primitives and the `tlisp-api.ts` adapter. The Elm `update` reducer remains a direct `UpdateResult` function.

### Editor runtime (REWRITE)

- `src/editor/editor.ts` — full rewrite. Public surface preserved (see "Public API contract" below). Internal structure: holds `private model: EditorModel`; `applyUpdate(msg)` runs `update(model, msg)`, swaps the field, enqueues any returned `Cmd`, fires `stateChangeListeners` exactly once for that committed model change, and returns the new model synchronously. A private async command drain runs queued commands and dispatches follow-up messages. `handleKey` dispatches to handlers, which return `Msg[]` or `State<EditorModel, void>`. `getEditorState()` / `getState()` return `modelToEditorState(this.model)`. `setEditorState(external)` translates the incoming public state into a batch of `Msg`s.
- `src/editor/handlers/normal-handler.ts`, `insert-handler.ts`, `visual-handler.ts`, `command-handler.ts`, `mx-handler.ts`, `replace-handler.ts` — each rewritten to (a) read model fields via typed `editor.getModel()` accessors, (b) dispatch `Msg`s or compose `State<EditorModel, A>` computations from api primitives, (c) keep T-Lisp calls intact through typed runtime methods such as `editor.getInterpreter()` or `editor.executeCommand*` when those calls already exist. Handler purity means no direct model/state mutation, not "no runtime calls." Zero `(editor as any)`.
- `src/editor/tlisp-api.ts` — `createEditorAPI` keeps the current `createEditorAPI(state: TlispEditorState)` compatibility signature until tests are migrated, but its implementation delegates to a new typed adapter that runs `State<EditorModel, A>` / `StateTaskEither<EditorModel, AppError, A>` primitives against the current model and commits the result through `applyUpdate`. Existing tests that import and instantiate `TlispEditorState` directly must either keep passing through this compatibility adapter or be explicitly migrated to a model-backed harness in the same phase. The `_evalTlisp`, `_getCurrentMajorMode`, `_getMinorModeRegistry`, etc. underscored escape hatches are replaced by direct typed accessors on the new `Editor` only after the compatibility path is covered.
- `src/editor/api/*.ts` — each ops module is classified and handled before final validation, because the final zero-`as any` scan includes every `src/editor/api/*.ts` file:
  - Migrate to model/state primitives: `ast-ops`, `bindings-ops`, `browse-url-ops`, `buffer-ops`, `change-ops`, `clipboard-ops`, `count-ops`, `cursor-ops`, `delete-ops`, `dired-ops`, `editor-state`, `evil-integration`, `file-ops`, `fold-ops`, `hook-ops`, `indent-ops`, `jump-ops`, `keymap-ops`, `kill-ring`, `line-ops`, `load-ops`, `lsp-diagnostics`, `macro-persistence`, `macro-recording`, `major-mode-ops`, `minor-mode-ops`, `mode-ops`, `module-ops`, `navigation-ops`, `plugin-ops`, `plugin-repository`, `replace-ops`, `search-ops`, `syntax-ops`, `tab-ops`, `text-objects`, `text-objects-ops`, `undo-redo-ops`, `undo-tree`, `visual-ops`, `window-ops`, `word-ops`, `yank-ops`, `yank-pop-ops`.
  - Keep and migrate as the shared Phase 4 State bridge: `state-context`. This file is not an exception. It must export typed `EditorModel` State helpers only, must not close over `TlispEditorState`, and must pass the same unsafe-cast checks as the ops modules.
  - Leave unchanged except for typing/`as any` cleanup if they are already pure helpers: `documentation`, `text-utils`.
  - No `src/editor/api/*.ts` file is excluded from the final zero-`as any` target. If an unavoidable cast remains, the implementation must add a local `// reason:` comment and adjust the final validation script's expected count explicitly in the implementation notes.

### Editor glue (existing — light edits)

- `src/editor/keymap-sync.ts`, `src/editor/mode-state.ts`, `src/editor/mode-loader.ts`, `src/editor/key-resolution.ts`, `src/editor/auto-mode.ts`, `src/editor/message-log.ts`, `src/editor/log-store.ts`, `src/editor/log-entry.ts`, `src/editor/log-persist.ts`, `src/editor/utils/which-key.ts`, `src/editor/utils/which-key-state.ts` — read-only model access replaces direct `editor.state.X` reads. No structural changes.

### Public API contract (must preserve verbatim)

These methods are called by `src/main.tsx`, `src/server/server.ts`, `src/steep/assam.ts`, `src/frontend/frontends/types.ts`, `test/helpers/editor-fixture.ts`, and ~25 `test/unit|integration/*.test.ts` files. Their signatures and user-visible behavior MUST NOT change:

- Lifecycle: `constructor(terminal, filesystem, initFilePath?)`, `start()`, `stop()`, `isRunning()`.
- Key dispatch: `handleKey(key: string): Promise<void>`.
- File ops: `openFile(filename: string): Promise<void>`, `saveFile(filename?: string): Promise<void>`.
- Buffer ops: `createBuffer(name, content?)`, `clearSelection()`, `clearAllMacros()`.
- State accessors: `getState(): EditorState`, `getEditorState(): EditorState`, `setEditorState(state: EditorState)`, `getInterpreter()`, `getWhichKeyHandle()`, `getFilesystem()`.
- Mode accessors: `getCurrentMajorMode()`, `getCurrentModeState()`, `getMinorModeRegistry()`, `getBufferModeStates()`, `getGlobalizedMinorModes()`, `getAutoModeRules()`, `getLoadPaths()`, `getCurrentModuleName()`, `setCurrentMajorMode(mode)`, `activateMajorModeForFile(filename)`, `registerMinorMode(...)`.
- Logging: `logMessage(...)`, `logDaemonEvent(...)`, `logProgram(...)`, `getMessageLog()`, `getDaemonLog()`, `getUnifiedLog()`, `flushLog()`.
- Workspace: `exportWorkspace()`, `applyWorkspace(workspace)`, `clearModifiedFlags()`, `markBuffersModified(names)`.
- Subscription: `onStateChange(callback)`.
- Count prefix: `getCount()`, `setCount(n)`, `consumeCount()`, `resetCount()`, `isCountActive()`.
- T-Lisp bridge: `evalBuffer()`, `evalInitFile()`, `ensureCoreBindingsLoadedPublic()`, `loadInitFilePublic()`, `loadPluginsFromDirectory(...)`, `saveMacros()`.
- Viewport: `updateViewport()`, `updateTerminalSize(...)`, `recomputeHighlights()`.
- Keymap: `getKeyMappings()`, `getAllGlobalBindings()`, `lookupGlobalBinding(...)`, `getGlobalFunctionNames()`, `getGlobalVariables()`.
- Misc: `getBufferDetails()`, `getCurrentBufferKey()`, `getMode()`, `getSelection()`, `setEchoOnly(text)`.

New methods added by this chore (additive, non-breaking): `getModel(): EditorModel`, `applyUpdate(msg: Msg): EditorModel`. These become the canonical way for handlers and api primitives to read/write editor state.

Intentional contract tightening: `getState()` and `getEditorState()` continue returning `EditorState`, but they no longer expose live mutable internals. They return cloned boundary objects. Tests or consumers that previously mutated a returned state object or returned `Map`/array to mutate the editor must be migrated to an explicit public method, `setEditorState(...)`, `applyUpdate(...)`, or a T-Lisp/editor command. Any affected tests must include a short migration note explaining whether the old assertion depended on public behavior or on private object identity.

### Tests

- `test/helpers/editor-fixture.ts` — uses `new Editor(MockTerminal, MockFileSystem)`, `editor.start()`, `editor.createBuffer(...)`, `editor.getState().currentBuffer.getContent()`, `editor.getInterpreter().execute(expr)`. Must keep working unchanged.
- `test/unit/editor.test.ts` and ~25 other `test/unit|integration/*.test.ts` files referencing `Editor` — must keep passing without modification.
- `test/unit/editor-state-boundary.test.ts` (new or extended equivalent) — targeted regression tests for model/public-state isolation:
  - Mutating the `Map` returned by `editor.getState().buffers` or `editor.getEditorState().buffers` must not add/remove buffers from `editor.getModel().buffers` or a later `getState()` result.
  - Mutating arrays returned from public state (`windows`, `tabs`, `activeMinorModes`, `highlightSpans`, and similar mutable public arrays present in the model) must not mutate `EditorModel`.
  - Passing caller-owned `Map`/array/object values into `setEditorState()` and then mutating those original values must not mutate `EditorModel`.
  - Mutating the public state object returned after `setEditorState()` must not mutate the model either.
- `tmax-use/playbooks/` and `tmax-use/tests/` — e2e playbooks driven through the daemon; these exercise the full editor through JSON-RPC. Must keep passing.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom. Each phase has an exact validation gate listed below; do not start the next phase unless that phase's gate is green. `bun run test:unit` is required in every phase gate, but some phases intentionally use `typecheck:src` while others require the full `typecheck`, integration tests, e2e tests, or build.

### Phase 1 — Functional core scaffolding (additive, zero behavior change)

- Create `src/editor/functional/model.ts`:
  - Define `EditorModel` as an immutable interface separate from `EditorState`. Include the public editor fields plus deterministic private editor state (`buffers` as `ReadonlyMap<string, FunctionalTextBuffer>`, `keyMappings`, `bufferModeStates`, `minorModeRegistry`, `globalizedMinorModes`, `autoModeRules`, `loadPaths`, `bufferMetadata`, `bufferRecency`, `countPrefix`, `spacePressed`, `windowPrefixPressed`, `messages`, `currentWorkspace`, `currentInitFile`, `currentModuleName`). All fields are `readonly`, and collection fields use `ReadonlyMap`, `ReadonlySet`, or readonly arrays.
  - Explicitly exclude impure/non-model runtime fields from `EditorModel`: `terminal`, `filesystem`, `interpreter`, `lspClient`, `keymapSync`, `whichKeyHandle`, `log`, `logPath`, `running`, and `coreBindingsLoaded`. They remain private `Editor` runtime fields because they are services, handles, derived integration objects, persistence sinks, or lifecycle gates rather than immutable editor data. Model fields may contain the serializable state those services influence (for example `lspDiagnostics`, which-key visibility/timeout, or `currentInitFile`), but not the service objects themselves.
  - Export `initialModel(options?: { readonly initFilePath?: string }): EditorModel` mirroring the current constructor's `this.state = { ... }` object literal and nearby deterministic field defaults (`keyMappings`, count/window prefix flags, mode registries, load paths, buffer metadata/recency, workspace/module/init-file values). Use those stable code anchors instead of line numbers, because `editor.ts` will change throughout this chore. The default load path must point at existing `src/tlisp/core`: from `src/editor/functional/model.ts`, `${import.meta.dir}/../../tlisp/core` is the correct relative path. Do not use `${import.meta.dir}/../tlisp/core`, which resolves to non-existent `src/editor/tlisp/core`.
  - Export `modelToEditorState(model): EditorState` — a boundary adapter that returns a fresh public state object and clones mutable collection fields where the public type is mutable (`new Map(model.buffers)`, `new Map(model.foldRanges)`, array spreads for `windows`, `tabs`, `activeMinorModes`, `highlightSpans`, etc.). The render path and `getEditorState()` use this.
  - Export `editorStateToModelPatch(external: EditorState): Partial<EditorModel>` or equivalent helpers for `setEditorState`, so public mutable `EditorState` values are copied into the model instead of retained by reference.
- Create `src/editor/functional/messages.ts`:
  - Define `Msg` as a discriminated union. Enumerate constructors by listing every distinct mutation site in `editor.ts` and the handlers. Start with exact assignments, then expand the inventory for compound and alias-based writes before defining the union:
    - `rg "this\.state\.\w+\s*=" src/editor/editor.ts src/editor/handlers`
    - `rg "this\.state\.[A-Za-z0-9_.$\[\]]+\s*(\+=|-=|\*=|/=|\+\+|--)" src/editor/editor.ts src/editor/handlers`
    - `rg "this\.state\.[A-Za-z0-9_.$\[\]]+\.(push|pop|shift|unshift|splice|sort|reverse|set|delete|clear)\(" src/editor/editor.ts src/editor/handlers`
    - `rg "\(editor as any\)\.state\.[A-Za-z0-9_.$\[\]]+\s*(=|\+=|-=|\*=|/=|\+\+|--)" src/editor/handlers`
    - `rg "\(editor as any\)\.state\.[A-Za-z0-9_.$\[\]]+\.(push|pop|shift|unshift|splice|sort|reverse|set|delete|clear)\(" src/editor/handlers`
    - `rg "(const|let)\s+\w+\s*=\s*(this\.state|\(editor as any\)\.state)|\w+\s*=\s*(this\.state|\(editor as any\)\.state)" src/editor/editor.ts src/editor/handlers` and inspect every alias for later writes.
  - Group related mutations (`SetCommandLine` vs `AppendCommandLine` vs `ClearCommandLine`). The accepted `Msg` union must cover direct assignments, nested object writes, collection mutations (`Map.set/delete/clear`, array `push/splice/...`), increments, compound updates, and writes through aliases.
- Create `src/editor/functional/update.ts`:
  - Define `UpdateResult = { readonly model: EditorModel; readonly cmds: readonly Cmd<Msg>[] }`.
  - Implement `update(model: EditorModel, msg: Msg): UpdateResult` as a pure direct reducer with an exhaustive `switch (msg.type)`. Each case returns a fresh model via object/collection copying or small immutable helper functions, plus any requested commands. Do not make `update` return `State`; each case should directly return `UpdateResult`.
  - No IO, no T-Lisp eval — pure state transitions only. Effects are represented as `Cmd`s in the returned result.
- Create `src/editor/functional/cmd.ts`:
  - Define `Cmd<Msg>` as a discriminated union of effects. Minimum variants:
    - `{ tag: "OpenFile"; commandId; owner: "openFile" | "handler"; filename }`
    - `{ tag: "SaveFile"; commandId; owner: "saveFile" | "handler"; filename; content; bufferName }`
    - `{ tag: "EvalTlisp"; commandId; owner: "handler"; expression }`
    - `{ tag: "EvalTlispAsync"; commandId; owner: "handler"; expression }` if async evaluator paths exist
    - `{ tag: "LogMessage"; commandId; owner: "background"; entry }`
    - `{ tag: "LogProgram"; commandId; owner: "background"; entry }`
    - Do not add `NotifyStateChange`; notification is owned by `applyUpdate`.
  - Implement `runCmd(cmd, runtime): TaskEither<AppError, Msg[]>` — runs the effect, returns follow-up `Msg`s (possibly empty).
  - Define command ownership and failure semantics in code, not comments only. Every queued `Cmd` carries a stable `commandId` and an `owner`: `'openFile'`, `'saveFile'`, `'handler'`, or `'background'`. `runCmd` returns either follow-up messages for that same command id or a typed `AppError`. The drain dispatches `CmdFailed` for every `Left(error)` so the status/message log behavior is visible in the model.
  - Define follow-up `Msg` variants explicitly: `OpenFileSucceeded { commandId, filename, content }`, `OpenFileFailed { commandId, filename, error }` or `CmdFailed`, `SaveFileSucceeded { commandId, filename, bufferName }`, `SaveFileFailed { commandId, filename, error }` or `CmdFailed`, `EvalTlispSucceeded { commandId, value? }`, `EvalTlispFailed { commandId, error }` or `CmdFailed`, and `BackgroundCommandFailed { commandId, commandTag, error }` or a `CmdFailed` variant carrying enough fields to distinguish these cases. Successful open/save follow-ups are the only place where buffer/current-filename/status/modified-flag changes from file IO are committed.
  - Preserve public async method behavior through correlation, not conditionals. `openFile(filename)` enqueues an owner `'openFile'` command and awaits drain completion for that command id; it rejects if that command fails, leaves the previous buffer/model intact on failed reads, and commits buffer/current-filename/status follow-up messages only after a successful read. `saveFile(filename?)` enqueues owner `'saveFile'`, awaits its command id, rejects on write failure, leaves modified flags/model state as current behavior requires on failure, and commits success status/modified-flag follow-up messages only after a successful write. `LogMessage`/`LogProgram` commands are owner `'background'`; their failures dispatch `CmdFailed`/status-log messages but never reject an unrelated public method. Handler-triggered commands are owner `'handler'`; `handleKey` awaits only the command ids required for the key's observable behavior and must not surface unrelated background failures as unhandled rejections.
- Create `src/editor/functional/runtime.ts`:
  - Define `EditorRuntime` interface (the impure capabilities the editor provides to `Cmd` runners).
- Validation gate: `bun run typecheck:src` — new files must compile. Existing tests untouched and still green: `bun run test:unit`.

### Phase 2 — Bridge editor.ts to the new model (dual-field, behavior-preserving)

- Add `private model: EditorModel` field to `Editor`, initialized from `initialModel(...)` in the constructor.
- Add `getModel(): EditorModel` and `applyUpdate(msg: Msg): EditorModel`:
  - `applyUpdate(msg)` runs `update(this.model, msg)`, assigns `result.model` to `this.model`, syncs cloned/projected fields back to `this.state` (temporary bridge), enqueues `result.cmds` for the private async command drain, fires `stateChangeListeners` once synchronously, and returns the new model.
  - State-change notifications have exactly one source: `applyUpdate` after a model commit. The command drain never calls listeners directly and there is no notification command. Follow-up messages produced by commands notify only when they are committed through their own `applyUpdate` call.
  - Add a private async command queue/drain that runs `Cmd`s sequentially through `runCmd`. Follow-up messages produced by commands are dispatched through `applyUpdate`. Existing public async methods await this drain where callers currently observe completed IO/eval behavior.
  - The drain handles `Left<AppError>` from `runCmd` by dispatching `CmdFailed`/status messages, preserving queue progress for independent commands, and resolving or rejecting the awaiting public method according to the required command ownership contract from Phase 1. Implement explicit ownership/correlation for `openFile`, `saveFile`, background log commands, and handler-triggered commands; a failed background log write must not make an unrelated `saveFile` reject.
- Refactor the existing `this.state.X = Y` mutation sites in `editor.ts` to call `this.applyUpdate({ type: '...', ... })` instead. **Do them in batches** (state setters → viewport → mode → file ops → command/mx line → which-key → lsp → windows/tabs), running `bun run test:unit` after each batch.
- At the end of Phase 2: `this.state` is a derived, mutable compatibility view of `this.model`; `setEditorState(external)` translates into a `SetEditorStateExternal` msg that copies the same fields currently assigned in `setEditorState(newState)` (`currentBuffer`, cursor/mode/status/viewport/config/current filename, command and M-x lines, minibuffer/cursor focus, buffers, and mode-state updates) without retaining caller-owned `Map`, array, or object references.
- Compatibility adapter shape for direct `createEditorAPI(state: TlispEditorState)` tests: create a private model-backed bridge that owns an `EditorModel`, exposes `{ getModel(): EditorModel; applyUpdate(msg): EditorModel; runState(computation): A }`, and projects every committed model back onto the supplied legacy `TlispEditorState` after each commit. The supplied `TlispEditorState` is a boundary mirror, not the source of truth after adapter creation. Initial model state is copied from the supplied object using the same ingress-cloning rules as `editorStateToModelPatch`; commits sync back by replacing/cloning public fields on the legacy object (`buffers`, cursor/mode/status/viewport/config/current filename, command/M-x lines, minibuffer/focus, mode state, messages) without retaining caller-owned `Map`, array, or nested object references. Tests that cannot accept this ownership model must be migrated to a real `Editor` harness in Phase 4 and documented in implementation notes.
- Validation gate: `bun run typecheck && bun run test:unit` green. The 5 `as any` in `editor.ts` itself should be eliminable here; the 84 in handlers are Phase 3.

### Phase 3 — Migrate handlers (one file per batch, eliminate `(editor as any)`)

For each handler file, in this order: `command-handler.ts` (23 casts) → `normal-handler.ts` (19) → `insert-handler.ts` (19) → `replace-handler.ts` (16) → `visual-handler.ts` (9) → `mx-handler.ts` (2):

- Replace every `(editor as any).state.X = Y` with `editor.applyUpdate({ type: '...', ... })`.
- Replace every `(editor as any).getInterpreter()` / `(editor as any).escapeKeyForTLisp(...)` / etc. with typed `editor.getInterpreter()` / added typed helpers. Add the typed helpers to `Editor` if missing (e.g., `escapeKeyForTLisp` becomes a public method).
- Replace every `(editor as any).state.X` read with `editor.getModel().X` (or a typed accessor if the field is private).
- Preserve the existing T-Lisp execution flow — handlers may still call `interp.execute(cmdString)` / `executeCommand*` through typed methods. Only the state-access pattern changes; handler purity in this phase means "no direct state/model mutation."
- Validation gate after each file: `bun run typecheck:src && bun run test:unit && bun run test:integration` green. After the last file: `rg "\(editor as any\)" src/editor/handlers/` returns zero matches.

### Phase 4 — Migrate api/*.ts to `State<EditorModel, A>` return values

Batch tracking table. Complete the batches in order and update implementation notes with each file's exported factories/primitives and whether each one returns `State<EditorModel, ...>`, `StateTaskEither<EditorModel, ...>`, or `Cmd`.

| Batch | Files | Acceptance |
| --- | --- | --- |
| 4A | `text-utils`, `documentation` | Confirm pure-helper exemption; no mutable state closure, no unsafe casts. |
| 4B | `state-context`, `editor-state`, `buffer-ops`, `cursor-ops` | Shared State bridge and core state/buffer/cursor primitives migrated. |
| 4C | `navigation-ops`, `line-ops`, `word-ops`, `count-ops`, `mode-ops` | Movement/count/mode primitives migrated. |
| 4D | `minor-mode-ops`, `major-mode-ops`, `bindings-ops`, `keymap-ops` | Mode registry and keymap primitives migrated. |
| 4E | `delete-ops`, `yank-ops`, `yank-pop-ops`, `change-ops`, `replace-ops` | Editing primitives migrated. |
| 4F | `indent-ops`, `search-ops`, `visual-ops`, `text-objects`, `text-objects-ops` | Selection/search/text-object primitives migrated. |
| 4G | `kill-ring`, `clipboard-ops`, `jump-ops`, `undo-redo-ops`, `undo-tree` | Ring/clipboard/jump/history primitives migrated. |
| 4H | `syntax-ops`, `fold-ops`, `lsp-diagnostics`, `window-ops`, `tab-ops` | Syntax/fold/LSP/window/tab primitives migrated. |
| 4I | `file-ops`, `load-ops`, `dired-ops`, `ast-ops`, `module-ops` | File/load/dired/AST/module primitives migrated, async effects use `StateTaskEither` or `Cmd`. |
| 4J | `browse-url-ops`, `evil-integration`, `hook-ops`, `plugin-ops`, `plugin-repository` | Integration/plugin primitives migrated. |
| 4K | `macro-recording`, `macro-persistence`, `tlisp-api.ts` | Macro primitives migrated and T-Lisp adapter runs State computations through the compatibility/runtime adapter. |

For each file:
- Change the factory signature so it no longer closes over mutable state. The required shape is State-monad based: each primitive returns `State<EditorModel, Either<AppError, TLispValue>>` for synchronous primitives or `StateTaskEither<EditorModel, AppError, TLispValue>` / `Cmd` for async effects. The editor runtime or `createEditorAPI` adapter runs the returned computation and commits the resulting model through `applyUpdate`. Do not use a Reader/deps style API that calls `applyUpdate` internally for ordinary state primitives; that would preserve typed mutation but miss the chore's stated State-monad migration goal.
- Inside each primitive: replace `state.X = Y` with `State.modify(model => ({ ...model, X: Y }))` or `stateUtils.updateProperty('X', Y)`. Replace `state.X` reads with `State.gets(model => model.X)`.
- Acceptance is per exported primitive/factory, not per file. Every exported editor primitive or factory in non-exempt `src/editor/api/*.ts` must satisfy all of these:
  - Its public return type is `State<EditorModel, ...>`, `StateTaskEither<EditorModel, ...>`, or `Cmd` for deferred effects, or it is an adapter whose only purpose is to run one of those shapes.
  - It does not accept or close over `TlispEditorState`, `EditorState`, mutable callback deps, or raw `state` objects for ordinary state reads/writes.
  - Its model writes happen through `State.modify`, `State.gets` + immutable returns, `stateUtils.*`, or a named helper in `state-context.ts`.
  - Implementation notes list each exported primitive/factory in that file and the adopted shape. A comment, unused import, or one migrated helper in a file does not satisfy Phase 4.
- Update `createEditorAPI` in `tlisp-api.ts` so each registered function adapts between the `State<EditorModel, A>` returns and the `TLispFunctionImpl` signature.
- Preserve a compatibility overload/signature for tests that currently call `createEditorAPI(state: TlispEditorState)`. Either implement that overload by wrapping the mutable test bridge in a model-backed adapter, or migrate those tests in the same phase to construct the new typed deps. Do not break direct imports in `test/unit/tlisp-api.test.ts`, `test/unit/fikra-primitives.test.ts`, `test/unit/fikra-mode.test.ts`, `test/unit/messages-readonly.test.ts`, and `test/unit/observability-gaps.test.ts` without an explicit replacement.
- Update `editor.ts` factory call sites to pass the new deps.
- Validation gate after each listed batch: `bun run typecheck:src && bun run test:unit` green. After Phase 4, run the per-file State-monad adoption loop from the Validation Commands section and review the implementation-notes table. The loop is a guardrail; the per-export acceptance criteria above are the normative requirement. It must assert every `src/editor/api/*.ts` file contains `State<EditorModel`, `StateTaskEither<EditorModel`, or `stateUtils.` except explicitly pure helper files (`documentation.ts`, `text-utils.ts`) and any other helper named in implementation notes with a reason. `src/editor/tlisp-api.ts` must also contain `State<EditorModel`, `StateTaskEither<EditorModel`, or `stateUtils.`. A single migrated API file is not enough to pass Phase 4.

### Phase 5 — Collapse `this.state` into `this.model`

- Remove the `private state: EditorState` field. All reads go through `this.model`.
- `getEditorState()` and `getState()` both return `modelToEditorState(this.model)`. They must return fresh public `EditorState` objects, with mutable public collections cloned, so callers cannot mutate internal `EditorModel` state by retaining references.
- Treat this as an intentional contract tightening, not invisible behavior preservation. If any tests or consumers mutate `editor.getState()` / `editor.getEditorState()` results to drive editor behavior, migrate them to `setEditorState(...)`, `applyUpdate(...)`, or an existing public command/API and record the compatibility note in implementation notes.
- `setEditorState(external)` becomes a thin adapter that dispatches the appropriate `Msg` batch.
- Keep `modelToEditorState`; it is the intentional boundary between immutable internal model state and the existing public mutable state contract.
- Add or update `test/unit/editor-state-boundary.test.ts` with the clone/isolation cases listed in the Tests section before removing the bridge field. These tests should fail if `modelToEditorState` returns model-owned `Map`/array references or if `editorStateToModelPatch` retains caller-owned values.
- Validation gate: `bun run typecheck && bun run test:unit && bun run test:integration` green, plus `bun test test/unit/editor-state-boundary.test.ts` green.

### Phase 6 — Cleanup and dead-code removal

- `rg "as any" src/editor/` — should return zero matches (or only the truly-unavoidable ones, each with a `// reason:` comment).
- Also remove equivalent unsafe escape hatches in the touched editor surface: double assertions such as `as unknown as`, generic `as unknown`, broad `as never`, bracket-based private bypasses such as `editor["state"]`, and index writes through `this["state"]` or `(editor as unknown as ...)`. If a cast is genuinely required at an external boundary, it must be narrow, local, accompanied by `// reason:`, and reflected in the final validation exception list.
- `rg "this\.state\b" src/editor/editor.ts` — should return zero matches.
- Leave `stateUtils` / `State` / `stateCombiners` exports in `src/utils/state.ts`. If they appear unused after this migration, treat that as a failed Phase 4 migration and return to the API primitive work; do not delete them as cleanup.
- Remove the now-dead `_evalTlisp`, `_getCurrentMajorMode`, `_getMinorModeRegistry`, etc. underscored escape hatches from `TlispEditorState` (replaced by direct typed accessors in Phase 4).
- Validation gate: `bun run typecheck && bun run test:unit && bun run test:integration && bun run test:tmax-use && bun run build` all green.

### Phase 7 — Final validation (the chore's Validation Commands)

- Run every command in the `Validation Commands` section below, in order, with zero failures.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions. Every command must exit 0.

Local phase gates are the commands named at the end of each phase. The full list below is mandatory before declaring Phase 7 complete and for CI/pre-merge validation. During local phase work, do not repeatedly run the overlapping full-suite commands (`test:unit`, targeted unit test, `test:integration`, then `bun run test`) after every small edit unless the current phase gate asks for them.

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:src` — typecheck production source. Catches any `as any` removal that broke a typed call site, any `Msg` case the `update` switch doesn't handle, any `State<EditorModel, A>` misuse.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:test` — typecheck tests against the new (unchanged) public API. Catches contract drift.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck` — full project typecheck (src + test + tmax-use + bench). The authoritative compile gate.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:unit` — runs all `test/unit/*.test.ts`. The fast regression net; must be green after every phase, not just at the end.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/editor-state-boundary.test.ts` — targeted boundary-isolation regression test. Confirms `getState()`/`getEditorState()` and `setEditorState()` clone public mutable `Map`, array, and nested object inputs/outputs instead of sharing references with `EditorModel`.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:integration` — runs all `test/integration/*.test.ts`. Exercises editor + T-Lisp + daemon glue.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test` — runs the full Bun suite (unit + integration combined).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:tmax-use` — e2e playbooks through the daemon (`bin/tmax-use test`). This is the only test that actually drives the editor as a user would; it's the chore's strongest correctness signal.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run build` — compiles `dist/tmax`, `dist/tlisp`, `dist/tmax-use`. Confirms the new editor compiles into a standalone binary with no missing imports.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bash -lc 'failed=0; for f in src/editor/editor.ts src/editor/handlers/*.ts src/editor/api/*.ts src/editor/tlisp-api.ts; do count=$(rg -c "as any" "$f" || true); count=${count:-0}; printf "%s:%s\n" "$f" "$count"; if [ "$count" -ne 0 ]; then failed=1; fi; done; exit "$failed"'` — final lint check. Expected: every file reports `0` and the command exits `0`. This is the direct numerical proof the chore's stated motivation ("84 `(editor as any)` casts") is resolved. If an implementation keeps a justified cast, it must include a local `// reason:` comment and this validation command must be deliberately updated to assert only those known exceptions.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bash -lc "failed=0; patterns=('as unknown as' 'as unknown' 'as never' '\\[\"state\"\\]' \"\\['state'\\]\" '\\[\"model\"\\]' \"\\['model'\\]\" '\\[\"interpreter\"\\]' \"\\['interpreter'\\]\"); for p in \"\${patterns[@]}\"; do if rg -n \"\$p\" src/editor/editor.ts src/editor/handlers src/editor/api src/editor/tlisp-api.ts; then failed=1; fi; done; exit \"\$failed\""` — final unsafe-cast/bypass check. Expected: no output and exit `0`. If a narrow external-boundary cast is truly required, add a `// reason:` comment and update this command to assert that exact exception.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bash -lc 'count=$(rg -c "this\\.state\\." src/editor/editor.ts || true); count=${count:-0}; printf "src/editor/editor.ts:%s\n" "$count"; test "$count" -eq 0'` — expected: prints `src/editor/editor.ts:0` and exits `0`. Direct numerical proof that mutable `this.state` access is gone from the editor.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bash -lc 'failed=0; exceptions="src/editor/api/documentation.ts src/editor/api/text-utils.ts"; for f in src/editor/api/*.ts; do case " $exceptions " in *" $f "*) continue ;; esac; if ! rg -q "State<EditorModel|StateTaskEither<EditorModel|stateUtils\\.|runEditorState|readModelField|setModelField" "$f"; then printf "missing-state:%s\n" "$f"; failed=1; fi; if rg -n "TlispEditorState|EditorState|state\\.[A-Za-z0-9_]+\\s*(=|\\+=|-=|\\+\\+|--)|\\.state\\.[A-Za-z0-9_]+\\s*(=|\\+=|-=|\\+\\+|--)" "$f"; then printf "legacy-state:%s\n" "$f"; failed=1; fi; done; if ! rg -q "State<EditorModel|StateTaskEither<EditorModel|stateUtils\\.|runEditorState" src/editor/tlisp-api.ts; then printf "missing-state:%s\n" "src/editor/tlisp-api.ts"; failed=1; fi; rg "from .*utils/state|from .*api/state-context" src/editor/ -l >/dev/null || { printf "missing-import:src/editor\n"; failed=1; }; exit "$failed"'` — expected: no `missing-state`/`legacy-state`/`missing-import` lines and exit `0`. Confirms every non-exempt API file and the T-Lisp adapter adopted the State migration shape; one migrated file, comment, or unused import cannot satisfy this gate. Pair this with the Phase 4 implementation-notes table proving every exported primitive/factory has the new State-based shape.

## Notes

- **Elm Architecture mapping**: `model` = `EditorModel`; `update` = `src/editor/functional/update.ts`; `view` = `src/frontend/render/*.ts` (already pure); `Cmd` = `src/editor/functional/cmd.ts`. The `Editor` class is the runtime that ties them together — it is the only impure component.
- **Why `EditorModel` is separate from `EditorState`**: the public `EditorState` type currently exposes mutable collections such as `Map<string, FunctionalTextBuffer>`, and callers/tests can receive it through `getState()` / `getEditorState()`. Making `EditorModel extends EditorState` would make the immutable contract unsound. Keep the model internal and immutable, then project/clone to the public `EditorState` shape at the boundary so the existing render path and `Frontend` interface (`src/frontend/frontends/types.ts`) compile unchanged.
- **Immutable collection update patterns**: never mutate model-owned `Map`, `Set`, or array instances in place. For maps, use `new Map(model.buffers).set(name, nextBuffer)` and return the new map; for removals, clone then `delete`; for sets, use `new Set(model.globalizedMinorModes).add(mode)` or clone then `delete`; for arrays/log rings/window/tab lists, use spreads/slices/maps and cap after copying. Nested metadata objects must be copied at every changed level. `FunctionalTextBufferImpl` is already persistent: preserve that property by storing the buffer returned from `insert`/`delete`/`replace` instead of mutating an existing buffer object. Public `EditorState` adapters must clone mutable collections on both ingress and egress.
- **Strangler pattern**: Phase 1 is purely additive (new files, nothing breaks). Phase 2 keeps `this.state` and `this.model` in sync so each `this.state.X = Y` → `applyUpdate(...)` conversion is independently testable. Phases 3 and 4 migrate external consumers one file at a time. Phase 5 finally collapses the dual field. Each phase is a safe stopping point — if you have to pause mid-chore, the tree is still green at the end of any completed phase.
- **Do not pull T-Lisp logic into TypeScript** during this rewrite. `src/editor/Claude.md` is explicit: handlers are thin routers, primitives answer factual questions only. If a `Msg` like `SetMode` feels like it's making an editor decision, that's fine — the *decision* still comes from T-Lisp; the `Msg` just carries the outcome to the model.
- **The `State<S, A>` monad's `tryCatch` and `StateTaskEither` handle the async file/network paths** (saving files, loading plugins, LSP requests). Sync state transitions use plain `State`; async effects use `StateTaskEither` or `Cmd` + `TaskEither`.
- **The 84 `(editor as any)` casts are mostly `(editor as any).state.X` and `(editor as any).getInterpreter()` patterns** in handlers — they exist because handlers receive `editor: Editor` but `state` and several helpers are private. Phase 3 eliminates them by adding typed public accessors (`getModel()`, plus surfacing `escapeKeyForTLisp` and friends as public methods). The 35 `as any` in `tlisp-api.ts` go away in Phase 4 when the API primitives are rewritten to take typed deps.
- **The full pipeline (`bun run test:tmax-use`) is the strongest signal, but it does not override red unit tests**. Unit tests can pass with subtle regressions in mode transitions or key dispatch order; the tmax-use playbooks drive the editor through JSON-RPC exactly like a real client and will catch behavioral drift. If `test:tmax-use` is green but a unit test went red, investigate the unit failure first. Update a test only when it asserts private implementation details such as mutation order or object identity rather than public behavior; otherwise fix the implementation.
- **This chore is large.** Treat each phase as a separate commit (or separate PR). Do not squash Phases 1–6 into one commit — the diff would be unreviewable and a regression bisect would be impossible. Suggested commit boundaries: one per phase, plus one per handler file in Phase 3, plus one per ops-file batch in Phase 4.

## Historical Audit Log

Non-normative historical audit findings were moved to [`CHORE-39-functional-editor-rewrite.audit.md`](./CHORE-39-functional-editor-rewrite.audit.md). Do not treat that audit log as implementation requirements when it conflicts with this spec.
