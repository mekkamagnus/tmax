/**
 * @file repl.test.ts
 * @description Test suite for T-Lisp REPL
 */

import { describe, test, expect } from "bun:test";
import { TLispREPL } from "../../src/tlisp/repl.ts";
import { createNumber, createString, createSymbol, createList } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("T-Lisp REPL", () => {
  const repl = new TLispREPL();

  test("should create REPL", () => {
    expect(typeof repl).toBe("object");
  });

  test("should evaluate numbers", () => {
    const result = repl.evaluate("42");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(42));
    }
  });

  test("should evaluate strings", () => {
    const result = repl.evaluate("\"hello\"");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createString("hello"));
    }
  });

  test("should evaluate arithmetic", () => {
    const result = repl.evaluate("(+ 1 2 3)");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(6));
    }
  });

  test("should evaluate function definition", () => {
    const result = repl.evaluate("(defun square (x) (* x x))");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createSymbol("square"));
    }
  });

  test("should evaluate function call", () => {
    // First define the function
    repl.evaluate("(defun square (x) (* x x))");

    // Then call it
    const result = repl.evaluate("(square 5)");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(25));
    }
  });

  test("should evaluate let expression", () => {
    const result = repl.evaluate("(let ((x 10) (y 20)) (+ x y))");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(30));
    }
  });

  test("should evaluate lambda expression", () => {
    const result = repl.evaluate("((lambda (x) (* x 2)) 21)");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(42));
    }
  });

  test("should evaluate macro definition", () => {
    const result = repl.evaluate("(defmacro when (cond body) `(if ,cond ,body nil))");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createSymbol("when"));
    }
  });

  test("should evaluate macro expansion", () => {
    // First define the macro
    repl.evaluate("(defmacro when (cond body) `(if ,cond ,body nil))");

    // Then use it
    const result = repl.evaluate("(when t 42)");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(42));
    }
  });

  test("should evaluate standard library functions", () => {
    const result = repl.evaluate("(length \"hello\")");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(5));
    }
  });

  test("should handle multi-line expressions", () => {
    const multiline = `
      (defun factorial (n)
        (if (= n 0)
          1
          (* n (factorial (- n 1)))))
    `;

    const defResult = repl.evaluate(multiline);
    expect(Either.isRight(defResult)).toBe(true);
    if (Either.isRight(defResult)) {
      expect(defResult.right).toEqual(createSymbol("factorial"));
    }

    const callResult = repl.evaluate("(factorial 5)");
    expect(Either.isRight(callResult)).toBe(true);
    if (Either.isRight(callResult)) {
      expect(callResult.right).toEqual(createNumber(120));
    }
  });

  test("should handle list operations", () => {
    const result = repl.evaluate("(append '(1 2) '(3 4))");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createList([
        createNumber(1),
        createNumber(2),
        createNumber(3),
        createNumber(4)
      ]));
    }
  });

  test("should handle quasiquote", () => {
    repl.evaluate("(defun x () 42)");
    const result = repl.evaluate("`(test ,(x) end)");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createList([
        createSymbol("test"),
        createNumber(42),
        createSymbol("end")
      ]));
    }
  });

  test("should handle complex expression", () => {
    const complexExpr = `
      (let ((nums '(1 2 3 4 5)))
        (length nums))
    `;

    const result = repl.evaluate(complexExpr);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(5));
    }
  });

  test("should maintain state between evaluations", () => {
    // Define a variable
    repl.evaluate("(defun add-one (x) (+ x 1))");

    // Use it in another expression
    const result = repl.evaluate("(add-one 41)");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(42));
    }
  });
});
