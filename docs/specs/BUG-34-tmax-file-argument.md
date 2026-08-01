# Bug: `tmax <file>` drops the filename and resumes the last workspace

## Bug Description
When a daemon is running AND `~/.config/tmax/last-workspace` exists,
`tmax somefile.txt` execs the TUI client on the LAST workspace and **silently
drops** `somefile.txt` — the user lands in a completely different buffer. The
guard at `bin/tmax:301` resumed the last workspace whenever there was no `-w`
flag, with no check for file arguments; and `bin/tmaxclient`'s `--tui` branch
parsed positional filenames but discarded them when spawning the TUI.

The no-daemon path (`bin/tmax:308` → embedded `src/main.ts`) does open the file,
so the bug is specifically the daemon-running + last-workspace case.

## Problem Statement
`tmax <file>` must reliably open the named file whether or not a daemon and a
last-workspace are present.

## Solution Statement
1. **`bin/tmax`** — gate last-workspace persistence on `FILES` being empty
   (SPEC-040 scopes persistence to the bare `tmax` case). When files ARE given
   and a daemon is running, route them through the daemon (`tmaxclient --tui
   <files>`) instead of resuming the last workspace. The embedded-editor
   fallback remains only for the no-daemon case.
2. **`bin/tmaxclient`** — in `--tui` mode, open positional files via the
   `openFile` RPC **before** spawning the TUI, so the file is opened in the
   daemon and the TUI attaches to it (was: filenames parsed then dropped).

Codex review (APPROVE-WITH-CONCERNS) honored: "route files through the running
daemon and ensure the TUI attaches to that same workspace/frame; add automated
coverage for both `tmax file` and direct `tmaxclient --tui file`." Files now go
through the daemon's `open` RPC; the empirical daemon repro covers both paths.

## Steps to Reproduce
```bash
# daemon running + last-workspace populated:
bin/tmax /tmp/notes.txt     # today: opens LAST workspace, /tmp/notes.txt dropped
bin/tmaxclient --list-buffers   # today: /tmp/notes.txt absent
```

## Root Cause Analysis
`bin/tmax:301` resumed last-workspace on `(no -w) AND (last-ws file) AND
(daemon running)` — missing the `FILES empty` condition. `bin/tmaxclient:587`
tuiMode spawned the TUI without acting on `filenames`, so even routing through
`tmaxclient --tui file` would have dropped it.

## Relevant Files
- `bin/tmax:299-313` — FILES-empty guard on last-workspace resume; new "open via daemon" branch.
- `bin/tmaxclient:587-606` — open positional files via openFile RPC before spawning the TUI.

## Step by Step Tasks
### Task 1 — bin/tmax FILES routing
**AC**: with a daemon running + last-workspace populated + a file arg, `bash -x bin/tmax <file>` reaches the `tmaxclient --tui <file>` branch (not the last-workspace `exec`); `tmaxclient --list-buffers` includes the file afterward.
### Task 2 — tmaxclient --tui opens files
**AC**: `tmaxclient -s <socket> --tui <file>` issues an openFile RPC for `<file>` before spawning the TUI (so the buffer is open when the TUI attaches).
### Task 3 — no regressions
**AC**: bare `tmax` (no args, daemon running, last-workspace) still resumes last workspace; `tmax <file>` with no daemon still opens the embedded editor with the file.
### Task 4 — Validate
empirical daemon repro (both `bin/tmax <file>` and `tmaxclient --tui <file>`); verify-gate PASS.

## Validation Commands
- `bin/tmaxclient --help` exits 0 (syntax sanity for the edited TS launcher).
- With a daemon running + `~/.config/tmax/last-workspace` set: `bin/tmax /tmp/bug34.txt` then `bin/tmaxclient --list-buffers` includes `/tmp/bug34.txt`.
- `bin/tmaxclient -s <socket> --tui /tmp/bug34.txt` opens the file (buffer present in `--list-buffers`).
- Bare `bin/tmax` (no args) with daemon + last-workspace still resumes the last workspace.

## Notes
- The TUI client itself (`src/client/tui-client.ts`) not accepting a file arg is a separate, deeper gap (audit finding); this fix opens the file via RPC before the TUI attaches, so the buffer is present regardless.
- `bin/tmax` and `bin/tmaxclient` are not in the `tsconfig.src`/`tsconfig.test` typecheck roots; validation is empirical (daemon repro) + a launcher syntax check.
