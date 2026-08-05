# Bug: durable buffer not restored to its window after daemon restart

> **Status:** PRE-EXISTING — not caused by the Emacs-M× gap work (stash-confirmed). Root cause located and reproducibly verified 2026-08-06.
> **Issue:** [#114 (BUG-65)](https://github.com/mekkamagnus/tmax/issues/114)

## Goals

- `test:integration` green on the workspace durability path: a buffer held by a window survives a daemon restart and is restored to that window in the rendered frame.
- `showSplashIfEmpty` (the startup splash) must never clobber a restored workspace's window→buffer assignment — for file buffers *or* name-only buffers.
- A restored workspace whose current buffer is a name-only buffer (no associated filename, e.g. `durable.ts`) is treated identically to one whose current buffer is a file buffer.

## Completion Criteria (Definition of Done)

- [ ] `bun test test/integration/workspace-lifecycle.test.ts` → all green (currently 1 fail: "workspace-move-window target save failure leaves source durable on disk").
- [ ] After a daemon restart, a frame whose window held a durable buffer renders that buffer's `bufferName` in `render-state` (not `*scratch*`). Verified by the assertion at `test/integration/workspace-lifecycle.test.ts:626`.
- [ ] `bun run test:integration` exit 0.
- [ ] The splash screen still appears for a genuinely fresh start (empty `*scratch*`, no restored workspace windows) — i.e. the fix does not regress thesplash-on-first-launch behavior. Add/keep a unit or integration assertion that `*scratch*` shows the splash when no workspace was restored.
- [ ] `bun run typecheck` exit 0 (no new type errors).

## Bug Description

`test/integration/workspace-lifecycle.test.ts:626` — "workspace-move-window target save failure leaves source durable on disk" — fails:

```
expect(restoredRender.windows.map(w => w.bufferName)).toContain("durable.ts")
Expected to contain: "durable.ts"
Received: [ "*scratch*" ]
```

After a daemon restart, the restored frame's window renders `*scratch*` instead of the durable `durable.ts` buffer. **Pre-existing** — confirmed by stashing all Emacs-M×-gap `src/` changes and re-running; identical failure. Not caused by that work. (`test:integration` overall: 81 pass / 1 fail.)

The immediately preceding assertion (`:624`) PASSES — `restoredBuffers` contains `durable.ts`. So the buffer list is correctly restored; only the window→buffer assignment is lost. This rules out the persistence layer (the on-disk JSON is correct — the test at `:613`-`:614` asserts `sourceData.windows[].bufferName` contains `durable.ts`).

## Root Cause (investigated 2026-08-06)

**The original spec's framing was a misdiagnosis.** It pointed at the workspace/window restore path (`loadWorkspace` → `resolveBuffer` → window reattach in `src/server/server.ts`). That path is **correct** — verified by instrumentation:

- On the restarted server, `initializeWorkspaces` (`src/server/server.ts:290-303`) loads `move_fail_a` from disk and calls `this.editor.applyWorkspace(loaded.right)` at `server.ts:301`.
- `Editor.applyWorkspace` (`src/editor/editor.ts:2161`) correctly resolves the persisted window: at `editor.ts:2211-2216` it maps `workspace.windows` and resolves `durable.ts` via the `oldBufferNames` reverse index (`oldBufferNames.get(w.buffer)` returns `"durable.ts"`, `oldHas=true`). The model ends startup with `windows=[{ bufferName: "durable.ts" }]` and `currentBuffer = durable.ts`.
- `render-state` for the active workspace reads `shared.windows` from `frameToEditorState` (`src/server/server.ts:874-901`), which after the fix correctly carries `durable.ts`.

**Actual root cause:** `showSplashIfEmpty()` clobbers the just-restored window.

Call chain on the restart path:

1. `TmaxServer.startEditor()` (`src/server/server.ts:915-944`) calls `await this.initializeWorkspaces()` (`:921`) → which runs `applyWorkspace(move_fail_a)` → model is correct: `windows[0].bufferName = "durable.ts"`.
2. `startEditor` then continues to `this.editor.showSplashIfEmpty()` at `server.ts:938`.
3. `Editor.showSplashIfEmpty()` (`src/editor/editor.ts:2918-2929`):
   ```ts
   if (this.model.currentFilename) return;          // ← guard
   const scratch = this.buffers.get("*scratch*");
   if (scratch) {
     const content = scratch.getContent();
     if (Either.isRight(content) && content.right === "") {
       this.createBuffer("*scratch*", TextBufferImpl.SPLASH_TEXT);
     }
   }
   ```
   The guard `if (this.model.currentFilename) return;` only protects **file** buffers. `durable.ts` is a name-only buffer (`buffer-create "durable.ts"` with no associated file), so after `applyWorkspace` `model.currentFilename` is `undefined` and the guard does **not** fire. `*scratch*` is empty, so it calls `createBuffer("*scratch*", SPLASH_TEXT)`.
4. `Editor.createBuffer()` (`src/editor/editor.ts:2270-2307`) sets the new scratch buffer as current (`SetCurrentBuffer`, `:2276`), then — because `model.windows.length` is 1 (the restored window) — takes the **ELSE branch** at `editor.ts:2295-2306`:
   ```ts
   const currentWindow = this.model.windows[this.model.currentWindowIndex ?? 0];
   if (currentWindow) {
     currentWindow.buffer = buffer;                              // scratch
     currentWindow.bufferName = this.findBufferName(buffer);     // "*scratch*"
     ...
   }
   ```
   This overwrites the restored window's `buffer` and `bufferName` to `*scratch*`, silently destroying the `durable.ts` assignment.

**Verification (deterministic):** instrumenting `applyWorkspace`/`frameToEditorState` showed the model holds `durable.ts` immediately after `initializeWorkspaces`, then `*scratch*` by the time `render-state` runs. Skipping `showSplashIfEmpty` via a temporary guard makes the failing test pass (1 pass / 0 fail). Removing the guard restores the failure (0 pass / 1 fail). The defect is isolated to `showSplashIfEmpty` + the `createBuffer` window-overwrite branch.

This is the same family of bug as BUG-58 (embedded `:w` no-op): both are startup-path code mutating the editor model after the workspace/file was correctly loaded. BUG-58 was `startEditor` forcing `*scratch*` on `--clean`; BUG-65 is `showSplashIfEmpty` forcing `*scratch*` when the restored current buffer has no filename.

## Implementation Plan

The fix belongs in `Editor.showSplashIfEmpty` (`src/editor/editor.ts:2918-2929`). The splash must only seed `*scratch*` when `*scratch*` is genuinely the current buffer the user is looking at — not whenever the current buffer happens to lack a filename.

1. **Tighten the `showSplashIfEmpty` guard** (`src/editor/editor.ts:2918-2929`). Replace the filename-only check with one that also skips when the current window is pointing at a non-scratch buffer. Concretely, early-return when either:
   - `this.model.currentFilename` is set (existing behavior — a file buffer is current), OR
   - the current window's `bufferName` is something other than `*scratch*` (a restored name-only buffer like `durable.ts` is current and must not be displaced).

   Pattern to mirror — read the current window the same way `createBuffer` does (`editor.ts:2297`):
   ```ts
   const currentWindow = this.model.windows?.[this.model.currentWindowIndex ?? 0];
   const currentIsScratch = !currentWindow || currentWindow.bufferName === "*scratch*";
   if (this.model.currentFilename) return;
   if (!currentIsScratch) return;   // ← restored buffer owns the window; leave it alone
   ```
   This is the minimal change: two lines. It preserves splash-on-fresh-start (when no workspace was restored, `model.windows` is either empty or `[scratch]`, so `currentIsScratch` is true and the splash seeds normally).

2. **Do NOT change `createBuffer`** (`editor.ts:2270-2307`). Its ELSE-branch window-overwrite is intentional for the normal "user created/switched a buffer" flow (the current window should follow the new current buffer). The bug is solely that `showSplashIfEmpty` reaches `createBuffer` in a state where the current window legitimately belongs to a restored buffer. Fix the caller, not the callee.

3. **Do NOT change the restore path.** `applyWorkspace` (`editor.ts:2161-2238`), `dataToWorkspace` (`src/core/workspace.ts:527-663`), `initializeWorkspaces` (`server.ts:265-310`), and `frameToEditorState` (`server.ts:874-909`) are all verified correct for this scenario. The investigation's original "trace connect-frame + restoreWorkspaceAfterOverride" direction was a red herring: `connect-frame`'s `activateWorkspace` early-returns (`server.ts:351`) because the workspace is already active from startup, and `restoreWorkspaceAfterOverride` (`server.ts:524-530`) is not on this path (no workspace override in the test).

4. **Verify the splash regression.** Confirm `*scratch*` still receives `SPLASH_TEXT` on a fresh start (no restored workspace / empty `*scratch`). The existing first-launch behavior must be unchanged.

## Test Plan

- **Primary (the failing test, must go green):** `bun test test/integration/workspace-lifecycle.test.ts -t "workspace-move-window target save failure"`. The assertion at `:626` (`restoredRender.windows.map(w => w.bufferName)` contains `"durable.ts"`) directly verifies the restored window keeps its durable buffer. This test reproduces the exact restart→`workspace-load`→`connect-frame`→`render-state` sequence.
- **Full integration suite:** `bun run test:integration` → exit 0 (81 pass / 1 fail → 82 pass / 0 fail).
- **Splash regression guard:** add (or confirm an existing) assertion that on a clean start with no restored workspace, `*scratch*`'s content is `TextBufferImpl.SPLASH_TEXT`. If none exists, add a unit test in `test/unit/editor.test.ts` that constructs an Editor with empty `*scratch*` and no restored windows, calls `showSplashIfEmpty()`, and asserts `*scratch*` content equals the splash text — then a second case that pre-seeds `model.windows = [{ bufferName: "durable.ts", ... }]` with `currentFilename = undefined` and asserts `showSplashIfEmpty()` leaves that window's `bufferName` as `"durable.ts"`.
- **Type gate:** `bun run typecheck` → exit 0.
- **No broader regression:** `bun run test:unit` (excluding the known-unrelated BUG-16 inactivity-timer flake per memory) should show no new failures attributable to this change.

## Relevant Files

- `src/editor/editor.ts:2918-2929` — `showSplashIfEmpty` (the fix site; the guard to tighten).
- `src/editor/editor.ts:2270-2307` — `createBuffer` (the ELSE-branch window overwrite that performs the clobber; do NOT modify, understand only).
- `src/editor/editor.ts:2161-2238` — `applyWorkspace` (verified correct; resolves restored windows via `oldBufferNames`).
- `src/server/server.ts:265-310` — `initializeWorkspaces` (loads last workspace at startup and applies it; the source of the correct pre-splash model state).
- `src/server/server.ts:915-944` — `startEditor` (calls `initializeWorkspaces` then `showSplashIfEmpty` — the ordering that exposes the bug).
- `src/server/server.ts:874-909` — `frameToEditorState` (read by `render-state`; uses `shared.windows` for the active workspace).
- `test/integration/workspace-lifecycle.test.ts:577-634` — the failing test ("workspace-move-window target save failure leaves source durable on disk").
- Reference: `docs/specs/BUG-58-embedded-w-save-no-filename.md` — same bug family (startup code displacing the correctly-loaded buffer); `showSplashIfEmpty` is the BUG-65 analogue of BUG-58's `startEditor` `--clean` scratch-switch.

## Severity / Notes

- **Priority:** medium. Pre-existing; data-durability surface (a buffer a user expects to survive a restart is silently dropped from its window on the restart path). Not from the Emacs-M× gap work.
- **Scope of fix:** ~2 lines in `showSplashIfEmpty`. The investigation narrowed the defect from "the restore path is broken" to "the restore path is fine; a post-restore splash routine overwrites it."
