/**
 * @file interpreter.test.ts
 * @description Test suite for T-Lisp interpreter
 */

import { describe, test, expect } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { createNumber, createString, createSymbol, createList, createBoolean, createNil } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("T-Lisp Interpreter", () => {
  const interpreter = new TLispInterpreterImpl();

  test("should create interpreter", () => {
    expect(typeof interpreter).toBe("object");
    expect(typeof interpreter.globalEnv).toBe("object");
  });

  test("should parse expressions", () => {
    const result = interpreter.parse("42");
    expect(result).toEqual(createNumber(42));
  });

  test("should parse and evaluate numbers", () => {
    const result = interpreter.execute("42");
    expect('right' in result).toBe(true);
    if ('right' in result) {
      expect(result.right).toEqual(createNumber(42));
    }
  });

  test("should parse and evaluate strings", () => {
    const result = interpreter.execute("\"hello\"");
    expect('right' in result).toBe(true);
    if ('right' in result) {
      expect(result.right).toEqual(createString("hello"));
    }
  });

  test("should parse and evaluate booleans", () => {
    const trueResult = interpreter.execute("t");
    expect('right' in trueResult).toBe(true);
    if ('right' in trueResult) {
      expect(trueResult.right).toEqual(createBoolean(true));
    }

    const falseResult = interpreter.execute("nil");
    expect('right' in falseResult).toBe(true);
    if ('right' in falseResult) {
      expect(falseResult.right.type).toBe("nil");
    }
  });

  test("should parse and evaluate lists", () => {
    const result = interpreter.execute("'(1 2 3)");
    expect('right' in result).toBe(true);
    if ('right' in result) {
      expect(result.right).toEqual(createList([
        createNumber(1),
        createNumber(2),
        createNumber(3)
      ]));
    }
  });

  test("should evaluate arithmetic expressions", () => {
    const result = interpreter.execute("(+ 1 2 3)");
    expect('right' in result).toBe(true);
    if ('right' in result) {
      expect(result.right).toEqual(createNumber(6));
    }
  });

  test("should evaluate nested expressions", () => {
    const result = interpreter.execute("(* (+ 1 2) (- 10 5))");
    expect('right' in result).toBe(true);
    if ('right' in result) {
      expect(result.right).toEqual(createNumber(15));
    }
  });

  test("should evaluate function definitions", () => {
    const result = interpreter.execute("(defun square (x) (* x x))");
    expect('right' in result).toBe(true);
    if ('right' in result) {
      expect(result.right).toEqual(createSymbol("square"));
    }
  });

  test("should evaluate function calls", () => {
    interpreter.execute("(defun double (x) (* x 2))");
    const result = interpreter.execute("(double 21)");
    expect('right' in result).toBe(true);
    if ('right' in result) {
      expect(result.right).toEqual(createNumber(42));
    }
  });

  test("should evaluate lambda expressions", () => {
    const result = interpreter.execute("((lambda (x y) (+ x y)) 10 20)");
    expect('right' in result).toBe(true);
    if ('right' in result) {
      expect(result.right).toEqual(createNumber(30));
    }
  });

  test("should evaluate let expressions", () => {
    const result = interpreter.execute("(let ((x 10) (y 20)) (+ x y))");
    expect('right' in result).toBe(true);
    if ('right' in result) {
      expect(result.right).toEqual(createNumber(30));
    }
  });

  test("should evaluate if expressions", () => {
    const trueResult = interpreter.execute("(if t 42 0)");
    expect('right' in trueResult).toBe(true);
    if ('right' in trueResult) {
      expect(trueResult.right).toEqual(createNumber(42));
    }

    const falseResult = interpreter.execute("(if nil 42 0)");
    expect('right' in falseResult).toBe(true);
    if ('right' in falseResult) {
      expect(falseResult.right).toEqual(createNumber(0));
    }
  });

  test("should evaluate macro definitions", () => {
    const result = interpreter.execute("(defmacro when (cond body) `(if ,cond ,body nil))");
    expect('right' in result).toBe(true);
    if ('right' in result) {
      expect(result.right).toEqual(createSymbol("when"));
    }
  });

  test("should evaluate macro expansions", () => {
    interpreter.execute("(defmacro unless (cond body) `(if ,cond nil ,body))");
    const result = interpreter.execute("(unless nil 42)");
    expect('right' in result).toBe(true);
    if ('right' in result) {
      expect(result.right).toEqual(createNumber(42));
    }
  });

  test("should evaluate standard library functions", () => {
    const lengthResult = interpreter.execute("(length \"hello\")");
    expect('right' in lengthResult).toBe(true);
    if ('right' in lengthResult) {
      expect(lengthResult.right).toEqual(createNumber(5));
    }

    const appendResult = interpreter.execute("(append '(1 2) '(3 4))");
    expect('right' in appendResult).toBe(true);
    if ('right' in appendResult) {
      expect(appendResult.right).toEqual(createList([
        createNumber(1),
        createNumber(2),
        createNumber(3),
        createNumber(4)
      ]));
    }
  });

  test("should handle recursive functions", () => {
    interpreter.execute("(defun factorial (n) (if (= n 0) 1 (* n (factorial (- n 1)))))");
    const result = interpreter.execute("(factorial 5)");
    expect('right' in result).toBe(true);
    if ('right' in result) {
      expect(result.right).toEqual(createNumber(120));
    }
  });

  test("should handle tail-recursive functions", () => {
    interpreter.execute("(defun count-down (n) (if (= n 0) 'done (count-down (- n 1))))");
    const result = interpreter.execute("(count-down 100)");
    expect('right' in result).toBe(true);
    if ('right' in result) {
      expect(result.right).toEqual(createSymbol("done"));
    }
  });

  test("should allow defining custom built-ins", () => {
    interpreter.defineBuiltin("custom-add", (args) => {
      if (args.length !== 2) {
        return Either.left({
          type: 'EvalError',
          variant: 'RuntimeError',
          message: "custom-add requires 2 arguments",
          details: { expected: 2, actual: args.length }
        });
      }
      const a = args[0];
      const b = args[1];
      if (!a || !b || a.type !== "number" || b.type !== "number") {
        return Either.left({
          type: 'EvalError',
          variant: 'TypeError',
          message: "custom-add requires numbers",
          details: { aType: a?.type, bType: b?.type }
        });
      }
      return Either.right(createNumber((a.value as number) + (b.value as number)));
    });

    const result = interpreter.execute("(custom-add 15 27)");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(42));
    }
  });

  test("should maintain state between executions", () => {
    interpreter.execute("(defun get-value () 42)");
    const result = interpreter.execute("(get-value)");
    expect('right' in result).toBe(true);
    if ('right' in result) {
      expect(result.right).toEqual(createNumber(42));
    }
  });

  test("should handle complex expressions", () => {
    // First define the function
    interpreter.execute("(defun sum-list (lst) (if (null lst) 0 (+ (car lst) (sum-list (cdr lst)))))");

    // Then use it
    const result = interpreter.execute("(sum-list '(1 2 3 4 5))");
    expect('right' in result).toBe(true);
    if ('right' in result) {
      expect(result.right).toEqual(createNumber(15));
    }
  });
});