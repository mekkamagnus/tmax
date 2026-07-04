---
goal: "bun run typecheck passes, AND bash -lc 'count=$(rg -c \"enqueueCmd\" src/editor/editor.ts || true); count=${count:-0}; test \"$count\" -ge 2' exits 0, AND bash -lc '! rg -U -n \"case \\\"(SaveFile|OpenFile|EvalTlisp|EvalTlispAsync|LogMessage|LogProgram)\\\"[\\s\\S]{0,240}cmds: noCmds\" src/editor/functional/update.ts' exits 0, AND bash -lc 'for v in OpenFile SaveFile EvalTlisp EvalTlispAsync LogMessage LogProgram OpenFileSucceeded OpenFileFailed SaveFileSucceeded SaveFileFailed EvalTlispSucceeded EvalTlispFailed BackgroundCommandFailed; do rg -q \"\\\"$v\\\"\" src/editor/functional/messages.ts || exit 1; done' exits 0, AND bun run build passes, AND bun run test:unit passes"
---

# Chore: Make the Cmd/effect layer live — dispatch effects from update()

## Chore Description

CHORE-39 created the Elm-Architecture `Cmd<Msg>` effect system in `src/editor/functional/cmd.ts`, including `runCmd(cmd, runtime): TaskEither<AppError, Msg[]>` and an `EditorRuntime` interface. CHORE-39 also created `enqueueCmd` and `drainCommands` on the `Editor` class. **But the entire layer is dead code.** Patch-review (agents/01KWK7RC5H) found:

- `update.ts` returns `cmds: noCmds` for **every** `Msg` case (update.ts:24,45,47,49,…). The reducer never emits a single effect.
- `enqueueCmd` (editor.ts:2912) has **zero call sites** repo-wide.
- `drainCommands` (editor.ts:3250) is never invoked by `handleKey` or any public method.
- The spec-mandated follow-up `Msg` variants (`OpenFileSucceeded`, `SaveFileSucceeded`, `EvalTlispSucceeded`, `OpenFileFailed`, `SaveFileFailed`, `EvalTlispFailed`, `BackgroundCommandFailed`) are **not defined** in `messages.ts` (only `CmdFailed` exists).
- `openFile`/`saveFile` call `this.filesystem` directly and mutate `this.model` in place instead of enqueuing owner-tagged Cmds.

This chore makes the effect layer actually execute.

### The target

- `update()` emits real `Cmd`s for the effect-bearing Msgs (`SaveFile`, `OpenFile`, `EvalTlisp`, `LogMessage`, `LogProgram`).
- `applyUpdate()` enqueues returned Cmds via `enqueueCmd` and the async drain runs them through `runCmd`.
- `openFile(filename)` enqueues an owner-`'openFile'` `OpenFile` Cmd, awaits the drain for that command id, preserves the current public behavior of resolving after read failures, and commits `OpenFileSucceeded` follow-up Msgs only after a successful read.
- `saveFile(filename?)` captures the current buffer content before dispatch, enqueues an owner-`'saveFile'` `SaveFile` Cmd with that content, awaits its command id, preserves the current public behavior of resolving after write failures, and commits `SaveFileSucceeded` follow-up Msgs only after a successful write.
- `EvalTlisp`/`EvalTlispAsync` Cmds run through the drain; `EvalTlispSucceeded` follow-up is dispatched.
- `LogMessage`/`LogProgram` are owner-`'background'`; their failures dispatch `CmdFailed`/status messages but never reject an unrelated public method.
- `CmdFailed` is dispatched for every `Left(error)` from `runCmd` (already wired in the drain — keep it).

## Relevant Files

- `src/editor/functional/messages.ts` — add the missing initiating Msg variants and follow-up Msg variants. Initiating variants are `OpenFile { commandId, owner, filename }`, `SaveFile { commandId, owner, filename, content }`, `EvalTlisp { commandId, owner, expr }`, `EvalTlispAsync { commandId, owner, expr }`, `LogMessage { commandId, owner, message, level? }`, and `LogProgram { commandId, owner, category, entry }`; define or move the `CommandOwner` type so `messages.ts` and `cmd.ts` share the same owner union without introducing an import cycle. Follow-up variants are `OpenFileSucceeded { commandId, filename, content }`, `OpenFileFailed { commandId, filename, error }`, `SaveFileSucceeded { commandId, filename }`, `SaveFileFailed { commandId, filename, error }`, `EvalTlispSucceeded { commandId, result }`, `EvalTlispFailed { commandId, expr, error }`, and `BackgroundCommandFailed { commandId, error }`. Keep the existing `CmdFailed`.
- `src/editor/functional/update.ts` — change the effect-bearing cases to return real Cmds instead of `noCmds`. Each case still returns `{ model, cmds }` where `cmds` is a non-empty array of `Cmd` values when an effect is requested. The model field updates (e.g. setting status) still happen in the model; only the IO is deferred to the Cmd.
- `src/editor/functional/cmd.ts` — `runCmd` already handles each Cmd variant. Extend it to return the new follow-up Msg variants on success/failure (e.g. `OpenFile` → on success `[{ type: 'OpenFileSucceeded', commandId, filename, content }]`, on failure `[{ type: 'OpenFileFailed', commandId, filename, error }]`). Each Cmd carries a `commandId` and `owner`.
- `src/editor/editor.ts`:
  - `applyUpdate()` must use `enqueueCmd` for each returned Cmd instead of pushing directly to `cmdQueue`; currently it pushes directly, while `enqueueCmd` has no external call sites.
  - Add a private async command queue with ownership/correlation tracking. Each enqueued Cmd records `{ commandId, owner, resolve, reject }`. The drain runs Cmds sequentially via `runCmd` and resolves/rejects the awaiting owner.
  - `openFile(filename)`: replace the direct `this.filesystem.readFile` + `this.model.X = Y` with enqueuing an `OpenFile` Cmd (owner `'openFile'`), await the drain for that command id, and let the follow-up `OpenFileSucceeded`/`OpenFileFailed` Msg (dispatched through `applyUpdate`) commit the model change. Preserve the existing public behavior: failed reads update status/logs, leave the previous buffer intact, and resolve rather than reject.
  - `saveFile(filename?)`: same pattern with `SaveFile` Cmd (owner `'saveFile'`), except `saveFile()` must first perform the existing early-return checks and capture content from `currentBuffer.getContent()` before dispatch because the `Cmd` type requires `{ filename, content }`.
  - `handleKey` may trigger handler commands (owner `'handler'`); it awaits only the command ids needed for the key's observable behavior and must not surface unrelated background failures as unhandled rejections.
- `src/editor/functional/runtime.ts` — `EditorRuntime` interface already declares `evalTlisp`, `readFile`, `writeFile`, `logMessage`, `logProgram`, `toAppError`. The Editor implements it (editor.ts:3269+). Confirm the implementations are wired to the drain.

## Step by Step Tasks

### Step 1: Define the initiating and follow-up Msg variants

- In `messages.ts`, add the 6 initiating variants and 7 follow-up variants listed above. Each is a tagged-union member with the fields needed to request the effect or commit the result.
- Add the corresponding reducer cases in `update.ts`:
  - Initiating `OpenFile`, `SaveFile`, `EvalTlisp`, `EvalTlispAsync`, `LogMessage`, and `LogProgram` → return a real `Cmd` with the same `commandId`, `owner`, and payload.
  - `OpenFileSucceeded` → upsert buffer, set currentFilename/currentBufferKey, set status. Do only pure model updates here; preserve the current open-file side effects by running them from the Editor/drain success path after this follow-up is dispatched: LSP `onFileOpen`, simulated diagnostics, diagnostics/status update, success log, major-mode activation, AST parse, and highlight recomputation.
  - `OpenFileFailed` → set status with error, do NOT change buffers (leave previous intact).
  - `SaveFileSucceeded` → clear modified flag, set status.
  - `SaveFileFailed` → set status with error, keep modified flag.
  - `EvalTlispSucceeded` → optionally set a result field / status.
  - `EvalTlispFailed` → set status with error.
  - `BackgroundCommandFailed` → set status, append to messages.
- Add the exhaustiveness guard entry (`default: const _: never = msg`) so a missing case fails typecheck.

### Step 2: Make update() emit Cmds

- For `SaveFile` Msg: return `{ model, cmds: [{ tag: 'SaveFile', commandId, owner, filename, content }] }`. The `content` field is required: `saveFile()` captures it from `currentBuffer.getContent()` before dispatching the initiating Msg.
- For `OpenFile` Msg: return `{ model, cmds: [{ tag: 'OpenFile', commandId, owner, filename }] }`.
- For `EvalTlisp` Msg: return `{ model, cmds: [{ tag: 'EvalTlisp', commandId, owner, expr }] }`.
- For `EvalTlispAsync` Msg: return `{ model, cmds: [{ tag: 'EvalTlispAsync', commandId, owner, expr }] }`.
- For `LogMessage`/`LogProgram`: return background Cmds using the `owner` supplied on the initiating Msg; call sites should use owner `'background'` for ordinary logs.
- Remove all `noCmds` references for these cases (keep `noCmds` for pure model-only Msgs like `SetMode`, `SetStatusMessage`).

### Step 3: Extend runCmd to return follow-up Msgs

- `OpenFile` → `runtime.readFile(filename)` → on Right(content): return `Right([{ type: 'OpenFileSucceeded', commandId, filename, content }])`; on Left(error): return `Right([{ type: 'OpenFileFailed', commandId, filename, error }])` (the failure is a Msg, not a Left — Left is reserved for drain-level failures).
- `SaveFile` → `runtime.writeFile(filename, content)` → `SaveFileSucceeded` / `SaveFileFailed`, carrying `commandId`.
- `EvalTlisp`/`EvalTlispAsync` → `runtime.evalTlisp(expr)`/`runtime.evalTlispAsync(expr)` → `EvalTlispSucceeded` / `EvalTlispFailed`, carrying `commandId`.
- `LogMessage`/`LogProgram` → return `[]` on success (no follow-up needed beyond what the model already recorded); on failure return `[{ type: 'BackgroundCommandFailed', commandId, error }]`.

### Step 4: Add command-ownership correlation to the drain

- Add a private `commandQueue` to `Editor` that tracks `{ commandId, owner, resolve, reject }` per enqueued Cmd.
- `drainCommands()` runs each Cmd via `runCmd`. For each returned follow-up Msg, dispatch it through `applyUpdate`. For `Left(error)` from `runCmd`, dispatch `CmdFailed`.
- After dispatching, settle the awaiting owner based on the follow-up Msg and current public behavior: `OpenFileSucceeded`/`SaveFileSucceeded` resolve; `OpenFileFailed`/`SaveFileFailed` also resolve after status/log updates to match today's public methods; `EvalTlispFailed` may reject only the correlated handler command if existing handler behavior requires it. Background failures never reject unrelated public methods.

### Step 5: Rewrite openFile/saveFile to use Cmds

- `openFile(filename)`:
  ```typescript
  async openFile(filename: string): Promise<void> {
    const commandId = randomId();
    this.applyUpdate({ type: 'OpenFile', commandId, owner: 'openFile', filename });
    await this.awaitCommand(commandId); // resolves after OpenFileFailed status/log handling, matching today's public behavior
  }
  ```
- `saveFile(filename?)` — keep the existing non-write early returns before dispatch:
  - no `currentBuffer` → set status `"No buffer to save"`, log behavior unchanged, return without enqueuing a Cmd.
  - no resolved filename → set status `"Buffer has no associated file"`, log behavior unchanged, return without enqueuing a Cmd.
  - `currentBuffer.getContent()` returns `Left` → set/log the existing `"Failed to get content: ..."` status, return without enqueuing a Cmd.
  - otherwise dispatch `{ type: 'SaveFile', commandId, owner: 'saveFile', filename: saveFilename, content }`.
- Preserve all existing observable behavior: the previous buffer stays intact on failed reads; status line updates; modified flags update correctly; public `openFile()`/`saveFile()` resolve after handled filesystem failures as they do today.
- Add tests covering: successful open, failed open (file not found → previous buffer intact, status shows error, promise resolves), successful save, failed save (write permission → modified flag stays, promise resolves), and the three save early-return non-write paths.

### Step 6: Verify

- All existing tests pass (the public method behavior is preserved).
- New tests cover the four open/save success/failure paths.
- `enqueueCmd` has ≥2 call sites (it's actually used).
- `update.ts` has zero `noCmds` for effect-bearing cases; pure model-only cases may keep `noCmds`.
- `messages.ts` defines the 6 initiating variants and 7 follow-up variants.

## Validation Commands

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck` — full project typecheck.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:unit` — all unit tests pass.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:integration` — integration tests pass.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:tmax-use` — e2e playbooks pass (drives the editor through real open/save flows).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run build` — compiles.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bash -lc 'count=$(rg -c "enqueueCmd" src/editor/editor.ts || true); count=${count:-0}; test "$count" -ge 2'` — enqueueCmd is actually used (≥2 call sites).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bash -lc '! rg -U -n "case \"(SaveFile|OpenFile|EvalTlisp|EvalTlispAsync|LogMessage|LogProgram)\"[\\s\\S]{0,240}cmds: noCmds" src/editor/functional/update.ts'` — effect-bearing cases emit real Cmds. Pure-model cases that genuinely have no effect may keep using `noCmds`.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bash -lc 'for v in OpenFile SaveFile EvalTlisp EvalTlispAsync LogMessage LogProgram OpenFileSucceeded OpenFileFailed SaveFileSucceeded SaveFileFailed EvalTlispSucceeded EvalTlispFailed BackgroundCommandFailed; do rg -q "\"$v\"" src/editor/functional/messages.ts || exit 1; done'` — all initiating and follow-up Msg variants are defined.

## Notes

- **Preserve public method behavior.** `openFile`/`saveFile` currently handle filesystem failures by updating status/logs and resolving, not rejecting. Preserve that behavior; leave the previous buffer intact on failed reads; update the status line and modified flags as today. The Cmd layer is the mechanism, not a behavior change.
- **Owner correlation matters.** A failed background `LogMessage` write must not make an unrelated `saveFile` reject. The drain resolves/rejects only the awaiting owner for each command id.
- **`handleKey` isolation.** Handler-triggered commands (owner `'handler'`) must not surface unrelated background failures as unhandled rejections. `handleKey` awaits only the command ids required for the key's observable behavior.
- Related: CHORE-39 (parent), CHORE-41 (model immutability), CHORE-43 (reducer routing), ADR-0111.
