# ADR 0007: Message Buffer Observability

**Date**: 2026-06-08
**Status**: Accepted

## Context

The `*Messages*` buffer existed as a flat string array (`messages: string[]`) in the editor state. All log entries were unstructured text with no severity levels, no timestamps, no filtering, and no size bounds. This made the buffer useless for debugging — it grew without limit, mixed trivial notifications with real errors, and provided no way to control verbosity.

The Emacs `*Messages*` buffer supports severity-aware logging, ring-buffer truncation, level filtering, and a read-only guard that prevents accidental edits. tmax had none of these.

Relevant files:
- `src/editor/editor.ts` — owned the old `messages: string[]` and `logMessage(msg: string)`
- `src/editor/tlisp-api.ts` — exposed a single `(message ...)` function to T-Lisp
- `src/editor/api/buffer-ops.ts` — had no concept of read-only buffers
- `src/error/types.ts` — `BufferError` had no `ReadOnly` variant

## Decision

### 1. Extract `MessageLog` class with severity levels and ring buffer

Created `src/editor/message-log.ts`: a standalone `MessageLog` class with `LogLevel` (`debug | info | warn | error`), timestamped `MessageEntry` records, configurable minimum level (`minLevel`), configurable ring-buffer cap (`maxSize`, default 1000), and a `render()` method that formats entries as `[HH:MM:SS] [level] text`.

The editor's `logMessage()` signature widened from `(msg: string)` to `(msg: string, level: LogLevel, command?: string)`. All call sites now pass severity: `info` for welcome/save/open, `error` for command failures, `debug` for unbound keys.

### 2. Read-only guard on `*Messages*` buffer

Added `readonlyBuffers: Set<string>` parameter to `createBufferOps()` in `src/editor/api/buffer-ops.ts`. A `isReadonly()` helper checks if the current buffer is in the set. Four mutating operations (`buffer-insert-line`, `buffer-delete-line`, `buffer-insert-at-position`, `buffer-replace-region`) now return a `ReadOnly` `BufferError` when the current buffer is protected.

Added `ReadOnly` to the `BufferError.variant` union in `src/error/types.ts`.

### 3. T-Lisp API for message observability

Added seven new T-Lisp functions in `src/editor/tlisp-api.ts`:
- `log-message` — explicit log with level
- `message-log-level` / `set-message-log-level` — query/set minimum severity
- `message-log-max` / `set-message-log-max` — query/set ring-buffer cap
- `clear-messages` — clear the log
- `message` — upgraded to support `printf`-style format strings (`%s`, `%d`, `%%`)

### 4. T-Lisp commands and keybinding

Created `src/tlisp/core/commands/messages.tlisp` with `view-messages` (switches to `*Messages*`, scrolls to bottom) and `command-history`. Bound `C-h e` to `view-messages` in normal mode.

### 5. Server-side level-aware query

Updated `src/server/server.ts`: the `messages` RPC command now reads from `messageLog.getEntries()` and accepts `level` and `last` filter parameters instead of returning the raw `messages[]` array.

## Consequences

### Positive

- `*Messages*` is now a useful debugging tool — entries are timestamped and severity-tagged
- Level filtering lets users hide debug noise (`set-message-log-level 'warn`) or see everything (`'debug`)
- Ring buffer prevents unbounded memory growth
- Read-only guard prevents accidental edits to the log buffer
- `C-h e` provides quick access to the log (Emacs convention)
- `printf`-style format strings match Emacs `(message ...)` behavior

### Negative

- Every `logMessage` call site must specify a severity — existing callers that used `(msg: string)` were silently upgraded to `'info'` default, but future callers may misclassify
- `isReadonly()` iterates the buffer map to find the current buffer name — linear scan, negligible at current buffer counts

### Neutral

- The `MessageLog` class is standalone and testable independently of the editor, which enabled `test/unit/message-log.test.ts` without editor mocks
- The `readonlyBuffers` set is passed at construction time; adding new read-only buffers (e.g., `*scratch*`) requires only a set membership change
