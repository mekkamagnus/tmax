# Bug: Multiline Insert and TUI Stale State

## Bug Description
Two related issues in the daemon/client system:

1. **Multiline `--insert` fails**: When inserting text containing newlines via `tmaxclient --insert`, the T-Lisp string literal breaks because newlines aren't escaped. Only double quotes are escaped in `handleInsert`.

2. **TUI client shows stale state**: When other clients (tmaxclient --eval, --insert) modify the daemon's editor state, the TUI client doesn't update until the user presses a key. No polling or push mechanism exists.

## Problem Statement
- `handleInsert` in server.ts escapes `"` but not `\n`, `\r`, `\t`, or `\` in text before wrapping it in a T-Lisp string literal
- TUI client only fetches state in response to local keypress events; no periodic refresh

## Solution Statement
1. Properly escape all special characters in `handleInsert` before constructing T-Lisp string
2. Add a 200ms polling interval in TUI client that fetches state from daemon

## Steps to Reproduce

**Bug 1 - Multiline insert:**
1. Start daemon
2. Open a file
3. Insert multiline text via `tmaxclient --insert $'line1\nline2'`
4. Observe: T-Lisp parse error or broken insert

**Bug 2 - TUI stale state:**
1. Start daemon and open file
2. Launch TUI client
3. From another terminal, insert text via `tmaxclient --insert "hello"`
4. Observe: TUI doesn't update until a key is pressed

## Root Cause Analysis
- **Bug 1**: `handleInsert` does `text.replace(/"/g, '\\"')` but literal newlines break T-Lisp's string parser. Need to escape `\`, `\n`, `\r`, `\t` before `"`.
- **Bug 2**: `tui-client.ts` only calls `render()` in `stdin.on("data")` and `resize` handlers. No background refresh.

## Relevant Files

- `src/server/server.ts` — `handleInsert` method needs proper string escaping
- `src/client/tui-client.ts` — needs polling interval for state refresh

## Step by Step Tasks

### Fix multiline insert escaping

**User Story**: As a tmax-pilot user, I want to insert multiline text so that I can create documents with multiple lines.

- In `src/server/server.ts`, update `handleInsert` to escape `\`, newlines, carriage returns, tabs, and quotes before wrapping in T-Lisp string literal
- Order: escape `\` first, then `\n`, `\r`, `\t`, then `"`

**Acceptance Criteria**:
- [ ] `--insert` with newlines inserts multiple lines
- [ ] Text with backslashes, quotes, and newlines all insert correctly
- [ ] Single-line inserts still work

### Add TUI client polling

**User Story**: As a TUI user, I want to see changes made by other clients in real-time so that shared sessions work correctly.

- In `src/client/tui-client.ts`, add a `setInterval` (200ms) that calls `remote.getEditorState()` and re-renders if state changed
- Track last rendered state to avoid unnecessary re-renders
- Clear interval on cleanup

**Acceptance Criteria**:
- [ ] TUI updates within 200ms of external changes
- [ ] No unnecessary re-renders when state hasn't changed
- [ ] Clean shutdown clears the interval

### Test with tmax-pilot

**User Story**: As a developer, I want to verify both fixes work end-to-end.

- Use tmax-pilot to start daemon, open file, insert multiline text, verify via show-buffer
- Launch TUI, make changes from client, verify TUI updates

**Acceptance Criteria**:
- [ ] Multiline insert works via tmax-pilot
- [ ] TUI reflects external changes

## Validation Commands
- `bun test` — run test suite, confirm zero regressions
- Use tmax-pilot to test multiline insert end-to-end

## Notes
- Polling chosen over server-push for simplicity
- Escape order matters: `\` must be escaped first to avoid double-escaping
