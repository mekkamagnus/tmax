# Interactive find-file Command

## Status

Accepted

## Context

`find-file` was a T-Lisp function that required a `path` argument: `(defun find-file (path) ...)`. When invoked via M-x (`execute-extended-command`), the `invoke-command` primitive called `(find-file)` with zero arguments, producing the error: `lambda expects 1-1 arguments, got 0`.

The `:e` command in `editor-execute-command-line` was also unimplemented (line 110: `"Edit ${filename} not implemented yet"`).

There was no way for a user to open a file through the minibuffer — the only options were command-line arguments or direct T-Lisp evaluation.

## Decision

Make `find-file` interactive following the `switch-buffer` / `dired` pattern:

- **`&optional path`** — The parameter is now optional. When called without a path, it opens a minibuffer with `completing-read` prompting "Find file: ".
- **`find-file-accept`** — Minibuffer accept handler that calls `find-file-open` with the user's input.
- **`find-file-open`** — Extracted core logic that opens a file into a buffer. Handles both existing files (read + insert) and new files (create empty buffer).
- **`set-buffer-modified-p false`** — Fixed `nil` to `false` (the function requires a boolean).

The M-x flow now works: `SPC ;` → type `find-file` → Enter → minibuffer prompts for path → type path → Enter → file opens.

## Consequences

- `find-file` works both as a programmatic API `(find-file "/path")` and as an interactive M-x command.
- The `dired` module's `(find-file (concat ...))` call continues to work unchanged.
- New file creation is supported (empty buffer with "New file" message).
