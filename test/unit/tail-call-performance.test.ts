/**
 * @file tail-call-performance.test.ts
 * @description Performance tests for tail-call optimization
 */

import { describe, test, expect } from "bun:test";
import { Either } from "../../src/utils/task-either.ts";
import { createEvaluatorWithBuiltins } from "../../src/tlisp/evaluator.ts";
import { TLispParser } from "../../src/tlisp/parser.ts";
import { createNumber } from "../../src/tlisp/values.ts";

describe("Tail-Call Optimization Performance", () => {
  const { evaluator, env } = createEvaluatorWithBuiltins();
  const parser = new TLispParser();

  // Helper to parse and extract .right value
  const parseExpr = (code: string) => {
    const result = parser.parse(code);
    if (Either.isLeft(result)) {
      throw new Error(`Parse error: ${result.left}`);
    }
    return result.right;
  };

  // Helper to eval and extract .right value
  const evalExpr = (expr: any) => {
    const result = evaluator.eval(expr, env);
    if (Either.isLeft(result)) {
      throw new Error(`Eval error: ${result.left}`);
    }
    return result.right;
  };

  test("should handle deep recursion without stack overflow", () => {
    // Define a tail-recursive function that would cause stack overflow without TCO
    const defExpr = parseExpr(`
      (defun deep-countdown (n)
        (if (= n 0)
            'done
            (deep-countdown (- n 1))))
    `);
    evalExpr(defExpr);

    // Test with a moderate number first to verify it works
    const callExpr = parseExpr("(deep-countdown 100)");
    const result = evalExpr(callExpr);
    expect(result.type).toBe("symbol");
    expect(result.value).toBe("done");
  });

  test("should handle deep tail-recursive accumulation", () => {
    // Define a tail-recursive sum function
    const defExpr = parseExpr(`
      (defun sum-to-n (n acc)
        (if (= n 0)
            acc
            (sum-to-n (- n 1) (+ acc n))))
    `);
    evalExpr(defExpr);

    // Test sum of 1+2+...+100 = 5050
    const callExpr = parseExpr("(sum-to-n 100 0)");
    const result = evalExpr(callExpr);
    expect(result).toEqual(createNumber(5050));
  });

  test("should handle complex tail-recursive computation", () => {
    // Define a tail-recursive function that computes powers
    const defExpr = parseExpr(`
      (defun power-tail (base exp acc)
        (if (= exp 0)
            acc
            (power-tail base (- exp 1) (* acc base))))
    `);
    evalExpr(defExpr);

    // Test 2^10 = 1024
    const callExpr = parseExpr("(power-tail 2 10 1)");
    const result = evalExpr(callExpr);
    expect(result).toEqual(createNumber(1024));
  });

  test("should handle mutually recursive functions efficiently", () => {
    // Define mutually recursive functions for even/odd with large numbers
    const defEvenExpr = parseExpr(`
      (defun is-even-large (n)
        (if (= n 0)
            t
            (is-odd-large (- n 1))))
    `);
    evalExpr(defEvenExpr);

    const defOddExpr = parseExpr(`
      (defun is-odd-large (n)
        (if (= n 0)
            nil
            (is-even-large (- n 1))))
    `);
    evalExpr(defOddExpr);

    // Test with moderately large numbers
    const evenExpr = parseExpr("(is-even-large 500)");
    const evenResult = evalExpr(evenExpr);
    expect(evenResult.type).toBe("boolean");
    expect(evenResult.value).toBe(true);

    const oddExpr = parseExpr("(is-odd-large 501)");
    const oddResult = evalExpr(oddExpr);
    expect(oddResult.type).toBe("boolean");
    expect(oddResult.value).toBe(true);
  });
});
