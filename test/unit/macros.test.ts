/**
 * @file macros.test.ts
 * @description Test suite for T-Lisp macro system
 */

import { describe, test, expect } from "bun:test";
import { TLispParser } from "../../src/tlisp/parser.ts";
import { createEvaluatorWithBuiltins } from "../../src/tlisp/evaluator.ts";
import { createSymbol, createNumber, createString, createList, createNil } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("T-Lisp Macro System", () => {
  const parser = new TLispParser();
  const { evaluator, env } = createEvaluatorWithBuiltins();

  test("quasiquote - basic functionality", () => {
    const expr = parser.parse("`(a b c)");
    if (Either.isLeft(expr)) {
      throw new Error(`Parse failed: ${JSON.stringify(expr.left)}`);
    }
    const result = evaluator.eval(expr.right, env);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createList([createSymbol("a"), createSymbol("b"), createSymbol("c")]));
    }
  });

  test("quasiquote with unquote", () => {
    // Set up a variable for unquoting
    env.define("x", createNumber(42));

    const expr = parser.parse("`(a ,x c)");
    if (Either.isLeft(expr)) {
      throw new Error(`Parse failed: ${JSON.stringify(expr.left)}`);
    }
    const result = evaluator.eval(expr.right, env);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createList([createSymbol("a"), createNumber(42), createSymbol("c")]));
    }
  });

  test("quasiquote with unquote-splicing", () => {
    // Set up a list for splicing
    env.define("lst", createList([createNumber(1), createNumber(2), createNumber(3)]));

    const expr = parser.parse("`(a ,@lst d)");
    if (Either.isLeft(expr)) {
      throw new Error(`Parse failed: ${JSON.stringify(expr.left)}`);
    }
    const result = evaluator.eval(expr.right, env);

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

  test("defmacro - define simple macro", () => {
    const defExpr = parser.parse("(defmacro when (condition body) `(if ,condition ,body nil))");
    if (Either.isLeft(defExpr)) {
      throw new Error(`Parse failed: ${JSON.stringify(defExpr.left)}`);
    }
    const defResult = evaluator.eval(defExpr.right, env);

    expect(Either.isRight(defResult)).toBe(true);
    if (Either.isRight(defResult)) {
      expect(defResult.right).toEqual(createSymbol("when"));
    }
  });

  test("macro expansion - use when macro", () => {
    // First ensure we have the when macro defined
    const defExpr = parser.parse("(defmacro when (condition body) `(if ,condition ,body nil))");
    if (Either.isLeft(defExpr)) {
      throw new Error(`Parse failed: ${JSON.stringify(defExpr.left)}`);
    }
    evaluator.eval(defExpr.right, env);

    // Test macro expansion
    const useExpr = parser.parse("(when t 42)");
    if (Either.isLeft(useExpr)) {
      throw new Error(`Parse failed: ${JSON.stringify(useExpr.left)}`);
    }
    const result = evaluator.eval(useExpr.right, env);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(42));
    }
  });

  test("macro expansion - when with false condition", () => {
    const useExpr = parser.parse("(when nil 42)");
    if (Either.isLeft(useExpr)) {
      throw new Error(`Parse failed: ${JSON.stringify(useExpr.left)}`);
    }
    const result = evaluator.eval(useExpr.right, env);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toEqual("nil");
    }
  });

  test("defmacro - define unless macro", () => {
    const defExpr = parser.parse("(defmacro unless (condition body) `(if ,condition nil ,body))");
    if (Either.isLeft(defExpr)) {
      throw new Error(`Parse failed: ${JSON.stringify(defExpr.left)}`);
    }
    const defResult = evaluator.eval(defExpr.right, env);

    expect(Either.isRight(defResult)).toBe(true);
    if (Either.isRight(defResult)) {
      expect(defResult.right).toEqual(createSymbol("unless"));
    }
  });

  test("macro expansion - use unless macro", () => {
    // Test unless with false condition (should execute body)
    const useExpr = parser.parse("(unless nil 42)");
    if (Either.isLeft(useExpr)) {
      throw new Error(`Parse failed: ${JSON.stringify(useExpr.left)}`);
    }
    const result = evaluator.eval(useExpr.right, env);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(42));
    }

    // Test unless with true condition (should not execute body)
    const useExpr2 = parser.parse("(unless t 42)");
    if (Either.isLeft(useExpr2)) {
      throw new Error(`Parse failed: ${JSON.stringify(useExpr2.left)}`);
    }
    const result2 = evaluator.eval(useExpr2.right, env);

    expect(Either.isRight(result2)).toBe(true);
    if (Either.isRight(result2)) {
      expect(result2.right.type).toEqual("nil");
    }
  });

  test("nested quasiquote", () => {
    env.define("y", createNumber(10));
    const expr = parser.parse("``(a ,,y c)");
    if (Either.isLeft(expr)) {
      throw new Error(`Parse failed: ${JSON.stringify(expr.left)}`);
    }
    const result = evaluator.eval(expr.right, env);

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

  test("error handling - unquote outside quasiquote", () => {
    const expr = parser.parse("(unquote x)");
    if (Either.isLeft(expr)) {
      throw new Error(`Parse failed: ${JSON.stringify(expr.left)}`);
    }
    const result = evaluator.eval(expr.right, env);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("unquote can only be used inside quasiquote");
    }
  });

  test("error handling - unquote-splicing outside quasiquote", () => {
    const expr = parser.parse("(unquote-splicing x)");
    if (Either.isLeft(expr)) {
      throw new Error(`Parse failed: ${JSON.stringify(expr.left)}`);
    }
    const result = evaluator.eval(expr.right, env);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("unquote-splicing can only be used inside quasiquote");
    }
  });

  test("error handling - defmacro wrong argument count", () => {
    const expr = parser.parse("(defmacro foo)");
    if (Either.isLeft(expr)) {
      throw new Error(`Parse failed: ${JSON.stringify(expr.left)}`);
    }
    const result = evaluator.eval(expr.right, env);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("defmacro requires exactly 3 arguments");
    }
  });

  test("error handling - macro wrong argument count", () => {
    // Define a macro that expects 2 arguments
    const defExpr = parser.parse("(defmacro test-macro (a b) `(+ ,a ,b))");
    if (Either.isLeft(defExpr)) {
      throw new Error(`Parse failed: ${JSON.stringify(defExpr.left)}`);
    }
    evaluator.eval(defExpr.right, env);

    // Try to call it with wrong number of arguments
    const expr = parser.parse("(test-macro 1)");
    if (Either.isLeft(expr)) {
      throw new Error(`Parse failed: ${JSON.stringify(expr.left)}`);
    }
    const result = evaluator.eval(expr.right, env);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("macro test-macro expects 2 arguments, got 1");
    }
  });

  test("macro with computation", () => {
    // Define a macro that does some computation during expansion
    const defExpr = parser.parse("(defmacro inc (x) `(+ ,x 1))");
    if (Either.isLeft(defExpr)) {
      throw new Error(`Parse failed: ${JSON.stringify(defExpr.left)}`);
    }
    evaluator.eval(defExpr.right, env);

    const useExpr = parser.parse("(inc 5)");
    if (Either.isLeft(useExpr)) {
      throw new Error(`Parse failed: ${JSON.stringify(useExpr.left)}`);
    }
    const result = evaluator.eval(useExpr.right, env);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(6));
    }
  });

  test("macro generating macro calls", () => {
    // Test that macros can generate other macro calls
    const defExpr1 = parser.parse("(defmacro inc (x) `(+ ,x 1))");
    if (Either.isLeft(defExpr1)) {
      throw new Error(`Parse failed: ${JSON.stringify(defExpr1.left)}`);
    }
    evaluator.eval(defExpr1.right, env);

    const defExpr2 = parser.parse("(defmacro inc-twice (x) `(inc (inc ,x)))");
    if (Either.isLeft(defExpr2)) {
      throw new Error(`Parse failed: ${JSON.stringify(defExpr2.left)}`);
    }
    evaluator.eval(defExpr2.right, env);

    const useExpr = parser.parse("(inc-twice 5)");
    if (Either.isLeft(useExpr)) {
      throw new Error(`Parse failed: ${JSON.stringify(useExpr.left)}`);
    }
    const result = evaluator.eval(useExpr.right, env);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(7));
    }
  });
});