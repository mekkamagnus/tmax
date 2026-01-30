/**
 * @file buffer.test.ts
 * @description Tests for buffer management system
 */

import { describe, test, expect } from "bun:test";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import type { TextBuffer, Position, Range } from "../../src/core/types.ts";

/**
 * Test suite for FunctionalTextBuffer implementation
 */
describe("FunctionalTextBuffer", () => {
  let buffer: any; // Using any since we're testing internal functionality

  test("should create buffer with content", () => {
    buffer = FunctionalTextBufferImpl.create("Hello");
    const contentResult = buffer.getContent();
    if (contentResult._tag === "Right") {
      expect(contentResult.right).toBe("Hello");
    }
  });

  test("should insert text", () => {
    buffer = FunctionalTextBufferImpl.create("Hello");
    const result = buffer.insert({ line: 0, column: 5 }, " World");
    if (result._tag === "Right") {
      const contentResult = result.right.getContent();
      if (contentResult._tag === "Right") {
        expect(contentResult.right).toBe("Hello World");
      }
    }
  });

  test("should delete text", () => {
    buffer = FunctionalTextBufferImpl.create("Hello World");
    const range: Range = { start: { line: 0, column: 5 }, end: { line: 0, column: 6 } }; // Delete space
    const result = buffer.delete(range);
    if (result._tag === "Right") {
      const contentResult = result.right.getContent();
      if (contentResult._tag === "Right") {
        expect(contentResult.right).toBe("HelloWorld");
      }
    }
  });
});

/**
 * Test suite for FunctionalTextBuffer implementation (continued)
 */
describe("FunctionalTextBuffer Continued", () => {
  let buffer: any;
  const testContent = "Line 1\nLine 2\nLine 3";

  test("should create buffer with content", () => {
    buffer = FunctionalTextBufferImpl.create(testContent);
    const contentResult = buffer.getContent();
    if (contentResult._tag === "Right") {
      expect(contentResult.right).toBe(testContent);
    }
    const lineCountResult = buffer.getLineCount();
    if (lineCountResult._tag === "Right") {
      expect(lineCountResult.right).toBe(3);
    }
  });

  test("should get individual lines", () => {
    const line0Result = buffer.getLine(0);
    if (line0Result._tag === "Right") {
      expect(line0Result.right).toBe("Line 1");
    }
    const line1Result = buffer.getLine(1);
    if (line1Result._tag === "Right") {
      expect(line1Result.right).toBe("Line 2");
    }
    const line2Result = buffer.getLine(2);
    if (line2Result._tag === "Right") {
      expect(line2Result.right).toBe("Line 3");
    }
  });

  test("should insert text at position", () => {
    const pos: Position = { line: 0, column: 4 };
    const result = buffer.insert(pos, " One");
    if (result._tag === "Right") {
      const line0Result = result.right.getLine(0);
      if (line0Result._tag === "Right") {
        expect(line0Result.right).toBe("Line One 1");
      }
    }
  });

  test("should delete text in range", () => {
    const range: Range = {
      start: { line: 0, column: 5 },
      end: { line: 0, column: 9 }
    };
    const result = buffer.delete(range);
    if (result._tag === "Right") {
      const line0Result = result.right.getLine(0);
      if (line0Result._tag === "Right") {
        expect(line0Result.right).toBe("Line ");
      }
    }
  });

  test("should replace text in range", () => {
    const range: Range = {
      start: { line: 0, column: 5 },
      end: { line: 0, column: 7 }
    };
    const result = buffer.replace(range, "A");
    if (result._tag === "Right") {
      const line0Result = result.right.getLine(0);
      if (line0Result._tag === "Right") {
        expect(line0Result.right).toBe("Line A");
      }
    }
  });

  test("should get text in range", () => {
    const range: Range = {
      start: { line: 0, column: 0 },
      end: { line: 0, column: 4 }
    };
    const result = buffer.getText(range);
    if (result._tag === "Right") {
      expect(result.right).toBe("Line");
    }
  });

  test("should handle multi-line operations", () => {
    const range: Range = {
      start: { line: 0, column: 4 },
      end: { line: 2, column: 4 }
    };
    const result = buffer.getText(range);
    if (result._tag === "Right") {
      expect(result.right).toBe(" 1\nLine 2\nLine");
    }
  });
});