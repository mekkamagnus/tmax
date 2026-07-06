# Editor Functional Core Deepening — CHORE-41/42/43 (Immutable Model, Live Cmd Layer, Reducer Routing)

## Status

Accepted — implemented (CHORE-41 complete, CHORE-42/43 structurally complete with known gaps).

## Context

ADR-0111 established the Elm Architecture decision for the editor (`EditorModel` / `update` / `Cmd`). CHORE-39 delivered the scaffolding (Phases 1-3) and a partial Phase 4, but three patch-review audits (agents/01KWK7RC5H) found the implementation "only nominally present":

1. **`EditorModel extends EditorState`** — the spec explicitly forbids this ("would make the immutable contract unsound"), but Claude did it anyway. Fields weren't `readonly`; collections stayed mutable `Map`.
2. **The Cmd/effect layer was dead code** — `update()` returned `noCmds` for every Msg. `enqueueCmd` had zero call sites. `openFile`/`saveFile` called the filesystem directly and mutated `this.model` in place.
3. **91 direct `this.model.X = Y` mutations** in editor.ts — the field was renamed `state`→`model` to pass the validation sweep, but mutations were not routed through the reducer.

These were split into three independent specs (CHORE-41/42/43) and implemented via the adw pipeline with `/goal` mode.

## Decision

### CHORE-41: EditorModel truly immutable

Remove `extends EditorState` from `EditorModel`. Redclare every field as `readonly` with immutable collection types (`ReadonlyMap`, `ReadonlySet`, `readonly T[]`). Add a `WritableModelPatch` mapped type for the ingress adapter. Fix the cascade of compile errors across `editor.ts`, handlers, and api files using object spreads (`this.model = { ...this.model, field: newValue }`) instead of direct mutation.

### CHORE-42: Cmd/effect layer live

- Add follow-up Msg variants (`OpenFileSucceeded`, `SaveFileSucceeded`, `EvalTlispSucceeded`, etc.) and reducer cases.
- `update()` emits real Cmds for effect-bearing Msgs instead of `noCmds`.
- `runCmd` returns follow-up Msgs on success/failure.
- `enqueueCmd` is actually used (3 call sites). The command drain has ownership correlation for `openFile`/`saveFile`.

### CHORE-43: Route mutations through the reducer

Convert ~91 direct `this.model.X = Y` sites in `editor.ts` into `this.applyUpdate({ type: '...', ... })` dispatches. Handlers dispatch Msgs through `editor.applyUpdate(...)` for state changes. The reducer (`update.ts`) becomes the single source of model mutation.

## Consequences

**Easier:**
- `EditorModel` is now genuinely immutable — the readonly fields are compiler-enforced, making future reducer routing mandatory (the only way to change a readonly field is through the reducer).
- The Cmd layer is no longer dead code — `enqueueCmd` is used, the drain runs, and `openFile`/`saveFile` have the machinery for owner-correlated async effects.
- 91 `applyUpdate` call sites (up from ~3) means the reducer owns most state transitions. Direct mutations are down to 1 (the `applyUpdate` method itself).
- Handler state changes go through typed Msgs, not `executeCommand*` side effects.

**More difficult / open:**
- The Cmd layer's ownership/correlation tracking for awaiting public methods is not fully verified — `openFile`/`saveFile` still perform their own IO directly in some paths. The drain exists but the full async ownership contract needs behavioral tests.
- The `_evalTlisp`/`_getCurrentMajorMode`/`_getMinorModeRegistry` underscored escape hatches remain in `tlisp-api.ts` (21 occurrences) — Phase 6 cleanup.
- Some api factories still write through mutable callback deps (Phase 4 is partially complete; the validation sweep passes via read helpers but writes haven't fully migrated).

**Related:** CHORE-39 (parent), CHORE-41, CHORE-42, CHORE-43, ADR-0111 (Elm Architecture decision), ADR-0113 (test infrastructure that enabled the pipeline runs).
