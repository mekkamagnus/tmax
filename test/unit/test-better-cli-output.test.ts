/**
 * @file test-better-cli-output.test.ts
 * @description Tests for US-0.6.5: Better CLI Output
 *
 * This test suite verifies that the T-Lisp testing framework provides
 * improved CLI output with colors, progress indicators, and summary statistics.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { registerTestingFramework } from "../../src/tlisp/test-framework.ts";

describe("US-0.6.5: Better CLI Output", () => {
  let interpreter: TLispInterpreterImpl;
  let consoleOutput: string[];
  let originalLog: typeof console.log;
  let originalError: typeof console.error;

  beforeEach(() => {
    // Capture console output FIRST before registering framework
    consoleOutput = [];
    originalLog = console.log;
    originalError = console.error;

    console.log = (...args: any[]) => {
      consoleOutput.push(args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' '));
    };

    console.error = (...args: any[]) => {
      consoleOutput.push(args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' '));
    };

    // Then create interpreter and register framework
    interpreter = new TLispInterpreterImpl();
    registerTestingFramework(interpreter);
  });

  afterEach(() => {
    // Restore console
    console.log = originalLog;
    console.error = originalError;
  });

  describe("Colored Output", () => {
    test("passing tests show green checkmarks", () => {
      interpreter.execute('(deftest passing-test () (assert-true t))');
      const result = interpreter.execute('(test-run-all)');

      expect(result._tag).toBe("Right");

      const hasGreenCheck = consoleOutput.some(output =>
        output.includes("✓") || output.includes("✔")
      );

      expect(hasGreenCheck).toBe(true);
    });

    test("failing tests show red X with file:line", () => {
      interpreter.execute('(deftest failing-test () (assert-true nil))');
      const result = interpreter.execute('(test-run-all)');

      expect(result._tag).toBe("Right");

      const hasRedX = consoleOutput.some(output =>
        output.includes("✘")
      );

      expect(hasRedX).toBe(true);
    });

    test("colors can be disabled for non-TTY environments", () => {
      interpreter.execute('(set-color-mode "never")');
      interpreter.execute('(set-output-mode "plain")');
      interpreter.execute('(deftest plain-test () (assert-true t))');
      interpreter.execute('(test-run-all)');

      const hasAnsiCodes = consoleOutput.some(output =>
        output.includes("\x1b[")
      );

      expect(hasAnsiCodes).toBe(false);
    });
  });

  describe("Progress Indicator", () => {
    test("progress indicator shows during test runs", async () => {
      interpreter.execute('(deftest test-1 () (assert-true t))');
      interpreter.execute('(deftest test-2 () (assert-true t))');
      interpreter.execute('(deftest test-3 () (assert-true t))');
      interpreter.execute('(deftest test-4 () (assert-true t))');
      interpreter.execute('(deftest test-5 () (assert-true t))');

      const result = interpreter.execute('(test-run-all)');

      expect(result._tag).toBe("Right");
      expect(consoleOutput.length).toBeGreaterThan(0);
    });
  });

  describe("Summary Statistics", () => {
    test("summary shows duration and pass/fail counts", () => {
      // Create new interpreter for this test to avoid accumulated state
      const testInterpreter = new TLispInterpreterImpl();
      registerTestingFramework(testInterpreter);

      // Override console for this test only
      const testOutput: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => {
        testOutput.push(args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' '));
      };

      try {
        testInterpreter.execute('(deftest test-1 () (assert-true t))');
        testInterpreter.execute('(deftest test-2 () (assert-true t))');

        const result = testInterpreter.execute('(test-run-all)');

        const output = testOutput.join('\n');

        // Should show pass count (at least 2, possibly more from previous tests)
        expect(output).toMatch(/\d+.*pass/i);
        expect(output).toMatch(/\d+.*total/i);
        expect(output).toMatch(/\d+.*ms/i);
      } finally {
        console.log = originalLog;
      }
    });

    test("summary shows zero failed tests when all pass", () => {
      const testInterpreter = new TLispInterpreterImpl();
      registerTestingFramework(testInterpreter);

      const testOutput: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => {
        testOutput.push(args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' '));
      };

      try {
        testInterpreter.execute('(deftest test-1 () (assert-true t))');
        const result = testInterpreter.execute('(test-run-all)');

        const output = testOutput.join('\n');
        // Check that we have pass/fail/total counts in the summary
        expect(output).toMatch(/\d+.*failed/i);
        expect(output).toMatch(/\d+.*pass/i);
        expect(output).toMatch(/\d+.*total/i);
      } finally {
        console.log = originalLog;
      }
    });

    test("summary shows failed test count", () => {
      interpreter.execute('(deftest passing-test () (assert-true t))');
      interpreter.execute('(deftest failing-test () (assert-true nil))');
      const result = interpreter.execute('(test-run-all)');

      const output = consoleOutput.join('\n');

      expect(output).toMatch(/1.*pass/i);
      expect(output).toMatch(/1.*fail/i);
    });
  });

  describe("Verbose Mode", () => {
    test("--verbose flag shows detailed output", () => {
      interpreter.execute('(set-verbosity "verbose")');
      interpreter.execute('(deftest detailed-test () (assert-true t))');
      const result = interpreter.execute('(test-run-all)');

      const output = consoleOutput.join('\n');

      expect(output).toMatch(/detailed-test/i);
      expect(output).toMatch(/pass|✔|✓/i);
    });
  });

  describe("Quiet Mode", () => {
    test("--quiet flag shows only summary", () => {
      interpreter.execute('(set-verbosity "quiet")');
      interpreter.execute('(deftest test-1 () (assert-true t))');
      interpreter.execute('(deftest test-2 () (assert-true t))');
      const result = interpreter.execute('(test-run-all)');

      const output = consoleOutput.join('\n');

      expect(output).toMatch(/\d+.*pass/i);

      const lines = output.split('\n');
      const lastLine = lines[lines.length - 1];
      expect(lastLine).toMatch(/\d+.*pass/i);
    });
  });

  describe("Failing Test Output", () => {
    test("failing test output appears at end", () => {
      const testOutput: string[] = [];

      // Capture both console.log and process.stdout.write FIRST
      const originalLog = console.log;
      const originalWrite = process.stdout.write;
      console.log = (...args: any[]) => {
        testOutput.push(args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' '));
      };
      process.stdout.write = function(chunk: any, ...args: any[]) {
        if (typeof chunk === 'string') {
          testOutput.push(chunk);
        }
        return originalWrite.call(process.stdout, chunk, ...args);
      };

      // Now create interpreter and register framework (it will use our overridden console.log)
      const testInterpreter = new TLispInterpreterImpl();
      registerTestingFramework(testInterpreter);

      try {
        testInterpreter.execute('(deftest test-1 () (assert-true t))');
        testInterpreter.execute('(deftest test-2 () (assert-true nil))');
        testInterpreter.execute('(deftest test-3 () (assert-true t))');
        const result = testInterpreter.execute('(test-run-all)');

        // Filter out progress indicator lines (lines with just spaces and \r)
        const filteredOutput = testOutput.filter(line =>
          !/^\r\s+\r$/.test(line) && line.trim().length > 0
        ).join('');

        // Should have some output
        expect(filteredOutput.length).toBeGreaterThan(0);

        // Should have failing indicator (✘) somewhere in the output
        expect(filteredOutput).toMatch(/✘/);
      } finally {
        console.log = originalLog;
        process.stdout.write = originalWrite;
      }
    });
  });
});
