/**
 * @file evil-integration.test.ts
 * @description Tests for US-1.9.3 - Evil Integration (Vim register system with kill ring)
 *
 * Tests the integration between Vim's register system and Emacs' kill ring:
 * - Unnamed register (") for most recent delete/yank
 * - Register 0 for yanks
 * - Registers 1-9 for delete history (rotate through)
 * - Named registers a-z for specific storage
 * - Register + for system clipboard
 * - All operations also store in kill-ring
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import type { FunctionalTextBuffer } from "../../src/core/types.ts";
import { Either } from "../../src/utils/task-either.ts";
import { resetKillRing, killRingList } from "../../src/editor/api/kill-ring.ts";
import {
  resetRegisterState,
  getRegister,
  setRegister,
  registerYank,
  registerDelete,
  registerPaste,
  getRegisterIndex,
  REGISTER_NAMED_START,
  REGISTER_NAMED_END
} from "../../src/editor/api/evil-integration.ts";

describe("US-1.9.3 - Evil Integration", () => {
  let buffer: FunctionalTextBuffer;

  beforeEach(() => {
    // Reset all register state
    resetRegisterState();
    resetKillRing();

    // Create test buffer
    buffer = FunctionalTextBufferImpl.create("hello world\nfoo bar baz\nqux test");
  });

  describe("Register Storage Functions", () => {
    test("registerYank stores in unnamed register, yank register (0), and kill-ring", () => {
      const text = "yanked text";

      registerYank(text);

      // Check unnamed register
      const unnamed = getRegister('"');
      expect(unnamed).toBe(text);

      // Check register 0
      const register0 = getRegister('0');
      expect(register0).toBe(text);

      // Check kill-ring
      const killRing = killRingList();
      expect(killRing.length).toBe(1);
      expect(killRing[0]).toBe(text);
    });

    test("registerDelete with isLineDelete=false stores in unnamed register and kill-ring", () => {
      const text = "deleted text";

      registerDelete(text, false);

      // Check unnamed register
      const unnamed = getRegister('"');
      expect(unnamed).toBe(text);

      // Check kill-ring
      const killRing = killRingList();
      expect(killRing.length).toBe(1);
      expect(killRing[0]).toBe(text);

      // Check numbered registers NOT used
      expect(getRegister('1')).toBe("");
    });

    test("registerDelete with isLineDelete=true uses numbered registers", () => {
      const text1 = "deleted line 1\n";
      const text2 = "deleted line 2\n";

      registerDelete(text1, true);

      // Check unnamed register
      expect(getRegister('"')).toBe(text1);

      // Check register 1
      expect(getRegister('1')).toBe(text1);

      // Second delete
      registerDelete(text2, true);

      // Check register 1 shifted
      expect(getRegister('1')).toBe(text2);
      expect(getRegister('2')).toBe(text1);
    });

    test("registerPaste retrieves from register", () => {
      setRegister('a', "test text");

      const pasted = registerPaste('a');
      expect(pasted).toBe("test text");
    });
  });

  describe("Register Index Mapping", () => {
    test("getRegisterIndex maps register names to indices", () => {
      // Test unnamed register
      expect(getRegisterIndex('"')).toBe(-1);

      // Test yank register
      expect(getRegisterIndex('0')).toBe(0);

      // Test numbered registers
      expect(getRegisterIndex('1')).toBe(1);
      expect(getRegisterIndex('9')).toBe(9);

      // Test named registers
      expect(getRegisterIndex('a')).toBe(REGISTER_NAMED_START);
      expect(getRegisterIndex('z')).toBe(REGISTER_NAMED_END);

      // Test clipboard register
      expect(getRegisterIndex('+')).toBe(REGISTER_NAMED_END + 1);
    });
  });

  describe("Named Registers", () => {
    test("lowercase registers are independent", () => {
      setRegister('a', "content a");
      setRegister('b', "content b");
      setRegister('c', "content c");

      expect(getRegister('a')).toBe("content a");
      expect(getRegister('b')).toBe("content b");
      expect(getRegister('c')).toBe("content c");
    });

    test("uppercase registers append to lowercase", () => {
      setRegister('x', "first");
      setRegister('X', " second");
      setRegister('X', "third");

      expect(getRegister('x')).toBe("first secondthird");
    });

    test("appending to empty register works", () => {
      setRegister('A', "first");

      expect(getRegister('a')).toBe("first");

      setRegister('A', " second");

      expect(getRegister('a')).toBe("first second");
    });
  });

  describe("Numbered Registers Rotation", () => {
    test("numbered registers shift correctly on line deletes", () => {
      registerDelete("line1\n", true);
      expect(getRegister('1')).toBe("line1\n");

      registerDelete("line2\n", true);
      expect(getRegister('1')).toBe("line2\n");
      expect(getRegister('2')).toBe("line1\n");

      registerDelete("line3\n", true);
      expect(getRegister('1')).toBe("line3\n");
      expect(getRegister('2')).toBe("line2\n");
      expect(getRegister('3')).toBe("line1\n");
    });

    test("9 deletes rotate through numbered registers", () => {
      for (let i = 1; i <= 10; i++) {
        registerDelete(`line${i}\n`, true);
      }

      // After 10 deletes, line1 should be rotated out
      expect(getRegister('1')).toBe("line10\n");
      expect(getRegister('9')).toBe("line2\n");
      // Register 10 doesn't exist in our implementation (only 1-9)
      // so after 9 deletes, the oldest (line1) is pushed out
    });
  });

  describe("Reset Functionality", () => {
    test("resetRegisterState clears all registers", () => {
      setRegister('a', "test");
      setRegister('1', "delete");
      setRegister('"', "unnamed");
      setRegister('0', "yank");

      resetRegisterState();

      expect(getRegister('a')).toBe("");
      expect(getRegister('1')).toBe("");
      expect(getRegister('"')).toBe("");
      expect(getRegister('0')).toBe("");
    });
  });

  describe("Integration with Buffer Operations", () => {
    test("registerDelete integrates with buffer delete", () => {
      // Get some text from buffer
      const contentResult = buffer.getContent();
      expect(contentResult._tag).toBe("Right");

      if (contentResult._tag === "Right") {
        const lines = contentResult.right.split('\n');
        const firstLine = lines[0]!;

        // Simulate delete operation
        registerDelete(firstLine + "\n", true);

        // Check register
        expect(getRegister('1')).toBe(firstLine + "\n");
      }
    });

    test("registerYank integrates with buffer yank", () => {
      // Get some text from buffer
      const contentResult = buffer.getContent();
      expect(contentResult._tag).toBe("Right");

      if (contentResult._tag === "Right") {
        const firstWord = "hello";

        // Simulate yank operation
        registerYank(firstWord);

        // Check registers
        expect(getRegister('"')).toBe(firstWord);
        expect(getRegister('0')).toBe(firstWord);
      }
    });
  });
});
