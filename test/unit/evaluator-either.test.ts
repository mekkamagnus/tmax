/**
 * @file evaluator-either.test.ts
 * @description Tests for T-Lisp evaluator with Either return type
 */

import { describe, test, expect } from "bun:test";
import { TLispEvaluator, createEvaluatorWithBuiltins } from "../../src/tlisp/evaluator";
import { TLispParser } from "../../src/tlisp/parser";
import { createNumber, createString, createSymbol, createBoolean, createNil, createList, valueToString } from "../../src/tlisp/values";
import { Either } from "../../src/utils/task-either";

describe("T-Lisp Evaluator with Either", () => {
  test("should evaluate literals successfully", () => {
    const { evaluator, env } = createEvaluatorWithBuiltins();
    
    // Numbers
    const numberResult = evaluator.eval(createNumber(42), env);
    expect(Either.isRight(numberResult)).toBe(true);
    if (Either.isRight(numberResult)) {
      expect(numberResult.right).toEqual(createNumber(42));
    }

    // Strings
    const stringResult = evaluator.eval(createString("hello"), env);
    expect(Either.isRight(stringResult)).toBe(true);
    if (Either.isRight(stringResult)) {
      expect(stringResult.right).toEqual(createString("hello"));
    }

    // Booleans
    const booleanResult = evaluator.eval(createBoolean(true), env);
    expect(Either.isRight(booleanResult)).toBe(true);
    if (Either.isRight(booleanResult)) {
      expect(booleanResult.right).toEqual(createBoolean(true));
    }

    // Nil
    const nilResult = evaluator.eval(createNil(), env);
    expect(Either.isRight(nilResult)).toBe(true);
    if (Either.isRight(nilResult)) {
      expect(nilResult.right).toEqual(createNil());
    }
  });

  test("should evaluate symbols from environment", () => {
    const { evaluator, env } = createEvaluatorWithBuiltins();
    env.define("x", createNumber(42));
    
    const result = evaluator.eval(createSymbol("x"), env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(42));
    }
  });

  test("should return error for undefined symbols", () => {
    const { evaluator, env } = createEvaluatorWithBuiltins();
    
    const result = evaluator.eval(createSymbol("undefined_var"), env);
    expect(Either.isLeft(result)).toBe(true);
  });

  test("should evaluate arithmetic expressions", () => {
    const { evaluator, env } = createEvaluatorWithBuiltins();
    const parser = new TLispParser();

    // Addition
    const expr = parser.parse("(+ 1 2)");
    if (Either.isLeft(expr)) {
      throw new Error(`Parse failed: ${JSON.stringify(expr.left)}`);
    }
    const result = evaluator.eval(expr.right, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(3));
    }
  });

  test("should return error for invalid arithmetic expressions", () => {
    const { evaluator, env } = createEvaluatorWithBuiltins();
    const parser = new TLispParser();

    // Invalid addition with non-number
    const expr = parser.parse("(+ 1 (quote symbol))");
    if (Either.isLeft(expr)) {
      throw new Error(`Parse failed: ${JSON.stringify(expr.left)}`);
    }
    const result = evaluator.eval(expr.right, env);
    expect(Either.isLeft(result)).toBe(true);
  });

  test("should evaluate if expressions", () => {
    const { evaluator, env } = createEvaluatorWithBuiltins();
    const parser = new TLispParser();

    // True condition
    const expr = parser.parse("(if t 1 2)");
    if (Either.isLeft(expr)) {
      throw new Error(`Parse failed: ${JSON.stringify(expr.left)}`);
    }
    const result = evaluator.eval(expr.right, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(1));
    }
  });

  test("should handle errors in if expressions", () => {
    const { evaluator, env } = createEvaluatorWithBuiltins();
    const parser = new TLispParser();

    // Invalid if expression with wrong number of arguments
    const expr = parser.parse("(if t 1)"); // Missing else clause
    if (Either.isLeft(expr)) {
      throw new Error(`Parse failed: ${JSON.stringify(expr.left)}`);
    }
    const result = evaluator.eval(expr.right, env);
    expect(Either.isLeft(result)).toBe(true);
  });

  test("should evaluate lambda expressions", () => {
    const { evaluator, env } = createEvaluatorWithBuiltins();
    const parser = new TLispParser();

    const expr = parser.parse("((lambda (x) (* x 2)) 5)");
    if (Either.isLeft(expr)) {
      throw new Error(`Parse failed: ${JSON.stringify(expr.left)}`);
    }
    const result = evaluator.eval(expr.right, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(10));
    }
  });

  test("should return error for invalid lambda expressions", () => {
    const { evaluator, env } = createEvaluatorWithBuiltins();
    const parser = new TLispParser();

    // Invalid lambda with wrong number of arguments
    const expr = parser.parse("(lambda)"); // Missing parameters and body
    if (Either.isLeft(expr)) {
      throw new Error(`Parse failed: ${JSON.stringify(expr.left)}`);
    }
    const result = evaluator.eval(expr.right, env);
    expect(Either.isLeft(result)).toBe(true);
  });
});