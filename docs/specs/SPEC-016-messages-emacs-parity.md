# Feature: Emacs-Parity *Messages* Buffer

## Feature Description
Upgrade the `*Messages*` buffer from a flat append-only log to an Emacs-caliber message subsystem with severity levels, configurable capacity (ring buffer), `format`-style `(message ...)`, command context in error messages, command history access, and first-class buffer visitation so users and the AI harness can switch to, search, and filter messages like any other buffer.

## User Stories

### US-1: Severity-Aware Logging
**As a** tmax user (human or AI agent)
**I want** messages categorized by severity (debug, info, warn, error)
**So that** I can filter noise and focus on warnings/errors when debugging

**Acceptance Criteria:**
- [ ] `(message "text")` logs at `:info` level by default
- [ ] `(log-message :level "text")` logs at an explicit level (`:debug`, `:info`, `:warn`, `:error`)
- [ ] `(message-log-level)` returns the current minimum level
- [ ] `(set-message-log-level :warn)` suppresses `:debug` and `:info` from the buffer
- [ ] Unbound keys log at `:debug` (suppressed by default)
- [ ] Command errors log at `:error`
- [ ] File open/save log at `:info`

### US-2: Ring Buffer with Configurable Max
**As a** developer running long editing sessions
**I want** the *Messages* buffer to cap its size
**So that** memory doesn't grow unbounded and the buffer stays performant

**Acceptance Criteria:**
- [ ] Default max is 1000 entries (`message-log-max`)
- [ ] When max is exceeded, oldest entries are evicted (ring behavior)
- [ ] `(set-message-log-max N)` changes the cap at runtime
- [ ] Setting max to `nil` or `0` disables logging
- [ ] Current implementation's O(n) buffer rebuild is replaced with efficient append

### US-3: Format-Style `(message ...)`
**As a** T-Lisp author
**I want** `(message "Opened %s" filename)` to produce formatted strings
**So that** message calls are concise and match Emacs convention

**Acceptance Criteria:**
- [ ] `(message "Saved %s (%d bytes)" name size)` produces `"Saved foo.txt (1024 bytes)"`
- [ ] `%s` → string, `%d` → integer, `%%` → literal `%`
- [ ] When no format directives are present, args are joined with spaces (backward-compatible)

### US-4: Visit *Messages* as a First-Class Buffer
**As a** tmax user
**I want** to switch to `*Messages*` via the buffer switcher, scroll, and search it
**So that** I can review editor history interactively

**Acceptance Criteria:**
- [ ] `*Messages*` appears in `(buffer-list)` completion candidates
- [ ] Switching to it shows the full message log with timestamps and level prefixes
- [ ] The buffer is read-only (insert/delete operations are rejected)
- [ ] `(clear-messages)` empties the buffer

### US-5: Daemon Query with Level Filtering
**As a** tmax-pilot / AI harness user
**I want** to query messages filtered by severity
**So that** automated workflows can detect errors without parsing the full log

**Acceptance Criteria:**
- [ ] `query messages` returns all messages (current behavior, unchanged)
- [ ] `query messages?level=error` returns only error-severity messages
- [ ] `query messages?last=10` returns the last 10 messages
- [ ] Response includes `level` and `timestamp` fields per entry

### US-6: Command Context in Error Messages
**As a** tmax user
**I want** error messages in `*Messages*` to include which command caused them
**So that** I can trace a transient error back to its source

**Acceptance Criteria:**
- [ ] When a T-Lisp command signals an error, `*Messages*` logs `[error] [command-name] error-message`
- [ ] `(last-command)` returns the symbol name of the most recently executed command
- [ ] `executeCommand` in editor.ts already sets `state.lastCommand` — extend `logMessage` to read it when level is `error`
- [ ] Example: M-x `cursor-position` with a bug logs `[error] [cursor-position] Wrong number of arguments`

### US-7: Command History Access
**As a** tmax user
**I want** to review recently executed M-x commands
**So that** I can recall what I ran and reproduce or investigate issues

**Acceptance Criteria:**
- [ ] `(command-history)` returns the list of recently executed command names (from the existing `command-history` minibuffer history)
- [ ] `M-p`/`M-n` in the M-x minibuffer already recall history — no changes needed there
- [ ] `*Messages*` logs M-x invocations at `:debug` level: `[debug] M-x command-name`

### US-8: Quick View Messages Command
**As a** tmax user
**I want** a single command to jump to `*Messages*` to review what just flashed by
**So that** I don't have to navigate the buffer switcher for my most common debugging workflow

**Acceptance Criteria:**
- [ ] `(view-messages)` switches to `*Messages*` buffer directly
- [ ] Bound to a key (e.g. `SPC h e` or similar, matching Emacs's `C-h e`)
- [ ] Equivalent to `(buffer-switch "*Messages*")` but also scrolls to bottom (newest messages visible)

## Problem Statement
The current `*Messages*` buffer is a flat, unbounded, append-only array with no severity filtering, no format strings, no command context in errors, and a costly full-buffer rebuild on every log call. Error messages are logged as plain strings with no indication of which command caused them, making it impossible to correlate "I saw an error flash by" with "which M-x command caused it." There is no quick way to jump to the messages buffer.

## Solution Statement
Introduce a `MessageLog` class in TypeScript that manages a ring buffer of `{ timestamp, level, text, command? }` entries with level filtering and command context. Update `logMessage()` to use it and attach the current `lastCommand` to error entries. Extend the T-Lisp API with `(message ...)`, `(log-message ...)`, `(message-log-level)`, `(set-message-log-level ...)`, `(message-log-max)`, `(set-message-log-max ...)`, `(clear-messages)`, `(command-history)`, `(last-command)`, and `(view-messages)`. Log M-x invocations at debug level. Wire `*Messages*` into the buffer list as a read-only buffer. Add level/tail query params to the daemon.

## Relevant Files

- `src/editor/editor.ts` — `logMessage()`, `messages[]`, `*Messages*` buffer creation (lines 68, 162-163, 2237-2244), `executeCommand` sets `state.lastCommand` (line 2028), `executeCommandAsync` sets `state.lastCommand` (line 2070)
- `src/editor/tlisp-api.ts` — `(messages-buffer)`, `(message)` functions (lines 616-638), `lastCommand` getter/setter (line 259)
- `src/editor/api/file-ops.ts` — `logMessage` callback in file operations (line 46)
- `src/server/server.ts` — `query messages` handler (line 1389-1392), `logMessage` calls (lines 221, 449, 558, 852)
- `src/editor/handlers/normal-handler.ts` — `logMessage` calls for unbound keys and errors (lines 73, 83, 103, 142, 162)
- `src/editor/handlers/command-handler.ts` — `logMessage` calls (lines 93, 108, 114, 124)
- `src/editor/handlers/visual-handler.ts` — `logMessage` calls (lines 22, 28, 46)
- `src/editor/handlers/insert-handler.ts` — `logMessage` calls (lines 66, 72, 82)
- `src/tlisp/core/commands/buffers.tlisp` — buffer list/switch commands, `*Messages*` must appear in completion
- `src/tlisp/core/commands/execute-extended-command.tlisp` — M-x accept function `execute-extended-command-accept` (line 33-35) — add debug log here
- `src/tlisp/core/completion/minibuffer.tlisp` — `command-history` minibuffer history (line 6), `minibuffer-history-values` (line 8-10)
- `src/editor/handlers/mx-handler.ts` — M-x key dispatch, no `logMessage` calls currently
- `test/unit/editor.test.ts` — existing editor tests

### New Files
- `src/editor/message-log.ts` — `MessageLog` class (ring buffer, level filtering, command context, rendering)
- `src/tlisp/core/commands/messages.tlisp` — `(view-messages)`, `(command-history)` commands and key bindings

## Implementation Plan

### Phase 1: Foundation — MessageLog Class
Extract message storage from `Editor` into a dedicated `MessageLog` class with ring buffer, severity levels, command context, and efficient buffer sync.

### Phase 2: Core Implementation — T-Lisp API & Format Strings
Wire `MessageLog` into the editor, update all `logMessage` call sites with severity levels, add format-string support to `(message ...)`, attach command context to errors.

### Phase 3: Integration — Buffer Visitation, Command History, Daemon Query
Make `*Messages*` a first-class buffer with read-only guard, add `(view-messages)`, `(command-history)`, `(last-command)`, log M-x invocations, extend daemon query with filtering.

## Step by Step Tasks

### Create `MessageLog` class
- Create `src/editor/message-log.ts` with a `MessageLog` class
- Properties: `entries: MessageEntry[]`, `maxSize: number` (default 1000), `minLevel: LogLevel`
- `MessageEntry = { timestamp: string, level: LogLevel, text: string, command?: string }`
- `LogLevel = 'debug' | 'info' | 'warn' | 'error'` with numeric ordering (debug=0 < info=1 < warn=2 < error=3)
- Methods:
  - `log(level, text, command?)` — append entry (respecting minLevel), evict oldest if over maxSize, return `void`
  - `render()` — return all entries as a single string. Format for entries with command: `[HH:MM:SS] [LEVEL] [command] text`. Format without command: `[HH:MM:SS] [LEVEL] text`
  - `getEntries(options?)` — return entries, optionally filtered by `{ level?, last? }`
  - `clear()` — empty entries
  - `setMax(n)` / `getMax()` — configure ring size
  - `setMinLevel(level)` / `getMinLevel()` — configure filter
- **Verify:** unit test for ring eviction, level filtering, render format, command context

### Wire MessageLog into Editor
- In `src/editor/editor.ts`:
  - Replace `private messages: string[] = []` with `private messageLog = new MessageLog()`
  - Update `logMessage(msg)` signature to `logMessage(msg: string, level: LogLevel = 'info', command?: string)`
  - `logMessage` delegates to `this.messageLog.log(level, msg, command)`
  - In `executeCommand` / `executeCommandAsync`: when logging errors, pass `this.state.lastCommand` as the command context
  - Update `*Messages*` buffer content via `this.messageLog.render()`
  - Expose `messageLog` getter for daemon/TLisp access
- **Verify:** `bun run typecheck:src` passes

### Update all `logMessage` call sites with severity levels
- `editor.ts:2041,2044` — T-Lisp eval errors → `logMessage(msg, 'error', this.state.lastCommand)` (attaches command context)
- `editor.ts:2063,2101` — status message echoes → `'info'`
- `editor.ts:2312` — file opened → `'info'`
- `editor.ts:2327` — file open failure → `'error'`
- `editor.ts:2358` — file saved → `'info'`
- `editor.ts:177` — welcome → `'info'`
- `normal-handler.ts:73,83` — unbound keys → `'debug'`
- `normal-handler.ts:103,142,162` — command errors → `'error'`
- `command-handler.ts:93,124` — command errors → `'error'`
- `command-handler.ts:108,114` — unbound keys → `'debug'`
- `visual-handler.ts:22,28` — unbound keys → `'debug'`
- `visual-handler.ts:46` — command errors → `'error'`
- `insert-handler.ts:66,72` — unbound keys → `'debug'`
- `insert-handler.ts:82` — command errors → `'error'`
- `server.ts:221,449,558,852` — frame/server events → `'info'`
- **Verify:** `bun run typecheck:src` passes

### Add format-string support to `(message ...)`
- In `src/editor/tlisp-api.ts`, update the `'message'` handler:
  - If first arg is a string containing `%s`, `%d`, or `%%`, treat it as a format string
  - Substitute `%s` → next arg as string, `%d` → next arg as integer, `%%` → literal `%`
  - If no format directives, join all args with spaces (backward-compatible)
- **Verify:** unit test: `(message "Saved %s" "foo.txt")` → `"Saved foo.txt"`, `(message "hello" "world")` → `"hello world"`

### Add new T-Lisp functions
- In `src/editor/tlisp-api.ts`, add:
  - `(log-message LEVEL TEXT)` — log at explicit level, set status only for `:info` and above
  - `(message-log-level)` → returns current min level as keyword
  - `(set-message-log-level LEVEL)` → sets min level
  - `(message-log-max)` → returns current max
  - `(set-message-log-max N)` → sets max
  - `(clear-messages)` → clears the buffer
  - `(last-command)` → returns `state.lastCommand` (expose existing state as T-Lisp primitive)
- **Verify:** `bun run typecheck:src` passes

### Make `*Messages*` a first-class buffer
- Ensure `*Messages*` appears in `(buffer-list)` (it already has buffer metadata)
- Add read-only guard: in the editor's buffer mutation functions (`insertText`, `deleteText`), check if current buffer name is `*Messages*` and reject with a status message
- **Verify:** switching to `*Messages*` via buffer switcher works, typing is rejected

### Add `(command-history)` and `(view-messages)` commands
- Create `src/tlisp/core/commands/messages.tlisp`:
  - `(command-history)` — returns `(minibuffer-history-values "command-history")` from the existing minibuffer history
  - `(view-messages)` — switches to `*Messages*` buffer and scrolls to bottom (newest messages visible)
  - `(view-messages)` implementation: `(progn (buffer-switch "*Messages*") (cursor-move (buffer-line-count) 0))`
  - Key binding for `(view-messages)` in normal mode (e.g. `SPC h e` or suitable prefix)
- **Verify:** `bun run typecheck:src` passes, M-x `view-messages` works

### Log M-x invocations at debug level
- In `src/tlisp/core/commands/execute-extended-command.tlisp`, update `execute-extended-command-accept`:
  - Before `(invoke-command name)`, call `(log-message :debug (concat "M-x " name))`
- This uses the existing `(log-message)` T-Lisp function, keeping it in T-Lisp land per architecture rules
- **Verify:** with `(set-message-log-level :debug)`, M-x commands appear in `*Messages*`

### Extend daemon `query messages` with filtering
- In `src/server/server.ts`, update `case 'messages'`:
  - Accept optional `params.level` — filter to entries >= that level
  - Accept optional `params.last` — return only the last N entries
  - Return `{ messages: [{ timestamp, level, text, command? }] }` instead of plain strings
- **Verify:** `bun run typecheck:src` passes

### Write tests
- Unit tests for `MessageLog` (ring eviction, level filtering, render, clear, setMax, setMinLevel, command context)
- Unit test for format-string `(message ...)`
- Unit test for `(log-message ...)`, `(clear-messages)`, level/max getters/setters
- Unit test for `(last-command)` returning the most recently executed command
- Unit test for `(command-history)` returning M-x history
- Unit test for read-only guard on `*Messages*`
- **Verify:** `bun test` passes with zero regressions

### Run validation
- `bun run typecheck:src && bun run typecheck:test && bun run typecheck`
- `bun test`
- `bun run build`

## Testing Strategy

### Unit Tests
- `MessageLog` ring buffer: push N+1 entries when max=N, verify oldest evicted
- `MessageLog` level filtering: set min level to `warn`, push `info` and `error`, verify only `error` stored
- `MessageLog` render format: verify `[HH:MM:SS] [info] text` output
- `MessageLog` command context: render entry with command → `[HH:MM:SS] [error] [my-cmd] error text`
- Format string: `(message "Saved %s (%d bytes)" "file.txt" 42)` → `"Saved file.txt (42 bytes)"`
- Backward compat: `(message "hello")` → `"hello"`, `(message "a" "b")` → `"a b"`
- Read-only guard: insert into `*Messages*` rejected with status message
- `(clear-messages)` empties the buffer
- `(set-message-log-max 0)` disables logging
- `(last-command)` returns the last executed command symbol
- `(command-history)` returns the list of M-x command names

### Integration Tests
- Open file → `*Messages*` contains `[info] Opened <file>`
- Trigger error → `*Messages*` contains `[error] [command-name] error text`
- Set log level to `:warn` → debug/info entries stop appearing
- M-x invocation with debug level enabled → `*Messages*` contains `[debug] M-x command-name`

### Edge Cases
- Empty format string: `(message "")`
- More `%s` directives than args — substitute with empty string
- Ring buffer at exactly max capacity (no eviction yet)
- `(set-message-log-max 0)` then `(set-message-log-max 100)` — logging resumes
- Error with no command context (e.g. file open failure) → render without `[command]` bracket

## Acceptance Criteria
- `*Messages*` uses a ring buffer capped at a configurable maximum (default 1000)
- Messages have severity levels (`debug`, `info`, `warn`, `error`) with configurable minimum display level
- `(message "Saved %s" filename)` produces formatted output with `%s`/`%d`/`%%` support
- Error messages include command context: `[error] [command-name] error text`
- `*Messages*` appears in buffer-list completion and is visitable but read-only
- `(clear-messages)` empties the buffer
- `(view-messages)` switches to `*Messages*` and scrolls to newest entries
- `(command-history)` returns recently executed M-x command names
- `(last-command)` returns the most recently executed command symbol
- M-x invocations are logged at debug level
- `query messages` supports `level` and `last` filtering params
- `bun test` passes with zero regressions
- `bun run typecheck` passes with zero errors
- `bun run build` succeeds

## Validation Commands
- `bun run typecheck:src` — zero type errors in source
- `bun run typecheck:test` — zero type errors in tests
- `bun run typecheck` — full typecheck passes
- `bun test` — all tests pass with zero regressions
- `bun run build` — build succeeds

## Notes
- The existing `(messages-buffer)` function returns the rendered text — unchanged API, enriched content
- Default `minLevel` should be `'info'` so debug messages (including M-x invocations) are hidden until explicitly enabled
- The `MessageLog` class should live in `src/editor/` (TypeScript primitive) per the editor CLAUDE.md rule — it manages buffer state, not editor logic
- `(command-history)` and `(view-messages)` are T-Lisp commands in `messages.tlisp`, not TypeScript primitives — they compose existing buffer/history primitives
- `(last-command)` is a thin TypeScript primitive exposing the existing `state.lastCommand` field
- M-x logging uses `(log-message :debug ...)` in T-Lisp, not a TypeScript hook — this follows the architecture rule that editor decisions belong in T-Lisp
- Future: `(message-log-level)` could be set per-frame for multi-client observability
- Future: persist messages to disk across sessions (out of scope for this spec)
