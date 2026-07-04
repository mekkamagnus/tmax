---
goal: "bun run typecheck passes, AND bun -e 'const text=await Bun.file(\"src/editor/functional/model.ts\").text(); const m=text.match(/export interface EditorModel([^\\{]*)\\{([\\s\\S]*?)\\n\\}/); if(!m) throw new Error(\"EditorModel interface not found\"); if(/extends\\s+EditorState/.test(m[1])) throw new Error(\"EditorModel still extends EditorState\"); const bad=m[2].split(\"\\n\").map(l=>l.trim()).filter(l=>l && !l.startsWith(\"/**\") && !l.startsWith(\"*\") && !l.startsWith(\"//\") && /^[A-Za-z_$][\\w$?]*:/.test(l)); if(bad.length) throw new Error(\"Non-readonly EditorModel fields: \"+bad.join(\", \"));' passes, AND bun test test/unit/editor-state-boundary.test.ts passes, AND bun test test/unit/editor.test.ts passes"
---

# Chore: Make EditorModel truly immutable — separate from EditorState

## Chore Description

CHORE-39 established the Elm-Architecture scaffolding, but patch-review (agents/01KWK7RC5H) found that `EditorModel` does not meet the spec's immutability contract. The current `model.ts` declares:

```typescript
export interface EditorModel extends EditorState {  // ← spec calls this "unsound"
  countPrefix: number;
  loadPaths: string[];
  currentModuleName: string;
}
```

The spec explicitly states: *"Making `EditorModel extends EditorState` would make the immutable contract unsound"* because the public `EditorState` type exposes mutable collections (`Map<string, FunctionalTextBuffer>`, etc.) and non-readonly fields. By extending it, `EditorModel` inherits all those mutable fields. This is why `this.model.currentFilename = filename` compiles in editor.ts:2677 — the fields aren't readonly.

This chore makes `EditorModel` a standalone immutable interface with all fields `readonly` and all in-scope collections typed as `ReadonlyMap` / `readonly T[]`.

### The problem, concretely

1. **`EditorModel extends EditorState`** — inherits ~30 mutable fields from the public `EditorState` type. The immutability contract is unsound.
2. **Non-readonly fields** — `countPrefix`, `loadPaths`, `currentModuleName` (the only fields declared directly on EditorModel) are not `readonly`.
3. **Mutable collection types** — `buffers` stays `Map<string, FunctionalTextBuffer>` (mutable), not `ReadonlyMap`. Same for actual `EditorState` collection fields such as `foldRanges`, `windows`, `tabs`, `highlightSpans`, `searchMatches`, `whichKeyBindings`, and mode/diagnostic arrays.
4. **Direct mutation compiles** — because fields are mutable, `this.model.X = Y` compiles at 91 sites in editor.ts, defeating the reducer-driven contract.

### The target

- `EditorModel` is a standalone interface (no `extends EditorState`). It re-declares every field it needs with `readonly` and immutable collection types.
- All fields are `readonly`.
- Collection fields use `ReadonlyMap` / `readonly T[]`.
- `modelToEditorState(model)` projects from the immutable model to the mutable public `EditorState` (already exists — keep it working).
- `editorStateToModelPatch(external)` copies mutable public collections into immutable model collections on ingress (already exists — keep it working).
- `initialModel()` returns a properly-typed immutable record.
- The boundary tests (`test/unit/editor-state-boundary.test.ts`) continue to pass unchanged.

## Relevant Files

- `src/editor/functional/model.ts` — the only file that needs structural changes. Currently `extends EditorState`; redeclare all fields standalone + readonly + immutable collections.
- `src/editor/editor.ts` — may need minor adjustments if it relies on `EditorModel` being assignable to `EditorState` directly (it shouldn't, since `getEditorState()` projects via `modelToEditorState`).
- `src/editor/functional/update.ts` — the reducer returns fresh models via object spreads; confirm it still typechecks after the readonly change.
- `test/unit/editor-state-boundary.test.ts` — must pass unchanged.
- `test/unit/editor.test.ts` — existing editor integration/unit coverage must still pass.

## Step by Step Tasks

### Step 1: Redesign EditorModel as a standalone immutable interface

- Remove `extends EditorState` from `EditorModel`.
- Re-declare every field currently inherited from `src/core/types.ts` `EditorState` as a direct field on `EditorModel`, with `readonly` modifiers. Use the current `EditorState` interface as the source of truth:
  - Scalar/object fields: `currentBuffer`, `cursorPosition`, `mode`, `statusMessage`, `viewportTop`, `viewportLeft`, `config`, `commandLine`, `mxCommand`, `lastCommand`, `currentFilename`, `cursorFocus`, `whichKeyActive`, `whichKeyPrefix`, `whichKeyTimeout`, `whichKeyPopup`, `describeKeyPending`, `describeKeyTimeout`, `describeFunctionPending`, `aproposCommandPending`, `currentWindowIndex`, `currentTabIndex`, `currentMajorMode`, `bufferModified`, `minibufferState`, `minibufferView`.
  - Collection fields → immutable variants:
    - `readonly buffers?: ReadonlyMap<string, FunctionalTextBuffer>`
    - `readonly whichKeyBindings?: readonly WhichKeyBinding[]`
    - `readonly lspDiagnostics?: readonly LSPDiagnostic[]`
    - `readonly windows?: readonly Window[]`
    - `readonly tabs?: readonly Tab[]`
    - `readonly highlightSpans?: readonly (readonly HighlightSpan[])[]`
    - `readonly searchMatches?: readonly Range[]`
    - `readonly activeMinorModes?: readonly string[]`
    - `readonly activeMinorModeLighters?: readonly string[]`
    - `readonly foldRanges?: ReadonlyMap<number, number>`
- Keep the current model-only fields, also readonly/immutable: `readonly countPrefix: number`, `readonly loadPaths: readonly string[]`, and `readonly currentModuleName: string | undefined`.
- Do not migrate private `Editor` runtime fields in this chore. Fields such as `keyMappings`, `bufferModeStates`, `minorModeRegistry`, `globalizedMinorModes`, `autoModeRules`, `bufferMetadata`, and `currentWorkspace` stay as separate private `Editor` fields unless/until a later chore explicitly moves them into the model.
- Explicitly EXCLUDE impure runtime fields (already documented): `terminal`, `filesystem`, `interpreter`, `lspClient`, `keymapSync`, `whichKeyHandle`, `log`, `logPath`, `running`, `coreBindingsLoaded`. These stay off the model.
- Do NOT add or remove model state beyond the current `EditorState` fields plus the three current model-only fields above; only change their types to readonly/immutable and remove the `extends`.

### Step 2: Fix any compile errors from the readonly change

- `editor.ts` and `update.ts` will surface compile errors at sites that currently mutate model fields directly. For THIS chore, **do not** route those mutations through `applyUpdate` (that's CHORE-43). Instead, build a fresh model object at each mutation site using object spread: `this.model = { ...this.model, field: newValue }`. This preserves the current behavior while satisfying the readonly type.
- If a collection needs updating, clone-then-assign: `this.model = { ...this.model, buffers: new Map(this.model.buffers).set(name, buffer) }`.
- The goal of this chore is type-level immutability only. Behavioral routing through the reducer is a separate chore.

### Step 3: Verify boundary adapters still work

- `modelToEditorState(model)` must still produce a mutable `EditorState` from the immutable model (clone collections on egress — already does this).
- `editorStateToModelPatch(external)` must still produce a `Partial<EditorModel>` from a mutable `EditorState` (clone on ingress — already does this).
- Run `bun test test/unit/editor-state-boundary.test.ts` — all 6 tests must pass unchanged.

## Validation Commands

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:src` — the readonly/immutable type changes compile.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:test` — tests compile against the new types.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck` — full project typecheck.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/editor-state-boundary.test.ts` — boundary isolation tests pass (6/6).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/editor.test.ts` — existing editor integration/unit coverage still passes.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bash -lc 'rg -n "extends EditorState" src/editor/functional/model.ts; test $? -eq 1'` — exit 0 (grep finds nothing, `rg` exits 1, test succeeds). Proves the `extends` is gone.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun -e 'const text=await Bun.file("src/editor/functional/model.ts").text(); const m=text.match(/export interface EditorModel([^\\{]*)\\{([\\s\\S]*?)\\n\\}/); if(!m) throw new Error("EditorModel interface not found"); if(/extends\\s+EditorState/.test(m[1])) throw new Error("EditorModel still extends EditorState"); const bad=m[2].split("\\n").map(l=>l.trim()).filter(l=>l && !l.startsWith("/**") && !l.startsWith("*") && !l.startsWith("//") && /^[A-Za-z_$][\\w$?]*:/.test(l)); if(bad.length) throw new Error("Non-readonly EditorModel fields: "+bad.join(", "));'` — deterministic assertion that `EditorModel` does not extend `EditorState` and every direct field is declared `readonly`.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run build` — compiles into standalone binaries.

## Notes

- **This chore is type-level only.** It does not route mutations through the reducer (that's CHORE-43) or make the Cmd layer live (that's CHORE-42). It only makes the `EditorModel` type genuinely immutable so that future chores can rely on the contract.
- **Why not route through applyUpdate here?** The 91 mutation sites are interrelated; changing them in the same chore as the type change would create a massive, hard-to-review diff. Type-first keeps this chore small and verifiable.
- **The `as unknown as` casts** that currently force a mutable buffers map into the readonly field must be removed as part of Step 2 — they exist only because the type was unsound.
- Related: CHORE-39 (parent), CHORE-42 (Cmd layer), CHORE-43 (reducer routing), ADR-0111.
