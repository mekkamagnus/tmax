---
goal: "bun run typecheck passes, AND bash -lc 'count=$(rg -c \"this\\\\.model\\\\.[a-zA-Z]\\\\+ \\\\?= \" src/editor/editor.ts || true); count=${count:-0}; printf \"direct-mutations:%s\\\\n\" \"$count\"; test \"$count\" -le 10' exits 0 (≤10 direct mutations remain, down from 91), AND bash -lc 'count=$(rg -c \"applyUpdate\" src/editor/editor.ts || true); count=${count:-0}; printf \"applyUpdate-calls:%s\\\\n\" \"$count\"; test \"$count\" -ge 30' exits 0 (≥30 applyUpdate call sites), AND bash -lc 'count=$(rg -c \"applyUpdate\" src/editor/handlers/ || true); count=${count:-0}; test \"$count\" -ge 6' exits 0 (handlers dispatch Msgs), AND bun run test:unit passes, AND bun run build passes"
---

# Chore: Route editor mutations through the reducer — applyUpdate everywhere

## Chore Description

CHORE-39 established `applyUpdate(msg): EditorModel` on the `Editor` class and the `update(model, msg)` reducer. **But almost nothing routes through it.** Patch-review (agents/01KWK7RC5H) found:

- `editor.ts` has **91 direct `this.model.X = Y` mutation sites** and only **3 `applyUpdate` call sites** (and those 3 are inside the command drain that never runs — see CHORE-42).
- All 6 handlers have **0 `applyUpdate` calls**. They mutate state indirectly via `executeCommand*` T-Lisp calls, never dispatching Msgs.
- The field was renamed `state`→`model` to pass the `this.state.` validation sweep, but mutations were not routed through the reducer.

This chore converts the ~91 direct mutation sites in `editor.ts` plus the handler state changes into `applyUpdate({ type: '...', ... })` dispatches, so that the reducer becomes the single source of model mutation.

### The target

- Every `this.model.X = Y` in `editor.ts` is replaced by `this.applyUpdate({ type: 'SetX', value: Y })` (or the appropriate existing Msg variant).
- Handlers dispatch Msgs through `editor.applyUpdate(...)` for state changes (mode transitions, command line accumulation, count prefix, viewport, etc.).
- `applyUpdate` is the single source of model mutation. The reducer (`update.ts`) owns all state transitions.
- The remaining direct mutations (≤10) are confined to: the `applyUpdate` method itself (assigning `this.model = result.model`), the sync-back bridge to legacy state, and `initialModel()`.

## Relevant Files

- `src/editor/editor.ts` — the bulk of the work. ~91 mutation sites across `handleKey`, `setEditorState`, mode transitions, viewport updates, command line accumulation, count prefix, which-key state, lsp diagnostics, windows/tabs, buffer operations. Convert each to `applyUpdate`.
- `src/editor/handlers/*.ts` (6 files) — handlers currently mutate state via `executeCommand*`. Add `editor.applyUpdate(...)` calls for the state changes they cause (or ensure the T-Lisp commands they invoke call api primitives that go through applyUpdate per CHORE-44).
- `src/editor/functional/messages.ts` — may need additional Msg variants if the current 70 don't cover every mutation site. Enumerate missing variants and add them.
- `src/editor/functional/update.ts` — add reducer cases for any new Msg variants. Each returns a fresh immutable model.
- `src/editor/functional/model.ts` — no changes (CHORE-41 handles immutability; this chore assumes mutable fields for now if CHORE-41 hasn't landed, or readonly fields if it has — the routing pattern works either way).

## Step by Step Tasks

### Step 1: Enumerate all mutation sites

- Run `rg -n "this\.model\.[a-zA-Z]+ *=|this\.model\.[a-zA-Z]+\.[a-zA-Z]+ *=|this\.model\.[a-zA-Z]+ *\+=" src/editor/editor.ts` to list every direct mutation.
- Group them by the field being mutated: `currentBuffer`, `cursorPosition`, `mode`, `statusMessage`, `commandLine`, `viewport`, `buffers`, `windows`, `tabs`, `countPrefix`, `spacePressed`, `whichKeyActive`, `lspDiagnostics`, etc.
- For each group, identify the corresponding Msg variant in `messages.ts` (most already exist: `SetMode`, `SetStatusMessage`, `SetCommandLine`, `AppendCommandLine`, `SetCursorPosition`, `SetViewport`, `UpsertBuffer`, `SetCountPrefix`, `SetSpacePressed`, `SetWhichKeyActive`, `SetLspDiagnostics`, etc.).
- For any mutation site without a matching Msg variant, add one to `messages.ts` and a reducer case to `update.ts`.

### Step 2: Convert mutations in batches

Do the conversions in batches, running `bun run typecheck:src && bun run test:unit` after each batch. Suggested batch order (matching the spec's Phase 2 batching):

1. **State setters** — `setEditorState`, `setEchoOnly`, `setLastCommand`, status messages. (~10 sites)
2. **Viewport** — `updateViewport`, `updateTerminalSize`, `recomputeHighlights`. (~8 sites)
3. **Mode transitions** — `setMode`, mode-enter/exit helpers. (~12 sites)
4. **File ops** — `openFile`, `saveFile` body (the non-Cmd parts; see CHORE-42 for the Cmd layer). (~10 sites)
5. **Command/MX line** — command line accumulation, minibuffer state. (~15 sites)
6. **Which-key** — `whichKeyActive`, `whichKeyPrefix`, `whichKeyTimeout`, `whichKeyBindings`. (~8 sites)
7. **LSP** — `lspDiagnostics` updates. (~5 sites)
8. **Windows/tabs** — window splits, tab switches. (~10 sites)
9. **Count prefix** — `countPrefix`, `spacePressed`, `windowPrefixPressed`. (~8 sites)
10. **Buffers** — `buffers.set/delete`, `currentBufferKey`, `currentFilename`, modified flags. (~15 sites)

After each batch: `bun run typecheck:src && bun run test:unit` must be green.

### Step 3: Convert handler mutations

For each of the 6 handlers (`command-handler`, `normal-handler`, `insert-handler`, `visual-handler`, `mx-handler`, `replace-handler`):

- Identify state changes currently done via `executeCommand*` side effects or `editor.getModel().X` reads followed by indirect mutation.
- Where the handler changes a state field directly, dispatch the appropriate Msg via `editor.applyUpdate(...)`.
- Handlers may still call `interp.execute(cmdString)` / `executeCommand*` for T-Lisp logic — only the *state mutation* pattern changes. Handler purity means "no direct model mutation," not "no runtime calls."

### Step 4: Verify the mutation count

- `rg -c "this\.model\.[a-zA-Z]+ =|this\.model\.[a-zA-Z]+\.|= " src/editor/editor.ts` should report ≤10 (the allowed residual: `applyUpdate`'s own `this.model = result.model`, the sync-back bridge, and `initialModel`).
- `rg -c "applyUpdate" src/editor/editor.ts` should report ≥30.
- `rg -c "applyUpdate" src/editor/handlers/` should report ≥6 (at least one dispatch per handler).

## Validation Commands

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck` — full project typecheck.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:unit` — all unit tests pass.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:integration` — integration tests pass.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:tmax-use` — e2e playbooks pass.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run build` — compiles.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bash -lc 'count=$(rg -c "this\.model\.[a-zA-Z]+ =|this\.model\.[a-zA-Z]+\. |= " src/editor/editor.ts || true); count=${count:-0}; printf "direct-mutations:%s\n" "$count"; test "$count" -le 10'` — ≤10 direct mutations remain.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bash -lc 'count=$(rg -c "applyUpdate" src/editor/editor.ts || true); count=${count:-0}; printf "applyUpdate-calls:%s\n" "$count"; test "$count" -ge 30'` — ≥30 applyUpdate call sites in editor.ts.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bash -lc 'count=$(rg -c "applyUpdate" src/editor/handlers/ || true); count=${count:-0}; printf "handler-applyUpdate:%s\n" "$count"; test "$count" -ge 6'` — handlers dispatch Msgs.

## Notes

- **Batch, don't big-bang.** The 91 mutation sites are interrelated. Converting batch-by-batch with a green test gate after each keeps the diff reviewable and bisectable.
- **Behavior preservation is paramount.** Every conversion must preserve the existing observable behavior — that's what the test suite verifies. If a test breaks, the conversion is wrong, not the test (unless the test asserts private implementation details like mutation order or object identity).
- **Msg variants mostly exist.** CHORE-39 defined 70+ Msg variants; most mutation sites have a matching variant. Add new ones only where genuinely missing.
- **This chore is independent of CHORE-41 (immutability) and CHORE-42 (Cmd layer).** It can land before or after either. If CHORE-41 has landed, the model fields are readonly and the only way to change them is through the reducer — this chore becomes mandatory. If not, the routing still works but direct mutation remains technically possible.
- **Handlers dispatch Msgs, not T-Lisp commands.** Where a handler currently calls `executeCommand("(set-mode 'insert)")` to change mode, it should dispatch `editor.applyUpdate({ type: 'SetMode', mode: 'insert' })` directly. T-Lisp commands that are pure logic (not state mutation) stay as T-Lisp calls.
- Related: CHORE-39 (parent), CHORE-41 (model immutability), CHORE-42 (Cmd layer), ADR-0111.
