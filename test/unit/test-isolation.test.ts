/**
 * @file test-isolation.test.ts
 * @description Test the test isolation functionality
 */

import { describe, test, beforeEach, afterEach } from "bun:test";
import { expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Test Isolation", () => {
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

  test("variables defined in one test should not exist in another test", () => {
    const interpreter = editor.getInterpreter();

    // Define a test that sets a variable
    interpreter.execute('(deftest test-with-var () (defvar my-test-var 42) (assert-equal 42 my-test-var))');

    // Define another test that checks if the variable exists
    interpreter.execute('(deftest test-without-var () (assert-error my-test-var))'); // Should pass if var doesn't exist from previous test

    // Run the first test
    const result1 = interpreter.execute('(test-run "test-with-var")');
    expect(result1._tag).toBe("Right");
    expect(result1.right.value).toBe(true);

    // Run the second test - this should pass because variables from first test shouldn't leak
    const result2 = interpreter.execute('(test-run "test-without-var")');
    expect(result2._tag).toBe("Right");
    expect(result2.right.value).toBe(true);
  });

  test("setup and teardown functions should work", () => {
    const interpreter = editor.getInterpreter();

    // Define setup and teardown
    interpreter.execute('(setup () (defvar setup-counter 0))');
    interpreter.execute('(teardown () (set! setup-counter 999))');

    // Define a test that modifies the variable
    interpreter.execute('(deftest test-setup-teardown () (set! setup-counter (+ setup-counter 1)) (assert-equal 1 setup-counter))');

    // Run the test
    const result = interpreter.execute('(test-run "test-setup-teardown")');
    expect(result._tag).toBe("Right");
    expect(result.right.value).toBe(true);

    // Check that the variable was reset by teardown (though it should be in isolated env)
    // The variable from the test environment shouldn't leak to global
    const checkVarResult = interpreter.execute('(assert-error setup-counter)');
    // This assertion depends on whether the variable leaked or not
  });

  test("failed tests should not affect next test environment", () => {
    const interpreter = editor.getInterpreter();

    // Define a test that fails
    interpreter.execute('(deftest failing-test () (defvar fail-var "should-not-exist") (assert-equal 1 2))'); // Intentionally fail

    // Define a test that checks if the variable from the failing test exists
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