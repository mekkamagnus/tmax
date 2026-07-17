/**
 * @file undo-redo.test.ts
 * @description Tests for undo/redo functionality (US-1.2.3)
 *
 * Tests Vim-style undo/redo with u (undo) and Ctrl+r (redo)
 * - Track edit history
 * - Handle undo branch clearing on new edits
 * - Show appropriate messages at boundaries
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { expectRight } from "../helpers/editor-fixture.ts";
import { Either } from "../../src/utils/task-either.ts";
import { createUndoRedoOps, createUndoRedoDomainState } from "../../src/editor/api/undo-redo-ops.ts";
import type { TextBuffer } from "../../src/core/types.ts";
import type { TLispValue } from "../../src/tlisp/types.ts";

// Mock buffer implementation for testing
class MockBuffer implements TextBuffer {
  private content: string;

  constructor(initialContent: string = "") {
    this.content = initialContent;
  }

  getContent(): Either<string, string> {
    return Either.right(this.content);
  }

  getLine(lineNumber: number): Either<string, string> {
    const lines = this.content.split('\n');
    if (lineNumber < 0 || lineNumber >= lines.length) {
      return Either.left(`Line ${lineNumber} out of range`);
    }
    return Either.right(lines[lineNumber]!);
  }

  getLineCount(): Either<string, number> {
    return Either.right(this.content.split('\n').length);
  }

  insert(position: { line: number; column: number }, text: string): Either<string, TextBuffer> {
    const lines = this.content.split('\n');
    const line = lines[position.line] || "";

    const newLine = line.slice(0, position.column) + text + line.slice(position.column);
    lines[position.line] = newLine;
    const newContent = lines.join('\n');

    const newBuffer = new MockBuffer(newContent);
    return Either.right(newBuffer as TextBuffer);
  }

  delete(range: { start: { line: number; column: number }; end: { line: number; column: number } }): Either<string, TextBuffer> {
    const lines = this.content.split('\n');

    // Simple case: same line
    if (range.start.line === range.end.line) {
      const line = lines[range.start.line] || "";
      const newLine = line.slice(0, range.start.column) + line.slice(range.end.column);
      lines[range.start.line] = newLine;
      const newContent = lines.join('\n');
      const newBuffer = new MockBuffer(newContent);
      return Either.right(newBuffer as TextBuffer);
    }

    // Multi-line deletion
    const firstLine = lines[range.start.line] || "";
    const lastLine = lines[range.end.line] || "";
    const newLine = firstLine.slice(0, range.start.column) + lastLine.slice(range.end.column);

    const newLines = lines.slice(0, range.start.line)
      .concat([newLine])
      .concat(lines.slice(range.end.line + 1));

    const newContent = newLines.join('\n');
    const newBuffer = new MockBuffer(newContent);
    return Either.right(newBuffer as TextBuffer);
  }

  replace(range: { start: { line: number; column: number }; end: { line: number; column: number } }, text: string): Either<string, TextBuffer> {
    const deleteResult = this.delete(range);
    if (Either.isLeft(deleteResult)) {
      return deleteResult;
    }

    return expectRight(deleteResult).insert(range.start, text);
  }

  getText(range: { start: { line: number; column: number }; end: { line: number; column: number } }): Either<string, string> {
    const lines = this.content.split('\n');

    // Simple case: same line
    if (range.start.line === range.end.line) {
      const line = lines[range.start.line] || "";
      const text = line.slice(range.start.column, range.end.column);
      return Either.right(text);
    }

    // Multi-line text
    const firstLine = lines[range.start.line] || "";
    const lastLine = lines[range.end.line] || "";
    const middleLines = range.end.line > range.start.line + 1
      ? lines.slice(range.start.line + 1, range.end.line)
      : [];

    const text = firstLine.slice(range.start.column) + '\n' +
      middleLines.join('\n') +
      (middleLines.length > 0 ? '\n' : '') +
      lastLine.slice(0, range.end.column);

    return Either.right(text);
  }

  getStats(): Either<string, { lines: number; characters: number; words: number }> {
    const lines = this.content.split('\n');
    const words = this.content.split(/\s+/).filter(w => w.length > 0).length;
    return Either.right({
      lines: lines.length,
      characters: this.content.length,
      words
    });
  }
}

describe("Undo/Redo Operations", () => {
  let currentBuffer: TextBuffer | null;
  let undoRedoOps: Map<string, (args: any[]) => Either<any, any>>;
  let currentStatusMessage: string;
  // CHORE-44 Change 1: undo state is per-editor; reset/setInitialBuffer come
  // from the factory result (bound to this editor's history).
  let resetUndoRedoState: () => void;
  let setInitialBuffer: (buffer: TextBuffer) => void;

  beforeEach(() => {
    currentBuffer = new MockBuffer("Hello world\nLine 2\nLine 3") as TextBuffer;
    currentStatusMessage = "";

    const undoRedoCore = createUndoRedoOps(
      createUndoRedoDomainState(),
      () => currentBuffer,
      (buffer) => { currentBuffer = buffer; },
      () => 0,  // cursorLine
      (line) => {},  // setCursorLine (no-op for tests)
      () => 0,  // cursorColumn
      (col) => {},  // setCursorColumn (no-op for tests)
      () => currentStatusMessage,  // statusMessage
      (msg) => { currentStatusMessage = msg; }  // setStatusMessage
    );
    undoRedoOps = undoRedoCore.api;
    resetUndoRedoState = undoRedoCore.reset;
    setInitialBuffer = undoRedoCore.setInitialBuffer;
    resetUndoRedoState();
  });

  describe("Basic undo functionality", () => {
    test("undoes last edit", () => {
      // Set initial buffer state
      setInitialBuffer(currentBuffer!);

      const undoFunc = undoRedoOps.get("undo")!;
      const pushFunc = undoRedoOps.get("undo-history-push")!;

      // Push an edit to history - wrap buffer in special object
      const modifiedBuffer = new MockBuffer("Hello world modified\nLine 2\nLine 3") as TextBuffer;
      const pushResult = pushFunc([
        { type: 'string', value: 'test' },
        { buffer: modifiedBuffer }
      ]);
      expect(Either.isRight(pushResult)).toBe(true);

      // Now undo
      const undoResult = undoFunc([]);
      expect(Either.isRight(undoResult)).toBe(true);

      // Buffer should be restored to initial state
      const contentResult = currentBuffer!.getContent();
      expect(Either.isRight(contentResult)).toBe(true);
      expect(expectRight(contentResult)).toBe("Hello world\nLine 2\nLine 3");
    });

    test("multiple u presses undo edits sequentially", () => {
      setInitialBuffer(currentBuffer!);

      const pushFunc = undoRedoOps.get("undo-history-push")!;
      const undoFunc = undoRedoOps.get("undo")!;

      // Push 3 edits
      const edit1 = new MockBuffer("Edit 1\nLine 2\nLine 3") as TextBuffer;
      const edit2 = new MockBuffer("Edit 2\nLine 2\nLine 3") as TextBuffer;
      const edit3 = new MockBuffer("Edit 3\nLine 2\nLine 3") as TextBuffer;

      pushFunc([{ type: 'string', value: 'edit1' }, { buffer: edit1 }]);
      pushFunc([{ type: 'string', value: 'edit2' }, { buffer: edit2 }]);
      pushFunc([{ type: 'string', value: 'edit3' }, { buffer: edit3 }]);

      // Undo 3 times
      undoFunc([]);
      undoFunc([]);
      undoFunc([]);

      // Should be back to initial state
      const contentResult = currentBuffer!.getContent();
      expect(Either.isRight(contentResult)).toBe(true);
      expect(expectRight(contentResult)).toBe("Hello world\nLine 2\nLine 3");
    });

    test("undo only undoes last edit (not all)", () => {
      setInitialBuffer(currentBuffer!);

      const pushFunc = undoRedoOps.get("undo-history-push")!;
      const undoFunc = undoRedoOps.get("undo")!;

      // Push 2 edits
      const edit1 = new MockBuffer("Edit 1\nLine 2\nLine 3") as TextBuffer;
      const edit2 = new MockBuffer("Edit 2\nLine 2\nLine 3") as TextBuffer;

      pushFunc([{ type: 'string', value: 'edit1' }, { buffer: edit1 }]);
      pushFunc([{ type: 'string', value: 'edit2' }, { buffer: edit2 }]);

      // Undo once
      undoFunc([]);

      // Should be at edit1, not initial state
      const contentResult = currentBuffer!.getContent();
      expect(Either.isRight(contentResult)).toBe(true);
      expect(expectRight(contentResult)).toBe("Edit 1\nLine 2\nLine 3");
    });

    test("undo to beginning shows message", () => {
      setInitialBuffer(currentBuffer!);

      const undoFunc = undoRedoOps.get("undo")!;

      // Undo with no history
      const undoResult = undoFunc([]);
      expect(Either.isRight(undoResult)).toBe(true);

      // Check status message
      expect(currentStatusMessage).toContain("Already at oldest");
    });
  });

  describe("Redo functionality", () => {
    test("Ctrl+r redoes undone edits", () => {
      setInitialBuffer(currentBuffer!);

      const pushFunc = undoRedoOps.get("undo-history-push")!;
      const undoFunc = undoRedoOps.get("undo")!;
      const redoFunc = undoRedoOps.get("redo")!;

      // Push an edit
      const edit1 = new MockBuffer("Edit 1\nLine 2\nLine 3") as TextBuffer;
      pushFunc([{ type: 'string', value: 'edit1' }, { buffer: edit1 }]);

      // Undo
      undoFunc([]);

      // Redo
      const redoResult = redoFunc([]);
      expect(Either.isRight(redoResult)).toBe(true);

      // Should be back to edit1 state
      const contentResult = currentBuffer!.getContent();
      expect(Either.isRight(contentResult)).toBe(true);
      expect(expectRight(contentResult)).toBe("Edit 1\nLine 2\nLine 3");
    });

    test("redo to end shows message", () => {
      setInitialBuffer(currentBuffer!);

      const pushFunc = undoRedoOps.get("undo-history-push")!;
      const redoFunc = undoRedoOps.get("redo")!;

      // Push an edit
      const edit1 = new MockBuffer("Edit 1\nLine 2\nLine 3") as TextBuffer;
      pushFunc([{ type: 'string', value: 'edit1' }, { buffer: edit1 }]);

      // Try to redo without undoing first
      const redoResult = redoFunc([]);
      expect(Either.isRight(redoResult)).toBe(true);

      // Check status message
      expect(currentStatusMessage).toContain("Already at newest");
    });
  });

  describe("Branch clearing on new edits", () => {
    test("new edits clear redo history", () => {
      setInitialBuffer(currentBuffer!);

      const pushFunc = undoRedoOps.get("undo-history-push")!;
      const undoFunc = undoRedoOps.get("undo")!;
      const redoFunc = undoRedoOps.get("redo")!;

      // Push 2 edits
      const edit1 = new MockBuffer("Edit 1\nLine 2\nLine 3") as TextBuffer;
      const edit2 = new MockBuffer("Edit 2\nLine 2\nLine 3") as TextBuffer;

      pushFunc([{ type: 'string', value: 'edit1' }, { buffer: edit1 }]);
      pushFunc([{ type: 'string', value: 'edit2' }, { buffer: edit2 }]);

      // Undo once (now at edit1)
      undoFunc([]);

      // Push new edit (should clear redo history)
      const edit3 = new MockBuffer("Edit 3\nLine 2\nLine 3") as TextBuffer;
      pushFunc([{ type: 'string', value: 'edit3' }, { buffer: edit3 }]);

      // Try to redo - should fail
      const redoResult = redoFunc([]);
      expect(Either.isRight(redoResult)).toBe(true);

      // Should show message about being at newest
      expect(currentStatusMessage).toContain("Already at newest");
    });
  });

  describe("History tracking", () => {
    test("tracks edit history correctly", () => {
      const pushFunc = undoRedoOps.get("undo-history-push")!;
      const countFunc = undoRedoOps.get("undo-history-count")!;

      // Push 3 edits
      const edit1 = new MockBuffer("Edit 1\nLine 2\nLine 3") as TextBuffer;
      const edit2 = new MockBuffer("Edit 2\nLine 2\nLine 3") as TextBuffer;
      const edit3 = new MockBuffer("Edit 3\nLine 2\nLine 3") as TextBuffer;

      pushFunc([{ type: 'string', value: 'edit1' }, { buffer: edit1 }]);
      pushFunc([{ type: 'string', value: 'edit2' }, { buffer: edit2 }]);
      pushFunc([{ type: 'string', value: 'edit3' }, { buffer: edit3 }]);

      // Check count
      const countResult = countFunc([]);
      expect(Either.isRight(countResult)).toBe(true);
      expect(expectRight(countResult)).toHaveProperty('type', 'number');
      expect(expectRight(countResult).value).toBe(3);
    });

    test("clears history correctly", () => {
      const pushFunc = undoRedoOps.get("undo-history-push")!;
      const clearFunc = undoRedoOps.get("undo-history-clear")!;
      const countFunc = undoRedoOps.get("undo-history-count")!;

      // Push some edits
      const edit1 = new MockBuffer("Edit 1\nLine 2\nLine 3") as TextBuffer;
      pushFunc([{ type: 'string', value: 'edit1' }, { buffer: edit1 }]);

      // Clear history
      const clearResult = clearFunc([]);
      expect(Either.isRight(clearResult)).toBe(true);

      // Check count
      const countResult = countFunc([]);
      expect(Either.isRight(countResult)).toBe(true);
      expect(expectRight(countResult).value).toBe(0);
    });
  });

  describe("Edge cases", () => {
    test("handles empty buffer correctly", () => {
      const emptyBuffer = new MockBuffer("") as TextBuffer;
      currentBuffer = emptyBuffer;
      setInitialBuffer(emptyBuffer);

      const pushFunc = undoRedoOps.get("undo-history-push")!;
      const undoFunc = undoRedoOps.get("undo")!;

      // Push edit on empty buffer
      const edit1 = new MockBuffer("text") as TextBuffer;
      const pushResult = pushFunc([{ type: 'string', value: 'edit1' }, { buffer: edit1 }]);
      expect(Either.isRight(pushResult)).toBe(true);

      // Undo
      const undoResult = undoFunc([]);
      expect(Either.isRight(undoResult)).toBe(true);

      // Should be back to empty
      const contentResult = currentBuffer!.getContent();
      expect(Either.isRight(contentResult)).toBe(true);
      expect(expectRight(contentResult)).toBe("");
    });

    test("handles undo with no history", () => {
      const undoFunc = undoRedoOps.get("undo")!;

      // Undo with no history
      const undoResult = undoFunc([]);
      expect(Either.isRight(undoResult)).toBe(true);

      // Buffer should be unchanged
      const contentResult = currentBuffer!.getContent();
      expect(Either.isRight(contentResult)).toBe(true);
      expect(expectRight(contentResult)).toBe("Hello world\nLine 2\nLine 3");
    });

    test("handles redo with no undone changes", () => {
      setInitialBuffer(currentBuffer!);

      const pushFunc = undoRedoOps.get("undo-history-push")!;
      const redoFunc = undoRedoOps.get("redo")!;

      // Push edit but don't undo - also update current buffer
      const edit1 = new MockBuffer("Edit 1\nLine 2\nLine 3") as TextBuffer;
      pushFunc([{ type: 'string', value: 'edit1' }, { buffer: edit1 }]);
      currentBuffer = edit1;  // Update current buffer to reflect the edit

      // Try to redo without undoing
      const redoResult = redoFunc([]);
      expect(Either.isRight(redoResult)).toBe(true);

      // Buffer should be unchanged (still at edit1)
      const contentResult = currentBuffer!.getContent();
      expect(Either.isRight(contentResult)).toBe(true);
      expect(expectRight(contentResult)).toBe("Edit 1\nLine 2\nLine 3");
    });
  });

  describe("Undo/redo with cursor position", () => {
    test("restores cursor position on undo", () => {
      let savedLine = 5;
      let savedColumn = 10;

      const { api: ops } = createUndoRedoOps(
      createUndoRedoDomainState(),
        () => currentBuffer,
        (buffer) => { currentBuffer = buffer; },
        () => savedLine,
        (line) => { savedLine = line; },
        () => savedColumn,
        (col) => { savedColumn = col; },
        () => currentStatusMessage,
        (msg) => { currentStatusMessage = msg; }
      );

      setInitialBuffer(currentBuffer!);

      const pushFunc = ops.get("undo-history-push")!;
      const undoFunc = ops.get("undo")!;

      // Push edit with cursor position
      const edit1 = new MockBuffer("Edit 1\nLine 2\nLine 3") as TextBuffer;
      pushFunc([
        { type: 'string', value: 'edit1' },
        { buffer: edit1 } as unknown as TLispValue,
        { type: 'number', value: 5 },   // cursor line
        { type: 'number', value: 10 }   // cursor column
      ]);

      // Change cursor
      savedLine = 15;
      savedColumn = 20;

      // Undo
      undoFunc([]);

      // Cursor should be restored
      expect(savedLine).toBe(5);
      expect(savedColumn).toBe(10);
    });
  });

  describe("BUG-13: pre-edit cursor restoration", () => {
    test("undo restores the pre-edit cursor of the undone edit (cross-edit)", () => {
      // Simulate the bug repro: edit1 (post-edit cursor at 5,10),
      // cursor moves to (15,20), edit2 applied (pre-edit cursor was 15,20),
      // then undo edit2 — cursor should return to (15,20), NOT (5,10).
      let savedLine = 0;
      let savedColumn = 0;

      const { api: ops } = createUndoRedoOps(
      createUndoRedoDomainState(),
        () => currentBuffer,
        (buffer) => { currentBuffer = buffer; },
        () => savedLine,
        (line) => { savedLine = line; },
        () => savedColumn,
        (col) => { savedColumn = col; },
        () => currentStatusMessage,
        (msg) => { currentStatusMessage = msg; }
      );

      const beginFunc = ops.get("undo-begin")!;
      const commitFunc = ops.get("undo-commit")!;
      const undoFunc = ops.get("undo")!;

      // Edit 1: pre-edit cursor at (0,0); mutate buffer; post-edit cursor at (5,10)
      beginFunc([]);
      const edit1 = new MockBuffer("Edit 1\nLine 2\nLine 3") as TextBuffer;
      currentBuffer = edit1;
      savedLine = 5;
      savedColumn = 10;
      commitFunc([{ type: 'string', value: 'edit1' }]);

      // Cursor moves to (15,20) between edits (not an edit)
      savedLine = 15;
      savedColumn = 20;

      // Edit 2: pre-edit cursor at (15,20); mutate buffer; post-edit cursor at (30,40)
      beginFunc([]);
      const edit2 = new MockBuffer("Edit 2\nLine 2\nLine 3") as TextBuffer;
      currentBuffer = edit2;
      savedLine = 30;
      savedColumn = 40;
      commitFunc([{ type: 'string', value: 'edit2' }]);

      // Undo edit2 — cursor should return to where it was before edit2 was applied
      undoFunc([]);

      expect(savedLine).toBe(15);
      expect(savedColumn).toBe(20);
    });

    test("undo restores the initial cursor when undoing the first edit", () => {
      // Repro: with an empty history, cursor is at (3,7); apply one edit;
      // post-edit cursor is (5,9); undo — cursor should return to (3,7).
      let savedLine = 3;
      let savedColumn = 7;

      const { api: ops } = createUndoRedoOps(
      createUndoRedoDomainState(),
        () => currentBuffer,
        (buffer) => { currentBuffer = buffer; },
        () => savedLine,
        (line) => { savedLine = line; },
        () => savedColumn,
        (col) => { savedColumn = col; },
        () => currentStatusMessage,
        (msg) => { currentStatusMessage = msg; }
      );

      const beginFunc = ops.get("undo-begin")!;
      const commitFunc = ops.get("undo-commit")!;
      const undoFunc = ops.get("undo")!;

      // Edit 1: pre-edit cursor at (3,7); mutate; post-edit cursor at (5,9)
      beginFunc([]);
      const edit1 = new MockBuffer("Edit 1\nLine 2\nLine 3") as TextBuffer;
      currentBuffer = edit1;
      savedLine = 5;
      savedColumn = 9;
      commitFunc([{ type: 'string', value: 'edit1' }]);

      // Undo — cursor should return to the pre-edit position (3,7), NOT post-edit (5,9)
      undoFunc([]);

      expect(savedLine).toBe(3);
      expect(savedColumn).toBe(7);
    });
  });

  describe("BUG-13 follow-up: stale initialCursorLine after undo→move→edit", () => {
    test("first-edit undo after a prior undo→cursor-move→new-edit cycle restores the new edit's pre-edit cursor, not the stale initial", () => {
      // Repro from BUG-13 patch review M-1:
      //   1. iA<Esc>  → edit1 at (0,0). initialCursorLine seeded to 0.
      //   2. u        → undo edit1, currentIndex = -1. Cursor returns to (0,0).
      //   3. j        → cursor moves to (1,0). NOT an edit.
      //   4. iB<Esc>  → edit2 on line 1. history truncated to [edit2]; first-edit branch fires on next undo.
      //   5. u        → BUG: stale initialCursorLine (=0) wins → cursor at (0,0).
      //                 FIX: undoneItem.preCursorLine (=1) wins → cursor at (1,0).
      let savedLine = 0;
      let savedColumn = 0;

      const { api: ops } = createUndoRedoOps(
      createUndoRedoDomainState(),
        () => currentBuffer,
        (buffer) => { currentBuffer = buffer; },
        () => savedLine,
        (line) => { savedLine = line; },
        () => savedColumn,
        (col) => { savedColumn = col; },
        () => currentStatusMessage,
        (msg) => { currentStatusMessage = msg; }
      );

      const beginFunc = ops.get("undo-begin")!;
      const commitFunc = ops.get("undo-commit")!;
      const undoFunc = ops.get("undo")!;

      // Step 1: edit1 at cursor (0,0); post-edit cursor (0,1).
      beginFunc([]);
      const edit1 = new MockBuffer("A\nLine 2\nLine 3") as TextBuffer;
      currentBuffer = edit1;
      savedLine = 0;
      savedColumn = 1;
      commitFunc([{ type: 'string', value: 'edit1' }]);

      // Step 2: undo edit1 — cursor returns to (0,0).
      undoFunc([]);
      expect(savedLine).toBe(0);
      expect(savedColumn).toBe(0);

      // Step 3: cursor moves to (1,0) between edits (not an edit).
      savedLine = 1;
      savedColumn = 0;

      // Step 4: edit2 with pre-edit cursor (1,0); post-edit cursor (1,1).
      beginFunc([]);
      const edit2 = new MockBuffer("A\nB\nLine 3") as TextBuffer;
      currentBuffer = edit2;
      savedLine = 1;
      savedColumn = 1;
      commitFunc([{ type: 'string', value: 'edit2' }]);

      // Step 5: undo edit2 — cursor should return to (1,0), not (0,0).
      undoFunc([]);

      expect(savedLine).toBe(1);
      expect(savedColumn).toBe(0);
    });
  });
});
