---
goal: "bun run typecheck passes, AND bash -lc 'pattern=\"this\\.model\\s*=\\s*\\{\\s*\\.\\.\\.this\\.model|this\\.model\\.[A-Za-z_$][A-Za-z0-9_$]*\\s*(\\+=|-=|\\*=|/=|=\\s)|\\.patchModel\\s*\\(\"; count=$(rg -n \"$pattern\" src/editor/editor.ts src/editor/handlers/ | wc -l | tr -d \" \"); printf \"direct-model-commits:%s\\n\" \"$count\"; test \"$count\" -le 10' exits 0 (≤10 direct model commits remain), AND bash -lc 'count=$(rg -c \"applyUpdate\" src/editor/editor.ts || true); count=${count:-0}; printf \"applyUpdate-calls:%s\\n\" \"$count\"; test \"$count\" -ge 30' exits 0 (≥30 applyUpdate call sites), AND bun run test:unit passes, AND bun run build passes"
---

# Chore: Route editor mutations through the reducer — applyUpdate everywhere

## Chore Description

CHORE-39 established `applyUpdate(msg): EditorModel` on the `Editor` class and the `update(model, msg)` reducer. **But almost nothing routes through it.** Patch-review (agents/01KWK7RC5H) found:

- `editor.ts` has **91 direct `this.model.X = Y` mutation sites** and only **3 `applyUpdate` call sites** (and those 3 are inside the command drain that never runs — see CHORE-42).
- All 6 handlers have **0 `applyUpdate` calls**. Some handlers mutate editor-facing model fields via `patchModel(...)`; others only route keys into T-Lisp and may legitimately have no direct reducer dispatch.
- The field was renamed `state`→`model` to pass the `this.state.` validation sweep, but mutations were not routed through the reducer.

This chore converts the ~91 direct mutation sites in `editor.ts` plus the handler state changes into `applyUpdate({ type: '...', ... })` dispatches, so that the reducer becomes the single source of model mutation.

### The target

- Every `this.model.X = Y` in `editor.ts` is replaced by `this.applyUpdate({ type: 'SetX', value: Y })` (or the appropriate existing Msg variant).
- Handlers dispatch Msgs through `editor.applyUpdate(...)` for state changes they own directly (mode transitions, command line accumulation, which-key/status updates, etc.).
- `applyUpdate` is the single source of model mutation. The reducer (`update.ts`) owns all state transitions.
- The remaining direct model commits (≤10) are confined to: the `applyUpdate` method itself (assigning `this.model = result.model`), explicit sync-back bridges to legacy/private state, `initialModel()`, and prefix-tracker state deferred below.

## Relevant Files

- `src/editor/editor.ts` — the bulk of the work. ~91 mutation sites across `handleKey`, `setEditorState`, mode transitions, viewport updates, command line accumulation, which-key state, lsp diagnostics, windows/tabs, and scalar buffer metadata. Convert model-field commits to `applyUpdate` where ownership is clear.
- `src/editor/handlers/*.ts` (6 files) — replace direct `editor.patchModel(...)` calls with `editor.applyUpdate(...)`. Do not add artificial dispatches to handlers that only route keys into T-Lisp.
- `src/editor/functional/messages.ts` — may need additional Msg variants if the current 70 don't cover every mutation site. Enumerate missing variants and add them.
- `src/editor/functional/update.ts` — add reducer cases for any new Msg variants. Each returns a fresh immutable model.
- `src/editor/functional/model.ts` — no changes (CHORE-41 handles immutability; this chore assumes mutable fields for now if CHORE-41 hasn't landed, or readonly fields if it has — the routing pattern works either way).

## Step by Step Tasks

### Step 1: Enumerate all mutation sites

- Run `rg -n "this\.model\s*=\s*\{\s*\.\.\.this\.model|this\.model\.[A-Za-z_$][A-Za-z0-9_$]*\s*(\+=|-=|\*=|/=|=\s)|\.patchModel\s*\(" src/editor/editor.ts src/editor/handlers/` to list actual direct model commits: object-spread commits to `this.model`, direct `this.model.foo = ...` assignments, and `patchModel(...)` call sites.
- Group them by the field being committed: `currentBuffer`, `cursorPosition`, `mode`, `statusMessage`, `commandLine`, `viewport`, `buffers`, `windows`, `tabs`, `whichKeyActive`, `lspDiagnostics`, etc.
- For each group, identify the corresponding Msg variant in `messages.ts` (most already exist: `SetMode`, `SetStatusMessage`, `SetCommandLine`, `AppendCommandLine`, `SetCursorPosition`, `SetViewport`, `UpsertBuffer`, `SetWhichKeyActive`, `SetLspDiagnostics`, etc.).
- For any mutation site without a matching Msg variant, add one to `messages.ts` and a reducer case to `update.ts`.
- For every newly added Msg variant, add reducer unit coverage that proves the case returns the expected immutable model update, and rely on the existing `never` exhaustiveness guard in `update.ts` plus `bun run typecheck:src` after message/update edits.

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
9. **Prefix trackers** — exclude `countPrefix`, `spacePressed`, and `windowPrefixPressed` from this chore. They are editor-private/prefix routing state according to `messages.ts`; do not add `SetCountPrefix`, `SetSpacePressed`, or `SetWindowPrefixPressed` here unless this chore is explicitly expanded to first move that state into `EditorModel`.
10. **Buffers** — route scalar model state such as `currentBuffer`, `currentFilename`, and modified flags. Leave shared `this.buffers` map ownership in `Editor` unless the implementation also provides a concrete synchronization strategy that keeps `this.buffers`, `model.buffers`, buffer metadata, windows, and tabs in lockstep. Do not blindly replace `buffers.set/delete` with `UpsertBuffer` if that would desynchronize the private map from `model.buffers`.

After each batch: `bun run typecheck:src && bun run test:unit` must be green.

### Step 3: Convert handler mutations

For each of the 6 handlers (`command-handler`, `normal-handler`, `insert-handler`, `visual-handler`, `mx-handler`, `replace-handler`):

- Identify direct handler commits (`editor.patchModel(...)` or direct model writes) and replace each with the appropriate `editor.applyUpdate(...)` Msg.
- Do not require an `applyUpdate` call in every handler. Some handlers only route keys into T-Lisp, and forcing no-op dispatches would duplicate state transitions.
- Handlers may still call `interp.execute(cmdString)` / `executeCommand*` for T-Lisp logic. Existing T-Lisp side effects such as buffer insertion, cursor movement, undo, minibuffer dispatch, and editor API primitive mutations are not converted in this chore; routing those editor API primitives through `applyUpdate` belongs to CHORE-44 unless this spec is explicitly expanded.

### Step 4: Verify the mutation count

- `bash -lc 'pattern="this\.model\s*=\s*\{\s*\.\.\.this\.model|this\.model\.[A-Za-z_$][A-Za-z0-9_$]*\s*(\+=|-=|\*=|/=|=\s)|\.patchModel\s*\("; count=$(rg -n "$pattern" src/editor/editor.ts src/editor/handlers/ | wc -l | tr -d " "); test "$count" -le 10'` should pass (the allowed residual: explicit sync-back bridges, prefix-tracker state deferred above, and any legacy bridge intentionally kept with a comment).
- `rg -c "applyUpdate" src/editor/editor.ts` should report ≥30.
- There is no minimum `applyUpdate` count for `src/editor/handlers/`; instead, the direct-model-commit check above must find no unapproved `patchModel(...)` or direct model writes in handlers, and targeted handler tests must cover command-line editing, insert/replace Escape mode changes, which-key prefix behavior, and unbound-key status messages.

## Validation Commands

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck` — full project typecheck.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:unit` — all unit tests pass.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:integration` — integration tests pass.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:tmax-use` — e2e playbooks pass.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run build` — compiles.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bash -lc 'pattern="this\.model\s*=\s*\{\s*\.\.\.this\.model|this\.model\.[A-Za-z_$][A-Za-z0-9_$]*\s*(\+=|-=|\*=|/=|=\s)|\.patchModel\s*\("; count=$(rg -n "$pattern" src/editor/editor.ts src/editor/handlers/ | wc -l | tr -d " "); printf "direct-model-commits:%s\n" "$count"; test "$count" -le 10'` — ≤10 direct model commits remain.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bash -lc 'count=$(rg -c "applyUpdate" src/editor/editor.ts || true); count=${count:-0}; printf "applyUpdate-calls:%s\n" "$count"; test "$count" -ge 30'` — ≥30 applyUpdate call sites in editor.ts.
- Targeted behavior tests cover handler-visible state changes without requiring one reducer dispatch per handler.

## Notes

- **Batch, don't big-bang.** The 91 mutation sites are interrelated. Converting batch-by-batch with a green test gate after each keeps the diff reviewable and bisectable.
- **Behavior preservation is paramount.** Every conversion must preserve the existing observable behavior — that's what the test suite verifies. If a test breaks, the conversion is wrong, not the test (unless the test asserts private implementation details like mutation order or object identity).
- **Msg variants mostly exist.** CHORE-39 defined 70+ Msg variants; most mutation sites have a matching variant. Add new ones only where genuinely missing.
- **This chore is independent of CHORE-41 (immutability) and CHORE-42 (Cmd layer).** It can land before or after either. If CHORE-41 has landed, the model fields are readonly and the only way to change them is through the reducer — this chore becomes mandatory. If not, the routing still works but direct mutation remains technically possible.
- **Handlers dispatch Msgs for direct model commits, not for every T-Lisp effect.** Where a handler directly commits a model field, it should dispatch `editor.applyUpdate({ type: 'SetMode', mode: 'insert' })` or the matching Msg. T-Lisp commands and editor API primitives that mutate buffers, cursor, undo, or minibuffer state remain as-is for this chore; route those primitives through `applyUpdate` in CHORE-44.
- Related: CHORE-39 (parent), CHORE-41 (model immutability), CHORE-42 (Cmd layer), ADR-0111.
