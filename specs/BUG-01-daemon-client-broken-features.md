# Bug: Daemon/Client Broken and Missing Features

## Bug Description
The tmax daemon server and client CLI have multiple broken features discovered during integration testing via tmux. Five distinct issues prevent basic daemon/client workflows from functioning:

1. **`--list-buffers` crashes**: `buffers.map is not a function` — server treats `buffers` as an array but it's a `Map<string, FunctionalTextBuffer>`
2. **`--insert "text"` crashes**: `executeTlisp is not a function` — server calls a non-existent method on the Editor class
3. **`save-buffer` command broken**: Accesses `currentBuffer.content` but buffer has `getContent()` method, not a `.content` property
4. **`kill-buffer` command broken**: Same array-vs-Map issue as `list-buffers`, plus `.splice()` on a Map
5. **Key bindings empty in daemon**: Core binding files aren't loaded at startup

Additionally, the server's `handleCommand` method has several cases that operate on `buffers` as an array (`map`, `findIndex`, `splice`) when it's actually a `Map`.

## Problem Statement
The server's command handlers were written assuming `EditorState.buffers` is an array of buffer objects with `.name` and `.content` properties. In reality, `buffers` is a `Map<string, FunctionalTextBuffer>` where keys are file paths and values are `FunctionalTextBuffer` instances with a `getContent()` method. The `handleInsert` method calls a non-existent `executeTlisp()` method instead of using the interpreter directly.

## Solution Statement
Fix each server handler to work with the actual data structures:
- Convert `Map` operations to proper `Map.forEach`/`Map.get`/`Map.delete` calls
- Replace `executeTlisp()` with `this.editor.getInterpreter().execute()`
- Use `getContent()` instead of `.content` for buffer text access
- Load core bindings at server startup

## Steps to Reproduce
1. Start daemon: `bun src/server/server.ts` (in tmux session)
2. Test each broken feature:
   - `bun bin/tmaxclient --list-buffers` → crash: `buffers.map is not a function`
   - `bun bin/tmaxclient --insert "hello"` → crash: `executeTlisp is not a function`
   - `bun bin/tmaxclient --eval '(buffer-insert "test")'` then `--eval '(file-save)'` → verify works
   - `bun bin/tmaxclient --server-info` → shows `keybindings: {}` (empty)
3. Observe errors in client output and daemon logs

## Root Cause Analysis
The `handleCommand` method in `server.ts` was written with incorrect assumptions about the Editor API:
- **Array vs Map**: `EditorState.buffers` is typed as `Map<string, FunctionalTextBuffer>` (types.ts:191) but handlers use array methods (`.map()`, `.findIndex()`, `.splice()`)
- **Missing method**: `handleInsert` calls `this.editor.executeTlisp()` which doesn't exist on the Editor class. The correct approach is `this.editor.getInterpreter().execute()` (confirmed at editor.ts:2014)
- **Wrong property**: `save-buffer` accesses `currentBuffer.content` but `FunctionalTextBuffer` has `getContent()` returning `Either<BufferError, string>` (types.ts:55)
- **Missing initialization**: The server constructor doesn't call `loadCoreBindings()` so no key bindings are available in the daemon

## Relevant Files
Use these files to fix the bug:

- `src/server/server.ts` — All broken handlers are in this file:
  - `handleCommand` (line 411): `list-buffers`, `kill-buffer`, `save-buffer` cases
  - `handleInsert` (line 392): calls non-existent `executeTlisp`
  - `handleOpen` (line 313): already correctly uses `Map.set()` — good reference
  - `handleQuery` (line 636): `buffers` case already correctly iterates `Map.forEach` — good reference
  - Constructor (line 54): needs core bindings loading
- `src/editor/editor.ts` — Reference for correct API usage:
  - `getInterpreter()` at line 2014 returns `TLispInterpreterImpl`
  - `saveFile()` at line 1891 — async method for saving
  - `loadCoreBindings()` around line 1320 — loads T-Lisp binding files
- `src/core/types.ts` — Type definitions:
  - `EditorState.buffers` is `Map<string, FunctionalTextBuffer>` (line 191)
  - `FunctionalTextBuffer.getContent()` returns `Either<BufferError, string>` (line 55)
- `bin/tmaxclient` — Client CLI (no changes needed, bugs are server-side)

## Step by Step Tasks

### Fix `list-buffers` command

**User Story**: As a daemon user, I want to list open buffers so that I can see what files are being edited.

- In `handleCommand` at line 421, replace `this.editor.getState().buffers.map(buf => buf.name)` with proper Map iteration using `Array.from(state.buffers.keys())` to get buffer names (file paths)

**Acceptance Criteria**:
- [ ] `bun bin/tmaxclient --list-buffers` returns an array of buffer names without crashing
- [ ] Empty server returns `[]`
- [ ] After opening a file, the list includes that file path

### Fix `kill-buffer` command

**User Story**: As a daemon user, I want to close a specific buffer so that I can manage editor resources.

- Replace array operations (`findIndex`, `splice`) with `Map.delete()` at lines 424-431

**Acceptance Criteria**:
- [ ] `bun bin/tmaxclient --kill-buffer <name>` successfully removes the buffer
- [ ] Returns error for non-existent buffer
- [ ] Returns error when no buffer name provided

### Fix `save-buffer` command

**User Story**: As a daemon user, I want to save the current buffer to disk so that my edits are persisted.

- Replace manual filesystem operations at lines 435-441 with `this.editor.saveFile()` which handles content extraction and writing (line 1891 of editor.ts)

**Acceptance Criteria**:
- [ ] `save-buffer` command via `handleCommand` saves correctly
- [ ] Returns error when no file is associated with the buffer

### Fix `--insert` flag (handleInsert)

**User Story**: As a daemon user, I want to insert text at the cursor position via the `--insert` flag so that I can programmatically add content.

- Replace `this.editor.executeTlisp(...)` at line 401 with `this.editor.getInterpreter().execute(...)` which returns `Either<AppError, TLispValue>`
- Handle the Either return type (check `_tag === 'Left'` for errors)
- Return the result via `this.tlispValueToJson()`

**Acceptance Criteria**:
- [ ] `bun bin/tmaxclient --insert "hello"` inserts text without crashing
- [ ] Inserted text is visible via `bun bin/tmaxclient --eval '(buffer-text)'`
- [ ] Error returned when text parameter is empty

### Load core bindings at server startup

**User Story**: As a daemon user, I want key bindings and editor commands to be available so that the daemon is fully functional.

- Add a call to load core bindings after editor initialization in the constructor
- Verify that `--server-info` shows non-empty `keybindings` after the fix

**Acceptance Criteria**:
- [ ] `bun bin/tmaxclient --server-info` shows populated key bindings
- [ ] `bun bin/tmaxclient --eval '(buffer-text)'` and other T-Lisp builtins work
- [ ] Core binding files (`normal.tlisp`, `insert.tlisp`, etc.) are loaded at startup

### Run validation tests

**User Story**: As a developer, I want to verify all fixes work with zero regressions.

- Run `bun test` to verify no regressions in existing tests
- Manually test each fixed feature via tmux daemon/client

**Acceptance Criteria**:
- [ ] `bun test` passes with zero new failures
- [ ] All daemon/client commands work as expected

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bunx tsc --noEmit` — Zero type errors
- `bun test` — Full test suite passes with no new failures
- Manual tmux validation (daemon running in `tmax:3`, client in `tmax:2`):
  - `bun bin/tmaxclient --ping` → `{"status":"running","server":"tmax"}`
  - `bun bin/tmaxclient --list-buffers` → returns `[]` (no crash)
  - `bun bin/tmaxclient --insert "hello"` → no crash
  - `bun bin/tmaxclient --eval '(buffer-text)'` → shows inserted text
  - `bun bin/tmaxclient --server-info` → shows key bindings populated

## Notes
- The `handleQuery` method's `buffers` case (line 644) already correctly iterates the Map with `forEach` — use it as a reference pattern
- The `handleOpen` method (line 339) already correctly uses `Map.has()` and `Map.set()` — another good reference
- The `saveFile()` method on Editor is async and handles the Either return from `getContent()` internally — prefer it over manual content extraction
- The `import.meta.main` guard was already added in a previous fix to make the server runnable directly
- `executeTlisp` was never a method on Editor — the correct call pattern is `editor.getInterpreter().execute(code)` which returns `Either<AppError, TLispValue>`
