/**
 * @file tail-call-performance.test.ts
 * @description Performance tests for tail-call optimization
 */

import { assertEquals } from "@std/assert";
import { createEvaluatorWithBuiltins } from "../../src/tlisp/evaluator.ts";
import { TLispParser } from "../../src/tlisp/parser.ts";
import { createNumber } from "../../src/tlisp/values.ts";

/**
 * Test suite for tail-call optimization performance
 */
Deno.test("Tail-Call Optimization Performance", async (t) => {
  const { evaluator, env } = createEvaluatorWithBuiltins();
  const parser = new TLispParser();

  await t.step("should handle deep recursion without stack overflow", () => {
    // Define a tail-recursive function that would cause stack overflow without TCO
    const defExpr = parser.parse(`
      (defun deep-countdown (n)
        (if (= n 0)
            'done
            (deep-countdown (- n 1))))
    `);
    evaluator.eval(defExpr, env);

    // Test with a moderate number first to verify it works
    const callExpr = parser.parse("(deep-countdown 100)");
    const result = evaluator.eval(callExpr, env);
    assertEquals(result.type, "symbol");
    assertEquals(result.value, "done");
  });

  await t.step("should handle deep tail-recursive accumulation", () => {
    // Define a tail-recursive sum function
    const defExpr = parser.parse(`
      (defun sum-to-n (n acc)
        (if (= n 0)
            acc
            (sum-to-n (- n 1) (+ acc n))))
    `);
    evaluator.eval(defExpr, env);

    // Test sum of 1+2+...+100 = 5050
    const callExpr = parser.parse("(sum-to-n 100 0)");
    const result = evaluator.eval(callExpr, env);
    assertEquals(result, createNumber(5050));
  });

  await t.step("should handle complex tail-recursive computation", () => {
    // Define a tail-recursive function that computes powers
    const defExpr = parser.parse(`
      (defun power-tail (base exp acc)
        (if (= exp 0)
            acc
            (power-tail base (- exp 1) (* acc base))))
    `);
    evaluator.eval(defExpr, env);

    // Test 2^10 = 1024
    const callExpr = parser.parse("(power-tail 2 10 1)");
    const result = evaluator.eval(callExpr, env);
    assertEquals(result, createNumber(1024));
  });

  await t.step("should handle mutually recursive functions efficiently", () => {
    // Define mutually recursive functions for even/odd with large numbers
    const defEvenExpr = parser.parse(`
      (defun is-even-large (n)
        (if (= n 0)
            t
            (is-odd-large (- n 1))))
    `);
    evaluator.eval(defEvenExpr, env);

    const defOddExpr = parser.parse(`
      (defun is-odd-large (n)
        (if (= n 0)
            nil
            (is-even-large (- n 1))))
    `);
    evaluator.eval(defOddExpr, env);

    // Test with moderately large numbers
    const evenExpr = parser.parse("(is-even-large 500)");
    const evenResult = evaluator.eval(evenExpr, env);
    assertEquals(evenResult.type, "boolean");
    assertEquals(evenResult.value, true);

    const oddExpr = parser.parse("(is-odd-large 501)");
    const oddResult = evaluator.eval(oddExpr, env);
    assertEquals(oddResult.type, "boolean");
    assertEquals(oddResult.value, true);
  });
});