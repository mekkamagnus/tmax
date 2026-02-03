/**
 * @file undo-tree.test.ts
 * @description Tests for Undo Tree functionality (US-3.4.1)
 *
 * Tests branching undo history with tree visualization and navigation
 * - Creates branches when undoing and making new edits
 * - Visualizes tree structure with parent-child relationships
 * - Allows navigation between branches
 * - Shows current position in tree
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Either } from "../../src/utils/task-either.ts";
import { createUndoTreeOps, resetUndoTreeState, setInitialBuffer as setTreeInitialBuffer } from "../../src/editor/api/undo-tree.ts";
import type { FunctionalTextBuffer } from "../../src/core/types.ts";

// Mock buffer implementation for testing
class MockBuffer implements FunctionalTextBuffer {
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

  insert(position: { line: number; column: number }, text: string): Either<string, FunctionalTextBuffer> {
    const lines = this.content.split('\n');
    const line = lines[position.line] || "";
    const newLine = line.slice(0, position.column) + text + line.slice(position.column);
    lines[position.line] = newLine;
    const newContent = lines.join('\n');
    const newBuffer = new MockBuffer(newContent);
    return Either.right(newBuffer as FunctionalTextBuffer);
  }

  delete(range: { start: { line: number; column: number }; end: { line: number; column: number } }): Either<string, FunctionalTextBuffer> {
    const lines = this.content.split('\n');

    // Simple case: same line
    if (range.start.line === range.end.line) {
      const line = lines[range.start.line] || "";
      const newLine = line.slice(0, range.start.column) + line.slice(range.end.column);
      lines[range.start.line] = newLine;
      const newContent = lines.join('\n');
      const newBuffer = new MockBuffer(newContent);
      return Either.right(newBuffer as FunctionalTextBuffer);
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
    return Either.right(newBuffer as FunctionalTextBuffer);
  }

  replace(range: { start: { line: number; column: number }; end: { line: number; column: number } }, text: string): Either<string, FunctionalTextBuffer> {
    const deleteResult = this.delete(range);
    if (Either.isLeft(deleteResult)) {
      return deleteResult;
    }
    return deleteResult.right.insert(range.start, text);
  }

  getText(range: { start: { line: number; column: number }; end: { line: number; column: number } }): Either<string, string> {
    const lines = this.content.split('\n');

    if (range.start.line === range.end.line) {
      const line = lines[range.start.line] || "";
      const text = line.slice(range.start.column, range.end.column);
      return Either.right(text);
    }

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

describe("Undo Tree Operations", () => {
  let currentBuffer: FunctionalTextBuffer | null;
  let undoTreeOps: Map<string, (args: any[]) => Either<any, any>>;

  beforeEach(() => {
    // Reset state before each test
    resetUndoTreeState();
    currentBuffer = new MockBuffer("Initial content\nLine 2\nLine 3") as FunctionalTextBuffer;

    undoTreeOps = createUndoTreeOps(
      () => currentBuffer,
      (buffer) => { currentBuffer = buffer; },
      () => 0,  // cursorLine
      (line) => {},  // setCursorLine
      () => 0,  // cursorColumn
      (col) => {}  // setCursorColumn
    );
  });

  describe("Branch creation", () => {
    test("creates branch when undoing and making new edit", () => {
      setTreeInitialBuffer(currentBuffer!);
      const pushFunc = undoTreeOps.get("undo-tree-push")!;
      const undoFunc = undoTreeOps.get("undo-tree-undo")!;
      const treeFunc = undoTreeOps.get("undo-tree-structure")!;

      // Create edits A, B, C
      const editA = new MockBuffer("Edit A\nLine 2\nLine 3") as FunctionalTextBuffer;
      const editB = new MockBuffer("Edit B\nLine 2\nLine 3") as FunctionalTextBuffer;
      const editC = new MockBuffer("Edit C\nLine 2\nLine 3") as FunctionalTextBuffer;

      pushFunc([{ type: 'string', value: 'A' }, { buffer: editA }]);
      pushFunc([{ type: 'string', value: 'B' }, { buffer: editB }]);
      pushFunc([{ type: 'string', value: 'C' }, { buffer: editC }]);

      // Undo to A
      undoFunc([]);
      undoFunc([]);

      // Create new edit D (creates branch)
      const editD = new MockBuffer("Edit D\nLine 2\nLine 3") as FunctionalTextBuffer;
      pushFunc([{ type: 'string', value: 'D' }, { buffer: editD }]);

      // Get tree structure
      const treeResult = treeFunc([]);
      expect(Either.isRight(treeResult)).toBe(true);

      // Tree should show branches: A→B→C and A→D
      const tree = treeResult.right;
      expect(tree.type).toBe('list');
      expect(tree.value).toHaveProperty('length');

      // Parse the tree structure
      const nodes = tree.value as any[];
      const findNode = (name: string) => nodes.find((n: any) =>
        n.type === 'list' && n.value[0]?.value === name
      );

      const nodeA = findNode('A');
      const nodeB = findNode('B');
      const nodeC = findNode('C');
      const nodeD = findNode('D');

      expect(nodeA).toBeDefined();
      expect(nodeB).toBeDefined();
      expect(nodeC).toBeDefined();
      expect(nodeD).toBeDefined();
    });

    test("creates multiple branches from same point", () => {
      setTreeInitialBuffer(currentBuffer!);
      const pushFunc = undoTreeOps.get("undo-tree-push")!;
      const undoFunc = undoTreeOps.get("undo-tree-undo")!;

      // Create edit A
      const editA = new MockBuffer("Edit A\nLine 2\nLine 3") as FunctionalTextBuffer;
      pushFunc([{ type: 'string', value: 'A' }, { buffer: editA }]);

      // Undo to initial
      undoFunc([]);

      // Create edit B (branch 1)
      const editB = new MockBuffer("Edit B\nLine 2\nLine 3") as FunctionalTextBuffer;
      pushFunc([{ type: 'string', value: 'B' }, { buffer: editB }]);

      // Undo to initial
      undoFunc([]);

      // Create edit C (branch 2)
      const editC = new MockBuffer("Edit C\nLine 2\nLine 3") as FunctionalTextBuffer;
      pushFunc([{ type: 'string', value: 'C' }, { buffer: editC }]);

      // Get tree structure
      const treeFunc = undoTreeOps.get("undo-tree-structure")!;
      const treeResult = treeFunc([]);
      expect(Either.isRight(treeResult)).toBe(true);

      // Should have branches: initial→A, initial→B, initial→C
      const tree = treeResult.right;
      const nodes = tree.value as any[];

      const findNode = (name: string) => nodes.find((n: any) =>
        n.type === 'list' && n.value[0]?.value === name
      );

      expect(findNode('A')).toBeDefined();
      expect(findNode('B')).toBeDefined();
      expect(findNode('C')).toBeDefined();
    });
  });

  describe("Branch navigation", () => {
    test("navigates to branch point and selects branch", () => {
      setTreeInitialBuffer(currentBuffer!);
      const pushFunc = undoTreeOps.get("undo-tree-push")!;
      const undoFunc = undoTreeOps.get("undo-tree-undo")!;
      const gotoFunc = undoTreeOps.get("undo-tree-goto")!;

      // Create edits A, B, C
      const editA = new MockBuffer("Edit A\nLine 2\nLine 3") as FunctionalTextBuffer;
      const editB = new MockBuffer("Edit B\nLine 2\nLine 3") as FunctionalTextBuffer;
      const editC = new MockBuffer("Edit C\nLine 2\nLine 3") as FunctionalTextBuffer;

      pushFunc([{ type: 'string', value: 'A' }, { buffer: editA }]);
      pushFunc([{ type: 'string', value: 'B' }, { buffer: editB }]);
      pushFunc([{ type: 'string', value: 'C' }, { buffer: editC }]);

      // Undo to A
      undoFunc([]);
      undoFunc([]);

      // Create new edit D (creates branch)
      const editD = new MockBuffer("Edit D\nLine 2\nLine 3") as FunctionalTextBuffer;
      pushFunc([{ type: 'string', value: 'D' }, { buffer: editD }]);

      // Navigate to node C
      const gotoResult = gotoFunc([{ type: 'number', value: 2 }]); // Index of C
      expect(Either.isRight(gotoResult)).toBe(true);

      // Buffer should be at C state
      const contentResult = currentBuffer!.getContent();
      expect(Either.isRight(contentResult)).toBe(true);
      expect(contentResult.right).toBe("Edit C\nLine 2\nLine 3");
    });

    test("switches between branches at branch point", () => {
      setTreeInitialBuffer(currentBuffer!);
      const pushFunc = undoTreeOps.get("undo-tree-push")!;
      const undoFunc = undoTreeOps.get("undo-tree-undo")!;
      const gotoFunc = undoTreeOps.get("undo-tree-goto")!;

      // Create edits A, B
      const editA = new MockBuffer("Edit A\nLine 2\nLine 3") as FunctionalTextBuffer;
      const editB = new MockBuffer("Edit B\nLine 2\nLine 3") as FunctionalTextBuffer;

      pushFunc([{ type: 'string', value: 'A' }, { buffer: editA }]);
      pushFunc([{ type: 'string', value: 'B' }, { buffer: editB }]);

      // Undo to A
      undoFunc([]);

      // Create edit C (branch)
      const editC = new MockBuffer("Edit C\nLine 2\nLine 3") as FunctionalTextBuffer;
      pushFunc([{ type: 'string', value: 'C' }, { buffer: editC }]);

      // Navigate to B
      gotoFunc([{ type: 'number', value: 1 }]);

      // Buffer should be at B state
      let contentResult = currentBuffer!.getContent();
      expect(Either.isRight(contentResult)).toBe(true);
      expect(contentResult.right).toBe("Edit B\nLine 2\nLine 3");

      // Navigate to C
      gotoFunc([{ type: 'number', value: 2 }]);

      // Buffer should be at C state
      contentResult = currentBuffer!.getContent();
      expect(Either.isRight(contentResult)).toBe(true);
      expect(contentResult.right).toBe("Edit C\nLine 2\nLine 3");
    });
  });

  describe("Tree visualization", () => {
    test("shows tree structure with parent-child relationships", () => {
      setTreeInitialBuffer(currentBuffer!);
      const pushFunc = undoTreeOps.get("undo-tree-push")!;
      const undoFunc = undoTreeOps.get("undo-tree-undo")!;
      const treeFunc = undoTreeOps.get("undo-tree-structure")!;

      // Create edits A, B, C
      const editA = new MockBuffer("Edit A\nLine 2\nLine 3") as FunctionalTextBuffer;
      const editB = new MockBuffer("Edit B\nLine 2\nLine 3") as FunctionalTextBuffer;
      const editC = new MockBuffer("Edit C\nLine 2\nLine 3") as FunctionalTextBuffer;

      pushFunc([{ type: 'string', value: 'A' }, { buffer: editA }]);
      pushFunc([{ type: 'string', value: 'B' }, { buffer: editB }]);
      pushFunc([{ type: 'string', value: 'C' }, { buffer: editC }]);

      // Undo to A and create branch D
      undoFunc([]);
      undoFunc([]);
      const editD = new MockBuffer("Edit D\nLine 2\nLine 3") as FunctionalTextBuffer;
      pushFunc([{ type: 'string', value: 'D' }, { buffer: editD }]);

      // Get tree structure
      const treeResult = treeFunc([]);
      expect(Either.isRight(treeResult)).toBe(true);

      const tree = treeResult.right;
      expect(tree.type).toBe('list');

      // Should show parent-child relationships
      const nodes = tree.value as any[];
      expect(nodes.length).toBeGreaterThan(0);
    });

    test("marks current position in tree", () => {
      setTreeInitialBuffer(currentBuffer!);
      const pushFunc = undoTreeOps.get("undo-tree-push")!;
      const currentFunc = undoTreeOps.get("undo-tree-current")!;

      // Create edit A
      const editA = new MockBuffer("Edit A\nLine 2\nLine 3") as FunctionalTextBuffer;
      pushFunc([{ type: 'string', value: 'A' }, { buffer: editA }]);

      // Get current position
      const currentResult = currentFunc([]);
      expect(Either.isRight(currentResult)).toBe(true);

      const current = currentResult.right;
      expect(current.type).toBe('number');
      expect(current.value).toBe(0); // Should be at index 0 (edit A)
    });

    test("shows branches from each node", () => {
      setTreeInitialBuffer(currentBuffer!);
      const pushFunc = undoTreeOps.get("undo-tree-push")!;
      const undoFunc = undoTreeOps.get("undo-tree-undo")!;
      const branchesFunc = undoTreeOps.get("undo-tree-branches")!;

      // Create edits A, B, C
      const editA = new MockBuffer("Edit A\nLine 2\nLine 3") as FunctionalTextBuffer;
      const editB = new MockBuffer("Edit B\nLine 2\nLine 3") as FunctionalTextBuffer;
      const editC = new MockBuffer("Edit C\nLine 2\nLine 3") as FunctionalTextBuffer;

      pushFunc([{ type: 'string', value: 'A' }, { buffer: editA }]);
      pushFunc([{ type: 'string', value: 'B' }, { buffer: editB }]);
      pushFunc([{ type: 'string', value: 'C' }, { buffer: editC }]);

      // Undo to A and create branch D
      undoFunc([]);
      undoFunc([]);
      const editD = new MockBuffer("Edit D\nLine 2\nLine 3") as FunctionalTextBuffer;
      pushFunc([{ type: 'string', value: 'D' }, { buffer: editD }]);

      // Get branches from node A (index 0)
      const branchesResult = branchesFunc([{ type: 'number', value: 0 }]);
      expect(Either.isRight(branchesResult)).toBe(true);

      const branches = branchesResult.right;
      expect(branches.type).toBe('list');

      // Should have 2 branches from A: B and D
      const branchList = branches.value as any[];
      expect(branchList.length).toBe(2);
    });
  });

  describe("Tree state management", () => {
    test("tracks all nodes in tree", () => {
      setTreeInitialBuffer(currentBuffer!);
      const pushFunc = undoTreeOps.get("undo-tree-push")!;
      const nodesFunc = undoTreeOps.get("undo-tree-nodes")!;

      // Create edits A, B, C
      const editA = new MockBuffer("Edit A\nLine 2\nLine 3") as FunctionalTextBuffer;
      const editB = new MockBuffer("Edit B\nLine 2\nLine 3") as FunctionalTextBuffer;
      const editC = new MockBuffer("Edit C\nLine 2\nLine 3") as FunctionalTextBuffer;

      pushFunc([{ type: 'string', value: 'A' }, { buffer: editA }]);
      pushFunc([{ type: 'string', value: 'B' }, { buffer: editB }]);
      pushFunc([{ type: 'string', value: 'C' }, { buffer: editC }]);

      // Get node count
      const nodesResult = nodesFunc([]);
      expect(Either.isRight(nodesResult)).toBe(true);

      const nodes = nodesResult.right;
      expect(nodes.type).toBe('number');
      expect(nodes.value).toBe(3); // A, B, C
    });

    test("resets tree state correctly", () => {
      setTreeInitialBuffer(currentBuffer!);
      const pushFunc = undoTreeOps.get("undo-tree-push")!;
      const resetFunc = undoTreeOps.get("undo-tree-reset")!;
      const nodesFunc = undoTreeOps.get("undo-tree-nodes")!;

      // Create some edits
      const editA = new MockBuffer("Edit A\nLine 2\nLine 3") as FunctionalTextBuffer;
      pushFunc([{ type: 'string', value: 'A' }, { buffer: editA }]);

      // Reset
      const resetResult = resetFunc([]);
      expect(Either.isRight(resetResult)).toBe(true);

      // Should have 0 nodes
      const nodesResult = nodesFunc([]);
      expect(Either.isRight(nodesResult)).toBe(true);
      expect(nodesResult.right.value).toBe(0);
    });
  });

  describe("Linear undo behavior (backward compatibility)", () => {
    test("works like linear undo when no branches", () => {
      setTreeInitialBuffer(currentBuffer!);
      const pushFunc = undoTreeOps.get("undo-tree-push")!;
      const undoFunc = undoTreeOps.get("undo-tree-undo")!;
      const redoFunc = undoTreeOps.get("undo-tree-redo")!;

      // Create edits A, B, C
      const editA = new MockBuffer("Edit A\nLine 2\nLine 3") as FunctionalTextBuffer;
      const editB = new MockBuffer("Edit B\nLine 2\nLine 3") as FunctionalTextBuffer;
      const editC = new MockBuffer("Edit C\nLine 2\nLine 3") as FunctionalTextBuffer;

      pushFunc([{ type: 'string', value: 'A' }, { buffer: editA }]);
      pushFunc([{ type: 'string', value: 'B' }, { buffer: editB }]);
      pushFunc([{ type: 'string', value: 'C' }, { buffer: editC }]);

      // Undo twice
      undoFunc([]);
      undoFunc([]);

      // Should be at A
      let contentResult = currentBuffer!.getContent();
      expect(Either.isRight(contentResult)).toBe(true);
      expect(contentResult.right).toBe("Edit A\nLine 2\nLine 3");

      // Redo
      redoFunc([]);

      // Should be at B
      contentResult = currentBuffer!.getContent();
      expect(Either.isRight(contentResult)).toBe(true);
      expect(contentResult.right).toBe("Edit B\nLine 2\nLine 3");
    });
  });
});
