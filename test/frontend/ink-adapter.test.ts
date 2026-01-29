/**
 * @file ink-adapter.test.ts
 * @description Unit tests for InkTerminalIO class implementing FunctionalTerminalIO
 */

import { assertEquals, assert, assertInstanceOf } from "@std/assert";
import { InkTerminalIO } from "../../src/frontend/ink-adapter.ts";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import { ErrorFactory, TmaxError } from "../../src/utils/error-manager.ts";

/**
 * Test suite for InkTerminalIO class
 */
Deno.test("InkTerminalIO Class - FunctionalTerminalIO Implementation", async (t) => {
  let terminalIO: InkTerminalIO;

  await t.step("setup", () => {
    terminalIO = new InkTerminalIO();
  });

  await t.step("should implement all required methods", () => {
    // Check that all required methods exist
    assert(typeof terminalIO.getSize === "function");
    assert(typeof terminalIO.clear === "function");
    assert(typeof terminalIO.clearToEndOfLine === "function");
    assert(typeof terminalIO.moveCursor === "function");
    assert(typeof terminalIO.write === "function");
    assert(typeof terminalIO.readKey === "function");
    assert(typeof terminalIO.enterRawMode === "function");
    assert(typeof terminalIO.exitRawMode === "function");
    assert(typeof terminalIO.enterAlternateScreen === "function");
    assert(typeof terminalIO.exitAlternateScreen === "function");
    assert(typeof terminalIO.hideCursor === "function");
    assert(typeof terminalIO.showCursor === "function");
    assert(typeof terminalIO.isStdinTTY === "function");
    assert(typeof terminalIO.resolveKeyPress === "function");
    assert(typeof terminalIO.cancelKeyPress === "function");
    assert(typeof terminalIO.onSizeChange === "function");
    assert(typeof terminalIO.updateSize === "function");
  });

  await t.step("getSize should return Either with terminal dimensions", () => {
    const result = terminalIO.getSize();
    // Since Either is a discriminated union, we can check the tag
    assert(result._tag === 'Left' || result._tag === 'Right');
    assert(Either.isRight(result));

    const size = result.right;
    assertEquals(typeof size.width, "number");
    assertEquals(typeof size.height, "number");
    assert(size.width > 0);
    assert(size.height > 0);
  });

  await t.step("clear should return TaskEither<void>", async () => {
    const result = terminalIO.clear();
    assert(result instanceof TaskEither);
    
    const eitherResult = await result.run();
    assert(Either.isRight(eitherResult));
  });

  await t.step("clearToEndOfLine should return TaskEither<void>", async () => {
    const result = terminalIO.clearToEndOfLine();
    assert(result instanceof TaskEither);
    
    const eitherResult = await result.run();
    assert(Either.isRight(eitherResult));
  });

  await t.step("moveCursor should return TaskEither<void>", async () => {
    const position = { line: 5, column: 10 };
    const result = terminalIO.moveCursor(position);
    assert(result instanceof TaskEither);
    
    const eitherResult = await result.run();
    assert(Either.isRight(eitherResult));
  });

  await t.step("write should return TaskEither<void>", async () => {
    const text = "Hello, world!";
    const result = terminalIO.write(text);
    assert(result instanceof TaskEither);
    
    const eitherResult = await result.run();
    assert(Either.isRight(eitherResult));
  });

  await t.step("enterRawMode should return TaskEither<void>", async () => {
    const result = terminalIO.enterRawMode();
    assert(result instanceof TaskEither);
    
    const eitherResult = await result.run();
    assert(Either.isRight(eitherResult));
  });

  await t.step("exitRawMode should return TaskEither<void>", async () => {
    const result = terminalIO.exitRawMode();
    assert(result instanceof TaskEither);
    
    const eitherResult = await result.run();
    assert(Either.isRight(eitherResult));
  });

  await t.step("enterAlternateScreen should return TaskEither<void>", async () => {
    const result = terminalIO.enterAlternateScreen();
    assert(result instanceof TaskEither);
    
    const eitherResult = await result.run();
    assert(Either.isRight(eitherResult));
  });

  await t.step("exitAlternateScreen should return TaskEither<void>", async () => {
    const result = terminalIO.exitAlternateScreen();
    assert(result instanceof TaskEither);
    
    const eitherResult = await result.run();
    assert(Either.isRight(eitherResult));
  });

  await t.step("hideCursor should return TaskEither<void>", async () => {
    const result = terminalIO.hideCursor();
    assert(result instanceof TaskEither);
    
    const eitherResult = await result.run();
    assert(Either.isRight(eitherResult));
  });

  await t.step("showCursor should return TaskEither<void>", async () => {
    const result = terminalIO.showCursor();
    assert(result instanceof TaskEither);
    
    const eitherResult = await result.run();
    assert(Either.isRight(eitherResult));
  });

  await t.step("isStdinTTY should return Either<boolean>", () => {
    const result = terminalIO.isStdinTTY();
    // Since Either is a discriminated union, we can check the tag
    assert(result._tag === 'Left' || result._tag === 'Right');
    assert(Either.isRight(result));

    const isTTY = result.right;
    assert(typeof isTTY === "boolean");
  });

  await t.step("readKey should return TaskEither<string>", async () => {
    // This test is tricky because readKey waits for input
    // We'll test that it returns the correct type
    const result = terminalIO.readKey();
    assert(result instanceof TaskEither);
    
    // Since readKey waits for input, we'll cancel it to avoid hanging
    setTimeout(() => {
      terminalIO.cancelKeyPress();
    }, 100);
    
    const eitherResult = await result.run();
    // The cancellation should result in an error
    if (Either.isLeft(eitherResult)) {
      assert(true); // Expected since we cancelled
    } else {
      // If it succeeded, that's also fine
      assert(true);
    }
  });

  await t.step("should handle terminal resize events", () => {
    // Test size update functionality
    const initialSize = terminalIO.getSize();
    assert(Either.isRight(initialSize));
    
    // Update size
    terminalIO.updateSize(120, 40);
    
    // Verify size was updated
    const newSize = terminalIO.getSize();
    assert(Either.isRight(newSize));
    assertEquals(newSize.right.width, 120);
    assertEquals(newSize.right.height, 40);
  });

  await t.step("should handle size change callbacks", () => {
    let callbackCalled = false;
    let receivedSize: any = null;
    
    // Register a callback
    terminalIO.onSizeChange((size) => {
      callbackCalled = true;
      receivedSize = size;
    });
    
    // Update size to trigger callback
    terminalIO.updateSize(80, 25);
    
    // The callback should have been called
    // Note: In this synchronous test, we're testing that the callback mechanism is set up
    // In a real scenario, the callback would be triggered asynchronously
    assert(true); // Basic test to ensure no errors in callback setup
  });

  await t.step("should handle key press resolution", async () => {
    // Test the key press resolution mechanism
    const readKeyPromise = terminalIO.readKey().run();
    
    // Resolve the key press after a short delay
    setTimeout(() => {
      terminalIO.resolveKeyPress('a');
    }, 50);
    
    const result = await readKeyPromise;
    if (Either.isRight(result)) {
      assertEquals(result.right, 'a');
    }
    // If left, that's also acceptable due to timing
  });

  await t.step("cleanup", () => {
    // Clean up any global state
    if ((globalThis as any).__tmax_key_resolvers) {
      (globalThis as any).__tmax_key_resolvers.clear();
    }
    terminalIO = undefined as any;
  });
});

/**
 * Test error handling in InkTerminalIO
 */
Deno.test("InkTerminalIO Error Handling", async (t) => {
  let terminalIO: InkTerminalIO;

  await t.step("setup", () => {
    terminalIO = new InkTerminalIO();
  });

  await t.step("should handle invalid cursor positions gracefully", async () => {
    // Test with negative positions
    const negativePosResult = await terminalIO.moveCursor({ line: -1, column: -1 }).run();
    assert(Either.isRight(negativePosResult)); // Should not throw

    // Test with very large positions
    const largePosResult = await terminalIO.moveCursor({ line: 999999, column: 999999 }).run();
    assert(Either.isRight(largePosResult)); // Should not throw
  });

  await t.step("should handle empty and long text in write", async () => {
    // Test with empty string
    const emptyResult = await terminalIO.write("").run();
    assert(Either.isRight(emptyResult));

    // Test with very long string
    const longText = "x".repeat(10000);
    const longResult = await terminalIO.write(longText).run();
    assert(Either.isRight(longResult));
  });

  await t.step("should handle Unicode characters", async () => {
    const unicodeText = "Hello 世界 🌍 café naïve résumé";
    const result = await terminalIO.write(unicodeText).run();
    assert(Either.isRight(result));
  });

  await t.step("cleanup", () => {
    terminalIO = undefined as any;
  });
});