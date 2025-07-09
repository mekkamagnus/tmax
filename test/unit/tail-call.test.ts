/**
 * @file tail-call.test.ts
 * @description Tests for tail-call optimization in T-Lisp evaluator
 */

import { assertEquals } from "@std/assert";
import { createEvaluatorWithBuiltins } from "../../src/tlisp/evaluator.ts";
import { TLispParser } from "../../src/tlisp/parser.ts";
import { createNumber } from "../../src/tlisp/values.ts";

/**
 * Test suite for tail-call optimization
 */
Deno.test("Tail-Call Optimization", async (t) => {
  const { evaluator, env } = createEvaluatorWithBuiltins();
  const parser = new TLispParser();

  await t.step("should handle simple tail recursion", () => {
    // Define a tail-recursive factorial function
    const defExpr = parser.parse(`
      (defun factorial-tail (n acc)
        (if (= n 0)
            acc
            (factorial-tail (- n 1) (* n acc))))
    `);
    evaluator.eval(defExpr, env);

    // Test factorial with tail recursion
    const callExpr = parser.parse("(factorial-tail 5 1)");
    const result = evaluator.eval(callExpr, env);
    assertEquals(result, createNumber(120));
  });

  await t.step("should handle tail-recursive countdown", () => {
    // Define a tail-recursive countdown function
    const defExpr = parser.parse(`
      (defun countdown (n)
        (if (= n 0)
            'done
            (countdown (- n 1))))
    `);
    evaluator.eval(defExpr, env);

    // Test countdown - should not stack overflow even with large numbers
    const callExpr = parser.parse("(countdown 100)");
    const result = evaluator.eval(callExpr, env);
    assertEquals(result.type, "symbol");
    assertEquals(result.value, "done");
  });

  await t.step("should handle tail-recursive sum", () => {
    // Define a tail-recursive sum function
    const defExpr = parser.parse(`
      (defun sum-tail (n acc)
        (if (= n 0)
            acc
            (sum-tail (- n 1) (+ acc n))))
    `);
    evaluator.eval(defExpr, env);

    // Test sum 1+2+3+4+5 = 15
    const callExpr = parser.parse("(sum-tail 5 0)");
    const result = evaluator.eval(callExpr, env);
    assertEquals(result, createNumber(15));
  });

  await t.step("should handle tail calls in if expressions", () => {
    // Define a function that uses tail calls in both branches
    const defExpr = parser.parse(`
      (defun even-odd (n)
        (if (= n 0)
            'even
            (if (= n 1)
                'odd
                (even-odd (- n 2)))))
    `);
    evaluator.eval(defExpr, env);

    // Test even/odd detection
    const evenExpr = parser.parse("(even-odd 10)");
    const evenResult = evaluator.eval(evenExpr, env);
    assertEquals(evenResult.type, "symbol");
    assertEquals(evenResult.value, "even");

    const oddExpr = parser.parse("(even-odd 11)");
    const oddResult = evaluator.eval(oddExpr, env);
    assertEquals(oddResult.type, "symbol");
    assertEquals(oddResult.value, "odd");
  });

  await t.step("should handle tail calls in let expressions", () => {
    // Define a function that uses tail calls within let
    const defExpr = parser.parse(`
      (defun fibonacci-tail (n a b)
        (if (= n 0)
            a
            (let ((next-a b) (next-b (+ a b)))
              (fibonacci-tail (- n 1) next-a next-b))))
    `);
    evaluator.eval(defExpr, env);

    // Test fibonacci - fib(6) = 8
    const callExpr = parser.parse("(fibonacci-tail 6 0 1)");
    const result = evaluator.eval(callExpr, env);
    assertEquals(result, createNumber(8));
  });

  await t.step("should handle mutual tail recursion", () => {
    // Define mutually recursive functions
    const defEvenExpr = parser.parse(`
      (defun is-even (n)
        (if (= n 0)
            t
            (is-odd (- n 1))))
    `);
    evaluator.eval(defEvenExpr, env);

    const defOddExpr = parser.parse(`
      (defun is-odd (n)
        (if (= n 0)
            nil
            (is-even (- n 1))))
    `);
    evaluator.eval(defOddExpr, env);

    // Test mutual recursion
    const evenExpr = parser.parse("(is-even 10)");
    const evenResult = evaluator.eval(evenExpr, env);
    assertEquals(evenResult.type, "boolean");
    assertEquals(evenResult.value, true);

    const oddExpr = parser.parse("(is-odd 11)");
    const oddResult = evaluator.eval(oddExpr, env);
    assertEquals(oddResult.type, "boolean");
    assertEquals(oddResult.value, true);
  });
});