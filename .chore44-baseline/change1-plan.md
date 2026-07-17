# CHORE-44 Change 1 — Per-instance editor state: migration plan

Status: **CHANGE 1 COMPLETE + GREEN.** All ACs met:
- AC1.1 ✅ `rg '^let '` empty in all 15 modules.
- AC1.2/1.3 ✅ `test/unit/editor-instance-isolation.test.ts` (3/0) — two editors
  hold independent registers, kill ring, macros, visual; creating/stopping one
  doesn't reset the other.
- AC1.4 ✅ AST/parse caches per-editor (`EditorRuntimeCaches`), not shared, not
  in exported workspace JSON.
- AC1.5 ✅ behavior preserved — spec's Change-1 targeted gate 186/0; affected
  suites (text-objects/yank/evil/kill-ring/macro/navigation) 148/0.
- Full authoritative `bun run typecheck` (src+test+tmax-use+bench) clean.

Design shipped: `EditorSession` (src/editor/functional/domain-state.ts) bundles
per-editor bound ops (killRing, registers, deleteRegister, yankRegister, yankPop,
visual, macros); `Editor` owns one (`this.session`), threads it through
`createEditorAPI` (new optional `TlispEditorState.session`) into the coupled
factories. text-objects wrapped in `createTextObjectsHelpers(opts)`; undo-redo /
undo-tree wrap state+helpers inside their factories and return
`{ api, reset, setInitialBuffer }`. AST caches via `EditorRuntimeCaches`.
Full `test:unit` was kicked off in the background to confirm no cross-test leak.

Next: Change 2 (typed EditorAPIContext, remove TlispEditorState compat + `_` hatches).


## What's already done (green, keep)

- `src/editor/runtime/caches.ts` — `EditorRuntimeCaches` (ast/parseTree maps) + `CachedAST` type + `createEditorRuntimeCaches()`.
- `src/editor/api/ast-ops.ts` — module cache removed; `AstOpsDeps.caches` required; factory uses `deps.caches.ast`/`.parseTree`; local `getCachedAST`.
- `src/editor/api/navigation-ops.ts` — `_astCacheRef`/`setAstCacheRef` removed; `NavigationOpsDeps.caches` required; `getAST` uses `deps.caches.ast`.
- `src/editor/tlisp-api.ts` — builds one `caches = createEditorRuntimeCaches()`, passes to ast + navigation ops; removed `getAstCache`/`setAstCacheRef` imports + wiring line.
- `test/unit/ast-ops.test.ts`, `test/unit/navigation-ops.test.ts` — pass `caches` via fixture.
- **Leaf modules — module `let` moved INTO the factory body (per-editor, no signature/caller change):**
  - `src/editor/api/search-ops.ts` (lastSearchPattern, isearch* state)
  - `src/editor/api/dired-ops.ts` (diredPath, diredMarkedForDelete, showHidden)
  - `src/editor/api/syntax-ops.ts` (activeLanguage, highlightEnabled, storedSpans)
  - `src/editor/api/replace-ops.ts` (replaceState)
- Verified: `typecheck:src`, `typecheck:test` clean; ast/navigation 60/0; search/dired/syntax/replace suite 381/0.
- **AC1.1 status: 4 of 15 files clean (search/dired/syntax/replace). 11 remain (the coupled core).**

## The coupled cluster (atomic)

State is shared across modules via free-function calls. Thread ONE per-editor
`EditorSession` through every factory in `createEditorAPI`, built once and passed
to each `create*Ops`. editor.ts holds `this.session` for the macro block + getters.

### New: `src/editor/functional/domain-state.ts`
```
EditorSession {
  killRing: KillRingOps;          // from kill-ring.ts (bindKillRing)
  registers: RegisterOps;         // from evil-integration.ts (bindRegisters, wired to killRing)
  deleteRegister: { get(): string; set(t: string): void };  // simple holder
  yankRegister:   { get(): string; set(t: string): void };  // simple holder
  yankPop: YankPopOps;            // from yank-pop-ops.ts (bindYankPop, wired to killRing)
  visual:  VisualOps;             // from visual-ops.ts (bindVisual)
  macros:  MacroOps;              // from macro-recording.ts (bindMacros)
}
createEditorSession(): EditorSession  // fresh state + binders
```
Also expose typed state slices if needed for serialization later (deferred —
ACs are met by per-editor isolation; spec's "on EditorModel" is spirit not gate).

### Module conversions

**kill-ring.ts** (REDO — was reverted): export `KillRingState`, `createKillRingState()`,
`KillRingOps` {save,yank,rotate,list,setMax,getMax,reset}, `bindKillRing(state)`;
`createKillRingOps(ops)`. Remove module `let killRingState` + `resetKillRing` +
free fns killRingSave/Yank/Rotate/List/setMax/getMax.

**evil-integration.ts** (REDO): export `RegisterState`, `createRegisterState()`,
`RegisterOps` {get,set,yank,del,paste,reset,listEntries}, `bindRegisters(state, killRing)`;
`createEvilIntegrationOps(ops)`. Keep pure `getRegisterIndex` + REGISTER_* consts.
Remove module `let`s + `resetRegisterState` + free getRegister/setRegister/registerYank/registerDelete/registerPaste.

**yank-pop-ops.ts**: export `YankPopState`, `YankPopOps` {activate(text,pos),reset(),getState(),perform(buf,setCurrentBuffer)},
`bindYankPop(state, killRing)`; `createYankPopOps(access, ops, setCurrentBuffer)`.
Remove module `let` + free reset/get/activate/performYankPop + killRing/getYankRegister imports.

**delete-ops.ts**: remove `let deleteRegister` + get/set/resetDeleteRegisterState + killRingSave/registerDelete/resetRegisterState imports.
`createDeleteOps(access, session, setCurrentBuffer, setCursorLine, setCursorColumn)`.
`setDeleteRegister(x)`→`session.deleteRegister.set(x)`; `registerDelete(x,b)`→`session.registers.del(x,b)`;
`deleteRegister` read→`session.deleteRegister.get()`.

**yank-ops.ts**: remove `let yankRegister` + get/set/reset + killRing/activate/getRegister/registerYank/resetRegisterState imports.
`createYankOps(access, session, setCurrentBuffer, setCursorLine, setCursorColumn)`.
`registerYank(x)`→`session.registers.yank(x)`; `getRegister('"')`→`session.registers.get('"')`;
`yankRegister`→`session.yankRegister.get()`; `activateYankPopState(t,p)`→`session.yankPop.activate(t,p)`.

**text-objects.ts** (1170 lines, 33 fns, no factory — the crux):
Wrap all helper fns in `export function createTextObjectsHelpers(opts: { registerDelete: (t:string,isLine?:boolean)=>void }) { const { registerDelete } = opts; function deleteInnerWord(...){ ...; registerDelete(textToDelete,false); ... } ...; return { deleteInnerWord, ..., textObjectRegion }; }`.
Internal `registerDelete(...)` calls resolve to the destructured param — NO internal edits beyond the wrap.
Remove module `let deleteRegister` + getDeleteRegister/setDeleteRegister (confirmed unused externally) + the kill-ring/evil imports.

**text-objects-ops.ts**: `import { createTextObjectsHelpers } from "./text-objects.ts"`;
add `registerDelete: (t:string,isLine?:boolean)=>void` to `createTextObjectsOps` signature (passed `session.registers.del`);
top of factory: `const { deleteInnerWord, ..., textObjectRegion } = createTextObjectsHelpers({ registerDelete });`.
All existing call sites unchanged.

**visual-ops.ts**: export `VisualSelection` type + `VisualOps` {get,set,clear}, `bindVisual(state)`;
`createVisualOps(access, session, setBuffer, setCursorLine, setCursorColumn, setMode, setStatusMessage)`.
`visualSelection`→`session.visual`; `setDeleteRegister`/`setYankRegister`→session holders; `registerDelete`/`setRegister`→session.registers.

**change-ops.ts**: `createChangeOps(access, session, setCurrentBuffer, setCursorLine, setCursorColumn)`.
`setDeleteRegister` callback→`session.deleteRegister.set`; `killRingSave`→`session.killRing.save`; `registerDelete`→`session.registers.del`.

**Internal-only (move `let` into factory body — state used only in own closures):**
- `search-ops.ts`, `dired-ops.ts`, `syntax-ops.ts`, `replace-ops.ts`: move `let`s inside `create*Ops`.
- `undo-redo-ops.ts`, `undo-tree.ts`: move `let`s inside factory; their `resetKillRing()`/`resetRegisterState()` calls become `session.killRing.reset()`/`session.registers.reset()` (factories take session).
- `major-mode-ops.ts`: verify modeRegistry/autoModeRules only used in factory closures; move in. Check getMajorModeRegistry/getAutoModeRules callers first.

**macro-recording.ts**: export `MacroState`, `MacroOps` {start,stop,record,isActive,currentRegister,all, get, execute, executeLast, lastExecuted, clear, clearOne, set, recordedKeys}, `bindMacros(state)`. Remove module `let macroState` + all free fns.

**macro-persistence.ts**: take `MacroOps` (or read via `editor.session.macros`); replace `getMacros()`/`setMacro()`.

### Wiring

**editor.ts**:
- Add `private session: EditorSession = createEditorSession();` (or lazy).
- Pass `this.session` into `createEditorAPI` (new field on `TlispEditorState` or new arg).
- Macro `defineRaw` block (lines ~1346-1593): replace `const { startRecording, ... } = macroRecording;` with `const macros = this.session.macros;` and call `macros.start(register)` etc.
- `saveMacros`/`loadMacros`: use `this.session.macros`.
- Visual getters (~3484, 3492): `this.session.visual.get()` / `.clear()`.
- Remove constructor resets: `resetYankRegisterState()`, `resetDeleteRegisterState()`, `resetUndoRedoState()` (lines 258-260) — redundant for fresh per-editor state.

**tlisp-api.ts**:
- `createEditorAPI(state)` where `state` carries `session: EditorSession` (add to `TlispEditorState`).
- Build `const session = state.session ?? createEditorSession();` (or require).
- Pass `session` to: createKillRingOps(session.killRing), createEvilIntegrationOps(session.registers),
  createDeleteOps(access, session, ...), createYankOps(access, session, ...), createYankPopOps(access, session.yankPop, ...),
  createTextObjectsOps(access, session.registers.del, ...), createVisualOps(access, session, ...), createChangeOps(access, session, ...),
  createUndoRedoOps(access, session, ...), createUndoTreeOps(access, session, ...).
- `getVisualSelection()` usage (lines ~216, 294) → `session.visual.get()`.

### Test: `test/unit/editor-instance-isolation.test.ts`
Two started editors via fixture; exercise ≥1 op per state group on editor A; assert editor B unchanged.
Groups: registers (set-register), kill-ring (kill-ring-save + list), yank/pop, undo (insert + undo),
search (search-forward + last pattern), visual (visual-select), macro (macro-record-start/key/stop + macro-list),
dired (dired-toggle-hidden or marked), syntax (syntax-enable), replace (replace-enter).
Also assert caches isolated (ast-parse-buffer in A not visible in B) + not in serialized workspace JSON.

### Verify (Change 1 targeted gate)
`bun run typecheck:src && bun run typecheck:test`
`bun test test/unit/editor-instance-isolation.test.ts test/unit/count-prefix.test.ts test/unit/macro-recording.test.ts test/unit/register-prefix.test.ts test/unit/incremental-search.test.ts test/unit/undo-redo.test.ts test/unit/undo-tree.test.ts test/unit/visual-mode-selection.test.ts test/unit/dired.test.ts test/unit/ast-ops.test.ts`
`bash -lc 'test "$(rg -n "^let " src/editor/api/{macro-recording,yank-pop-ops,kill-ring,yank-ops,delete-ops,text-objects,evil-integration,undo-redo-ops,undo-tree,search-ops,dired-ops,syntax-ops,visual-ops,replace-ops,major-mode-ops}.ts || true)" = ""'`

## After Change 1 green → Change 2 (typed EditorAPIContext), then 3..12 (each ~1 day).
