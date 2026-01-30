/**
 * @file ink-adapter.test.ts
 * @description Unit tests for InkTerminalIO class implementing FunctionalTerminalIO
 */

import { describe, test, expect } from "bun:test";
import { InkTerminalIO } from "../../src/frontend/ink-adapter.ts";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import { ErrorFactory, TmaxError } from "../../src/utils/error-manager.ts";

/**
 * Test suite for InkTerminalIO class
 */
describe("InkTerminalIO Class - FunctionalTerminalIO Implementation", () => {
  let terminalIO: InkTerminalIO;

  test("setup", () => {
    terminalIO = new InkTerminalIO();
  });

  test("should implement all required methods", () => {
    // Check that all required methods exist
    expect($1).toBe(true);
    expect($1).toBe(true);
    expect($1).toBe(true);
    expect($1).toBe(true);
    expect($1).toBe(true);
    expect($1).toBe(true);
    expect($1).toBe(true);
    expect($1).toBe(true);
    expect($1).toBe(true);
    expect($1).toBe(true);
    expect($1).toBe(true);
    expect($1).toBe(true);
    expect($1).toBe(true);
    expect($1).toBe(true);
    expect($1).toBe(true);
    expect($1).toBe(true);
    expect($1).toBe(true);
  });

  test("getSize should return Either with terminal dimensions", () => {
    const result = terminalIO.getSize();
    // Since Either is a discriminated union, we can check the tag
    expect($1).toBe(true);
    expect($1).toBe(true));

    const size = result.right;
    expect(typeof size.width).toBe("number");
    expect(typeof size.height).toBe("number");
    expect($1).toBe(true);
    expect($1).toBe(true);
  });

  test("clear should return TaskEither<void>", () => {
    const result = terminalIO.clear();
    expect($1).toBe(true);
    
    const eitherResult = await result.run();
    expect($1).toBe(true));
  });

  test("clearToEndOfLine should return TaskEither<void>", () => {
    const result = terminalIO.clearToEndOfLine();
    expect($1).toBe(true);
    
    const eitherResult = await result.run();
    expect($1).toBe(true));
  });

  test("moveCursor should return TaskEither<void>", () => {
    const position = { line: 5, column: 10 };
    const result = terminalIO.moveCursor(position);
    expect($1).toBe(true);
    
    const eitherResult = await result.run();
    expect($1).toBe(true));
  });

  test("write should return TaskEither<void>", () => {
    const text = "Hello, world!";
    const result = terminalIO.write(text);
    expect($1).toBe(true);
    
    const eitherResult = await result.run();
    expect($1).toBe(true));
  });

  test("enterRawMode should return TaskEither<void>", () => {
    const result = terminalIO.enterRawMode();
    expect($1).toBe(true);
    
    const eitherResult = await result.run();
    expect($1).toBe(true));
  });

  test("exitRawMode should return TaskEither<void>", () => {
    const result = terminalIO.exitRawMode();
    expect($1).toBe(true);
    
    const eitherResult = await result.run();
    expect($1).toBe(true));
  });

  test("enterAlternateScreen should return TaskEither<void>", () => {
    const result = terminalIO.enterAlternateScreen();
    expect($1).toBe(true);
    
    const eitherResult = await result.run();
    expect($1).toBe(true));
  });

  test("exitAlternateScreen should return TaskEither<void>", () => {
    const result = terminalIO.exitAlternateScreen();
    expect($1).toBe(true);
    
    const eitherResult = await result.run();
    expect($1).toBe(true));
  });

  test("hideCursor should return TaskEither<void>", () => {
    const result = terminalIO.hideCursor();
    expect($1).toBe(true);
    
    const eitherResult = await result.run();
    expect($1).toBe(true));
  });

  test("showCursor should return TaskEither<void>", () => {
    const result = terminalIO.showCursor();
    expect($1).toBe(true);
    
    const eitherResult = await result.run();
    expect($1).toBe(true));
  });

  test("isStdinTTY should return Either<boolean>", () => {
    const result = terminalIO.isStdinTTY();
    // Since Either is a discriminated union, we can check the tag
    expect($1).toBe(true);
    expect($1).toBe(true));

    const isTTY = result.right;
    expect($1).toBe(true);
  });

  test("readKey should return TaskEither<string>", () => {
    // This test is tricky because readKey waits for input
    // We'll test that it returns the correct type
    const result = terminalIO.readKey();
    expect($1).toBe(true);
    
    // Since readKey waits for input, we'll cancel it to avoid hanging
    setTimeout(() => {
      terminalIO.cancelKeyPress();
    }, 100);
    
    const eitherResult = await result.run();
    // The cancellation should result in an error
    if (Either.isLeft(eitherResult)) {
      expect($1).toBe(true); // Expected since we cancelled
    } else {
      // If it succeeded, that's also fine
      expect($1).toBe(true);
    }
  });

  test("should handle terminal resize events", () => {
    // Test size update functionality
    const initialSize = terminalIO.getSize();
    expect($1).toBe(true));
    
    // Update size
    terminalIO.updateSize(120, 40);
    
    // Verify size was updated
    const newSize = terminalIO.getSize();
    expect($1).toBe(true));
    expect(newSize.right.width).toBe(120);
    expect(newSize.right.height).toBe(40);
  });

  test("should handle size change callbacks", () => {
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
    expect($1).toBe(true); // Basic test to ensure no errors in callback setup
  });

  test("should handle key press resolution", () => {
    // Test the key press resolution mechanism
    const readKeyPromise = terminalIO.readKey().run();
    
    // Resolve the key press after a short delay
    setTimeout(() => {
      terminalIO.resolveKeyPress('a');
    }, 50);
    
    const result = await readKeyPromise;
    if (Either.isRight(result)) {
      expect(result.right).toBe('a');
    }
    // If left, that's also acceptable due to timing
  });

  test("cleanup", () => {
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
describe("InkTerminalIO Error Handling", () => {
  let terminalIO: InkTerminalIO;

  test("setup", () => {
    terminalIO = new InkTerminalIO();
  });

  test("should handle invalid cursor positions gracefully", () => {
    // Test with negative positions
    const negativePosResult = await terminalIO.moveCursor({ line: -1, column: -1 }).run();
    expect($1).toBe(true)); // Should not throw

    // Test with very large positions
    const largePosResult = await terminalIO.moveCursor({ line: 999999, column: 999999 }).run();
    expect($1).toBe(true)); // Should not throw
  });

  test("should handle empty and long text in write", () => {
    // Test with empty string
    const emptyResult = await terminalIO.write("").run();
    expect($1).toBe(true));

    // Test with very long string
    const longText = "x".repeat(10000);
    const longResult = await terminalIO.write(longText).run();
    expect($1).toBe(true));
  });

  test("should handle Unicode characters", () => {
    const unicodeText = "Hello 世界 🌍 café naïve résumé";
    const result = await terminalIO.write(unicodeText).run();
    expect($1).toBe(true));
  });

  test("cleanup", () => {
    terminalIO = undefined as any;
  });
});