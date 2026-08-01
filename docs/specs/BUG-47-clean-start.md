# Bug: fresh daemons inherit leaked/garbage workspace state; no --clean escape

## Bug Description
On startup, the daemon unconditionally restored the last/most-recent workspace,
including leaked buffers (stale tmp files, expression strings, orphaned tabs
accumulated across test/crash sessions). A bare `tmax` opened to whatever
garbage was last persisted (observed: 50+ leaked buffers, stale tmp paths as
the current buffer). There was no way to start fresh without manually deleting
the workspace JSON.

## Problem Statement
A `--clean` flag must let users start a fresh daemon on `*scratch*`, skipping
the workspace restore.

## Solution Statement
1. **`--clean` flag** — threaded `bin/tmax` → `ensure_daemon` → `server.ts` entry
   → `main.ts` → `TmaxServer` ctor (5th param `cleanStart`).
2. **Skip MRU restore** — `initializeWorkspaces` skips the last-workspace restore
   block when `cleanStart` is true.
3. **Land on `*scratch*`** — `startEditor` switches the current buffer to
   `*scratch*` after workspace init when `cleanStart`, so the user starts on a
   clean buffer even if the default workspace still has leaked buffers on disk.

Codex APPROVE-WITH-CONCERNS: the `-e` expression leak claim was NOT supported
by current code (tmaxclient excludes -e values from filenames), so no name-guard
was added. Codex asked to "pick ONE startup contract" — chosen: **restore by
default** (existing behavior, SPEC-040), **--clean opt-in** for a fresh start.
The orphan-tab pruning + write-time size bounding are deferred follow-up.

## Relevant Files
- `src/server/server.ts` — `cleanStart` field + ctor param; `initializeWorkspaces` skip; `startEditor` switch to *scratch*.
- `src/main.ts` — parse `--clean` + pass to TmaxServer.
- `bin/tmax` — parse `--clean` + forward in `ensure_daemon` + help text.

## Step by Step Tasks
### Task 1 — --clean flag threaded
**AC**: `tmax --clean` / `tmax --daemon --clean` forwards to the daemon; the daemon's `cleanStart` is set.
### Task 2 — skip MRU restore + land on *scratch*
**AC**: with `--clean`, the daemon skips the last-workspace restore and the current buffer is `*scratch*` (not a stale buffer).
### Task 3 — Validate
typecheck clean + empirical verification + verify-gate PASS.

## Validation Commands
- `bun run typecheck:src`
- Start `bun src/server/server.ts --clean` → `(buffer-name)` returns `*scratch*`.
- `bin/tmax --help` shows `--clean`.

## Notes
- Out of scope (follow-up): orphan-tab pruning (remap→prune); write-time workspace JSON size bounding; the `-e` name-guard (codex: not needed, code already excludes -e values).
- Default behavior unchanged (restore-by-default, SPEC-040); --clean is opt-in.
