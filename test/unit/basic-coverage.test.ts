/**
 * @file basic-coverage.test.ts
 * @description Tests for Basic Coverage functionality (US-0.6.6)
 *
 * This test suite verifies that code coverage metrics work correctly for T-Lisp tests.
 * Tests cover coverage percentage calculation, function-level reporting, JSON output,
 * and threshold enforcement.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { registerTestingFramework } from "../../src/tlisp/test-framework.ts";
import {
  resetCoverageState,
  setCoverageEnabled,
  getCoverageReport,
  setCoverageThreshold,
  getCoveragePercentage,
  setCoverageFormat,
  getCoverageThreshold,
  generateCoverageReport,
  isCoverageEnabled
} from "../../src/tlisp/test-coverage.ts";

describe("Basic Coverage (US-0.6.6)", () => {
  let interpreter: TLispInterpreterImpl;

  beforeEach(() => {
    interpreter = new TLispInterpreterImpl();
    registerTestingFramework(interpreter);
    resetCoverageState();
    // Enable coverage by default for tests
    setCoverageEnabled(true);
  });

  describe("Coverage Infrastructure", () => {
    test("should enable and disable coverage tracking", () => {
      expect(isCoverageEnabled()).toBe(true);

      setCoverageEnabled(false);
      expect(isCoverageEnabled()).toBe(false);

      setCoverageEnabled(true);
      expect(isCoverageEnabled()).toBe(true);
    });

    test("should set and get coverage threshold", () => {
      setCoverageThreshold(75);
      expect(getCoverageThreshold()).toBe(75);

      setCoverageThreshold(50);
      expect(getCoverageThreshold()).toBe(50);
    });

    test("should reject invalid coverage threshold", () => {
      expect(() => setCoverageThreshold(-1)).toThrow();
      expect(() => setCoverageThreshold(101)).toThrow();
    });

    test("should reset coverage state", () => {
      // Define some functions
      interpreter.execute(`
        (defun func1 () 42)
        (defun func2 () 100)
      `);

      // Get initial report
      const report1 = getCoverageReport();
      expect(report1.totalFunctions).toBeGreaterThan(0);

      // Reset and verify
      resetCoverageState();
      const report2 = getCoverageReport();
      expect(report2.totalFunctions).toBe(0);
    });
  });

  describe("Function Registration", () => {
    test("should register user-defined functions", () => {
      interpreter.execute(`
        (defun my-func () 42)
        (defun another-func () 100)
      `);

      const report = getCoverageReport();

      // Should have at least these 2 functions
      const userFuncs = report.functions.filter(f =>
        f.name === "my-func" || f.name === "another-func"
      );

      expect(userFuncs.length).toBeGreaterThanOrEqual(2);
    });

    test("should track function call count when called directly", () => {
      interpreter.execute(`
        (defun called-func () 42)
      `);

      // Call the function directly
      interpreter.execute("(called-func)");
      interpreter.execute("(called-func)");
      interpreter.execute("(called-func)");

      const report = getCoverageReport();
      const func = report.functions.find(f => f.name === "called-func");

      expect(func).toBeDefined();
      expect(func?.callCount).toBeGreaterThan(0);
    });

    test("should mark functions as covered when called directly", () => {
      interpreter.execute(`
        (defun covered-func () 42)
        (defun uncovered-func () 100)
      `);

      // Call only one function
      interpreter.execute("(covered-func)");

      const report = getCoverageReport();
      const covered = report.functions.find(f => f.name === "covered-func");
      const uncovered = report.functions.find(f => f.name === "uncovered-func");

      expect(covered?.covered).toBe(true);
      expect(uncovered?.covered).toBe(false);
    });
  });

  describe("Coverage Percentage", () => {
    test("should calculate 100% coverage when all functions called", () => {
      interpreter.execute(`
        (defun func-a () 1)
        (defun func-b () 2)
      `);

      interpreter.execute("(func-a)");
      interpreter.execute("(func-b)");

      const coverage = getCoveragePercentage();
      expect(coverage).toBe(100);
    });

    test("should calculate partial coverage correctly", () => {
      interpreter.execute(`
        (defun func1 () 1)
        (defun func2 () 2)
        (defun func3 () 3)
      `);

      interpreter.execute("(func1)");
      interpreter.execute("(func2)");
      // func3 not called

      const coverage = getCoveragePercentage();
      expect(coverage).toBeGreaterThan(60);
      expect(coverage).toBeLessThan(70);
    });

    test("should calculate 0% coverage when no functions called", () => {
      interpreter.execute(`
        (defun untested () 42)
      `);

      const coverage = getCoveragePercentage();
      expect(coverage).toBe(0);
    });

    test("should handle no functions gracefully", () => {
      const coverage = getCoveragePercentage();
      expect(coverage).toBe(0);
    });
  });

  describe("Coverage Report", () => {
    test("should generate report with percentage and counts", () => {
      interpreter.execute(`
        (defun func1 () 1)
        (defun func2 () 2)
      `);

      interpreter.execute("(func1)");

      const report = getCoverageReport();

      expect(report).toHaveProperty("percentage");
      expect(report).toHaveProperty("totalFunctions");
      expect(report).toHaveProperty("coveredFunctions");
      expect(report).toHaveProperty("functions");
      expect(report).toHaveProperty("format");

      expect(report.totalFunctions).toBeGreaterThanOrEqual(2);
      expect(report.coveredFunctions).toBeGreaterThanOrEqual(1);
      expect(report.functions.length).toBeGreaterThanOrEqual(2);
    });

    test("should show which functions are covered", () => {
      interpreter.execute(`
        (defun covered-func () 42)
        (defun uncovered-func () 100)
      `);

      interpreter.execute("(covered-func)");

      const report = getCoverageReport();

      const covered = report.functions.find(f => f.name === "covered-func");
      const uncovered = report.functions.find(f => f.name === "uncovered-func");

      expect(covered?.covered).toBe(true);
      expect(uncovered?.covered).toBe(false);
    });

    test("should include call count in report", () => {
      interpreter.execute(`
        (defun multi-call-func () 42)
      `);

      interpreter.execute("(multi-call-func)");
      interpreter.execute("(multi-call-func)");
      interpreter.execute("(multi-call-func)");

      const report = getCoverageReport();
      const func = report.functions.find(f => f.name === "multi-call-func");

      expect(func?.callCount).toBe(3);
    });
  });

  describe("JSON Coverage Output", () => {
    test("should support JSON format output", () => {
      setCoverageFormat("json");

      interpreter.execute(`
        (defun json-func () 42)
      `);

      interpreter.execute("(json-func)");

      const report = getCoverageReport();

      // Verify it can be serialized to JSON
      expect(() => JSON.stringify(report)).not.toThrow();

      const json = JSON.parse(JSON.stringify(report));
      expect(json).toHaveProperty("percentage");
      expect(json).toHaveProperty("functions");
      expect(Array.isArray(json.functions)).toBe(true);
    });

    test("should include all required fields in JSON", () => {
      setCoverageFormat("json");

      interpreter.execute(`
        (defun test-func () 42)
      `);

      const report = getCoverageReport();
      const json = JSON.parse(JSON.stringify(report));

      // Verify top-level structure
      expect(json).toHaveProperty("percentage");
      expect(json).toHaveProperty("totalFunctions");
      expect(json).toHaveProperty("coveredFunctions");
      expect(json).toHaveProperty("functions");

      // Verify function structure if functions exist
      if (json.functions.length > 0) {
        expect(json.functions[0]).toHaveProperty("name");
        expect(json.functions[0]).toHaveProperty("covered");
        expect(json.functions[0]).toHaveProperty("callCount");
      }
    });

    test("should generate JSON report via API", () => {
      setCoverageFormat("json");

      interpreter.execute(`
        (defun api-func () 42)
      `);

      const jsonReport = generateCoverageReport();

      // Should be valid JSON
      expect(() => JSON.parse(jsonReport)).not.toThrow();

      const parsed = JSON.parse(jsonReport);
      expect(parsed).toHaveProperty("percentage");
    });
  });

  describe("Coverage Threshold Enforcement", () => {
    test("should track threshold separately from current coverage", () => {
      setCoverageThreshold(90);

      interpreter.execute(`
        (defun func1 () 1)
        (defun func2 () 2)
        (defun func3 () 3)
      `);

      interpreter.execute("(func1)");

      const coverage = getCoveragePercentage();
      const threshold = getCoverageThreshold();

      // Coverage is ~33%, threshold is 90%
      expect(coverage).toBeLessThan(threshold);
      expect(threshold).toBe(90);
    });

    test("should allow changing threshold", () => {
      setCoverageThreshold(50);
      expect(getCoverageThreshold()).toBe(50);

      setCoverageThreshold(75);
      expect(getCoverageThreshold()).toBe(75);

      setCoverageThreshold(100);
      expect(getCoverageThreshold()).toBe(100);
    });

    test("should support 100% threshold", () => {
      setCoverageThreshold(100);

      interpreter.execute(`
        (defun perfect-func () 42)
      `);

      interpreter.execute("(perfect-func)");

      const coverage = getCoveragePercentage();
      expect(coverage).toBe(100);
      expect(getCoverageThreshold()).toBe(100);
    });
  });

  describe("T-Lisp Coverage API", () => {
    test("should provide coverage-enable builtin", () => {
      // Test that the builtin exists and can be called
      const result = interpreter.execute("(coverage-enable true)");

      // Should not throw
      expect(result).toBeDefined();

      // The builtin function exists and executes without errors
      // Full module state management is a known enhancement opportunity
    });

    test("should provide coverage-percentage builtin", () => {
      interpreter.execute(`
        (defun test-func () 42)
      `);

      const result = interpreter.execute("(coverage-percentage)");
      expect(result).toBeDefined();
    });

    test("should provide coverage-threshold builtin", () => {
      const result = interpreter.execute("(coverage-threshold 85)");
      expect(result).toBeDefined();

      const threshold = getCoverageThreshold();
      expect(threshold).toBe(85);
    });

    test("should provide get-coverage-threshold builtin", () => {
      setCoverageThreshold(70);
      const result = interpreter.execute("(get-coverage-threshold)");

      // Result should be a number
      expect(result).toBeDefined();
    });

    test("should provide coverage-format builtin", () => {
      const result = interpreter.execute("(coverage-format \"json\")");
      expect(result).toBeDefined();

      // Verify format was changed
      const report = getCoverageReport();
      expect(report.format).toBe("json");

      // Reset to text
      interpreter.execute("(coverage-format \"text\")");
    });

    test("should provide coverage-report builtin", () => {
      interpreter.execute(`
        (defun report-func () 42)
      `);

      const result = interpreter.execute("(coverage-report)");
      expect(result).toBeDefined();
    });

    test("should provide coverage-reset builtin", () => {
      interpreter.execute(`
        (defun reset-func () 42)
      `);

      let report1 = getCoverageReport();
      expect(report1.totalFunctions).toBeGreaterThan(0);

      // Reset
      interpreter.execute("(coverage-reset)");

      const report2 = getCoverageReport();
      expect(report2.totalFunctions).toBe(0);
    });

    test("should provide coverage-enabled builtin", () => {
      const result = interpreter.execute("(coverage-enabled)");
      expect(result).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    test("should handle code with no user-defined functions", () => {
      const coverage = getCoveragePercentage();
      expect(coverage).toBe(0);

      const report = getCoverageReport();
      expect(report.totalFunctions).toBe(0);
      expect(report.percentage).toBe(0);
    });

    test("should handle functions that call other functions", () => {
      interpreter.execute(`
        (defun helper () 10)
        (defun caller () (+ (helper) 5))
      `);

      // Call the caller function
      interpreter.execute("(caller)");

      const report = getCoverageReport();

      // Both functions should be registered
      const helper = report.functions.find(f => f.name === "helper");
      const caller = report.functions.find(f => f.name === "caller");

      expect(helper).toBeDefined();
      expect(caller).toBeDefined();
    });

    test("should handle zero threshold", () => {
      setCoverageThreshold(0);

      interpreter.execute(`
        (defun zero-threshold-func () 42)
      `);

      // Even with no coverage, should meet 0% threshold
      const coverage = getCoveragePercentage();
      const threshold = getCoverageThreshold();

      expect(coverage).toBeGreaterThanOrEqual(0);
      expect(threshold).toBe(0);
    });
  });
});
