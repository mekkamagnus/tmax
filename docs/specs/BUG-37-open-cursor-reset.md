# Bug: RPC open() inherits a stale cursor — first insert after open throws "Line N out of bounds"

## Bug Description
The RPC `open` handler spread `{...currentState}` and overrode only
`currentFilename`/`statusMessage`, so `cursorPosition` was inherited from
whatever buffer was current before. `createBuffer()` also copied the stale
cursor/viewport into the active window. After opening a brand-new (shorter)
file the reported `{line:1,column:1}` was a lie — the real cursor still pointed
at the prior file's line, and the next `insert` targeting that stale line threw
`-32010 'Line N is out of bounds (0-0)'`. This is the primary daemon editing
path (open + insert).

## Problem Statement
Opening a file must leave the cursor at the start of the new buffer, and the
first insert must succeed.

## Solution Statement
In the `open` handler (`src/server/rpc/handlers/editing.ts`), reset
`cursorPosition`/`viewportTop`/`viewportLeft` to origin:
1. **before** `createBuffer` — so `createBuffer`'s window-sync copies the origin
   cursor (not the stale one) into the active window (codex concern), and
2. **after** `createBuffer` with the new filename/status — so the top-level
   state is at origin.

Codex APPROVE-WITH-CONCERNS honored: "implementation must also keep the active
window at origin (or perform the reset before createBuffer)" — done via the
pre-`createBuffer` reset.

## Steps to Reproduce
```bash
# daemon RPC sequence:
open multi-line file; eval (cursor-move 3 5); open brand-new empty file; insert "x"
# today: insert errors -32010 'Line 3 is out of bounds (0-0)'
```

## Root Cause Analysis
`buffer-insert` reads the top-level cursor (`getCursorLine/Column`,
`buffer-ops.ts:281`). The `open` handler's `newState` spread the stale
`currentState.cursorPosition`, and `setEditorState` dutifully applied it, so the
cursor never moved to the new buffer's origin. `createBuffer` additionally
synced the stale cursor into the active window.

## Relevant Files
- `src/server/rpc/handlers/editing.ts:85-106` — origin reset before + after `createBuffer`.
- `test/integration/open-cursor-reset.test.ts` — RPC test: open + cursor-move + open-new + insert succeeds; render-state cursor at origin.

## Step by Step Tasks
### Task 1 — origin reset in open
**AC**: `open` resets `cursorPosition`/`viewportTop`/`viewportLeft` to origin before `createBuffer` (window-sync) and after (top-level state).
### Task 2 — insert-after-open succeeds
**AC**: open a multi-line file, `(cursor-move 3 5)`, open a brand-new empty file, then `insert {text}` returns success (not `-32010 out of bounds`).
### Task 3 — render-state shows origin
**AC**: a `render-state` query immediately after open returns `cursorPosition {line:0, column:0}`.
### Task 4 — regression test
**AC**: `test/integration/open-cursor-reset.test.ts` covers the above; verify-gate PASS.

## Validation Commands
- `bun run typecheck:src && bun run typecheck:test`
- `bun test test/integration/open-cursor-reset.test.ts` — green.

## Notes
- `cursor-move` is a T-Lisp primitive (used by normal-mode `j`/`k`/`h`/`l` bindings).
- The hard-coded `line:1, column:1` in the open RPC *return* value is the 1-indexed display origin and is correct; the bug was the *state* cursor.
