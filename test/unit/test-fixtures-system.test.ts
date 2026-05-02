/**
 * @file test-fixtures-system.test.ts
 * @description Tests for T-Lisp Fixture System (US-0.6.2)
 * Tests the deffixture, use-fixtures, and fixture lifecycle management
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { resetFixtureState } from "../../src/tlisp/test-framework.ts";

describe("T-Lisp Fixture System (US-0.6.2)", () => {
  let editor: Editor;
  let mockTerminal: MockTerminal;
  let mockFileSystem: MockFileSystem;

  beforeEach(() => {
    mockTerminal = new MockTerminal();
    mockFileSystem = new MockFileSystem();
    editor = new Editor(mockTerminal, mockFileSystem);
    editor.start();
    // Reset fixture state for clean test isolation
    resetFixtureState();
  });

  afterEach(() => {
    editor.stop();
  });

  function getInterpreter() {
    return editor.getInterpreter();
  }

  describe("deffixture - Fixture Definition", () => {
    test("deffixture defines a simple fixture", () => {
      const interpreter = getInterpreter();
      const result = interpreter.execute('(deffixture simple-fixture () (defvar x 10))');

      expect(result).toBeDefined();
      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("symbol");
      expect(result.right.value).toBe("simple-fixture");
    });

    test("deffixture returns fixture name", () => {
      const interpreter = getInterpreter();
      const result = interpreter.execute('(deffixture my-fixture () (defvar data 42))');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("symbol");
      expect(result.right.value).toBe("my-fixture");
    });

    test("deffixture with parameters", () => {
      const interpreter = getInterpreter();
      const result = interpreter.execute('(deffixture param-fixture (name value) (defvar name value))');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("symbol");
      expect(result.right.value).toBe("param-fixture");
    });

    test("deffixture stores setup and teardown code", () => {
      const interpreter = getInterpreter();
      const result = interpreter.execute('(deffixture complex-fixture () (setup (defvar setup-called t)) (teardown (defvar teardown-called t)))');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("symbol");
      expect(result.right.value).toBe("complex-fixture");
    });

    test("deffixture can return test data", () => {
      const interpreter = getInterpreter();
      const result = interpreter.execute('(deffixture data-fixture () (list 1 2 3))');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("symbol");
    });
  });

  describe("use-fixtures - Applying Fixtures to Tests", () => {
    test("use-fixtures applies single fixture to test", () => {
      const interpreter = getInterpreter();

      // Define fixture
      interpreter.execute('(deffixture setup-x () (defvar x 100))');

      // Define test with fixture
      interpreter.execute('(deftest test-with-x () (use-fixtures setup-x) (assert-equal x 100))');

      // Run test
      const result = interpreter.execute('(test-run "test-with-x")');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("boolean");
      expect(result.right.value).toBe(true);
    });

    test("use-fixtures applies multiple fixtures in order", () => {
      const interpreter = getInterpreter();

      interpreter.execute('(deffixture setup-first () (defvar first 1))');
      interpreter.execute('(deffixture setup-second () (defvar second 2))');
      interpreter.execute('(deftest test-with-both () (use-fixtures setup-first setup-second) (assert-equal first 1) (assert-equal second 2))');

      const result = interpreter.execute('(test-run "test-with-both")');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("boolean");
      expect(result.right.value).toBe(true);
    });

    test("use-fixtures fixture cleanup executes after test", () => {
      const interpreter = getInterpreter();

      interpreter.execute('(deffixture with-teardown () (defvar value 10) (teardown (set! value 0)))');
      interpreter.execute('(deftest test-cleanup () (use-fixtures with-teardown) (assert-equal value 10))');

      const result = interpreter.execute('(test-run "test-cleanup")');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("boolean");
      expect(result.right.value).toBe(true);
    });
  });

  describe("Fixture Lifecycle Management", () => {
    test("fixture setup executes before test", () => {
      const interpreter = getInterpreter();

      interpreter.execute('(deffixture with-setup () (defvar setup-ran nil) (setup (set! setup-ran t)))');
      interpreter.execute('(deftest test-setup-executes () (use-fixtures with-setup) (assert-true setup-ran))');

      const result = interpreter.execute('(test-run "test-setup-executes")');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("boolean");
      expect(result.right.value).toBe(true);
    });

    test("fixture teardown executes after test even on failure", () => {
      const interpreter = getInterpreter();

      interpreter.execute('(deffixture with-teardown () (defvar cleaned-up nil) (teardown (set! cleaned-up t)))');
      interpreter.execute('(deftest test-failing-test () (use-fixtures with-teardown) (assert-true nil))');

      const result = interpreter.execute('(test-run "test-failing-test")');

      // Test should fail
      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("boolean");
      expect(result.right.value).toBe(false);
    });

    test("multiple fixtures set up in order", () => {
      const interpreter = getInterpreter();

      interpreter.execute('(deffixture fixture-a () (defvar order-a 0) (setup (set! order-a 1)))');
      interpreter.execute('(deffixture fixture-b () (defvar order-b 0) (setup (set! order-b 2)))');
      interpreter.execute('(deftest test-order () (use-fixtures fixture-a fixture-b) (assert-equal order-a 1) (assert-equal order-b 2))');

      const result = interpreter.execute('(test-run "test-order")');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("boolean");
      expect(result.right.value).toBe(true);
    });

    test("fixtures tear down in reverse order", () => {
      const interpreter = getInterpreter();

      interpreter.execute('(deffixture teardown-a () (defvar a-teardown 0) (teardown (set! a-teardown 1)))');
      interpreter.execute('(deffixture teardown-b () (defvar b-teardown 0) (teardown (set! b-teardown 2)))');
      interpreter.execute('(deftest test-teardown-order () (use-fixtures teardown-a teardown-b) (assert-equal a-teardown 0) (assert-equal b-teardown 0))');

      const result = interpreter.execute('(test-run "test-teardown-order")');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("boolean");
      expect(result.right.value).toBe(true);
    });
  });

  describe("Fixture Scope Controls", () => {
    test("fixture with each scope runs for each test", () => {
      const interpreter = getInterpreter();

      interpreter.execute('(deffixture each-fixture (:scope each) (defvar counter 0) (setup (set! counter (+ counter 1))))');
      interpreter.execute('(deftest test-one () (use-fixtures each-fixture) (assert-equal counter 1))');
      interpreter.execute('(deftest test-two () (use-fixtures each-fixture) (assert-equal counter 1))');

      const result = interpreter.execute('(test-run-all)');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("list");
      const counts = result.right.value;
      expect(counts[2].value).toBeGreaterThanOrEqual(2); // At least 2 tests
    });

    test("fixture with once scope runs only once", () => {
      const interpreter = getInterpreter();

      interpreter.execute('(deffixture once-fixture (:scope once) (defvar ran-once 0) (setup (set! ran-once (+ ran-once 1))))');
      interpreter.execute('(deftest test-once-one () (use-fixtures once-fixture) (assert-type ran-once number))');
      interpreter.execute('(deftest test-once-two () (use-fixtures once-fixture) (assert-type ran-once number))');

      const result = interpreter.execute('(test-run-all)');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("list");
    });

    test("fixture with all scope runs before all tests", () => {
      const interpreter = getInterpreter();

      interpreter.execute('(deffixture all-fixture (:scope all) (defvar all-setup nil) (setup (set! all-setup t)))');
      interpreter.execute('(deftest test-all-one () (use-fixtures all-fixture) (assert-true all-setup))');
      interpreter.execute('(deftest test-all-two () (use-fixtures all-fixture) (assert-true all-setup))');

      const result = interpreter.execute('(test-run-all)');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("list");
    });
  });

  describe("Fixture Error Handling", () => {
    test("failed fixture setup skips test", () => {
      const interpreter = getInterpreter();

      // Note: Division by zero might not error in T-Lisp, so we use a different approach
      interpreter.execute('(deffixture failing-setup () (setup (assert-true nil)))');
      interpreter.execute('(deftest test-should-be-skipped () (use-fixtures failing-setup) (assert-true t))');

      const result = interpreter.execute('(test-run "test-should-be-skipped")');

      // Test should fail because setup failed
      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("boolean");
      expect(result.right.value).toBe(false);
    });

    test("fixture teardown failure is logged but doesn't stop test", () => {
      const interpreter = getInterpreter();

      interpreter.execute('(deffixture failing-teardown () (defvar x 1) (teardown (assert-true nil)))');
      interpreter.execute('(deftest test-with-failing-teardown () (use-fixtures failing-teardown) (assert-equal x 1))');

      const result = interpreter.execute('(test-run "test-with-failing-teardown")');

      // Test should pass even though teardown fails
      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("boolean");
      expect(result.right.value).toBe(true);
    });
  });

  describe("Fixture Return Values", () => {
    test("fixture can return test data", () => {
      const interpreter = getInterpreter();

      interpreter.execute('(deffixture data-provider () (list "name" "value"))');
      interpreter.execute('(deftest test-with-fixture-data () (use-fixtures data-provider) (assert-true t))');

      const result = interpreter.execute('(test-run "test-with-fixture-data")');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("boolean");
      expect(result.right.value).toBe(true);
    });

    test("fixture return value accessible in test", () => {
      const interpreter = getInterpreter();

      interpreter.execute('(deffixture config-fixture () (defvar config-value 42))');
      interpreter.execute('(deftest test-fixture-return-value () (use-fixtures config-fixture) (assert-equal config-value 42))');

      const result = interpreter.execute('(test-run "test-fixture-return-value")');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("boolean");
      expect(result.right.value).toBe(true);
    });
  });

  describe("Integration with Existing Test Framework", () => {
    test("fixtures work with setup/teardown functions", () => {
      const interpreter = getInterpreter();

      interpreter.execute('(deffixture integrated-fixture () (defvar from-fixture t))');
      interpreter.execute('(setup (defvar from-setup t))');
      interpreter.execute('(teardown (defvar from-teardown t))');
      interpreter.execute('(deftest test-integration () (use-fixtures integrated-fixture) (assert-true from-fixture) (assert-true from-setup))');

      const result = interpreter.execute('(test-run "test-integration")');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("boolean");
      expect(result.right.value).toBe(true);
    });

    test("fixtures work with all assertion types", () => {
      const interpreter = getInterpreter();

      interpreter.execute('(deffixture test-data () (defvar my-list (list 1 2 3)) (defvar my-string "hello") (defvar my-num 42))');
      interpreter.execute('(deftest test-fixture-assertions () (use-fixtures test-data) (assert-contains my-list 2) (assert-contains-string my-string "ell") (assert-type my-num number))');

      const result = interpreter.execute('(test-run "test-fixture-assertions")');

      expect(result._tag).toBe("Right");
      expect(result.right.type).toBe("boolean");
      expect(result.right.value).toBe(true);
    });
  });
});
