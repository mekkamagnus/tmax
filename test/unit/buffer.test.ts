/**
 * @file buffer.test.ts
 * @description Tests for buffer management system
 */

import { assertEquals, assertExists } from "@std/assert";
import { GapBuffer, TextBufferImpl } from "../../src/core/buffer.ts";
import type { TextBuffer, Position, Range } from "../../src/core/types.ts";

/**
 * Test suite for GapBuffer implementation
 */
Deno.test("GapBuffer", async (t) => {
  let buffer: GapBuffer;

  await t.step("should create empty gap buffer", () => {
    buffer = new GapBuffer();
    assertEquals(buffer.length(), 0);
    assertEquals(buffer.toString(), "");
  });

  await t.step("should insert text at beginning", () => {
    buffer.insert(0, "Hello");
    assertEquals(buffer.length(), 5);
    assertEquals(buffer.toString(), "Hello");
  });

  await t.step("should insert text at end", () => {
    buffer.insert(5, " World");
    assertEquals(buffer.length(), 11);
    assertEquals(buffer.toString(), "Hello World");
  });

  await t.step("should insert text in middle", () => {
    buffer.insert(5, ",");
    assertEquals(buffer.length(), 12);
    assertEquals(buffer.toString(), "Hello, World");
  });

  await t.step("should delete text", () => {
    buffer.delete(5, 1); // Delete comma
    assertEquals(buffer.length(), 11);
    assertEquals(buffer.toString(), "Hello World");
  });

  await t.step("should get character at position", () => {
    assertEquals(buffer.charAt(0), "H");
    assertEquals(buffer.charAt(6), "W");
  });

  await t.step("should get substring", () => {
    assertEquals(buffer.substring(0, 5), "Hello");
    assertEquals(buffer.substring(6, 11), "World");
  });
});

/**
 * Test suite for TextBuffer implementation
 */
Deno.test("TextBuffer", async (t) => {
  let buffer: TextBuffer;
  const testContent = "Line 1\nLine 2\nLine 3";

  await t.step("should create buffer with content", () => {
    buffer = new TextBufferImpl(testContent);
    assertEquals(buffer.getContent(), testContent);
    assertEquals(buffer.getLineCount(), 3);
  });

  await t.step("should get individual lines", () => {
    assertEquals(buffer.getLine(0), "Line 1");
    assertEquals(buffer.getLine(1), "Line 2");
    assertEquals(buffer.getLine(2), "Line 3");
  });

  await t.step("should insert text at position", () => {
    const pos: Position = { line: 0, column: 4 };
    buffer.insert(pos, " One");
    assertEquals(buffer.getLine(0), "Line One 1");
  });

  await t.step("should delete text in range", () => {
    const range: Range = {
      start: { line: 0, column: 5 },
      end: { line: 0, column: 9 }
    };
    buffer.delete(range);
    assertEquals(buffer.getLine(0), "Line 1");
  });

  await t.step("should replace text in range", () => {
    const range: Range = {
      start: { line: 0, column: 5 },
      end: { line: 0, column: 7 }
    };
    buffer.replace(range, "A");
    assertEquals(buffer.getLine(0), "Line A");
  });

  await t.step("should get text in range", () => {
    const range: Range = {
      start: { line: 0, column: 0 },
      end: { line: 0, column: 4 }
    };
    assertEquals(buffer.getText(range), "Line");
  });

  await t.step("should handle multi-line operations", () => {
    const range: Range = {
      start: { line: 0, column: 4 },
      end: { line: 2, column: 4 }
    };
    const text = buffer.getText(range);
    assertEquals(text, " A\nLine 2\nLine");
  });
});