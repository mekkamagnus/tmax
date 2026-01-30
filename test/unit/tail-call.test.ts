/**
 * @file tail-call.test.ts
 * @description Tests for tail-call optimization in T-Lisp evaluator
 */

import { describe, test, expect } from "bun:test";
import { createEvaluatorWithBuiltins } from "../../src/tlisp/evaluator.ts";
import { TLispParser } from "../../src/tlisp/parser.ts";
import { createNumber } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("Tail-Call Optimization", () => {
  const { evaluator, env } = createEvaluatorWithBuiltins();
  const parser = new TLispParser();

  // Helper to parse expression and extract .right value
  const parseExpr = (code: string) => {
    const result = parser.parse(code);
    if (Either.isLeft(result)) {
      throw new Error(`Parse error: ${result.left}`);
    }
    return result.right;
  };

  // Helper to eval expression and extract .right value
  const evalExpr = (expr: any) => {
    const result = evaluator.eval(expr, env);
    if (Either.isLeft(result)) {
      throw new Error(`Eval error: ${result.left}`);
    }
    return result.right;
  };

  test("should handle simple tail recursion", () => {
    // Define a tail-recursive factorial function
    const defExpr = parseExpr(`
      (defun factorial-tail (n acc)
        (if (= n 0)
            acc
            (factorial-tail (- n 1) (* n acc))))
    `);
    evalExpr(defExpr);

    // Test factorial with tail recursion
    const callExpr = parseExpr("(factorial-tail 5 1)");
    const result = evalExpr(callExpr);
    expect(result).toEqual(createNumber(120));
  });

  test("should handle tail-recursive countdown", () => {
    // Define a tail-recursive countdown function
    const defExpr = parseExpr(`
      (defun countdown (n)
        (if (= n 0)
            'done
            (countdown (- n 1))))
    `);
    evalExpr(defExpr);

    // Test countdown - should not stack overflow even with large numbers
    const callExpr = parseExpr("(countdown 100)");
    const result = evalExpr(callExpr);
    expect(result.type).toBe("symbol");
    expect(result.value).toBe("done");
  });

  test("should handle tail-recursive sum", () => {
    // Define a tail-recursive sum function
    const defExpr = parseExpr(`
      (defun sum-tail (n acc)
        (if (= n 0)
            acc
            (sum-tail (- n 1) (+ acc n))))
    `);
    evalExpr(defExpr);

    // Test sum 1+2+3+4+5 = 15
    const callExpr = parseExpr("(sum-tail 5 0)");
    const result = evalExpr(callExpr);
    expect(result).toEqual(createNumber(15));
  });

  test("should handle tail calls in if expressions", () => {
    // Define a function that uses tail calls in both branches
    const defExpr = parseExpr(`
      (defun even-odd (n)
        (if (= n 0)
            'even
            (if (= n 1)
                'odd
                (even-odd (- n 2)))))
    `);
    evalExpr(defExpr);

    // Test even/odd detection
    const evenExpr = parseExpr("(even-odd 10)");
    const evenResult = evalExpr(evenExpr);
    expect(evenResult.type).toBe("symbol");
    expect(evenResult.value).toBe("even");

    const oddExpr = parseExpr("(even-odd 11)");
    const oddResult = evalExpr(oddExpr);
    expect(oddResult.type).toBe("symbol");
    expect(oddResult.value).toBe("odd");
  });

  test("should handle tail calls in let expressions", () => {
    // Define a function that uses tail calls within let
    const defExpr = parseExpr(`
      (defun fibonacci-tail (n a b)
        (if (= n 0)
            a
            (let ((next-a b) (next-b (+ a b)))
              (fibonacci-tail (- n 1) next-a next-b))))
    `);
    evalExpr(defExpr);

    // Test fibonacci - fib(6) = 8
    const callExpr = parseExpr("(fibonacci-tail 6 0 1)");
    const result = evalExpr(callExpr);
    expect(result).toEqual(createNumber(8));
  });

  test("should handle mutual tail recursion", () => {
    // Define mutually recursive functions
    const defEvenExpr = parseExpr(`
      (defun is-even (n)
        (if (= n 0)
            t
            (is-odd (- n 1))))
    `);
    evalExpr(defEvenExpr);

    const defOddExpr = parseExpr(`
      (defun is-odd (n)
        (if (= n 0)
            nil
            (is-even (- n 1))))
    `);
    evalExpr(defOddExpr);

    // Test mutual recursion
    const evenExpr = parseExpr("(is-even 10)");
    const evenResult = evalExpr(evenExpr);
    expect(evenResult.type).toBe("boolean");
    expect(evenResult.value).toBe(true);

    const oddExpr = parseExpr("(is-odd 11)");
    const oddResult = evalExpr(oddExpr);
    expect(oddResult.type).toBe("boolean");
    expect(oddResult.value).toBe(true);
  });
});
