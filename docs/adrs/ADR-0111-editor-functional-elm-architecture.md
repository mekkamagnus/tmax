# Editor Functional Rewrite — Elm Architecture + State Monad

## Status

Accepted — partially implemented (Phases 1–3 + `mode-ops`/`count-ops` delivered; Phase 4 api-factory migration open).

## Context

The `Editor` class in `src/editor/editor.ts` had grown into a mutable god object:

- **169 references to `this.state`** with ~205 `.state.` field accesses mutated in place across `handleKey`, `openFile`, `saveFile`, mode transitions, viewport updates, and keymap changes.
- **131 `as any` escape hatches** — 5 in `editor.ts`, 88 in the six handlers (`(editor as any).state.X = Y`, `(editor as any).getInterpreter()`), 8 in `api/*.ts`, and 35 in `tlisp-api.ts`. These let handlers and the T-Lisp adapter mutate editor internals through untyped holes in the public surface.
- **Unused functional scaffolding** — `State<S, A>` and `StateTaskEither<S, L, A>` existed in `src/utils/state.ts` with full monadic operations and **zero call sites** in `src/`.

This violated `rules/functional-programming.md` ("Immutable State", "Composition Over Inheritance") and the spirit of `src/editor/Claude.md` ("TypeScript here provides primitives ONLY"), because handlers reached into editor internals and mutated them directly rather than going through a typed surface.

## Decision

Rewrite the editor into a functional **Elm Architecture** (model / update / view) that threads state through the existing `State<S, A>` monad. Four pure layers plus a thin impure runtime:

- **`EditorModel`** (`src/editor/functional/model.ts`) — an immutable record of deterministic editor state, deliberately **separate from** the public `EditorState` type (which exposes mutable `Map`s). All fields `readonly`; collections typed `ReadonlyMap` / `ReadonlySet` / `readonly T[]`. Impure runtime resources (terminal, filesystem, interpreter, LSP client, timers) stay off the model.
- **`update(model, msg): UpdateResult`** (`update.ts`) — a pure direct reducer over a `Msg` discriminated union (one constructor per former mutation site). Returns `{ model, cmds }`. No IO; effects are represented as `Cmd`s.
- **`Cmd<Msg>`** (`cmd.ts`) — effect type (`SaveFile`, `OpenFile`, `EvalTlisp`, `LogMessage`, `LogProgram`) run by `runCmd(cmd, runtime): TaskEither<AppError, Msg[]>` which yields follow-up `Msg`s. `NotifyStateChange` is intentionally **not** a `Cmd`; notification happens synchronously in `applyUpdate` only, so there is exactly one listener fire per committed model change.
- **`Editor` runtime** — holds `private model: EditorModel`, exposes additive `getModel()` and `applyUpdate(msg): EditorModel`. `applyUpdate` runs `update`, swaps the field, enqueues returned `Cmd`s for the async drain, fires listeners once, returns the new model synchronously.

Strangler-pattern migration in 7 phases (each a safe green stopping point):

1. **Phase 1** — additive functional core (`model.ts`, `messages.ts`, `update.ts`, `cmd.ts`, `runtime.ts`). Zero importers; nothing breaks.
2. **Phase 2** — bridge: `private model` field, `getModel()`/`applyUpdate()`, command drain. `getEditorState()` projects from `modelToEditorState(this.model)` (clones mutable collections for boundary isolation). Eliminate the 5 `editor.ts` `as any` casts and the 164 `this.state.X` mutations.
3. **Phase 3** — migrate all six handlers off `(editor as any)` onto typed `getModel()` / `executeCommand*` / `escapeKeyForTLisp` accessors. Eliminate all 88 handler casts.
4. **Phase 4** — migrate `api/*.ts` factories to return `State<EditorModel, A>` / `StateTaskEither<EditorModel, AppError, A>`; the `createEditorAPI` adapter runs the computation and commits through `applyUpdate`. **Open.**
5. **Phase 5** — collapse `this.state` into `this.model`; `setEditorState` becomes a `Msg` batch.
6. **Phase 6** — remove dead escape hatches (`_evalTlisp`, `_getCurrentMajorMode`, `_getMinorModeRegistry`); final `as any` sweep.
7. **Phase 7** — full validation.

Boundary isolation is enforced at the public surface: `modelToEditorState()` clones mutable `Map`/array fields on egress, and `editorStateToModelPatch()` copies (not retains) caller-owned containers on ingress. Covered by `test/unit/editor-state-boundary.test.ts`.

## Consequences

**Easier:**
- The functional core (`update`, `runCmd`, `modelToEditorState`) is pure and unit-testable without a terminal, filesystem, or interpreter.
- Handler and api code goes through typed accessors — no `as any`, no private-field reach-through. The 131-cast motivation is resolved for editor.ts + handlers + api `as any` (the `_evalTlisp`-class underscored hatches remain until Phase 6).
- `EditorModel`'s immutability contract is sound because it does not extend the mutable `EditorState` type.
- State-change notifications have a single source (`applyUpdate`), making change detection predictable.

**More difficult / open:**
- Phase 4 is the largest remaining piece: ~45 `api/*.ts` factories still use the legacy close-over-mutable-state pattern. Only `mode-ops.ts` and `count-ops.ts` are genuinely migrated; `tlisp-api.ts` has no `State<EditorModel>` usage yet and still wires the underscored escape hatches.
- The Phase 4 validation sweep (`State<EditorModel` adoption in every api file) does **not** pass until that migration is real — it must not be satisfied by stub exports.
- A compatibility shim (`createEditorAPI(state: TlispEditorState)`) is kept until tests migrate, so two code paths coexist during the transition.
