# ADR 0080: Major mode auto-detection on buffer open

**Date**: 2026-06-11
**Status**: Accepted

## Context

Major modes (markdown, typescript, python, etc.) are registered via T-Lisp `require-module` calls in `normal.tlisp`, which is loaded lazily during `ensureCoreBindingsLoaded()`. Two code paths opened buffers without triggering `(major-mode-auto-detect)`:

1. **Startup path** (`src/main.tsx`): Files are loaded in Phase 4 by directly setting editor state via `editor.setEditorState(initialState)`. Core bindings load later in Phase 5 via `server.startEditor()`. No deferred mode detection ran after modes were registered.

2. **find-file-open** (`src/tlisp/core/commands/find-file.tlisp`): The `find-file-open` function creates a buffer, switches to it, sets the filename, and inserts content — but never called `(major-mode-auto-detect)`. This affected `gx` link-following in markdown, `:find-file`, and `SPC f f`.

The daemon/client path was unaffected because `startEditor()` runs before clients can open files.

Relevant files:
- `src/main.tsx` (Phase 4 file loading vs Phase 5 core bindings)
- `src/tlisp/core/commands/find-file.tlisp` (`find-file-open` function)
- `src/editor/api/major-mode-ops.ts` (mode registry and auto-detection)
- `src/editor/editor.ts` (`activateMajorModeForFile`)

## Decision

1. **Startup path**: After `server.startEditor()` completes in Phase 5, call `editor.activateMajorModeForFile(filename)` if a file was loaded in Phase 4. This ensures mode auto-detection runs with a populated mode registry.

2. **find-file-open**: Add `(major-mode-auto-detect)` after `set-buffer-filename` in both branches of `find-file-open` (existing file and new file). This ensures any code path that opens a file through T-Lisp activates the correct major mode.

## Consequences

### Positive

- Opening any file via any path (startup, `:find-file`, `SPC f f`, `gx` link-following) now activates the correct major mode
- Mode-specific features (syntax highlighting, key bindings, indent rules) work immediately in all cases
- The fix is minimal — one TypeScript call and one T-Lisp call per branch

### Negative

- `(major-mode-auto-detect)` runs an extra time if `openFile()` is called (which already calls `activateMajorModeForFile`), but this is idempotent and cheap

### Neutral

- Any future code path that opens buffers must include `(major-mode-auto-detect)` after setting the buffer filename — this is now an implicit contract rather than a centralized guarantee
