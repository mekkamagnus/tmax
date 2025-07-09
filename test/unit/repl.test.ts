/**
 * @file repl.test.ts
 * @description Test suite for T-Lisp REPL
 */

import { assertEquals } from "@std/assert";
import { TLispREPL } from "../../src/tlisp/repl.ts";
import { createNumber, createString, createSymbol, createList } from "../../src/tlisp/values.ts";

Deno.test("T-Lisp REPL", async (t) => {
  const repl = new TLispREPL();

  await t.step("should create REPL", () => {
    assertEquals(typeof repl, "object");
  });

  await t.step("should evaluate numbers", () => {
    const result = repl.evaluate("42");
    assertEquals(result, createNumber(42));
  });

  await t.step("should evaluate strings", () => {
    const result = repl.evaluate("\"hello\"");
    assertEquals(result, createString("hello"));
  });

  await t.step("should evaluate arithmetic", () => {
    const result = repl.evaluate("(+ 1 2 3)");
    assertEquals(result, createNumber(6));
  });

  await t.step("should evaluate function definition", () => {
    const result = repl.evaluate("(defun square (x) (* x x))");
    assertEquals(result, createSymbol("square"));
  });

  await t.step("should evaluate function call", () => {
    // First define the function
    repl.evaluate("(defun square (x) (* x x))");
    
    // Then call it
    const result = repl.evaluate("(square 5)");
    assertEquals(result, createNumber(25));
  });

  await t.step("should evaluate let expression", () => {
    const result = repl.evaluate("(let ((x 10) (y 20)) (+ x y))");
    assertEquals(result, createNumber(30));
  });

  await t.step("should evaluate lambda expression", () => {
    const result = repl.evaluate("((lambda (x) (* x 2)) 21)");
    assertEquals(result, createNumber(42));
  });

  await t.step("should evaluate macro definition", () => {
    const result = repl.evaluate("(defmacro when (cond body) `(if ,cond ,body nil))");
    assertEquals(result, createSymbol("when"));
  });

  await t.step("should evaluate macro expansion", () => {
    // First define the macro
    repl.evaluate("(defmacro when (cond body) `(if ,cond ,body nil))");
    
    // Then use it
    const result = repl.evaluate("(when t 42)");
    assertEquals(result, createNumber(42));
  });

  await t.step("should evaluate standard library functions", () => {
    const result = repl.evaluate("(length \"hello\")");
    assertEquals(result, createNumber(5));
  });

  await t.step("should handle multi-line expressions", () => {
    const multiline = `
      (defun factorial (n)
        (if (= n 0)
          1
          (* n (factorial (- n 1)))))
    `;
    
    const defResult = repl.evaluate(multiline);
    assertEquals(defResult, createSymbol("factorial"));
    
    const callResult = repl.evaluate("(factorial 5)");
    assertEquals(callResult, createNumber(120));
  });

  await t.step("should handle list operations", () => {
    const result = repl.evaluate("(append '(1 2) '(3 4))");
    assertEquals(result, createList([
      createNumber(1),
      createNumber(2),
      createNumber(3),
      createNumber(4)
    ]));
  });

  await t.step("should handle quasiquote", () => {
    repl.evaluate("(defun x () 42)");
    const result = repl.evaluate("`(test ,(x) end)");
    assertEquals(result, createList([
      createSymbol("test"),
      createNumber(42),
      createSymbol("end")
    ]));
  });

  await t.step("should handle complex expression", () => {
    const complexExpr = `
      (let ((nums '(1 2 3 4 5)))
        (length nums))
    `;
    
    const result = repl.evaluate(complexExpr);
    assertEquals(result, createNumber(5));
  });

  await t.step("should maintain state between evaluations", () => {
    // Define a variable
    repl.evaluate("(defun add-one (x) (+ x 1))");
    
    // Use it in another expression
    const result = repl.evaluate("(add-one 41)");
    assertEquals(result, createNumber(42));
  });
});