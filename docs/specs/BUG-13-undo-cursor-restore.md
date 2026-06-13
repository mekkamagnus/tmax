# Bug: Undo does not restore cursor position before the undone edit

## Bug Description

When the user presses `u` to undo an edit, tmax restores the buffer to its pre-edit state but restores the cursor to the **post-edit cursor of the previous edit** — not to where the cursor was just before the undone edit was applied. The effect is most visible after cursor movements between edits (e.g., `gg` before `dgg`, or any motion before a delete/change/paste).

Concretely: with a 15-line buffer, pressing `G` → `yy` → `p` (paste at end) then `gg` → `dgg` (delete to first line) then `u` lands the cursor on line 16 — the position it was in after the paste — instead of line 0, where it was immediately before `dgg`.

This contradicts Vim's undo semantics, where `u` restores both buffer AND cursor to the state immediately before the undone change.

## Problem Statement

The undo history stores only one cursor position per edit, captured at `undo-commit` time — which is the **post-edit** cursor. When `undo()` restores state, it pulls the cursor from `history[currentIndex-1]` (the previous edit's post-edit cursor) or, for the first edit, from `history[0].cursorLine/Column` (the first edit's post-edit cursor, since no `initialCursorLine/Column` is captured). Between two edits, cursor movements are not edits, so the previous edit's post-edit cursor ≠ the current edit's pre-edit cursor. Undo restores the wrong cursor.

## Solution Statement

Capture the cursor at `undo-begin` time (which is, by contract, immediately before the edit's buffer mutation begins) and store it as the pre-edit cursor in the same history item. In `undo()`, restore the cursor from the pre-edit cursor of the item being undone (`history[currentIndex]`'s pre-edit cursor before decrementing), not from the previous item. Also capture `initialCursorLine`/`initialCursorColumn` at the first `undo-begin` so undoing the first edit restores the true initial cursor. `redo()` continues to use the post-edit cursor (already stored as `cursorLine`/`cursorColumn`).

## Steps to Reproduce

1. Start `tmax` on a fresh buffer with multiple lines:
   ```
   tmax /tmp/undo-bug-demo.txt
   ```
   Populate the buffer (e.g., via `iHello<CR>world<CR>third<Esc>`) so it has ≥3 lines.
2. Press `G` to move the cursor to the last line.
3. Press `yy` then `p` to yank the last line and paste below it. Cursor is now on the pasted line (the new last line).
4. Press `gg` to move back to line 0.
5. Press `dgg` to delete from line 0 to the first line. Cursor moves to the new line 0.
6. Press `u` to undo the delete.

**Expected:** Cursor returns to line 0, column 0 — the position immediately before `dgg` was applied (after `gg`).
**Actual:** Cursor jumps to the last line of the buffer — the position it was in after the paste (step 3).

Equivalent one-edit reproduction:
1. Open an empty buffer.
2. Press `iA<Esc>` to insert "A". Cursor at line 0 col 1.
3. Press `u` to undo.

**Expected:** Cursor at line 0 col 0 (pre-edit position).
**Actual:** Cursor at line 0 col 1 (post-edit position, captured in `history[0].cursorLine`).

## Root Cause Analysis

`src/editor/api/undo-redo-ops.ts` defines `HistoryItem.cursorLine/cursorColumn` and captures them in `undo-commit` (lines 254–259):

```ts
pushToHistory(
  args[0]!.value as string,  // description
  currentBuffer,             // post-edit buffer
  getCursorLine(),           // post-edit cursor  ← wrong time to capture
  getCursorColumn()
);
```

`undo()` (lines 120–160) then restores:

- First-edit case (`currentIndex === 0`): restores `initialBuffer` for the buffer (correct), but restores cursor from `history[0].cursorLine/Column` — the POST-edit cursor of the first edit. There is no `initialCursorLine`/`initialCursorColumn` global, so the pre-first-edit cursor is never restored.
- Subsequent-edit case (`currentIndex > 0`): decrements `currentIndex`, restores `history[currentIndex].buffer` (the post-edit buffer of the previous edit = correct buffer), and restores `history[currentIndex].cursorLine/Column` (the previous edit's POST-edit cursor). Between edits, cursor motions are not edits — so the previous edit's post-edit cursor ≠ the current edit's pre-edit cursor. The restored cursor is whatever happened to be left after edit N-1, not where the user was when they triggered edit N.

`redo()` (lines 169–193) increments `currentIndex` and restores from `history[currentIndex]` — for redo, post-edit cursor is correct, so redo is unaffected.

The fix is to capture the pre-edit cursor at `undo-begin` (which the T-Lisp contract calls immediately before the buffer mutation) and store it in the same history item. `undo()` then reads the pre-edit cursor of the item being undone.

## Relevant Files

Use these files to fix the bug:

- `src/editor/api/undo-redo-ops.ts` — Capture pre-edit cursor in `undo-begin`, store it on `HistoryItem`, restore from it in `undo()`. Add `initialCursorLine`/`initialCursorColumn` module globals. Update `resetUndoRedoState()` to clear them.
- `test/unit/undo-redo.test.ts` — Add regression tests for cursor restoration through `undo()` (covers both first-edit and subsequent-edit cases, including the cross-edit scenario from the reproduction steps).

### New Files

- None.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Task 1: Capture pre-edit cursor in undo-begin

**User Story**: As an undo-system maintainer, I want `undo-begin` to snapshot the cursor alongside the buffer, so that each history item records where the cursor was immediately before the edit was applied.

- In `src/editor/api/undo-redo-ops.ts`, add module globals next to `pendingBuffer`:
  ```ts
  let pendingCursorLine: number | null = null;
  let pendingCursorColumn: number | null = null;
  ```
- Add module globals next to `initialBuffer`:
  ```ts
  let initialCursorLine: number | null = null;
  let initialCursorColumn: number | null = null;
  ```
- In `resetUndoRedoState()`, also reset all four new globals to `null`.
- In the `"undo-begin"` handler (around line 220), capture both cursor coordinates alongside `pendingBuffer`:
  ```ts
  pendingBuffer = getCurrentBuffer();
  pendingCursorLine = getCursorLine();
  pendingCursorColumn = getCursorColumn();
  ```

**Acceptance Criteria**:
- [ ] `undo-begin` captures all three: buffer + cursor line + cursor column.
- [ ] `resetUndoRedoState()` clears the four new globals (two pending, two initial).
- [ ] `bun run typecheck:src` passes.

### Task 2: Extend HistoryItem with pre-edit cursor

**User Story**: As an undo-system maintainer, I want each history item to carry both pre-edit and post-edit cursor positions, so that `undo()` can use the pre-edit cursor while `redo()` continues to use the post-edit cursor.

- Extend the `HistoryItem` interface with two optional fields:
  ```ts
  preCursorLine?: number;
  preCursorColumn?: number;
  ```
- Extend `pushToHistory` signature to accept them:
  ```ts
  export function pushToHistory(
    description: string,
    buffer: FunctionalTextBuffer,
    cursorLine?: number,
    cursorColumn?: number,
    preCursorLine?: number,
    preCursorColumn?: number
  ): void
  ```
- Assign the new fields onto the pushed `HistoryItem`.
- In the `"undo-commit"` handler, populate the pre-edit cursor from the pending globals and seed `initialCursorLine`/`initialCursorColumn` on the first commit:
  ```ts
  if (state.history.length === 0) {
    setInitialBuffer(pendingBuffer);
    initialCursorLine = pendingCursorLine;
    initialCursorColumn = pendingCursorColumn;
  }
  pushToHistory(
    args[0]!.value as string,
    currentBuffer,
    getCursorLine(),
    getCursorColumn(),
    pendingCursorLine ?? undefined,
    pendingCursorColumn ?? undefined
  );
  ```
- After commit, clear `pendingCursorLine` and `pendingCursorColumn` alongside `pendingBuffer`.

**Acceptance Criteria**:
- [ ] `HistoryItem` carries optional `preCursorLine`/`preCursorColumn`.
- [ ] `pushToHistory` accepts and stores the new fields.
- [ ] First commit seeds `initialCursorLine`/`initialCursorColumn`.
- [ ] `bun run typecheck:src` passes.

### Task 3: Restore pre-edit cursor in undo()

**User Story**: As a tmax user pressing `u`, I want the cursor to land where it was immediately before the undone edit, so that undo matches Vim semantics and my editing position is preserved.

- In `undo()` (`src/editor/api/undo-redo-ops.ts`), capture the item being undone BEFORE mutating `currentIndex`:
  ```ts
  const undoneItem = state.history[state.currentIndex]!;
  ```
- First-edit branch (`currentIndex === 0`): after `setCurrentBuffer(initialBuffer)`, restore from `initialCursorLine`/`initialCursorColumn` (NOT from `history[0]`).
- Subsequent-edit branch (`currentIndex > 0`): decrement `currentIndex`, restore `history[currentIndex].buffer` for the buffer, but restore cursor from `undoneItem.preCursorLine`/`preCursorColumn` (the pre-edit cursor of the edit being undone). Fall back to `undoneItem.cursorLine`/`cursorColumn` only when `preCursorLine` is absent (covers history items pushed via `undo-history-push` without the new fields).
- `redo()` is unchanged — it already uses the post-edit `cursorLine`/`cursorColumn`, which is correct for redo.

**Acceptance Criteria**:
- [ ] Undoing the first edit restores `initialCursorLine`/`initialCursorColumn`.
- [ ] Undoing a subsequent edit restores the pre-edit cursor of the undone item.
- [ ] Redo behavior is unchanged.
- [ ] `bun run typecheck:src` passes.

### Task 4: Add regression tests

**User Story**: As an undo-system maintainer, I want regression tests covering both the first-edit and cross-edit cursor restoration paths, so that this bug cannot silently return.

- In `test/unit/undo-redo.test.ts`, add a test that reproduces the bug from the Steps to Reproduce:
  - Apply edit 1 (e.g., insert at line 0), move cursor, apply edit 2 (e.g., delete elsewhere), then call `undo()` and assert the cursor returns to the position immediately before edit 2.
- Add a second test for the first-edit path:
  - Apply a single edit, then call `undo()` and assert the cursor returns to its initial position (not the post-edit position).
- Use `resetUndoRedoState()` in `beforeEach` (if not already) so the new globals are clean between tests.

**Acceptance Criteria**:
- [ ] Test for cross-edit undo cursor restoration exists and asserts pre-edit position.
- [ ] Test for first-edit undo cursor restoration exists and asserts initial position.
- [ ] `bun test test/unit/undo-redo.test.ts` passes.

### Task 5: Run full validation

**User Story**: As a maintainer, I want to verify the fix end-to-end with zero regressions, so that I can confidently ship it.

- Run the focused undo test suite, then the full project test suite, then typecheck.
- Run the unified-keymap demo (or the manual reproduction in the Steps to Reproduce) against a live `tmax` daemon to visually confirm the cursor lands on line 0 after `dgg` → `u`.

**Acceptance Criteria**:
- [ ] `bun run typecheck` passes with zero errors.
- [ ] `bun test` passes with zero regressions.
- [ ] Manual repro: `dgg` then `u` leaves cursor on line 0, not the last buffer line.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- `bun run typecheck` — TypeScript typechecks both src and test layers; must pass with zero errors.
- `bun test test/unit/undo-redo.test.ts` — focused regression suite for the undo cursor restoration paths; must pass.
- `bun test test/unit/vim-dispatch.test.ts` — covers `dgg`, `dd`, `dw`, `cw`, etc.; undo cursor changes must not break operator behavior.
- `bun test` — full project suite; must pass with zero regressions.
- Manual reproduction: start `tmax --daemon`, open a multi-line file, run `Gyy` → `p` → `gg` → `dgg` → `u` via `tmaxclient --keys`, then `tmaxclient --eval '(list (cursor-line) (cursor-column))'` — must report `[0,0]`, not the last line's column.

## Notes

- The bug is pre-existing — confirmed via `git stash` against the CHORE-23 dispatcher; behavior is identical on the old dispatcher. CHORE-23 surfaced it because the unified-keymap demo (`demos/unified-keymap.yaml`) visibly jumps to the last line after `u`.
- The fix preserves the existing `cursorLine`/`cursorColumn` (post-edit) fields on `HistoryItem` so that `redo()` is unaffected and `undo-history-push` (which accepts optional cursor args) continues to work for callers that don't supply the new pre-edit fields.
- `src/editor/api/undo-redo-ops.ts` already lives in the right layer per `src/editor/CLAUDE.md` — it's a TypeScript primitive owning factual state (history of (buffer, cursor) snapshots). The decision of WHEN to call `undo-begin`/`undo-commit` lives in T-Lisp (`src/tlisp/core/commands/edit-commands.tlisp`, `operators.tlisp`, `insert-entries.tlisp`) and is unchanged by this fix.

## Patch Review Findings

Review performed after implementation. Each finding has been verified against the merged code in `src/editor/api/undo-redo-ops.ts`.

### HIGH

None. The fix meets its acceptance criteria: the cross-edit and first-edit regression tests in `test/unit/undo-redo.test.ts` (under "BUG-13: pre-edit cursor restoration") pass, and the `dgg → u` demo no longer jumps to the last buffer line.

### MEDIUM

**M-1: `initialCursorLine` seeding goes stale after an undo→cursor-move→new-edit cycle.**

`undo-redo-ops.ts` seeds `initialCursorLine`/`initialCursorColumn` once — inside `undo-commit`, gated on `state.history.length === 0` (lines 277–281). That check runs *before* `pushToHistory` truncates the redo branch (truncation happens inside `pushToHistory` at lines 104–106). So after the user does:

1. `iA<Esc>` — edit1. `state.history.length === 0` true → seed `initialCursorLine = 0` (pre-edit1 cursor).
2. `u` — `currentIndex = -1`, history still `[edit1]`.
3. `j` — cursor moves to `(1, 0)` (assuming a multi-line buffer).
4. `iB<Esc>` — edit2 on line 1.
   - `undo-begin` captures `pendingCursor = (1, 0)`.
   - `undo-commit` checks `state.history.length === 0` — **false** (history still has edit1), so `initialCursorLine` is **not** re-seeded even though the user's "initial state" is now the post-undo state at cursor `(1, 0)`.
   - `pushToHistory` then truncates the future (edit1) and pushes edit2 → `history = [edit2]`, `currentIndex = 0`.
5. `u` — first-edit branch (`currentIndex === 0`) fires. Cursor restored from `initialCursorLine ?? undoneItem.preCursorLine ?? undoneItem.cursorLine` (lines 156–157).
   - `initialCursorLine = 0` (stale, from step 1)
   - `undoneItem.preCursorLine = 1` (the correct pre-edit2 cursor)
   - The chain picks `initialCursorLine` first → cursor lands at `(0, 0)`. **Wrong.** Should be `(1, 0)`.

**Fix:** flip the fallback chain in the first-edit branch so `undoneItem.preCursorLine` wins:

```ts
const restoreLine = undoneItem.preCursorLine ?? initialCursorLine ?? undoneItem.cursorLine;
const restoreColumn = undoneItem.preCursorColumn ?? initialCursorColumn ?? undoneItem.cursorColumn;
```

This is safe because for the genuine first edit (no prior undo) `undoneItem.preCursorLine` and `initialCursorLine` are the same value — both come from `pendingCursorLine` captured at the same `undo-begin`. Add a regression test that runs the five-step repro above and asserts `(1, 0)`, not `(0, 0)`.

(Alternative fix: re-seed `initialCursorLine`/`initialCursorColumn` whenever `pushToHistory` truncates the future. More invasive — touches `pushToHistory` rather than just `undo()` — and unnecessary given the fallback flip above.)

### LOW

**L-1: Legacy `undo-history-push` API never captures pre-edit cursor, so it silently falls back to post-edit cursor.**

The public-but-unused `undo-history-push` handler (lines 355–407) accepts `description`, `buffer`, and optional `cursorLine`/`cursorColumn`, but does NOT accept `preCursorLine`/`preCursorColumn`. Items pushed this way have `preCursorLine = undefined`, so the subsequent-edit undo branch (line 174: `undoneItem.preCursorLine ?? undoneItem.cursorLine`) falls back to the post-edit cursor — the original buggy behavior.

Grep confirms zero T-Lisp callers — the only callers are in `test/unit/undo-redo.test.ts`. So this is dead-ish surface area, not an active bug. Two reasonable resolutions: (a) extend `undo-history-push` to accept two more optional args for the pre-edit cursor, or (b) delete the handler entirely (and its tests) since `undo-begin`/`undo-commit` is the only path used by real code. Either is fine; doing nothing is also fine as long as the API is documented as legacy.

**L-2: Type asymmetry between `pendingCursorLine` (`number | null`) and `HistoryItem.preCursorLine` (`number | undefined`).**

`pendingCursorLine`/`pendingCursorColumn`/`initialCursorLine`/`initialCursorColumn` are declared `number | null` (lines 51–55), but `HistoryItem.preCursorLine`/`preCursorColumn` are `number | undefined` (interface at lines 31–32). The commit handler bridges the two with `pendingCursorLine ?? undefined` (lines 287–288). It works, but the asymmetry is a small smell — pick one (preferably `number | undefined` for the module globals too, since optional fields on interfaces are idiomatic) and unify them.
