# Bug: :wq / :w race the async save — data loss on quit

## Bug Description
`:wq`/`:x` was `(progn (file-save) (editor-quit))`, and `file-save` is
fire-and-forget — it calls `this.saveFile().catch(...)` and returns `"saving..."`
immediately, without awaiting. So `editor-quit` ran before the write resolved,
losing data on slow/erroring writes. The same race affects `:w` immediately
followed by `:q`.

## Problem Statement
`:wq` and `:w`-then-`:q` must persist the buffer before quitting.

## Solution Statement
Route `:w`/`:w!` and `:wq`/`:x` (in `command-line.tlisp`) through `save-buffer`
instead of `file-save`. `save-buffer` is **synchronous** (it writes via
`write-file-content`, made sync by #45), so the save completes before the next
form (`editor-quit`) runs. Write failures surface as errors (write-file-content
`Either.left`); the no-filename path shows a message and returns normally (a
known behavioral gap — `:wq` on an unnamed buffer still quits; see Notes).

`file-save` remains available as the async TS primitive for direct callers; only
the `:w`/`:wq` command-line dispatch changed to the sync path.

Codex APPROVE-WITH-CONCERNS honored: the async-let approach can't run in the
synchronous command dispatch (`executeCommand`), so the sync `save-buffer` path
is used instead (the write is synchronous, no awaiting needed). Errors surface
via `save-buffer` throwing.

## Steps to Reproduce
```bash
# buffer with a large/slow write:
:wq       # today: editor-quit races the async write -> file may be stale/empty
```

## Root Cause Analysis
`file-save` returned before the async `saveFile()` resolved; `editor-quit`
didn't wait. Sync eval can't `await`, so the fix is a sync write path
(`save-buffer` → `write-file-content`, #45).

## Relevant Files
- `src/tlisp/core/commands/command-line.tlisp:65-72` — `:w`/`:w!`/`:wq`/`:x` use `save-buffer` (sync).
- `test/integration/wq-save-gate.test.ts` — `:w` dispatch persists the buffer to disk.

## Step by Step Tasks
### Task 1 — :w/:wq use the sync save path
**AC**: `:w` and `:wq` route through `save-buffer` (sync) not `file-save` (async); the file is persisted before the next command runs.
### Task 2 — regression test
**AC**: a test sets a buffer filename + content, runs `(editor-dispatch-command-line "w")`, and asserts the file on disk contains the content.
### Task 3 — Validate
verify-gate PASS.

## Validation Commands
- daemon: `(set-buffer-filename "/tmp/x")` + `(buffer-insert "m")` + `(editor-dispatch-command-line "w")` ⇒ `/tmp/x` contains `m`.
- `bun test test/integration/wq-save-gate.test.ts`.

## Notes
- `file-save` (async) remains for direct callers; only the `:w`/`:wq` dispatch changed.
- Depends on #45 (sync write-file-content) + #49 (save-buffer chain) — both landed.
- Known gap (verify-gate): `:wq` on an unnamed buffer still quits — save-buffer returns normally on no-filename (message + return-from), so editor-quit runs. A future fix could make save-buffer signal failure on no-filename so :wq aborts.
- The sync write (`fs.writeFileSync`) blocks the daemon eval thread for the duration of the write — the accepted tradeoff for closing the data-loss race (deferred to #43/#46 Phase-2 for the async/non-blocking path).
