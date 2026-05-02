/**
 * @file kill-ring-storage.test.ts
 * @description Tests for kill ring storage functionality (US-1.9.1)
 *
 * Tests Emacs-style kill ring for deleted/yanked text:
 * - Deleted text added to front of kill-ring
 * - New deletions push older items back
 * - Ring size limit (default 5) removes oldest when full
 * - p pastes item from front of kill-ring
 * - (kill-ring-rotate) rotates ring items
 * - (kill-ring-list) shows all items
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { registerTestingFramework } from "../../src/tlisp/test-framework.ts";
import type { FunctionalTextBuffer } from "../../src/core/types.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import { createKillRingOps, resetKillRing } from "../../src/editor/api/kill-ring.ts";

describe("Kill Ring Storage (US-1.9.1)", () => {
  let interpreter: TLispInterpreterImpl;
  let mockBuffer: FunctionalTextBuffer;

  beforeEach(() => {
    // Reset kill ring state before each test
    resetKillRing();

    // Create fresh interpreter for each test
    interpreter = new TLispInterpreterImpl();

    // Register testing framework
    registerTestingFramework(interpreter);

    // Register kill ring functions
    const killRingOps = createKillRingOps();
    for (const [name, func] of killRingOps.entries()) {
      interpreter.defineBuiltin(name, func);
    }

    // Create a mock buffer with some test content
    mockBuffer = FunctionalTextBufferImpl.create();
    mockBuffer.insert({ line: 0, column: 0 }, "Hello world\nThis is a test\nAnother line");

    // Define buffer variable in interpreter
    interpreter.execute(`
      (defvar buffer (quote BUFFER_PLACEHOLDER))
    `);

    // Set up kill ring functions in current environment
    interpreter.execute(`
      (defvar kill-ring-max 5)
      (defvar kill-ring (quote ()))
    `);
  });

  describe("Kill Ring Storage", () => {
    test("Deleted text added to front of kill-ring", () => {
      const result = interpreter.execute(`
        (kill-ring-save "first deletion")
        (kill-ring-list)
      `);

      expect(result._tag).toBe("Right");
      const killRingList = result.right;
      expect(killRingList).toHaveProperty("type", "list");
      expect(killRingList.value).toHaveLength(1);
      expect(killRingList.value[0]).toEqual({
        type: "string",
        value: "first deletion"
      });
    });

    test("New deletions push older items back", () => {
      const result = interpreter.execute(`
        (kill-ring-save "first")
        (kill-ring-save "second")
        (kill-ring-save "third")
        (kill-ring-list)
      `);

      expect(result._tag).toBe("Right");
      const killRingList = result.right;
      expect(killRingList).toHaveProperty("type", "list");
      expect(killRingList.value).toHaveLength(3);
      // Most recent is first
      expect(killRingList.value[0]).toEqual({
        type: "string",
        value: "third"
      });
      expect(killRingList.value[1]).toEqual({
        type: "string",
        value: "second"
      });
      expect(killRingList.value[2]).toEqual({
        type: "string",
        value: "first"
      });
    });

    test("Ring size limit (default 5) removes oldest when full", () => {
      const result = interpreter.execute(`
        (kill-ring-save "item1")
        (kill-ring-save "item2")
        (kill-ring-save "item3")
        (kill-ring-save "item4")
        (kill-ring-save "item5")
        (kill-ring-save "item6")  ; This should remove item1
        (kill-ring-list)
      `);

      expect(result._tag).toBe("Right");
      const killRingList = result.right;
      expect(killRingList).toHaveProperty("type", "list");
      expect(killRingList.value).toHaveLength(5); // Still 5 items
      // item1 should be gone
      const values = killRingList.value.map((item: any) => item.value);
      expect(values).not.toContain("item1");
      expect(values).toContain("item6");
      expect(values).toContain("item5");
      expect(killRingList.value[0]).toEqual({
        type: "string",
        value: "item6"
      });
    });

    test("p pastes item from front of kill-ring", () => {
      // First populate the kill ring
      interpreter.execute(`
        (kill-ring-save "text to paste")
      `);

      // Then paste it
      const result = interpreter.execute(`
        (kill-ring-yank)
      `);

      expect(result._tag).toBe("Right");
      const yankedText = result.right;
      expect(yankedText).toHaveProperty("type", "string");
      expect(yankedText.value).toBe("text to paste");
    });

    test("(kill-ring-rotate) rotates ring items", () => {
      const result = interpreter.execute(`
        (kill-ring-save "first")
        (kill-ring-save "second")
        (kill-ring-save "third")
        (kill-ring-rotate)
        (kill-ring-list)
      `);

      expect(result._tag).toBe("Right");
      const killRingList = result.right;
      expect(killRingList).toHaveProperty("type", "list");
      expect(killRingList.value).toHaveLength(3);
      // After rotation, first item moves to end
      expect(killRingList.value[0]).toEqual({
        type: "string",
        value: "second"
      });
      expect(killRingList.value[1]).toEqual({
        type: "string",
        value: "first"
      });
      expect(killRingList.value[2]).toEqual({
        type: "string",
        value: "third"
      });
    });

    test("(kill-ring-list) shows all items", () => {
      const result = interpreter.execute(`
        (kill-ring-save "alpha")
        (kill-ring-save "beta")
        (kill-ring-save "gamma")
        (kill-ring-list)
      `);

      expect(result._tag).toBe("Right");
      const killRingList = result.right;
      expect(killRingList).toHaveProperty("type", "list");
      expect(killRingList.value).toHaveLength(3);
      const values = killRingList.value.map((item: any) => item.value);
      expect(values).toEqual(["gamma", "beta", "alpha"]);
    });

    test("(kill-ring-yank) with empty kill-ring returns empty string", () => {
      const result = interpreter.execute(`
        (kill-ring-yank)
      `);

      expect(result._tag).toBe("Right");
      const yankedText = result.right;
      expect(yankedText).toHaveProperty("type", "string");
      expect(yankedText.value).toBe("");
    });

    test("(kill-ring-rotate) with single item does nothing", () => {
      const result = interpreter.execute(`
        (kill-ring-save "only item")
        (kill-ring-rotate)
        (kill-ring-list)
      `);

      expect(result._tag).toBe("Right");
      const killRingList = result.right;
      expect(killRingList.value).toHaveLength(1);
      expect(killRingList.value[0]).toEqual({
        type: "string",
        value: "only item"
      });
    });

    test("(kill-ring-rotate) with empty kill-ring does nothing", () => {
      const result = interpreter.execute(`
        (kill-ring-rotate)
        (kill-ring-list)
      `);

      expect(result._tag).toBe("Right");
      const killRingList = result.right;
      expect(killRingList.value).toHaveLength(0);
    });

    test("Kill ring max can be customized", () => {
      const result = interpreter.execute(`
        (set-kill-ring-max 3)
        (kill-ring-save "a")
        (kill-ring-save "b")
        (kill-ring-save "c")
        (kill-ring-save "d")  ; This should remove "a" due to max=3
        (kill-ring-list)
      `);

      expect(result._tag).toBe("Right");
      const killRingList = result.right;
      expect(killRingList.value).toHaveLength(3);
      const values = killRingList.value.map((item: any) => item.value);
      expect(values).not.toContain("a");
      expect(values).toContain("d");
    });
  });

  describe("Integration with Delete Operations", () => {
    test("delete operations add to kill ring", () => {
      // Simulate a delete operation
      const result = interpreter.execute(`
        (kill-ring-save "deleted word")
        (kill-ring-list)
      `);

      expect(result._tag).toBe("Right");
      const killRingList = result.right;
      expect(killRingList.value).toHaveLength(1);
      expect(killRingList.value[0]).toEqual({
        type: "string",
        value: "deleted word"
      });
    });
  });

  describe("Integration with Yank Operations", () => {
    test("yank operations add to kill ring", () => {
      const result = interpreter.execute(`
        (kill-ring-save "yanked text")
        (kill-ring-yank)
      `);

      expect(result._tag).toBe("Right");
      const yankedText = result.right;
      expect(yankedText.value).toBe("yanked text");
    });

    test("Multiple yanks populate kill ring", () => {
      const result = interpreter.execute(`
        (kill-ring-save "yank1")
        (kill-ring-save "yank2")
        (kill-ring-save "yank3")
        (kill-ring-list)
      `);

      expect(result._tag).toBe("Right");
      const killRingList = result.right;
      expect(killRingList.value).toHaveLength(3);
      const values = killRingList.value.map((item: any) => item.value);
      expect(values).toEqual(["yank3", "yank2", "yank1"]);
    });
  });
});
