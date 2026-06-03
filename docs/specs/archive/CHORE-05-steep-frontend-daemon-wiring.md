# Chore: Wire Up Steep Frontend (Primary) + Daemon/Client TUI Bindings

## Chore Description

Wire the Steep native ANSI frontend into `main.tsx` as the default editor (replacing Ink/React), and add `keypress` + `render-state` JSON-RPC handlers to the daemon server so a TUI client can drive the editor remotely through `RemoteEditor`.

Two deliverables:
1. **`bun run start` (or `bun run tmax`)** uses Steep frontend by default — no Ink/React dependency for the TUI path
2. **Daemon serves TUI clients** — `RemoteEditor` sends keypresses, daemon runs them through `Editor.handleKey()`, returns serialized state, client renders via Steep

## Relevant Files

Use these files to resolve the chore:

- `src/main.tsx` — Current entry point; hardcodes Ink/React rendering. Needs `--steep` (default) and `--ink` flag support, wiring SteepFrontend as primary
- `src/frontend/frontends/steep/index.ts` — `SteepFrontend` class: complete TUI with alt screen, key input, render loop. Calls `editor.handleKey()` and `editor.getEditorState()`
- `src/frontend/frontends/steep/screen.ts` — ANSI screen operations (alt screen, writeAt, cursor)
- `src/frontend/frontends/steep/input.ts` — Raw stdin key normalization
- `src/server/server.ts` — Daemon server. Needs `keypress` and `render-state` JSON-RPC method handlers
- `src/editor/remote-editor.ts` — Client-side class that sends `keypress`/`render-state` to daemon, returns `EditorState`. Already built, just needs server support
- `src/server/serialize.ts` — `editorStateToJson()` and `jsonToEditorState()` for wire format. Already built
- `src/editor/editor.ts` — `handleKey()` (line 1757) mutates state, `getEditorState()` (line 1933) returns snapshot, `EDITOR_QUIT_SIGNAL` thrown on quit
- `bin/tmax` — Launcher script, currently runs `main.tsx` via node+tsx
- `package.json` — Scripts entry points

### New Files

- `src/client/tui-client.ts` — Thin entry point: creates `RemoteEditor`, creates a Steep-like render loop that reads from `RemoteEditor` instead of local `Editor`. Alternatively, can be added to `bin/tmaxclient` as a `--tui` mode.

## Step by Step Tasks

### Step 1: Add `keypress` and `render-state` handlers to server

- In `src/server/server.ts`, add two cases to the `processRequest` switch:
  - `keypress`: calls `this.editor.handleKey(params.key)`, catches `EDITOR_QUIT_SIGNAL`, returns serialized state + `quitSignal: true` if quit
  - `render-state`: returns serialized state via `editorStateToJson(this.editor.getEditorState())`
- Import `editorStateToJson` from `../server/serialize.ts`

### Step 2: Wire SteepFrontend into main.tsx as default

- Import `SteepFrontend` from `./frontend/frontends/steep/index.ts`
- Add `--ink` flag (opt-in to old frontend) and make Steep the default when no flag is given
- When Steep is selected (default): skip Ink `render()`, create `SteepFrontend` instance, call `frontend.run(editor, initialState, filename)`
- Remove Ink-specific fullscreen/cleanup code from the Steep path (SteepFrontend handles its own alt screen)
- Keep `--daemon` handling unchanged

### Step 3: Create TUI client entry point

- Create `src/client/tui-client.ts`: a standalone script that connects to a running daemon and runs a Steep-like TUI loop using `RemoteEditor`
- The TUI client:
  1. Connects to daemon socket via `RemoteEditor.start()` (sends `render-state`)
  2. Enters alt screen, sets up raw stdin
  3. On each keypress: calls `remoteEditor.handleKey(key)` → gets `EditorState` back
  4. Renders buffer lines, status line, command input using the same render functions from `src/frontend/render/`
  5. On `EDITOR_QUIT_SIGNAL`: exits alt screen, exits process
- Add shebang `#!/usr/bin/env bun` and `import.meta.main` guard

### Step 4: Add `--tui` flag to tmaxclient

- In `bin/tmaxclient`, add `--tui` flag parsing
- When `--tui` is specified, spawn the TUI client instead of running CLI commands
- Alternatively, add a `bun run tui` script to `package.json` that runs `src/client/tui-client.ts` directly

### Step 5: Test the full flow in tmux

- Start daemon in `tmax:3`
- Test local Steep frontend: `bun run start` in `tmax:2`
- Test TUI client: `bun src/client/tui-client.ts` in a tmux window (connects to daemon)
- Verify: key input, rendering, mode switching, file editing, quit

## Validation Commands

- `bunx tsc --noEmit` — Zero type errors in changed files
- `bun test` — Full test suite passes with no new failures
- `bun run start` — Steep frontend launches with full TUI (alt screen, key input, rendering)
- `bun src/server/server.ts` — Daemon starts and listens
- `bun bin/tmaxclient --ping` — Confirms daemon running
- `bun src/client/tui-client.ts` — TUI client connects to daemon, renders editor, handles keys
- Verify quit (press `q` in normal mode) cleanly exits both Steep and TUI client

## Notes

- The Steep frontend already works — it's a complete implementation. The wiring is just about making it the default in `main.tsx`.
- `RemoteEditor` already exists and has the correct protocol. The server just needs two new JSON-RPC handlers.
- `serialize.ts` already handles the `EditorState` ↔ JSON conversion correctly.
- The quit signal propagates as a thrown `Error("EDITOR_QUIT_SIGNAL")`. The server's `keypress` handler needs to catch this and include `quitSignal: true` in the response.
- The `handleKey()` method is async and returns `void` (mutates internal state). After calling it, read state via `getEditorState()`.
- The Ink frontend should remain available via `--ink` flag for backward compatibility, but Steep becomes the default.
- File extension on `main.tsx` can stay as-is since it's referenced by `bin/tmax` and `package.json` scripts. The Ink import path requires `.tsx`. We can gate the Ink import behind the flag check.
