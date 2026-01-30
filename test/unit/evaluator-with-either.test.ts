import { test, expect } from "bun:test";
import { TLispEvaluator, createEvaluatorWithBuiltins } from "../../src/tlisp/evaluator";
import { TLispEnvironmentImpl } from "../../src/tlisp/environment";
import { createNumber, createString, createList, createSymbol } from "../../src/tlisp/values";
import { Either } from "../../src/utils/task-either";

test("should evaluate simple expressions successfully", () => {
  const { evaluator, env } = createEvaluatorWithBuiltins();

  // Simple number evaluation
  const numberExpr = createNumber(42);
  const result = evaluator.eval(numberExpr, env);

  expect(Either.isRight(result)).toBe(true);
  if (Either.isRight(result)) {
    expect(result.right.type).toBe("number");
    expect(result.right.value).toBe(42);
  }
});

test("should evaluate arithmetic expressions", () => {
  const { evaluator, env } = createEvaluatorWithBuiltins();
  
  // Test addition: (+ 1 2)
  const plusFunc = env.lookup("+");
  expect(plusFunc).toBeDefined();
  expect(plusFunc?.type).toBe("function");
  
  // This test will need to be updated after evaluator is refactored to return Either
});

test("should handle evaluation errors", () => {
  const { evaluator, env } = createEvaluatorWithBuiltins();
  
  // This test will be updated after refactoring to expect Either.left
  // For example, evaluating an undefined symbol should return an error
});