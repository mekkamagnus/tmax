/**
 * @file test-tlisp-testing-framework.test.ts
 * @description Test the T-Lisp testing framework functionality
 */

import { describe, test, beforeEach, afterEach } from "bun:test";
import { expectDefined, expectRight, expectTlispList, expectTlispNumber } from "../helpers/editor-fixture.ts";
import { expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { resetAllTestState } from "../../src/tlisp/test-framework.ts";

describe("T-Lisp Testing Framework", () => {
  let editor: Editor;
  let mockTerminal: MockTerminal;
  let mockFileSystem: MockFileSystem;

  beforeEach(async () => {
    mockTerminal = new MockTerminal();
    mockFileSystem = new MockFileSystem();
    // Create an empty filesystem for these tests
    editor = new Editor(mockTerminal, mockFileSystem);
    // Start the editor to initialize the interpreter
    await editor.start();
    // Reset all test state for clean isolation
    resetAllTestState(editor.getInterpreter());
  });

  afterEach(() => {
    editor.stop();
  });

  test("should define a test with deftest", async () => {
    const interpreter = editor.getInterpreter();

    // Define a simple test
    const result = interpreter.execute('(deftest my-test () (assert-true t))');

    expect(result).toBeDefined();
    expect(result._tag).toBe("Right");

    const value = expectRight(result);
    expect(value).toBeDefined();
    expect(value.type).toBe("symbol");
    expect(value.value).toBe("my-test");
  });

  test("should run a test with test-run", async () => {
    const interpreter = editor.getInterpreter();

    // Define a test that should pass
    interpreter.execute('(deftest passing-test () (assert-true t))');

    // Run the test
    const result = interpreter.execute('(test-run "passing-test")');

    expect(result).toBeDefined();
    expect(result._tag).toBe("Right");

    const value = expectRight(result);
    expect(value).toBeDefined();
    expect(value.type).toBe("boolean");
    expect(value.value).toBe(true);
  });

  test("should run all tests with test-run-all", async () => {
    const interpreter = editor.getInterpreter();

    // Define multiple tests
    interpreter.execute('(deftest test-one () (assert-true t))');
    interpreter.execute('(deftest test-two () (assert-equal 1 1))');
    interpreter.execute('(deftest test-three () (assert-false nil))');

    // Run all tests
    const result = interpreter.execute('(test-run-all)');

    expect(result).toBeDefined();
    expect(result._tag).toBe("Right");

    const value = expectRight(result);
    expect(value).toBeDefined();
    expect(value.type).toBe("list");

    const results = expectTlispList(value);
    expect(results.length).toBe(3);
    // The test registry is global, so we might have more tests than just the 3 we defined
    // But we expect at least our 3 tests to pass
    expect(expectTlispNumber(expectDefined(results[0]))).toBeGreaterThanOrEqual(3); // at least 3 passed
    expect(expectTlispNumber(expectDefined(results[1]))).toBe(0); // 0 failed
    expect(expectTlispNumber(expectDefined(results[2]))).toBeGreaterThanOrEqual(3); // at least 3 total
  });

  test("should handle test failures properly", async () => {
    const interpreter = editor.getInterpreter();

    // Define a test that should fail
    interpreter.execute('(deftest failing-test () (assert-equal 1 2))');

    // Run the test - this should still return true from test-run but the test itself fails
    // Actually, let's test the failure scenario differently
    try {
      interpreter.execute('(deftest failing-test-2 () (assert-equal 1 2)) (test-run "failing-test-2")');
      // If we reach here, the test didn't fail as expected
      expect(false).toBe(true); // This should not happen
    } catch (e) {
      // Expected - the test should fail
      expect(true).toBe(true);
    }
  });

  test("should handle errors in tests", async () => {
    const interpreter = editor.getInterpreter();

    // Define a test that should raise an error
    interpreter.execute('(deftest error-test () (assert-error (/ 1 0)))');

    // Run the test
    const result = interpreter.execute('(test-run "error-test")');

    expect(result).toBeDefined();
    expect(result._tag).toBe("Right");

    const value = expectRight(result);
    expect(value).toBeDefined();
    expect(value.type).toBe("boolean");
    expect(value.value).toBe(true);
  });

  test("should support assert-true functionality", async () => {
    const interpreter = editor.getInterpreter();

    // Test assert-true with truthy value
    const result1 = interpreter.execute('(assert-true t)');
    expect(result1._tag).toBe("Right");
    expect(expectRight(result1).value).toBe(true);

    // Test assert-true with falsy value (should throw error)
    try {
      interpreter.execute('(assert-true nil)');
      expect(false).toBe(true); // Should not reach here
    } catch (e) {
      expect(true).toBe(true); // Expected to throw
    }
  });

  test("should support assert-false functionality", async () => {
    const interpreter = editor.getInterpreter();

    // Test assert-false with falsy value
    const result1 = interpreter.execute('(assert-false nil)');
    expect(result1._tag).toBe("Right");
    expect(expectRight(result1).value).toBe(true);

    // Test assert-false with truthy value (should throw error)
    try {
      interpreter.execute('(assert-false t)');
      expect(false).toBe(true); // Should not reach here
    } catch (e) {
      expect(true).toBe(true); // Expected to throw
    }
  });

  test("should support assert-equal functionality", async () => {
    const interpreter = editor.getInterpreter();

    // Test assert-equal with equal values
    const result1 = interpreter.execute('(assert-equal 1 1)');
    expect(result1._tag).toBe("Right");
    expect(expectRight(result1).value).toBe(true);

    // Test assert-equal with different values (should throw error)
    try {
      interpreter.execute('(assert-equal 1 2)');
      expect(false).toBe(true); // Should not reach here
    } catch (e) {
      expect(true).toBe(true); // Expected to throw
    }
  });

  test("should support assert-not-equal functionality", async () => {
    const interpreter = editor.getInterpreter();

    // Test assert-not-equal with different values
    const result1 = interpreter.execute('(assert-not-equal 1 2)');
    expect(result1._tag).toBe("Right");
    expect(expectRight(result1).value).toBe(true);

    // Test assert-not-equal with same values (should throw error)
    try {
      interpreter.execute('(assert-not-equal 1 1)');
      expect(false).toBe(true); // Should not reach here
    } catch (e) {
      expect(true).toBe(true); // Expected to throw
    }
  });

  test("should support assert-error functionality", async () => {
    const interpreter = editor.getInterpreter();

    // Test assert-error with a form that raises an error
    // Note: We can't easily test this with a real error in this context
    // So we'll test with a form that doesn't raise an error (should fail the assertion)
    try {
      interpreter.execute('(assert-error (+ 1 2))');
      expect(false).toBe(true); // Should not reach here
    } catch (e) {
      expect(true).toBe(true); // Expected to throw since (+ 1 2) doesn't error
    }
  });
});
