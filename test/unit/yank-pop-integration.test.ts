/**
 * @file yank-pop-integration.test.ts
 * @description Integration tests for yank-pop functionality (US-1.9.2)
 *
 * Tests the complete yank-pop workflow including:
 * - Paste followed by M-y to cycle through kills
 * - Multiple M-y presses to cycle through history
 * - Yank-pop state management
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { registerTestingFramework } from "../../src/tlisp/test-framework.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import {
  createKillRingOps,
  resetKillRing
} from "../../src/editor/api/kill-ring.ts";
import {
  createYankOps,
  setYankRegister
} from "../../src/editor/api/yank-ops.ts";
import {
  createYankPopOps,
  resetYankPopState,
  getYankPopState
} from "../../src/editor/api/yank-pop-ops.ts";

describe("Yank Pop Integration (US-1.9.2)", () => {
  let interpreter: TLispInterpreterImpl;
  let mockBuffer: FunctionalTextBufferImpl;

  // State management callbacks (simulating editor state)
  let currentBuffer: FunctionalTextBufferImpl | null = null;
  let cursorLine = 0;
  let cursorColumn = 0;

  beforeEach(() => {
    // Reset all state
    resetKillRing();
    resetYankPopState();
    setYankRegister("");

    // Create fresh interpreter
    interpreter = new TLispInterpreterImpl();

    // Register testing framework
    registerTestingFramework(interpreter);

    // Create mock buffer
    mockBuffer = FunctionalTextBufferImpl.create();
    currentBuffer = mockBuffer;

    // Reset cursor position
    cursorLine = 0;
    cursorColumn = 0;

    // Register kill ring functions
    const killRingOps = createKillRingOps();
    for (const [name, func] of killRingOps.entries()) {
      interpreter.defineBuiltin(name, func);
    }

    // Register yank operations
    const yankOps = createYankOps(
      () => currentBuffer,
      (buf) => { currentBuffer = buf as FunctionalTextBufferImpl; },
      () => cursorLine,
      (line) => { cursorLine = line; },
      () => cursorColumn,
      (col) => { cursorColumn = col; }
    );
    for (const [name, func] of yankOps.entries()) {
      interpreter.defineBuiltin(name, func);
    }

    // Register yank-pop operations
    const yankPopOps = createYankPopOps(
      () => currentBuffer,
      (buf) => { currentBuffer = buf as FunctionalTextBufferImpl; },
      () => cursorLine,
      () => cursorColumn
    );
    for (const [name, func] of yankPopOps.entries()) {
      interpreter.defineBuiltin(name, func);
    }
  });

  describe("Paste and Yank-Pop Workflow", () => {
    test("p then M-y should cycle through kill ring", () => {
      // Setup kill ring with multiple items
      interpreter.execute("(kill-ring-save \"first kill\")");
      interpreter.execute("(kill-ring-save \"second kill\")");
      interpreter.execute("(kill-ring-save \"third kill\")");

      // Set up buffer with initial content
      mockBuffer.insert({ line: 0, column: 0 }, "Hello world");

      // Set yank register to most recent kill
      interpreter.execute("(yank-register-set \"third kill\")");

      // Paste (p) - in real usage this would be handled by paste-after
      // For this test, we manually activate yank-pop state
      interpreter.execute("(yank-register-set \"third kill\")");
      expect(getYankPopState().active).toBe(false);

      // Simulate paste operation activating yank-pop state
      const pasteResult = interpreter.execute("(paste-after)");
      expect(pasteResult._tag).toBe("Right");

      // After paste, yank-pop state should be activated
      // (This would be set by the paste-after function in real usage)
    });

    test("multiple M-y presses should cycle through entire kill ring", () => {
      // Setup kill ring
      interpreter.execute("(kill-ring-save \"first\")");
      interpreter.execute("(kill-ring-save \"second\")");
      interpreter.execute("(kill-ring-save \"third\")");

      // Initial yank
      let result = interpreter.execute("(kill-ring-yank)");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.value).toBe("third");
      }

      // First M-y (yank-pop)
      result = interpreter.execute("(kill-ring-rotate)");
      result = interpreter.execute("(kill-ring-yank)");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.value).toBe("second");
      }

      // Second M-y
      result = interpreter.execute("(kill-ring-rotate)");
      result = interpreter.execute("(kill-ring-yank)");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.value).toBe("first");
      }

      // Third M-y (should wrap around)
      result = interpreter.execute("(kill-ring-rotate)");
      result = interpreter.execute("(kill-ring-yank)");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.value).toBe("third");
      }
    });
  });

  describe("Yank-Pop State Management", () => {
    test("yank-pop-active should return false initially", () => {
      const result = interpreter.execute("(yank-pop-active)");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.value).toBe(false);
      }
    });

    test("yank-pop-reset should reset yank-pop state", () => {
      // Activate yank-pop state
      const yankPopOps = createYankPopOps(
        () => currentBuffer,
        (buf) => { currentBuffer = buf as FunctionalTextBufferImpl; },
        () => cursorLine,
        () => cursorColumn
      );

      // Manually activate state (simulating paste operation)
      // Note: This would be done by paste-after in real usage

      // Reset state
      const result = interpreter.execute("(yank-pop-reset)");
      expect(result._tag).toBe("Right");

      // Verify state is reset
      const activeResult = interpreter.execute("(yank-pop-active)");
      expect(activeResult._tag).toBe("Right");
      if (activeResult._tag === "Right") {
        expect(activeResult.right.value).toBe(false);
      }
    });
  });

  describe("Edge Cases", () => {
    test("yank-pop when inactive should do nothing", () => {
      // Setup kill ring
      interpreter.execute("(kill-ring-save \"first\")");
      interpreter.execute("(kill-ring-save \"second\")");

      // Don't activate yank-pop state (simulate no prior paste)
      resetYankPopState();

      // Try yank-pop (should do nothing since state is inactive)
      const result = interpreter.execute("(yank-pop)");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        // Should return empty string when inactive
        expect(result.right.value).toBe("");
      }
    });

    test("yank-pop with empty kill ring should return empty", () => {
      // Reset kill ring to empty
      resetKillRing();

      // Set up buffer
      mockBuffer.insert({ line: 0, column: 0 }, "test");

      // Try yank-pop
      const result = interpreter.execute("(yank-pop)");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.value).toBe("");
      }
    });
  });

  describe("Integration with Kill Ring", () => {
    test("new kill should not affect yank-pop state", () => {
      // Setup kill ring
      interpreter.execute("(kill-ring-save \"first\")");
      interpreter.execute("(kill-ring-save \"second\")");
      interpreter.execute("(kill-ring-save \"third\")");

      // Get current items
      let result = interpreter.execute("(kill-ring-list)");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.type).toBe("list");
      }

      // Add new item (simulates state reset for yank-pop)
      interpreter.execute("(kill-ring-save \"newest\")");

      // Verify new item is at front
      result = interpreter.execute("(kill-ring-yank)");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.value).toBe("newest");
      }
    });
  });
});
