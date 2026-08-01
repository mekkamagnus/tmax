# Bug: write-file-content returns nil and writes nothing in the daemon (silent data loss)

## Bug Description
`write-file-content` — the T-Lisp primitive that persists buffers — returned nil
and created **no file** when called through the daemon. Two compounding defects:

1. The file-API factory (`src/editor/tlisp-api.ts:241`) passed `filesystem=undefined`
   despite `ctx.filesystem` existing on the context.
2. The sync write path (`src/editor/api/file-ops.ts:99-105`) was **fire-and-forget**:
   it kicked off `filesystem.writeFile(...).then(...)` and returned
   `Either.right(nil)` immediately, before the write resolved (and when no
   filesystem was passed, it only set a status message and wrote nothing).

Result: silent data loss for the T-Lisp save path (`save.tlisp` save-buffer) and
markdown export (`export.tlisp`), even though every sibling primitive (file-copy,
make-backup-file, read-file-content) already writes/reads real bytes.

## Problem Statement
`(write-file-content "/tmp/x" "DATA")` must write the file on disk in the standard
daemon runtime, and the file must exist by the time the call returns (the daemon's
eval RPC returns this result to the client).

## Solution Statement
1. Pass `ctx.filesystem` into `createFileOps` (`tlisp-api.ts:241`) so the async path
   uses the injected filesystem (testable / mockable) instead of `undefined`.
2. Make the **sync** write path write **synchronously** via `fs.writeFileSync`
   (try/catch → `Either.left` on failure), so the file exists before the call
   returns. The async path (`isAsyncMode`) is unchanged — it already returns a
   promise that resolves on write.

Codex review (APPROVE-WITH-CONCERNS) honored: "make the non-async path
synchronous or otherwise awaited"; "add an integration test covering
createEditorAPI/daemon wiring because test/unit/file-primitives.test.ts:25-26
passes no filesystem and would exercise only the fallback" — the strengthened unit
test now asserts the file exists on disk (the writeFileSync path), and the
`bin/tmax -e` daemon repro exercises the wired runtime end-to-end.

## Steps to Reproduce
```bash
# Today: returns nil, NO file created.
bin/tmax -e '(write-file-content "/tmp/wf-audit.txt" "DATA")'; cat /tmp/wf-audit.txt
```

## Root Cause Analysis
`createFileOps` was wired with `undefined` for the filesystem (the daemon never
passed its real `ctx.filesystem`), so the sync branch hit the "no filesystem
available" status set and wrote nothing. Even with a filesystem, the sync branch
was fire-and-forget — racy against an immediate read.

## Relevant Files
- `src/editor/tlisp-api.ts:241` — pass `ctx.filesystem`.
- `src/editor/api/file-ops.ts:99-108` — sync `fs.writeFileSync` (replace fire-and-forget).
- `test/unit/file-primitives.test.ts` — strengthen write-file-content test to assert the file on disk; add a failure-returns-Left case.

## Step by Step Tasks
### Task 1 — wire ctx.filesystem
**AC**: `createFileOps` is called with `ctx.filesystem` (not `undefined`) in the file-API factory.
### Task 2 — synchronous sync-path write
**AC**: sync write uses `fs.writeFileSync(path, content, "utf-8")` with try/catch → `Either.left(fsRuntimeError(...))` on failure; returns `Either.right(nil)` only after the write completes. The async path is unchanged.
### Task 3 — strengthened test
**AC**: write-file-content unit test asserts `fs.existsSync(path)` is true and `fs.readFileSync(path,'utf-8')` matches the content (not just `result.type==='nil'`); a failure case returns `Either.left`.
### Task 4 — Validate
typecheck clean + Validation Commands green + verify-gate PASS.

## Validation Commands
- `bun run typecheck:src && bun run typecheck:test`
- daemon repro: `bin/tmax -e '(write-file-content "/tmp/wf-audit.txt" "DATA")'` then `cat /tmp/wf-audit.txt` ⇒ prints `DATA`.
- `bun test test/unit/file-primitives.test.ts` — green (incl. the on-disk assertion).

## Notes
- Unblocks #49 (save-buffer chain) and #50 (file-save awaitable) via AUTO-UNBLOCK once #45 closes.
- The async path was already correct; this fix is the sync path + the factory wiring.
