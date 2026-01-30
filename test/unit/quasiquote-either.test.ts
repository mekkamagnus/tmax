/**
 * @file quasiquote-either.test.ts
 * @description Tests for T-Lisp quasiquote functionality with Either return type
 */

import { describe, test, expect } from "bun:test";
import { TLispParser } from "../../src/tlisp/parser.ts";
import { createEvaluatorWithBuiltins } from "../../src/tlisp/evaluator.ts";
import { createSymbol, createNumber, createList, createNil } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("T-Lisp Quasiquote with Either", () => {
  const parser = new TLispParser();
  const { evaluator, env } = createEvaluatorWithBuiltins();

  test("should handle basic quasiquote", () => {
    const expr = parser.parse("`(a b c)");

    if (Either.isLeft(expr)) {
      console.log("Parse error:", expr.left);
    }

    const result = evaluator.eval(expr.right, env);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createList([createSymbol("a"), createSymbol("b"), createSymbol("c")]));
    }
  });

  test("should handle quasiquote with unquote", () => {
    // Create a fresh evaluator/env to ensure clean state
    const { evaluator: testEvaluator, env: testEnv } = createEvaluatorWithBuiltins();
    // Set up a variable for unquoting
    testEnv.define("x", createNumber(42));

    const expr = parser.parse("`(a ,x c)");
    const result = testEvaluator.eval(expr.right, testEnv);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createList([createSymbol("a"), createNumber(42), createSymbol("c")]));
    }
  });

  test("should handle quasiquote with unquote-splicing", () => {
    // Create a fresh evaluator/env to ensure clean state
    const { evaluator: testEvaluator, env: testEnv } = createEvaluatorWithBuiltins();
    // Set up a list for splicing
    testEnv.define("lst", createList([createNumber(1), createNumber(2), createNumber(3)]));

    const expr = parser.parse("`(a ,@lst d)");
    const result = testEvaluator.eval(expr.right, testEnv);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createList([
        createSymbol("a"),
        createNumber(1),
        createNumber(2),
        createNumber(3),
        createSymbol("d")
      ]));
    }
  });

  test("should handle nested quasiquote", () => {
    // Create a fresh evaluator/env to ensure clean state
    const { evaluator: testEvaluator, env: testEnv } = createEvaluatorWithBuiltins();
    testEnv.define("y", createNumber(10));
    const expr = parser.parse("``(a ,,y c)");
    const result = testEvaluator.eval(expr.right, testEnv);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createList([
        createSymbol("quasiquote"),
        createList([
          createSymbol("a"),
          createList([createSymbol("unquote"), createNumber(10)]),
          createSymbol("c")
        ])
      ]));
    }
  });

  test("should handle error case for malformed quasiquote", () => {
    // This test will be updated once we fix the expandQuasiquote method to return Either
    // For now, this is to document the expected behavior
  });
});