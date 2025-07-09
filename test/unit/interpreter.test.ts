/**
 * @file interpreter.test.ts
 * @description Test suite for T-Lisp interpreter
 */

import { assertEquals } from "@std/assert";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { createNumber, createString, createSymbol, createList, createBoolean } from "../../src/tlisp/values.ts";

Deno.test("T-Lisp Interpreter", async (t) => {
  const interpreter = new TLispInterpreterImpl();

  await t.step("should create interpreter", () => {
    assertEquals(typeof interpreter, "object");
    assertEquals(typeof interpreter.globalEnv, "object");
  });

  await t.step("should parse expressions", () => {
    const result = interpreter.parse("42");
    assertEquals(result, createNumber(42));
  });

  await t.step("should parse and evaluate numbers", () => {
    const result = interpreter.execute("42");
    assertEquals(result, createNumber(42));
  });

  await t.step("should parse and evaluate strings", () => {
    const result = interpreter.execute("\"hello\"");
    assertEquals(result, createString("hello"));
  });

  await t.step("should parse and evaluate booleans", () => {
    const trueResult = interpreter.execute("t");
    assertEquals(trueResult, createBoolean(true));
    
    const falseResult = interpreter.execute("nil");
    assertEquals(falseResult.type, "nil");
  });

  await t.step("should parse and evaluate lists", () => {
    const result = interpreter.execute("'(1 2 3)");
    assertEquals(result, createList([
      createNumber(1),
      createNumber(2),
      createNumber(3)
    ]));
  });

  await t.step("should evaluate arithmetic expressions", () => {
    const result = interpreter.execute("(+ 1 2 3)");
    assertEquals(result, createNumber(6));
  });

  await t.step("should evaluate nested expressions", () => {
    const result = interpreter.execute("(* (+ 1 2) (- 10 5))");
    assertEquals(result, createNumber(15));
  });

  await t.step("should evaluate function definitions", () => {
    const result = interpreter.execute("(defun square (x) (* x x))");
    assertEquals(result, createSymbol("square"));
  });

  await t.step("should evaluate function calls", () => {
    interpreter.execute("(defun double (x) (* x 2))");
    const result = interpreter.execute("(double 21)");
    assertEquals(result, createNumber(42));
  });

  await t.step("should evaluate lambda expressions", () => {
    const result = interpreter.execute("((lambda (x y) (+ x y)) 10 20)");
    assertEquals(result, createNumber(30));
  });

  await t.step("should evaluate let expressions", () => {
    const result = interpreter.execute("(let ((x 10) (y 20)) (+ x y))");
    assertEquals(result, createNumber(30));
  });

  await t.step("should evaluate if expressions", () => {
    const trueResult = interpreter.execute("(if t 42 0)");
    assertEquals(trueResult, createNumber(42));
    
    const falseResult = interpreter.execute("(if nil 42 0)");
    assertEquals(falseResult, createNumber(0));
  });

  await t.step("should evaluate macro definitions", () => {
    const result = interpreter.execute("(defmacro when (cond body) `(if ,cond ,body nil))");
    assertEquals(result, createSymbol("when"));
  });

  await t.step("should evaluate macro expansions", () => {
    interpreter.execute("(defmacro unless (cond body) `(if ,cond nil ,body))");
    const result = interpreter.execute("(unless nil 42)");
    assertEquals(result, createNumber(42));
  });

  await t.step("should evaluate standard library functions", () => {
    const lengthResult = interpreter.execute("(length \"hello\")");
    assertEquals(lengthResult, createNumber(5));
    
    const appendResult = interpreter.execute("(append '(1 2) '(3 4))");
    assertEquals(appendResult, createList([
      createNumber(1),
      createNumber(2),
      createNumber(3),
      createNumber(4)
    ]));
  });

  await t.step("should handle recursive functions", () => {
    interpreter.execute("(defun factorial (n) (if (= n 0) 1 (* n (factorial (- n 1)))))");
    const result = interpreter.execute("(factorial 5)");
    assertEquals(result, createNumber(120));
  });

  await t.step("should handle tail-recursive functions", () => {
    interpreter.execute("(defun count-down (n) (if (= n 0) 'done (count-down (- n 1))))");
    const result = interpreter.execute("(count-down 100)");
    assertEquals(result, createSymbol("done"));
  });

  await t.step("should allow defining custom built-ins", () => {
    interpreter.defineBuiltin("custom-add", (args) => {
      if (args.length !== 2) {
        throw new Error("custom-add requires 2 arguments");
      }
      const a = args[0];
      const b = args[1];
      if (a?.type !== "number" || b?.type !== "number") {
        throw new Error("custom-add requires numbers");
      }
      return createNumber((a.value as number) + (b.value as number));
    });
    
    const result = interpreter.execute("(custom-add 15 27)");
    assertEquals(result, createNumber(42));
  });

  await t.step("should maintain state between executions", () => {
    interpreter.execute("(defun get-value () 42)");
    const result = interpreter.execute("(get-value)");
    assertEquals(result, createNumber(42));
  });

  await t.step("should handle complex expressions", () => {
    // First define the function
    interpreter.execute("(defun sum-list (lst) (if (null lst) 0 (+ (car lst) (sum-list (cdr lst)))))");
    
    // Then use it
    const result = interpreter.execute("(sum-list '(1 2 3 4 5))");
    assertEquals(result, createNumber(15));
  });
});