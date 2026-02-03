/**
 * @file test-isolation-simple.test.ts
 * @description Test the test isolation functionality using existing constructs
 */

import { describe, test, beforeEach, afterEach } from "bun:test";
import { expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Test Isolation - Simple", () => {
  let editor: Editor;
  let mockTerminal: MockTerminal;
  let mockFileSystem: MockFileSystem;

  beforeEach(() => {
    mockTerminal = new MockTerminal();
    mockFileSystem = new MockFileSystem();
    // Create an empty filesystem for these tests
    editor = new Editor(mockTerminal, mockFileSystem);
    // Start the editor to initialize the interpreter
    editor.start();
  });

  afterEach(() => {
    editor.stop();
  });

  test("let bindings should be isolated between tests", () => {
    const interpreter = editor.getInterpreter();

    // Define a test that uses let to create a binding
    interpreter.execute('(deftest test-with-let () (let ((local-var 42)) (assert-equal 42 local-var)))');

    // Define another test that tries to access the variable (should fail)
    interpreter.execute('(deftest test-no-access () (assert-error local-var))'); // Should fail if local-var exists

    // Run the first test
    const result1 = interpreter.execute('(test-run "test-with-let")');
    expect(result1._tag).toBe("Right");
    expect(result1.right.value).toBe(true);

    // Run the second test - this should pass because let bindings from first test shouldn't leak
    const result2 = interpreter.execute('(test-run "test-no-access")');
    expect(result2._tag).toBe("Right");
    expect(result2.right.value).toBe(true);
  });

  test("setup and teardown functions should work", () => {
    const interpreter = editor.getInterpreter();

    // Define setup and teardown using the functions I added
    interpreter.execute('(setup () (defvar counter 0))');
    interpreter.execute('(teardown () (defvar counter 999))'); // Reset counter in global env

    // Define a test that modifies the counter
    interpreter.execute('(deftest test-counter () (set! counter (+ counter 1)) (assert-equal 1 counter))');

    // Run the test
    const result = interpreter.execute('(test-run "test-counter")');
    expect(result._tag).toBe("Right");
    expect(result.right.value).toBe(true);
  });

  test("failed tests should not affect next test environment", () => {
    const interpreter = editor.getInterpreter();

    // Define a test that fails but sets up some state
    interpreter.execute('(deftest failing-test () (let ((fail-var "should-not-leak")) (assert-equal 1 2)))'); // Intentionally fail

    // Define a test that checks if state from failing test exists
    interpreter.execute('(deftest clean-test () (assert-error fail-var))'); // Should pass if isolation works

    // Run the failing test
    const result1 = interpreter.execute('(test-run "failing-test")');
    expect(result1._tag).toBe("Right");
    expect(result1.right.value).toBe(false); // Test should fail

    // Run the clean test - this should pass because the failing test shouldn't pollute the environment
    const result2 = interpreter.execute('(test-run "clean-test")');
    expect(result2._tag).toBe("Right");
    expect(result2.right.value).toBe(true);
  });
});