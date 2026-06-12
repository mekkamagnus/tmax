# Demo Runner POSIX Shell Escaping

## Status

Accepted

## Context

The demo runner used `subprocess.list2cmdline()` to escape arguments passed to `tmaxclient`. This function produces Windows-style quoting, which does not correctly handle special characters (spaces, quotes, backslashes) on POSIX shells (macOS/Linux). Keys or text containing these characters would be misinterpreted by the shell.

## Decision

Replace `subprocess.list2cmdline([value])` with `shlex.quote(value)` for all four action types that pass user-supplied strings to the shell: `key`, `keys`, `insert`, and `command`.

## Consequences

- **Easier**: Demo playbooks work correctly with arbitrary text content and key names containing special characters.
- **No regressions**: `shlex.quote` is the standard POSIX escaping function and handles all edge cases that `list2cmdline` missed on Unix platforms.
