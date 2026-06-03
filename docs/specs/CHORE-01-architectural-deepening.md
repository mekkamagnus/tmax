# Chore: Architectural Deepening — 5 Refactoring Candidates

## Chore Description

The architecture review identified 5 modules that are too shallow — their interfaces are nearly as complex as their implementations, adding indirection without leverage. This chore addresses them in dependency order, so each phase builds on the one before.

The 5 candidates, ordered by influence (each enables or simplifies the next):

1. **Collapse `TlispEditorState` into `EditorState`** — Two state shapes with a 70-line getter/setter bridge in `Editor.initializeAPI()`. The bridge buries window-sync logic inside property descriptors. Fixing this is prerequisite for #2.

2. **Replace callback-explosion seam with a state interface** — `tlisp-api.ts` passes 53 individual getter/setter closures into 26 `createXxxOps()` factories. Each factory's interface mirrors the Editor's internals. A unified state interface (from #1) lets each ops module take one parameter instead of 6–8.

3. **Unify key binding lookup into T-Lisp keymaps** — Every key press checks `KeymapSync` then falls back to `Editor.keyMappings`. Two stores, two code paths. The PRD flags this as the core architecture violation. Unifying removes the fallback path entirely.

4. **Extract `KeyDispatcher` from handler functions** — `handleNormalMode` mixes count-prefix parsing, which-key UI, operator detection, and command execution in 236 lines. Once bindings (#3) and state (#1) settle, the handler can become a thin adapter feeding keys into a `KeyDispatcher` module.

5. **Clean up test registry backdoor** — `interpreter.ts` reaches into the evaluator's private test registry via `(this.evaluator as any)` in 3 places. Extract a `TestRegistry` interface with two adapters (real and no-op).

**Scope:** Each phase is independently mergeable. Phases 1–2 should land together (they're tightly coupled). Phases 3–5 can land individually after that.

## Relevant Files

### Phase 1 — State Shape Unification
- `src/editor/tlisp-api.ts` — Defines `TlispEditorState` interface (the duplicate state shape); `createEditorAPI()` receives it
- `src/editor/editor.ts` — `initializeAPI()` builds the 70-line getter/setter bridge (lines 152–223); `EditorState` interface defined here and in `src/core/types.ts`
- `src/core/types.ts` — Canonical `EditorState` type with `cursorPosition: Position` (line 180)

### Phase 2 — Callback-Explosion Seam
- `src/editor/tlisp-api.ts` — `createEditorAPI()` wires 53 closures across 26 factory calls (lines 76–352)
- `src/editor/api/cursor-ops.ts` — Example: `createCursorOps()` takes 7 callbacks (lines 38–46)
- `src/editor/api/buffer-ops.ts` — Example: `createBufferOps()` takes 7 callbacks (lines 39–47)
- `src/editor/api/mode-ops.ts` — Example: `createModeOps()` takes 9 callbacks (lines 40–49)
- `src/editor/api/delete-ops.ts` — 6 callbacks (line 191)
- `src/editor/api/yank-ops.ts` — 6 callbacks (line 129)
- All other `src/editor/api/*-ops.ts` files (26 total)

### Phase 3 — Key Binding Unification
- `src/editor/keymap-sync.ts` — `KeymapSync` class, `lookupKeyBinding()` (lines 28–170)
- `src/editor/editor.ts` — `keyMappings` Map and fallback lookup in `handleKey()`
- `src/tlisp/core/bindings/normal.tlisp` — T-Lisp keymap definitions
- `src/editor/api/keymap-ops.ts` — T-Lisp API for keymap manipulation

### Phase 4 — Handler Decomposition
- `src/editor/handlers/normal-handler.ts` — `handleNormalMode()` 236 lines, mixes 4 concerns
- `src/editor/handlers/insert-handler.ts` — Simpler but follows same pattern
- `src/editor/handlers/visual-handler.ts` — Visual mode handler
- `src/editor/handlers/command-handler.ts` — Command mode handler
- `src/editor/handlers/mx-handler.ts` — M-x mode handler

### Phase 5 — Test Registry Cleanup
- `src/tlisp/interpreter.ts` — 3 `(this.evaluator as any)` casts (lines 127, 136, 144)
- `src/tlisp/evaluator.ts` — Private test registry that interpreter reaches into
- `src/tlisp/test-framework.ts` — Test framework types and definitions

### New Files
- `src/editor/api/editor-state.ts` — Unified `EditorStateAccess` interface (Phase 1–2)
- `src/editor/key-dispatcher.ts` — `KeyDispatcher` module extracted from handlers (Phase 4)
- `src/tlisp/test-registry.ts` — `TestRegistry` interface + real/no-op adapters (Phase 5)

## Step by Step Tasks

### Phase 1: Collapse `TlispEditorState` into `EditorState`

- Define a unified `EditorStateAccess` interface in `src/editor/api/editor-state.ts` that all ops modules receive. It exposes:
  - `cursor: { getLine(), setLine(), getColumn(), setColumn() }` (wraps window sync)
  - `buffer: { getCurrent(), setCurrent(), getAll() }`
  - `mode: { get(), set() }`
  - `status: { getMessage(), setMessage() }`
  - `terminal`, `filesystem` (pass-through)
  - `commandLine`, `mxCommand`, `cursorFocus`, `spacePressed` (get/set)
  - `lspDiagnostics` (read-only)
  - `operations` (saveFile, openFile)
- Remove `TlispEditorState` interface from `tlisp-api.ts`
- Refactor `Editor.initializeAPI()` to create one `EditorStateAccess` object instead of 70 lines of property descriptors
- Move the window-sync logic (currently buried in cursor setter property descriptors) into the `cursor` methods of `EditorStateAccess`

### Phase 2: Replace callback-explosion with state interface

- Refactor each `createXxxOps()` factory to accept `EditorStateAccess` instead of individual callbacks
  - Start with `cursor-ops.ts` (7 callbacks → 1 parameter)
  - Then `buffer-ops.ts`, `mode-ops.ts`, `delete-ops.ts`, `yank-ops.ts`
  - Then remaining 21 ops files
- Simplify `createEditorAPI()` from 53 closures to passing one state object to each factory
- Each ops module destructures only the state slice it needs from `EditorStateAccess`
- Run tests after each ops file migration

### Phase 3: Unify key binding lookup

- Audit all bindings in `Editor.keyMappings` and ensure they have equivalents in T-Lisp keymaps
- Migrate any remaining TypeScript-only bindings into `normal.tlisp` (or mode-specific files)
- Remove the fallback path in `Editor.handleKey()` that checks `keyMappings` after `KeymapSync`
- Remove `keyMappings` Map from `Editor` class
- Remove `KeymapSync.registeredKeymaps` dual-store logic — simplify to single lookup
- Update `key-bind` T-Lisp function to register only in T-Lisp keymaps

### Phase 4: Extract `KeyDispatcher`

- Create `src/editor/key-dispatcher.ts` with a `KeyDispatcher` class
  - Owns the pipeline: parse key → resolve count prefix → detect operator → look up binding → execute
  - Interface: `dispatch(mode: string, key: string): Promise<Command | null>`
  - No dependency on `Editor` — depends on `EditorStateAccess` + binding lookup
- Extract count-prefix state from `Editor` into the dispatcher
- Extract operator-pending state (currently module-level `let` in `normal-handler.ts`) into the dispatcher
- Convert handlers to thin adapters: `handleNormalMode` becomes ~10 lines calling `dispatcher.dispatch("normal", key)`
- Move which-key scheduling into the dispatcher as a cross-cutting concern

### Phase 5: Clean up test registry backdoor

- Define `TestRegistry` interface in `src/tlisp/test-registry.ts`:
  - `getTestDefinition(name: string): TestDef | undefined`
  - `getAllTestNames(): string[]`
  - `clearRegistry(): void`
- Create `RealTestRegistry` (wraps evaluator's existing test storage)
- Create `NoOpTestRegistry` (for production, returns empty)
- Evaluator receives `TestRegistry` via constructor or setter
- Interpreter holds typed reference to registry instead of casting evaluator
- Remove all `(this.evaluator as any)` casts from `interpreter.ts`

### Final: Validate

- Run full test suite
- Run type checker
- Verify editor launches and responds to keys correctly

## Validation Commands

- `bunx tsc --noEmit` — Zero type errors across all phases
- `bun test` — Full test suite passes (88 test files)
- `bun run start` — Editor launches, responds to hjkl navigation, :q quits, i enters insert mode, Escape returns to normal (manual smoke test)

## Notes

**Dependency order matters.** Phases 1–2 should be a single PR. Phase 3 is independent after that. Phase 4 depends on 3. Phase 5 is fully independent and can be done at any point.

**Test coverage is the safety net.** There are 88 test files. Run `bun test` after migrating each ops file in Phase 2 to catch regressions immediately.

**Phase 3 is the PRD priority.** The roadmap explicitly flags "architecture violation: core philosophy is T-Lisp-first, but default bindings still in TypeScript." This phase resolves that violation.
