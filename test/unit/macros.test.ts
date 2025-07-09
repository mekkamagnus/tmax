/**
 * @file macros.test.ts
 * @description Test suite for T-Lisp macro system
 */

import { assertEquals, assertThrows } from "@std/assert";
import { TLispParser } from "../../src/tlisp/parser.ts";
import { createEvaluatorWithBuiltins } from "../../src/tlisp/evaluator.ts";
import { createSymbol, createNumber, createString, createList } from "../../src/tlisp/values.ts";

Deno.test("T-Lisp Macro System", async (t) => {
  const parser = new TLispParser();
  const { evaluator, env } = createEvaluatorWithBuiltins();

  await t.step("quasiquote - basic functionality", () => {
    const expr = parser.parse("`(a b c)");
    const result = evaluator.eval(expr, env);
    assertEquals(result, createList([createSymbol("a"), createSymbol("b"), createSymbol("c")]));
  });

  await t.step("quasiquote with unquote", () => {
    // Set up a variable for unquoting
    env.define("x", createNumber(42));
    
    const expr = parser.parse("`(a ,x c)");
    const result = evaluator.eval(expr, env);
    assertEquals(result, createList([createSymbol("a"), createNumber(42), createSymbol("c")]));
  });

  await t.step("quasiquote with unquote-splicing", () => {
    // Set up a list for splicing
    env.define("lst", createList([createNumber(1), createNumber(2), createNumber(3)]));
    
    const expr = parser.parse("`(a ,@lst d)");
    const result = evaluator.eval(expr, env);
    assertEquals(result, createList([
      createSymbol("a"),
      createNumber(1),
      createNumber(2),
      createNumber(3),
      createSymbol("d")
    ]));
  });

  await t.step("defmacro - define simple macro", () => {
    const defExpr = parser.parse("(defmacro when (condition body) `(if ,condition ,body nil))");
    const defResult = evaluator.eval(defExpr, env);
    assertEquals(defResult, createSymbol("when"));
  });

  await t.step("macro expansion - use when macro", () => {
    // First ensure we have the when macro defined
    const defExpr = parser.parse("(defmacro when (condition body) `(if ,condition ,body nil))");
    evaluator.eval(defExpr, env);
    
    // Test macro expansion
    const useExpr = parser.parse("(when t 42)");
    const result = evaluator.eval(useExpr, env);
    assertEquals(result, createNumber(42));
  });

  await t.step("macro expansion - when with false condition", () => {
    const useExpr = parser.parse("(when nil 42)");
    const result = evaluator.eval(useExpr, env);
    assertEquals(result.type, "nil");
  });

  await t.step("defmacro - define unless macro", () => {
    const defExpr = parser.parse("(defmacro unless (condition body) `(if ,condition nil ,body))");
    const defResult = evaluator.eval(defExpr, env);
    assertEquals(defResult, createSymbol("unless"));
  });

  await t.step("macro expansion - use unless macro", () => {
    // Test unless with false condition (should execute body)
    const useExpr = parser.parse("(unless nil 42)");
    const result = evaluator.eval(useExpr, env);
    assertEquals(result, createNumber(42));
    
    // Test unless with true condition (should not execute body)
    const useExpr2 = parser.parse("(unless t 42)");
    const result2 = evaluator.eval(useExpr2, env);
    assertEquals(result2.type, "nil");
  });

  await t.step("nested quasiquote", () => {
    env.define("y", createNumber(10));
    const expr = parser.parse("``(a ,,y c)");
    const result = evaluator.eval(expr, env);
    // Should expand to `(a (unquote 10) c) - the inner unquote is evaluated but left as unquote for outer
    assertEquals(result, createList([
      createSymbol("quasiquote"),
      createList([
        createSymbol("a"), 
        createList([createSymbol("unquote"), createNumber(10)]), 
        createSymbol("c")
      ])
    ]));
  });

  await t.step("error handling - unquote outside quasiquote", () => {
    assertThrows(() => {
      const expr = parser.parse("(unquote x)");
      evaluator.eval(expr, env);
    }, Error, "unquote can only be used inside quasiquote");
  });

  await t.step("error handling - unquote-splicing outside quasiquote", () => {
    assertThrows(() => {
      const expr = parser.parse("(unquote-splicing x)");
      evaluator.eval(expr, env);
    }, Error, "unquote-splicing can only be used inside quasiquote");
  });

  await t.step("error handling - defmacro wrong argument count", () => {
    assertThrows(() => {
      const expr = parser.parse("(defmacro foo)");
      evaluator.eval(expr, env);
    }, Error, "defmacro requires exactly 3 arguments");
  });

  await t.step("error handling - macro wrong argument count", () => {
    // Define a macro that expects 2 arguments
    const defExpr = parser.parse("(defmacro test-macro (a b) `(+ ,a ,b))");
    evaluator.eval(defExpr, env);
    
    // Try to call it with wrong number of arguments
    assertThrows(() => {
      const expr = parser.parse("(test-macro 1)");
      evaluator.eval(expr, env);
    }, Error, "macro test-macro expects 2 arguments, got 1");
  });

  await t.step("macro with computation", () => {
    // Define a macro that does some computation during expansion
    const defExpr = parser.parse("(defmacro inc (x) `(+ ,x 1))");
    evaluator.eval(defExpr, env);
    
    const useExpr = parser.parse("(inc 5)");
    const result = evaluator.eval(useExpr, env);
    assertEquals(result, createNumber(6));
  });

  await t.step("macro generating macro calls", () => {
    // Test that macros can generate other macro calls
    const defExpr1 = parser.parse("(defmacro inc (x) `(+ ,x 1))");
    evaluator.eval(defExpr1, env);
    
    const defExpr2 = parser.parse("(defmacro inc-twice (x) `(inc (inc ,x)))");
    evaluator.eval(defExpr2, env);
    
    const useExpr = parser.parse("(inc-twice 5)");
    const result = evaluator.eval(useExpr, env);
    assertEquals(result, createNumber(7));
  });
});