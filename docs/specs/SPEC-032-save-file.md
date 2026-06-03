# Feature: Save File via Daemon

## Feature Description
Add a `save-file` JSON-RPC method to the tmax daemon so that `tmaxclient` (or any client) can save the daemon's current buffer to disk. Also fix the existing broken `save-buffer` command handler.

## User Story
As a tmax user running `--remote` mode
I want to save the daemon's buffer to a file from the command line
So that I can persist edits made via `tmaxclient` without interacting with the editor UI

## Problem Statement
The daemon has a `save-buffer` command that's broken — it accesses `currentBuffer.content` which doesn't exist on `FunctionalTextBufferImpl`. There's no working way to save the daemon's buffer to disk from a client.

## Solution Statement
Add a `save-file` JSON-RPC method to the daemon that delegates to `Editor.saveFile()`. Optionally accept a `filename` param to save-as. Fix the existing `save-buffer` command.

## Relevant Files
Use these files to implement the feature:

- `src/server/server.ts` — Add `save-file` to the JSON-RPC switch, fix broken `save-buffer` command
- `src/editor/editor.ts` — Has `saveFile(filename?)` method at line 1894, already handles content extraction, file writing, and status messages
- `src/server/serialize.ts` — Serialization helpers (for returning updated state after save)
- `bin/tmaxclient` — Client CLI, needs `--save` and `--save-as` flags

## Implementation Plan
### Phase 1: Fix broken `save-buffer` command
The existing `save-buffer` at line 462 of server.ts accesses `this.editor.getState().currentBuffer.content` — this is wrong because `currentBuffer` is a `FunctionalTextBufferImpl`, not a plain object. Replace it with a call to `this.editor.saveFile()`.

### Phase 2: Add `save-file` JSON-RPC method
Add a new `save-file` method that:
- Accepts optional `filename` param
- Calls `this.editor.saveFile(filename)`
- Returns serialized state (so remote clients see the updated status message)

### Phase 3: Add `--save` / `--save-as` flags to tmaxclient
Add convenience flags to the client CLI for saving.

## Step by Step Tasks

### Fix `save-buffer` command handler
- In `src/server/server.ts`, replace the broken `save-buffer` case with a call to `this.editor.saveFile()`
- Return the serialized state with the status message

### Add `save-file` JSON-RPC method
- Add `case 'save-file'` in the `processRequest` switch
- Create `handleSaveFile` method that calls `this.editor.saveFile(params.filename)`
- Return serialized state via `editorStateToJson()`

### Add `--save` and `--save-as` flags to tmaxclient
- Add `--save` flag: sends `save-file` with no filename (saves to current filename)
- Add `--save-as FILE` flag: sends `save-file` with the given filename
- Update help text

### Validation
- Restart daemon, insert text, save via tmaxclient, verify file exists on disk

## Testing Strategy
### Unit Tests
- Test `handleSaveFile` with a filename
- Test `handleSaveFile` without filename (should fail if no current filename set)
- Test `handleSaveFile` after opening a file (should save to that file)

### Integration Tests
- Start daemon, open file, insert text, save via tmaxclient, read file to verify content

### Edge Cases
- Save with no buffer loaded
- Save with no filename set and none provided
- Save to a new file (save-as)
- Save when the daemon's editor state has been modified by both keypress and client commands

## Acceptance Criteria
- `tmaxclient --save` saves the daemon's buffer to the current file
- `tmaxclient --save-as ./tmp/test.txt` saves to a specific path
- The saved file contains the exact buffer content
- The daemon's status message updates to "Saved <filename>"
- The remote tmax UI reflects the updated status on next keypress
- The existing `save-buffer` command no longer crashes

## Validation Commands
- `bun bin/tmaxclient --eval '(buffer-text)'` — verify buffer has content
- `bun bin/tmaxclient --save-as ./tmp/test-save.txt` — save to file
- `cat tmp/test-save.txt` — verify file contents match buffer
- `bun bin/tmaxclient --command server-info` — verify daemon still running

## Notes
- The `Editor.saveFile()` method already handles all the edge cases (no buffer, no filename, write errors)
- The daemon must have a `currentFilename` set (via `open` or `save-as`) for `--save` to work
- `save-file` returns serialized state so remote clients pick up the status message change immediately
