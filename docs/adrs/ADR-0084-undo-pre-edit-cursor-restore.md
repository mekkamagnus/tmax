# Undo Pre-Edit Cursor Restore

## Status

Accepted

## Context

After an undo-cursor-move-new-edit cycle, `undo` restored the wrong cursor position. The history entries tracked post-edit cursor positions, so undoing an edit would place the cursor at the position from the *previous* history entry rather than where the user's cursor was immediately before the edit was applied (BUG-13).

## Decision

Record *pre-edit* cursor positions (`preCursorLine`, `preCursorColumn`) in each history entry:

1. `undo-begin` captures the current cursor position as the pending pre-edit cursor
2. `undo-commit` commits that saved position into the history item alongside the existing post-edit data
3. On undo, the cursor is restored to the pre-edit position of the item being undone

This eliminates the stale `initialCursorLine` problem where a cursor position from an earlier undo cycle would incorrectly win over the correct per-item pre-edit cursor.

## Consequences

- **Easier**: Undo now correctly restores cursor position in all scenarios including interleaved cursor moves and edits.
- **Harder**: Each history entry is slightly larger (two extra fields). The `undo-begin`/`undo-commit` protocol must always be paired correctly to avoid orphaned pre-edit data.
