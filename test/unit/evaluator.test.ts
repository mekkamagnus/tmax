/**
 * @file evaluator.test.ts
 * @description Tests for T-Lisp evaluator
 */

import { expect, describe, test, beforeAll } from "bun:test";
import { TLispEvaluator, createEvaluatorWithBuiltins } from "../../src/tlisp/evaluator.ts";
import { TLispParser } from "../../src/tlisp/parser.ts";
import { TLispEnvironment } from "../../src/tlisp/types.ts";
import { createNumber, createString, createSymbol, createBoolean, createNil, valueToString } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";

// Create a helper function for assertion since we're using Bun test
function assertEquals(actual: any, expected: any, msg?: string) {
  expect(actual).toEqual(expected);
}

/**
 * Test suite for T-Lisp evaluator
 */

describe("T-Lisp Evaluator", () => {
  let evaluator: TLispEvaluator;
  let parser: TLispParser;
  let env: TLispEnvironment;

  beforeAll(() => {
    const result = createEvaluatorWithBuiltins();
    evaluator = result.evaluator;
    env = result.env;
    parser = new TLispParser();
  });

  // Helper to parse expression and extract .right value
  const parseExpr = (code: string) => {
    const result = parser.parse(code);
    if (Either.isLeft(result)) {
      throw new Error(`Parse error: ${JSON.stringify(result.left)}`);
    }
    return result.right;
  };

  // Helper to eval expression and extract .right value
  const evalExpr = (expr: any) => {
    const result = evaluator.eval(expr, env);
    if (Either.isLeft(result)) {
      throw new Error(`Eval error: ${JSON.stringify(result.left)}`);
    }
    return result.right;
  };

  test("should evaluate literals", () => {
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
    env.define("x", createNumber(42));
    const result = evaluator.eval(createSymbol("x"), env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(42));
    }
  });

  test("should return error on undefined symbols", () => {
    const result = evaluator.eval(createSymbol("undefined-var"), env);
    expect(Either.isLeft(result)).toBe(true);
  });

  test("should evaluate quoted expressions", () => {
    const expr = parseExpr("'foo");
    const result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toBe("symbol");
      expect(result.right.value).toBe("foo");
    }
  });

  test("should evaluate quoted lists", () => {
    const expr = parseExpr("'(1 2 3)");
    const result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toBe("list");
      const list = result.right.value as any[];
      expect(list.length).toBe(3);
      expect(list[0].value).toBe(1);
      expect(list[1].value).toBe(2);
      expect(list[2].value).toBe(3);
    }
  });

  test("should evaluate arithmetic expressions", () => {
    // Addition
    let expr = parseExpr("(+ 1 2)");
    let result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(3));
    }

    // Subtraction
    expr = parseExpr("(- 5 3)");
    result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(2));
    }

    // Multiplication
    expr = parseExpr("(* 3 4)");
    result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(12));
    }

    // Division
    expr = parseExpr("(/ 8 2)");
    result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(4));
    }
  });

  test("should evaluate nested arithmetic", () => {
    const expr = parseExpr("(+ (* 2 3) (- 10 5))");
    const result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(11)); // (+ 6 5) = 11
    }
  });

  test("should evaluate comparison expressions", () => {
    // Equality
    let expr = parseExpr("(= 2 2)");
    let result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createBoolean(true));
    }

    expr = parseExpr("(= 2 3)");
    result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createBoolean(false));
    }

    // Less than
    expr = parseExpr("(< 1 2)");
    result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createBoolean(true));
    }

    expr = parseExpr("(< 2 1)");
    result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createBoolean(false));
    }
  });

  test("should evaluate if expressions", () => {
    // True condition
    let expr = parseExpr("(if t 1 2)");
    let result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(1));
    }

    // False condition
    expr = parseExpr("(if nil 1 2)");
    result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(2));
    }

    // Complex condition
    expr = parseExpr("(if (< 1 2) 'yes 'no)");
    result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toBe("symbol");
      expect(result.right.value).toBe("yes");
    }
  });

  test("should evaluate let expressions", () => {
    const expr = parseExpr("(let ((x 10) (y 20)) (+ x y))");
    const result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(30));
    }
  });

  test("should evaluate lambda expressions", () => {
    const expr = parseExpr("((lambda (x) (* x 2)) 5)");
    const result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(10));
    }
  });

  test("should evaluate defun expressions", () => {
    const expr = parseExpr("(defun square (x) (* x x))");
    const defResult = evaluator.eval(expr, env);
    expect(Either.isRight(defResult)).toBe(true);

    // Test the defined function
    const callExpr = parseExpr("(square 4)");
    const result = evaluator.eval(callExpr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(16));
    }
  });

  test("should evaluate list operations", () => {
    // cons
    let expr = parseExpr("(cons 1 '(2 3))");
    let result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toBe("list");
      let list = result.right.value as any[];
      expect(list.length).toBe(3);
      expect(list[0].value).toBe(1);
    }

    // car
    expr = parseExpr("(car '(1 2 3))");
    result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(1));
    }

    // cdr
    expr = parseExpr("(cdr '(1 2 3))");
    result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toBe("list");
      let list = result.right.value as any[];
      expect(list.length).toBe(2);
      expect(list[0].value).toBe(2);
      expect(list[1].value).toBe(3);
    }
  });

  test("should evaluate predicates", () => {
    // null
    let expr = parseExpr("(null nil)");
    let result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createBoolean(true));
    }

    expr = parseExpr("(null '(1 2))");
    result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createBoolean(false));
    }

    // atom
    expr = parseExpr("(atom 42)");
    result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createBoolean(true));
    }

    expr = parseExpr("(atom '(1 2))");
    result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createBoolean(false));
    }
  });

  test("should handle recursive functions", () => {
    // Define factorial function
    const defExpr = parseExpr(`
      (defun factorial (n)
        (if (= n 0)
            1
            (* n (factorial (- n 1)))))
    `);
    const defResult = evaluator.eval(defExpr, env);
    expect(Either.isRight(defResult)).toBe(true);

    // Test factorial
    const callExpr = parseExpr("(factorial 5)");
    const result = evaluator.eval(callExpr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(120));
    }
  });

  test("should evaluate cond expressions", () => {
    // Simple cond with first condition true
    let expr = parseExpr("(cond ((= 1 1) 'first) ((= 2 2) 'second))");
    let result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toBe("symbol");
      expect(result.right.value).toBe("first");
    }

    // Cond with second condition true
    expr = parseExpr("(cond ((= 1 2) 'first) ((= 2 2) 'second))");
    result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toBe("symbol");
      expect(result.right.value).toBe("second");
    }

    // Cond with no matching conditions
    expr = parseExpr("(cond ((= 1 2) 'first) ((= 3 4) 'second))");
    result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNil());
    }
  });

  test("should evaluate cond with 't' clause", () => {
    // Cond with 't' as else clause
    const expr = parseExpr("(cond ((= 1 2) 'first) (t 'default))");
    const result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toBe("symbol");
      expect(result.right.value).toBe("default");
    }
  });

  test("should evaluate cond with complex conditions", () => {
    // Cond with arithmetic conditions
    const expr = parseExpr(`
      (cond
        ((< 5 3) 'less)
        ((> 5 3) 'greater)
        (t 'equal))
    `);
    const result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toBe("symbol");
      expect(result.right.value).toBe("greater");
    }
  });

  test("should evaluate cond with complex expressions", () => {
    // Cond with complex expressions in both condition and result
    const expr = parseExpr(`
      (let ((x 10))
        (cond
          ((< x 5) (* x 2))
          ((> x 15) (+ x 5))
          (t (- x 3))))
    `);
    const result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(7)); // x=10, so (- 10 3) = 7
    }
  });

  test("should handle cond error cases", () => {
    // Empty cond
    const expr = parseExpr("(cond)");
    const result = evaluator.eval(expr, env);
    expect(Either.isLeft(result)).toBe(true);

    // Invalid clause format
    const expr2 = parseExpr("(cond 42)");
    const result2 = evaluator.eval(expr2, env);
    expect(Either.isLeft(result2)).toBe(true);

    // Clause with wrong number of elements
    const expr3 = parseExpr("(cond (t))");
    const result3 = evaluator.eval(expr3, env);
    expect(Either.isLeft(result3)).toBe(true);
  });

  test("should evaluate cond with tail-call optimization", () => {
    // Define a recursive function using cond
    const defExpr = parseExpr(`
      (defun countdown (n)
        (cond
          ((= n 0) 'done)
          (t (countdown (- n 1)))))
    `);
    const defResult = evaluator.eval(defExpr, env);
    expect(Either.isRight(defResult)).toBe(true);

    // Test tail-call optimized recursion
    const callExpr = parseExpr("(countdown 100)");
    const result = evaluator.eval(callExpr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toBe("symbol");
      expect(result.right.value).toBe("done");
    }
  });

  test("should handle complex expressions", () => {
    const expr = parseExpr(`
      (let ((x 10) (y 5))
        (if (> x y)
            (+ x y)
            (- x y)))
    `);
    const result = evaluator.eval(expr, env);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(createNumber(15));
    }
  });
});