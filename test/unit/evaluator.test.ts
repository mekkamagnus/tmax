/**
 * @file evaluator.test.ts
 * @description Tests for T-Lisp evaluator
 */

import { assertEquals, assertThrows } from "@std/assert";
import { TLispEvaluator, createEvaluatorWithBuiltins } from "../../src/tlisp/evaluator.ts";
import { TLispParser } from "../../src/tlisp/parser.ts";
import { TLispEnvironment } from "../../src/tlisp/types.ts";
import { createNumber, createString, createSymbol, createBoolean, createNil, valueToString } from "../../src/tlisp/values.ts";

/**
 * Test suite for T-Lisp evaluator
 */
Deno.test("T-Lisp Evaluator", async (t) => {
  let evaluator: TLispEvaluator;
  let parser: TLispParser;
  let env: TLispEnvironment;

  await t.step("should create evaluator", () => {
    const result = createEvaluatorWithBuiltins();
    evaluator = result.evaluator;
    env = result.env;
    parser = new TLispParser();
  });

  await t.step("should evaluate literals", () => {
    // Numbers
    assertEquals(evaluator.eval(createNumber(42), env), createNumber(42));
    
    // Strings
    assertEquals(evaluator.eval(createString("hello"), env), createString("hello"));
    
    // Booleans
    assertEquals(evaluator.eval(createBoolean(true), env), createBoolean(true));
    
    // Nil
    assertEquals(evaluator.eval(createNil(), env), createNil());
  });

  await t.step("should evaluate symbols from environment", () => {
    env.define("x", createNumber(42));
    const result = evaluator.eval(createSymbol("x"), env);
    assertEquals(result, createNumber(42));
  });

  await t.step("should throw on undefined symbols", () => {
    assertThrows(() => evaluator.eval(createSymbol("undefined-var"), env));
  });

  await t.step("should evaluate quoted expressions", () => {
    const expr = parser.parse("'foo");
    const result = evaluator.eval(expr, env);
    assertEquals(result.type, "symbol");
    assertEquals(result.value, "foo");
  });

  await t.step("should evaluate quoted lists", () => {
    const expr = parser.parse("'(1 2 3)");
    const result = evaluator.eval(expr, env);
    assertEquals(result.type, "list");
    const list = result.value as any[];
    assertEquals(list.length, 3);
    assertEquals(list[0].value, 1);
    assertEquals(list[1].value, 2);
    assertEquals(list[2].value, 3);
  });

  await t.step("should evaluate arithmetic expressions", () => {
    // Addition
    let expr = parser.parse("(+ 1 2)");
    let result = evaluator.eval(expr, env);
    assertEquals(result, createNumber(3));
    
    // Subtraction
    expr = parser.parse("(- 5 3)");
    result = evaluator.eval(expr, env);
    assertEquals(result, createNumber(2));
    
    // Multiplication
    expr = parser.parse("(* 3 4)");
    result = evaluator.eval(expr, env);
    assertEquals(result, createNumber(12));
    
    // Division
    expr = parser.parse("(/ 8 2)");
    result = evaluator.eval(expr, env);
    assertEquals(result, createNumber(4));
  });

  await t.step("should evaluate nested arithmetic", () => {
    const expr = parser.parse("(+ (* 2 3) (- 10 5))");
    const result = evaluator.eval(expr, env);
    assertEquals(result, createNumber(11)); // (+ 6 5) = 11
  });

  await t.step("should evaluate comparison expressions", () => {
    // Equality
    let expr = parser.parse("(= 2 2)");
    let result = evaluator.eval(expr, env);
    assertEquals(result, createBoolean(true));
    
    expr = parser.parse("(= 2 3)");
    result = evaluator.eval(expr, env);
    assertEquals(result, createBoolean(false));
    
    // Less than
    expr = parser.parse("(< 1 2)");
    result = evaluator.eval(expr, env);
    assertEquals(result, createBoolean(true));
    
    expr = parser.parse("(< 2 1)");
    result = evaluator.eval(expr, env);
    assertEquals(result, createBoolean(false));
  });

  await t.step("should evaluate if expressions", () => {
    // True condition
    let expr = parser.parse("(if t 1 2)");
    let result = evaluator.eval(expr, env);
    assertEquals(result, createNumber(1));
    
    // False condition
    expr = parser.parse("(if nil 1 2)");
    result = evaluator.eval(expr, env);
    assertEquals(result, createNumber(2));
    
    // Complex condition
    expr = parser.parse("(if (< 1 2) 'yes 'no)");
    result = evaluator.eval(expr, env);
    assertEquals(result.type, "symbol");
    assertEquals(result.value, "yes");
  });

  await t.step("should evaluate let expressions", () => {
    const expr = parser.parse("(let ((x 10) (y 20)) (+ x y))");
    const result = evaluator.eval(expr, env);
    assertEquals(result, createNumber(30));
  });

  await t.step("should evaluate lambda expressions", () => {
    const expr = parser.parse("((lambda (x) (* x 2)) 5)");
    const result = evaluator.eval(expr, env);
    assertEquals(result, createNumber(10));
  });

  await t.step("should evaluate defun expressions", () => {
    const expr = parser.parse("(defun square (x) (* x x))");
    evaluator.eval(expr, env);
    
    // Test the defined function
    const callExpr = parser.parse("(square 4)");
    const result = evaluator.eval(callExpr, env);
    assertEquals(result, createNumber(16));
  });

  await t.step("should evaluate list operations", () => {
    // cons
    let expr = parser.parse("(cons 1 '(2 3))");
    let result = evaluator.eval(expr, env);
    assertEquals(result.type, "list");
    let list = result.value as any[];
    assertEquals(list.length, 3);
    assertEquals(list[0].value, 1);
    
    // car
    expr = parser.parse("(car '(1 2 3))");
    result = evaluator.eval(expr, env);
    assertEquals(result, createNumber(1));
    
    // cdr
    expr = parser.parse("(cdr '(1 2 3))");
    result = evaluator.eval(expr, env);
    assertEquals(result.type, "list");
    list = result.value as any[];
    assertEquals(list.length, 2);
    assertEquals(list[0].value, 2);
    assertEquals(list[1].value, 3);
  });

  await t.step("should evaluate predicates", () => {
    // null
    let expr = parser.parse("(null nil)");
    let result = evaluator.eval(expr, env);
    assertEquals(result, createBoolean(true));
    
    expr = parser.parse("(null '(1 2))");
    result = evaluator.eval(expr, env);
    assertEquals(result, createBoolean(false));
    
    // atom
    expr = parser.parse("(atom 42)");
    result = evaluator.eval(expr, env);
    assertEquals(result, createBoolean(true));
    
    expr = parser.parse("(atom '(1 2))");
    result = evaluator.eval(expr, env);
    assertEquals(result, createBoolean(false));
  });

  await t.step("should handle recursive functions", () => {
    // Define factorial function
    const defExpr = parser.parse(`
      (defun factorial (n)
        (if (= n 0)
            1
            (* n (factorial (- n 1)))))
    `);
    evaluator.eval(defExpr, env);
    
    // Test factorial
    const callExpr = parser.parse("(factorial 5)");
    const result = evaluator.eval(callExpr, env);
    assertEquals(result, createNumber(120));
  });

  await t.step("should evaluate cond expressions", () => {
    // Simple cond with first condition true
    let expr = parser.parse("(cond ((= 1 1) 'first) ((= 2 2) 'second))");
    let result = evaluator.eval(expr, env);
    assertEquals(result.type, "symbol");
    assertEquals(result.value, "first");
    
    // Cond with second condition true
    expr = parser.parse("(cond ((= 1 2) 'first) ((= 2 2) 'second))");
    result = evaluator.eval(expr, env);
    assertEquals(result.type, "symbol");
    assertEquals(result.value, "second");
    
    // Cond with no matching conditions
    expr = parser.parse("(cond ((= 1 2) 'first) ((= 3 4) 'second))");
    result = evaluator.eval(expr, env);
    assertEquals(result, createNil());
  });

  await t.step("should evaluate cond with 't' clause", () => {
    // Cond with 't' as else clause
    const expr = parser.parse("(cond ((= 1 2) 'first) (t 'default))");
    const result = evaluator.eval(expr, env);
    assertEquals(result.type, "symbol");
    assertEquals(result.value, "default");
  });

  await t.step("should evaluate cond with complex conditions", () => {
    // Cond with arithmetic conditions
    const expr = parser.parse(`
      (cond 
        ((< 5 3) 'less)
        ((> 5 3) 'greater)
        (t 'equal))
    `);
    const result = evaluator.eval(expr, env);
    assertEquals(result.type, "symbol");
    assertEquals(result.value, "greater");
  });

  await t.step("should evaluate cond with complex expressions", () => {
    // Cond with complex expressions in both condition and result
    const expr = parser.parse(`
      (let ((x 10))
        (cond 
          ((< x 5) (* x 2))
          ((> x 15) (+ x 5))
          (t (- x 3))))
    `);
    const result = evaluator.eval(expr, env);
    assertEquals(result, createNumber(7)); // x=10, so (- 10 3) = 7
  });

  await t.step("should handle cond error cases", () => {
    // Empty cond
    assertThrows(() => {
      const expr = parser.parse("(cond)");
      evaluator.eval(expr, env);
    }, Error, "cond requires at least 1 clause");
    
    // Invalid clause format
    assertThrows(() => {
      const expr = parser.parse("(cond 42)");
      evaluator.eval(expr, env);
    }, Error, "cond clause must be a list");
    
    // Clause with wrong number of elements
    assertThrows(() => {
      const expr = parser.parse("(cond (t))");
      evaluator.eval(expr, env);
    }, Error, "cond clause must have exactly 2 elements");
  });

  await t.step("should evaluate cond with tail-call optimization", () => {
    // Define a recursive function using cond
    const defExpr = parser.parse(`
      (defun countdown (n)
        (cond 
          ((= n 0) 'done)
          (t (countdown (- n 1)))))
    `);
    evaluator.eval(defExpr, env);
    
    // Test tail-call optimized recursion
    const callExpr = parser.parse("(countdown 100)");
    const result = evaluator.eval(callExpr, env);
    assertEquals(result.type, "symbol");
    assertEquals(result.value, "done");
  });

  await t.step("should handle complex expressions", () => {
    const expr = parser.parse(`
      (let ((x 10) (y 5))
        (if (> x y)
            (+ x y)
            (- x y)))
    `);
    const result = evaluator.eval(expr, env);
    assertEquals(result, createNumber(15));
  });
});