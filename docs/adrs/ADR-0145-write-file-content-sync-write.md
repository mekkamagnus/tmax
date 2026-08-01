# ADR-0145 — write-file-content writes synchronously; ctx.filesystem wired (#45)
## Status: Accepted
## Context
`write-file-content` — the T-Lisp primitive that persists buffers — returned nil
and wrote **nothing** in the daemon: (1) the file-API factory
(`src/editor/tlisp-api.ts:241`) passed `filesystem=undefined` despite
`ctx.filesystem` existing; (2) the sync write path was **fire-and-forget**
(`filesystem.writeFile(...).then(...)` then immediately return nil), and with no
filesystem it only set a status message. Result: silent data loss for the T-Lisp
save path (`save.tlisp` save-buffer) and markdown export, even though sibling
primitives (file-copy, read-file-content) already work.

## Decision
1. Wire `ctx.filesystem` into `createFileOps` (`tlisp-api.ts:241`) so the async
   path uses the injected (mockable) filesystem.
2. The **sync** write path (`file-ops.ts:99-110`) now writes via
   `fs.writeFileSync(path, content, "utf-8")` with try/catch →
   `Either.left(fsRuntimeError(...))` on failure, returning only after the write
   completes. The async path (`isAsyncMode`) is unchanged.

The daemon's eval RPC runs in sync mode (`createEvalContext` defaults
`asyncMode:false`), so the file exists before the RPC result returns to the
client — the immediate-`cat` race is gone.

## Consequences
- `(write-file-content path content)` now persists to disk in the daemon
  (verified: `bin/tmax -e` writes the file; `cat` shows the content).
- The async path is byte-for-byte unchanged → no regression for async-let code.
- A failed write surfaces as `Either.left` (was silently swallowed).
- Unblocks #49 (save-buffer chain) and #50 (file-save awaitable) via
  AUTO-UNBLOCK.

Spec: [BUG-33](../specs/BUG-33-write-file-content-disk.md). Issue: #45.
Verify-gate: PASS (file-primitives 26/26 incl. on-disk + failure assertions;
tlisp-api 22/22 no regression).
