/**
 * @file yank-operator-integration.test.ts
 * @description Integration tests for yank operator functionality (US-1.2.2)
 *
 * Tests Vim-style yank operator with motion support through T-Lisp API
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import type { FunctionalTextBuffer } from "../../src/core/types.ts";
import { Either } from "../../src/utils/task-either.ts";
import { createYankOps } from "../../src/editor/api/yank-ops.ts";

/**
 * Test helper to create a buffer with content
 */
function createBuffer(content: string): FunctionalTextBuffer {
  return FunctionalTextBufferImpl.create(content);
}

/**
 * Test helper to get buffer content as string
 */
function getBufferContent(buffer: FunctionalTextBuffer): string {
  const result = buffer.getContent();
  if (Either.isLeft(result)) {
    throw new Error(`Failed to get buffer content: ${result.left}`);
  }
  return result.right;
}

describe("Yank Operator Integration - US-1.2.2", () => {
  let currentBuffer: FunctionalTextBuffer | null;
  let cursorLine: number;
  let cursorColumn: number;
  let yankOps: Map<string, (args: any[]) => Either<any, any>>;

  beforeEach(() => {
    currentBuffer = null;
    cursorLine = 0;
    cursorColumn = 0;

    // Create yank operations with mock state
    yankOps = createYankOps(
      () => currentBuffer,
      (buf) => { currentBuffer = buf; },
      () => cursorLine,
      (line) => { cursorLine = line; },
      () => cursorColumn,
      (col) => { cursorColumn = col; }
    );

    // Clear the yank register
    const setRegisterFn = yankOps.get("yank-register-set")!;
    setRegisterFn([{ type: "string", value: "" }]);
  });

  describe("yw - yank word", () => {
    test("should yank current word without deleting buffer content", () => {
      currentBuffer = createBuffer("hello world foo bar");
      cursorLine = 0;
      cursorColumn = 0;

      const initialContent = getBufferContent(currentBuffer);
      const yankWordFn = yankOps.get("yank-word")!;

      const result = yankWordFn([]);
      expect(Either.isRight(result)).toBe(true);

      // Buffer should remain unchanged
      expect(getBufferContent(currentBuffer)).toBe(initialContent);
      expect(getBufferContent(currentBuffer)).toBe("hello world foo bar");

      // Register should contain yanked word
      const getRegisterFn = yankOps.get("yank-register-get")!;
      const registerResult = getRegisterFn([]);
      expect(Either.isRight(registerResult)).toBe(true);
      expect(registerResult.right.value).toBe("hello");
    });

    test("should support count prefix (3yw yanks 3 words)", () => {
      currentBuffer = createBuffer("one two three four five");
      cursorLine = 0;
      cursorColumn = 0;

      const initialContent = getBufferContent(currentBuffer);
      const yankWordFn = yankOps.get("yank-word")!;

      const result = yankWordFn([{ type: "number", value: 3 }]);
      expect(Either.isRight(result)).toBe(true);

      // Buffer should remain unchanged
      expect(getBufferContent(currentBuffer)).toBe(initialContent);

      // Register should contain 3 words
      const getRegisterFn = yankOps.get("yank-register-get")!;
      const registerResult = getRegisterFn([]);
      expect(Either.isRight(registerResult)).toBe(true);
      expect(registerResult.right.value).toBe("one two three");
    });
  });

  describe("yy - yank line", () => {
    test("should yank entire line without deleting", () => {
      currentBuffer = createBuffer("first line\nsecond line\nthird line");
      cursorLine = 0;
      cursorColumn = 5;

      const initialContent = getBufferContent(currentBuffer);
      const yankLineFn = yankOps.get("yank-line")!;

      const result = yankLineFn([]);
      expect(Either.isRight(result)).toBe(true);

      // Buffer should remain unchanged
      expect(getBufferContent(currentBuffer)).toBe(initialContent);

      // Register should contain line with newline
      const getRegisterFn = yankOps.get("yank-register-get")!;
      const registerResult = getRegisterFn([]);
      expect(Either.isRight(registerResult)).toBe(true);
      expect(registerResult.right.value).toBe("first line\n");
    });

    test("should support count prefix (3yy yanks 3 lines)", () => {
      currentBuffer = createBuffer("line 1\nline 2\nline 3\nline 4\nline 5");
      cursorLine = 1;
      cursorColumn = 0;

      const initialContent = getBufferContent(currentBuffer);
      const yankLineFn = yankOps.get("yank-line")!;

      const result = yankLineFn([{ type: "number", value: 3 }]);
      expect(Either.isRight(result)).toBe(true);

      // Buffer should remain unchanged
      expect(getBufferContent(currentBuffer)).toBe(initialContent);

      // Register should contain 3 lines
      const getRegisterFn = yankOps.get("yank-register-get")!;
      const registerResult = getRegisterFn([]);
      expect(Either.isRight(registerResult)).toBe(true);
      expect(registerResult.right.value).toBe("line 2\nline 3\nline 4\n");
    });
  });

  describe("y$ - yank to end of line", () => {
    test("should yank from cursor to end of line", () => {
      currentBuffer = createBuffer("hello world foo bar");
      cursorLine = 0;
      cursorColumn = 6;

      const initialContent = getBufferContent(currentBuffer);
      const yankToEndFn = yankOps.get("yank-to-line-end")!;

      const result = yankToEndFn([]);
      expect(Either.isRight(result)).toBe(true);

      // Buffer should remain unchanged
      expect(getBufferContent(currentBuffer)).toBe(initialContent);

      // Register should contain text from cursor to end
      const getRegisterFn = yankOps.get("yank-register-get")!;
      const registerResult = getRegisterFn([]);
      expect(Either.isRight(registerResult)).toBe(true);
      expect(registerResult.right.value).toBe("world foo bar");
    });
  });

  describe("p - paste after cursor", () => {
    test("should paste character after cursor", () => {
      currentBuffer = createBuffer("hello world");
      cursorLine = 0;
      cursorColumn = 5;

      const lineCountResult = currentBuffer?.getLineCount();
      const lineCount = Either.isRight(lineCountResult) ? lineCountResult.right : "error";

      // First yank some text
      const yankWordFn = yankOps.get("yank-word")!;
      yankWordFn([]);

      // Then paste it
      const pasteAfterFn = yankOps.get("paste-after")!;
      const result = pasteAfterFn([]);
      expect(Either.isRight(result)).toBe(true);

      // Check that paste happened
      const afterLineCountResult = currentBuffer?.getLineCount();
      const afterLineCount = Either.isRight(afterLineCountResult) ? afterLineCountResult.right : "error";
      expect(getBufferContent(currentBuffer)).toBe("hello helloworld");
    });

    test("should paste line below current line", () => {
      currentBuffer = createBuffer("first line\nsecond line");
      cursorLine = 0;
      cursorColumn = 0;

      // First yank a line
      const yankLineFn = yankOps.get("yank-line")!;
      yankLineFn([]);

      // Reset cursor to second line
      cursorLine = 1;

      // Then paste it
      const pasteAfterFn = yankOps.get("paste-after")!;
      const result = pasteAfterFn([]);
      expect(Either.isRight(result)).toBe(true);

      // Check that line was pasted below
      expect(getBufferContent(currentBuffer)).toBe("first line\nfirst line\nsecond line");
    });

    test("should support count prefix (3p pastes 3 times)", () => {
      currentBuffer = createBuffer("hello world");
      cursorLine = 0;
      cursorColumn = 0;

      // First yank a word
      cursorColumn = 6;
      const yankWordFn = yankOps.get("yank-word")!;
      yankWordFn([]);

      // Reset cursor
      cursorColumn = 5;

      // Then paste it 3 times
      const pasteAfterFn = yankOps.get("paste-after")!;
      const result = pasteAfterFn([{ type: "number", value: 3 }]);
      expect(Either.isRight(result)).toBe(true);

      // Check that paste happened 3 times
      expect(getBufferContent(currentBuffer)).toBe("hello worldworldworld");
    });
  });

  describe("P - paste before cursor", () => {
    test("should paste character before cursor", () => {
      currentBuffer = createBuffer("hello world");
      cursorLine = 0;
      cursorColumn = 6;

      // First yank some text
      cursorColumn = 0;
      const yankWordFn = yankOps.get("yank-word")!;
      yankWordFn([]);

      // Reset cursor
      cursorColumn = 6;

      // Then paste it before cursor
      const pasteBeforeFn = yankOps.get("paste-before")!;
      const result = pasteBeforeFn([]);
      expect(Either.isRight(result)).toBe(true);

      // Check that paste happened before cursor
      expect(getBufferContent(currentBuffer)).toBe("hellohello world");
    });

    test("should paste line above current line", () => {
      currentBuffer = createBuffer("first line\nsecond line");
      cursorLine = 0;
      cursorColumn = 0;

      // First yank a line from second position
      cursorLine = 1;
      const yankLineFn = yankOps.get("yank-line")!;
      yankLineFn([]);

      // Reset cursor to first line
      cursorLine = 0;

      // Then paste it before
      const pasteBeforeFn = yankOps.get("paste-before")!;
      const result = pasteBeforeFn([]);
      expect(Either.isRight(result)).toBe(true);

      // Check that line was pasted above
      expect(getBufferContent(currentBuffer)).toBe("second line\nfirst line\nsecond line");
    });
  });

  describe("Empty register handling", () => {
    test("paste-after should handle empty register gracefully", () => {
      currentBuffer = createBuffer("hello world");
      cursorLine = 0;
      cursorColumn = 5;

      const initialContent = getBufferContent(currentBuffer);

      const pasteAfterFn = yankOps.get("paste-after")!;
      const result = pasteAfterFn([]);
      expect(Either.isRight(result)).toBe(true);

      // Buffer should remain unchanged
      expect(getBufferContent(currentBuffer)).toBe(initialContent);
    });

    test("paste-before should handle empty register gracefully", () => {
      currentBuffer = createBuffer("hello world");
      cursorLine = 0;
      cursorColumn = 5;

      const initialContent = getBufferContent(currentBuffer);

      const pasteBeforeFn = yankOps.get("paste-before")!;
      const result = pasteBeforeFn([]);
      expect(Either.isRight(result)).toBe(true);

      // Buffer should remain unchanged
      expect(getBufferContent(currentBuffer)).toBe(initialContent);
    });
  });

  describe("Edge cases", () => {
    test("should handle empty buffer", () => {
      currentBuffer = createBuffer("");
      cursorLine = 0;
      cursorColumn = 0;

      const yankLineFn = yankOps.get("yank-line")!;
      const result = yankLineFn([]);
      expect(Either.isRight(result)).toBe(true);
    });

    test("should handle single word buffer", () => {
      currentBuffer = createBuffer("hello");
      cursorLine = 0;
      cursorColumn = 0;

      const yankWordFn = yankOps.get("yank-word")!;
      const result = yankWordFn([]);
      expect(Either.isRight(result)).toBe(true);

      // Register should contain the word
      const getRegisterFn = yankOps.get("yank-register-get")!;
      const registerResult = getRegisterFn([]);
      expect(Either.isRight(registerResult)).toBe(true);
      expect(registerResult.right.value).toBe("hello");
    });

    test("should handle yanking at end of file", () => {
      currentBuffer = createBuffer("line 1\nline 2\nline 3");
      cursorLine = 2;
      cursorColumn = 0;

      const yankLineFn = yankOps.get("yank-line")!;
      const result = yankLineFn([]);
      expect(Either.isRight(result)).toBe(true);
    });
  });
});
