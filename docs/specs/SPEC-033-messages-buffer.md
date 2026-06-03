# Feature: *Messages* Buffer

## Feature Description
A special `*Messages*` buffer (like Emacs) that logs editor events: status messages, errors, warnings, mode changes, T-Lisp evaluation results, file operations, and unbound keys. Provides AI harness observability via `tmax-pilot show messages` and user visibility inside the editor.

## User Story
As a tmax user (human or AI agent)
I want a *Messages* buffer that records editor events
So that I can review what happened, debug issues, and understand editor behavior

## Problem Statement
Currently status messages and errors appear only transiently in the status line and are lost. There is no log of editor activity, making debugging and AI harness observability difficult.

## Solution Statement
Add a `*Messages*` buffer to the editor's buffer map. Introduce a `logMessage(message: string)` method on the Editor class that appends timestamped lines to this buffer. Hook into all places that currently set `statusMessage` to also call `logMessage`. Expose it via T-Lisp (`(messages-buffer)`) and the daemon server (`query messages`).

## Relevant Files

- `src/editor/editor.ts` — Add `logMessage()` method, create `*Messages*` buffer at init, hook into `setEditorState`
- `src/editor/handlers/normal-handler.ts` — Log unbound keys, command errors, which-key events
- `src/editor/handlers/insert-handler.ts` — Log unbound keys, command errors
- `src/editor/handlers/command-handler.ts` — Log command execution, errors
- `src/editor/handlers/mx-handler.ts` — Log M-x completions, errors
- `src/editor/handlers/visual-handler.ts` — Log unbound keys, errors
- `src/editor/tlisp-api.ts` — Log T-Lisp eval results, status message changes
- `src/server/server.ts` — Add `query messages` handler, create `*Messages*` buffer in server init
- `src/core/types.ts` — No changes needed (uses existing buffer mechanism)

### New Files
- None (uses existing buffer infrastructure)

## Implementation Plan

### Phase 1: Foundation
Add `logMessage()` to Editor and create the `*Messages*` buffer.

### Phase 2: Integration
Hook `logMessage` into all statusMessage write sites across handlers and T-Lisp API.

### Phase 3: Daemon/T-Lisp Access
Expose via daemon query and T-Lisp function so tmax-pilot can read it.

## Step by Step Tasks

### Add logMessage to Editor and create *Messages* buffer

**User Story**: As the editor core, I want a persistent message log buffer so that all events can be recorded.

- Add `private messages: string[]` array to Editor class
- In constructor or init, call `this.createBuffer('*Messages*', '')` 
- Add `logMessage(msg: string): void` method that:
  - Prepends timestamp: `[HH:MM:SS] msg`
  - Appends to `messages` array
  - Updates the `*Messages*` buffer content with all messages joined by newlines
- Add T-Lisp function `(messages-buffer)` that returns the messages text
- Add T-Lisp function `(message FORMAT-ARGS...)` that logs AND sets statusMessage (like Emacs)

**Acceptance Criteria**:
- [ ] `*Messages*` buffer exists after editor init
- [ ] `logMessage("test")` adds a timestamped line to the buffer
- [ ] `(messages-buffer)` T-Lisp function returns all logged messages

### Hook logMessage into handlers

**User Story**: As a user, I want all status messages and errors logged so I can review them later.

- In each handler (normal, insert, command, mx, visual), wherever `state.statusMessage = ...` is set, also call `(editor as any).logMessage(msg)`
- Log these categories:
  - Unbound keys (all modes)
  - Command errors (all modes)
  - Mode changes (when mode changes)
  - File open/save operations
  - T-Lisp evaluation errors
  - Count prefix changes
- In `editor.ts`, log in `openFile` and `saveFile`
- In `tlisp-api.ts`, log when status message is set via T-Lisp

**Acceptance Criteria**:
- [ ] Pressing an unbound key logs "Unbound key: x" to *Messages*
- [ ] Command errors are logged
- [ ] File opens log "Opened <filename>"
- [ ] Mode changes log "Mode: normal -> insert"

### Add daemon query for messages

**User Story**: As tmax-pilot, I want to query the messages buffer so I can observe editor behavior.

- In `server.ts`, add `case 'messages':` to `handleQuery` that returns messages array
- Update `tmaxclient` to support `--messages` flag
- Update `tmax-pilot.sh` to support `show messages` command

**Acceptance Criteria**:
- [ ] `tmaxclient --eval '(messages-buffer)'` returns messages text
- [ ] `tmax-pilot show messages` works

### Test with tmax-pilot

**User Story**: As a developer, I want to verify the feature works end-to-end.

- Start daemon, open a file, trigger various events, check messages buffer
- Verify messages accumulate correctly

**Acceptance Criteria**:
- [ ] *Messages* buffer contains events from session
- [ ] No regressions in test suite

## Testing Strategy

### Unit Tests
- Test `logMessage` adds timestamped line
- Test `*Messages*` buffer content updates
- Test `(messages-buffer)` T-Lisp function

### Integration Tests
- Test unbound key logs to messages
- Test command error logs to messages
- Test file open/save logs

### Edge Cases
- Empty messages buffer at start
- Very long messages
- Rapid successive messages

## Acceptance Criteria
- `*Messages*` buffer created at editor init with empty content
- All statusMessage writes also log to *Messages*
- `tmax-pilot show messages` displays the log
- `bun test` passes with zero regressions

## Validation Commands
- `bun test` — zero regressions
- `tmax-pilot start-daemon && tmax-pilot open /tmp/test.txt && tmax-pilot eval '(messages-buffer)'` — shows startup messages
- `tmax-pilot key x && tmax-pilot show messages` — shows "Unbound key: x"
- `tmax-pilot stop-daemon` — cleanup

## Notes
- Keep messages in memory only (not persisted to disk)
- Messages buffer is read-only for now (users shouldn't edit it)
- Future: add `(clear-messages)` T-Lisp function
- Future: configurable message level filtering
