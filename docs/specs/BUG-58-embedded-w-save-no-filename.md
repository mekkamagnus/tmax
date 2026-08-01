# Bug: `:w` in the embedded editor (`tmax file.md`) writes nothing to disk

## Bug Description
Opening a file with the embedded editor (`tmax test.md` — the single-process
path with the in-process socket server, no separate daemon), typing text, and
pressing `:w` produces **no file on disk**. `bat test.md` reports "no such file"
for a new file, and modifications to an existing file are silently lost.

Symptom, observed via tmux driving the real binary:
- The status line shows the buffer as `*scratch*` (not `test.md`) after typing,
  i.e. the opened file buffer was discarded.
- Even when the status line correctly shows `test.md`, `:w` still writes nothing
  because the buffer has no associated filename.

Expected: `tmax file.md` → type → `:w` writes the buffer to `file.md`, exactly
as the daemon/client path (`openFile` RPC) does.

## Problem Statement
Two independent defects in the embedded-editor bootstrap conspire to make `:w`
a no-op:

1. **`server.ts startEditor()` unconditionally switches to `*scratch*` on
   `--clean`.** `main.ts` always constructs the embedded `TmaxServer` with
   `cleanStart=true` (so it never restores a stale workspace). But `startEditor`
   interpreted "clean start" as "force `*scratch*`" and ran
   `(buffer-switch "*scratch*")` *after* `main.ts` had already loaded the file
   buffer — discarding it.

2. **`main.ts` never records the filename in `bufferMetadata`.** `createBuffer`
   only seeds `{ modified, recency }`. The filename→buffer association is set
   by `openFile` (`updateBufferMetadata(name, { filename })`) but **not** by the
   `main.ts` bootstrap. The first `buffer-insert` replaces the current buffer
   with a fresh immutable instance; `setCurrentBuffer` then *re-derives*
   `currentFilename` from `bufferMetadata[bufferName].filename`, which is
   `undefined` → `model.currentFilename` is wiped to `undefined` on the first
   keystroke. `save-buffer` reads `(buffer-filename)` → nil → bails with
   "Buffer has no associated file".

Either defect alone breaks `:w`; both were present.

## Solution Statement
1. Guard the `--clean` `buffer-switch` so it only fires when **no file buffer is
   present** (the bare `tmax` case). When `main.ts` opened a file,
   `currentFilename` is already set and must be preserved.
2. Mirror `openFile`'s metadata association in the `main.ts` bootstrap via a new
   `Editor.associateBufferFilename(filename)` method, so the first `buffer-insert`
   re-derivation keeps `currentFilename` intact.
3. (Defensive) Make `Editor.start()` idempotent: the Steep frontend
   (`assam.ts:96`) calls `editor.start()` *after* `server.startEditor()` already
   loaded core bindings + init file + macros. Re-running `loadInitFile`/
   `loadSavedMacros` is wasted work and can have side effects; short-circuit when
   `coreBindingsLoaded` is already true.

## Steps to Reproduce
1. `cd ~/Downloads` (or any dir).
2. `tmax test.md` (embedded editor, no daemon running).
3. Press `i`, type `hello world`, press `Escape`.
4. Type `:w` and press `Enter`.
5. Quit (`:q`), then `bat test.md`.

Actual: `bat` reports "No such file or directory" (new file) or shows the
pre-existing content unchanged (existing file).
Expected: `test.md` exists and contains `hello world`.

## Root Cause Analysis
- `src/server/server.ts` `startEditor()`: the `if (this.cleanStart)` block ran
  `(buffer-switch "*scratch*")` unconditionally. `cleanStart` was overloaded to
  mean both "skip workspace restore" (correct for embedded) and "force
  `*scratch*`" (wrong when a file was opened).
- `src/editor/editor.ts` `createBuffer()` (line ~2239): seeds metadata without
  `filename`. `openFile()` (line ~2298) adds it; the `main.ts` bootstrap (CHORE-44
  Change 10) did not.
- `src/editor/api/buffer-ops.ts` `buffer-insert` (line ~289): on every insert it
  calls `setCurrentBuffer(newBuffer)`, whose setter (editor.ts ~351-354)
  re-derives `currentFilename = bufferMetadata[bufferName]?.filename`. With no
  filename recorded, the first keystroke nilled `currentFilename`.
- `(buffer-filename)` (buffer-ops.ts ~495) reads `model.currentFilename`; once
  nil, `save-buffer` (save.tlisp) hits `(unless path … (return-from save-buffer))`
  and writes nothing.
- Diagnostic trace (applyUpdate log) confirmed the sequence: good state
  (`currentFilename=savetest.md`) → `SetCurrentBuffer` (insert) →
  `SetCurrentFilename(undefined)`.

## Relevant Files
Use these files to fix the bug:

- `src/server/server.ts` — `startEditor()`: guard the `--clean` `buffer-switch`
  with `!this.editor.getState().currentFilename`.
- `src/editor/editor.ts` — add `associateBufferFilename(filename)` (mirrors
  `openFile`'s metadata set); make `start()` idempotent on `coreBindingsLoaded`.
- `src/main.ts` — call `editor.associateBufferFilename(filename)` right after
  `SetCurrentFilename` in the bootstrap.

### New Files
None.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom. (All tasks are
IMPLEMENTED and VALIDATED as of this spec.)

### Task 1: Guard the `--clean` `buffer-switch` in `startEditor`

**User Story**: As a user running `tmax file.md`, I want the file I named on the
command line to remain the current buffer through startup, so that edits and
`:w` apply to it.

- In `src/server/server.ts` `startEditor()`, change the `cleanStart` block so
  `(buffer-switch "*scratch*")` only runs when
  `!this.editor.getState().currentFilename` (no file pre-loaded).

**Acceptance Criteria**:
- [x] `tmax file.md` keeps `file.md` as the current buffer through startup.
- [x] bare `tmax` still switches to `*scratch*` and shows the splash.

### Task 2: Associate the filename with the buffer in `main.ts`

**User Story**: As a user editing a file in the embedded editor, I want `:w` to
know which file to write, so my edits are saved.

- Add `Editor.associateBufferFilename(filename)` that calls
  `updateBufferMetadata(findBufferName(currentBuffer), { filename, modified:false })`.
- In `src/main.ts`, call it immediately after `SetCurrentFilename` in the
  bootstrap (file-opened branch).

**Acceptance Criteria**:
- [x] After the first `buffer-insert`, `(buffer-filename)` still returns the path.
- [x] `(save-buffer)` writes the file and returns `"Saved <path>"`.

### Task 3: Make `Editor.start()` idempotent

**User Story**: As a developer, I want `editor.start()` not to re-evaluate init
files/macros when the server already initialized the editor, so the frontend's
`start()` call can't disturb editor state.

- In `Editor.start()`, return early (after setting `running = true`) when
  `this.coreBindingsLoaded` is already true.

**Acceptance Criteria**:
- [x] `loadInitFile`/`loadSavedMacros` are not re-run by the frontend's `start()`.
- [x] Standalone first-call init (no server) is unchanged.

### Task 4: Validate end-to-end

**User Story**: As a user, I want confidence that `:w` works and nothing
regressed.

- Drive the real binary via tmux: `i` → type → `Escape` → `:w` → `Enter`.
- Check the file exists on disk with the typed content.
- Regression: bare `tmax` still shows the splash; opening an existing file and
  saving preserves prior content.

**Acceptance Criteria**:
- [x] New file written with correct content.
- [x] Existing file: appended content persists after `:w`.
- [x] Splash screen still renders for bare `tmax`.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run typecheck:src` — clean (no type errors).
- `bun run typecheck:test` — clean.
- `bun test test/unit/buffer-metadata.test.ts test/unit/server-save-file.test.ts test/unit/server-serialization.test.ts test/unit/editor.test.ts test/unit/buffer.test.ts` — all pass (the one `server-daemon` "should start tmax server daemon" failure is pre-existing and environmental: the test shells out to `timeout`, which macOS does not ship; unrelated to this fix).
- End-to-end (tmux, embedded path):
  ```bash
  tmux new-session -d -s tmaxbug -x 100 -y 30 "bun src/main.ts /tmp/savetest.md"
  sleep 3; tmux send-keys -t tmaxbug "i"; sleep 0.4
  tmux send-keys -t tmaxbug "hello e2e"; sleep 0.4
  tmux send-keys -t tmaxbug Escape; sleep 0.4
  tmux send-keys -t tmaxbug ":"; sleep 0.3; tmux send-keys -t tmaxbug "w"; sleep 0.3
  tmux send-keys -t tmaxbug Enter; sleep 1.5
  cat /tmp/savetest.md   # expect: hello e2e
  tmux kill-session -t tmaxbug
  ```
- Direct socket sanity (embedded editor's in-process socket):
  ```bash
  # while the embedded editor from above is running:
  bin/tmaxclient -s "/tmp/tmax-$(id -u)/server" --eval '(buffer-filename)'   # /tmp/savetest.md
  bin/tmaxclient -s "/tmp/tmax-$(id -u)/server" --eval '(save-buffer)'       # Saved /tmp/savetest.md
  ```

## Notes
- The `cleanStart` flag's intent is "skip workspace restore", **not** "force
  `*scratch*`". The bare-`tmax` splash still works because `main.ts` leaves
  `currentFilename` undefined in that branch, so the guard lets the
  `buffer-switch` through.
- This is the embedded-editor analogue of the daemon/client `openFile` path,
  which already set `bufferMetadata.filename`. The bootstrap in `main.ts`
  (CHORE-44 Change 10) had diverged from `openFile` and dropped that step.
- Related: BUG-33 (`write-file-content` disk write) — this bug was upstream of
  the write primitive: `save-buffer` never reached `write-file-content` because
  `(buffer-filename)` returned nil.
