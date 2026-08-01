# ADR-0149 — RPC open() resets the cursor to origin (#55)
## Status: Accepted
## Context
The RPC `open` handler spread `{...currentState}` and overrode only
`currentFilename`/`statusMessage`, so `cursorPosition` was inherited from the
prior buffer, and `createBuffer()` copied that stale cursor into the active
window. After opening a brand-new (shorter) file, the first `insert` targeted
the stale line and threw `-32010 'Line N is out of bounds (0-0)'` — the primary
daemon editing path (open + insert) was broken.

## Decision
In the `open` handler (`src/server/rpc/handlers/editing.ts`), reset
`cursorPosition`/`viewportTop`/`viewportLeft` to origin:
1. **before** `createBuffer` — so `createBuffer`'s window-sync copies the origin
   cursor (codex's active-window concern), and
2. **after** `createBuffer` with the new filename/status — so the top-level
   state (which `buffer-insert` reads via `getCursorLine/Column`) is at origin.

`buffer-insert` reads the top-level `cursorPosition` (`buffer-ops.ts:281`), so
the post-`createBuffer` reset is what fixes the insert; the pre-`createBuffer`
reset keeps the active window consistent.

## Consequences
- Open + insert works: opening a new file then inserting succeeds; `render-state`
  after open reports `cursorPosition {0,0}`. Verified by an integration test
  (real `TmaxServer`: open multi-line file → `(cursor-move 3 5)` → open new file
  → cursor origin → insert succeeds).
- Localized: 16 insertions, 0 deletions, confined to the `open` handler; no
  regression to insert/eval/render-state or `syncEditorToFrame`.
- Out of scope: the Editor's direct `openFile()` path (non-daemon) calls
  `createBuffer` without an explicit reset; if a future stale-cursor-on-direct-open
  bug appears, `editor.ts:2294` is the symmetric site.

Spec: [BUG-37](../specs/BUG-37-open-cursor-reset.md). Issue: #55.
Verify-gate: PASS.
