/**
 * @file stdlib.test.ts
 * @description Tests for T-Lisp standard library functions
 */

import { describe, test, expect } from "bun:test";
import { createEvaluatorWithBuiltins } from "../../src/tlisp/evaluator.ts";
import { TLispParser } from "../../src/tlisp/parser.ts";
import { createNumber, createString, createBoolean, createNil, createList, createSymbol } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("T-Lisp Standard Library", () => {
  const { evaluator, env } = createEvaluatorWithBuiltins();
  const parser = new TLispParser();

  // Helper to parse expression and extract .right value
  const parseExpr = (code: string) => {
    const result = parser.parse(code);
    if (Either.isLeft(result)) {
      throw new Error(`Parse error: ${result.left}`);
    }
    return result.right;
  };

  // Helper to eval expression and extract .right value
  const evalExpr = (expr: any) => {
    const result = evaluator.eval(expr, env);
    if (Either.isLeft(result)) {
      throw new Error(`Eval error: ${result.left}`);
    }
    return result.right;
  };

  describe("should handle string operations", () => {
    test("length function", () => {
      let expr = parseExpr('(length "hello")');
      let result = evalExpr(expr, env);
      expect(result).toEqual(createNumber(5));

      expr = parseExpr("(length '(1 2 3 4))");
      result = evalExpr(expr, env);
      expect(result).toEqual(createNumber(4));
    });

    test("substring function", () => {
      const expr = parseExpr('(substring "hello world" 0 5)');
      const result = evalExpr(expr, env);
      expect(result).toEqual(createString("hello"));
    });

    test("string-append function", () => {
      const expr = parseExpr('(string-append "hello" " " "world")');
      const result = evalExpr(expr, env);
      expect(result).toEqual(createString("hello world"));
    });

    test("string comparison functions", () => {
      let expr = parseExpr('(string= "hello" "hello")');
      let result = evalExpr(expr, env);
      expect(result).toEqual(createBoolean(true));

      expr = parseExpr('(string= "hello" "world")');
      result = evalExpr(expr, env);
      expect(result).toEqual(createBoolean(false));

      expr = parseExpr('(string< "apple" "banana")');
      result = evalExpr(expr, env);
      expect(result).toEqual(createBoolean(true));

      expr = parseExpr('(string> "banana" "apple")');
      result = evalExpr(expr, env);
      expect(result).toEqual(createBoolean(true));
    });

    test("string case functions", () => {
      let expr = parseExpr('(string-upcase "hello")');
      let result = evalExpr(expr, env);
      expect(result).toEqual(createString("HELLO"));

      expr = parseExpr('(string-downcase "WORLD")');
      result = evalExpr(expr, env);
      expect(result).toEqual(createString("world"));
    });
  });

  describe("should handle advanced list operations", () => {
    test("append function", () => {
      const expr = parseExpr("(append '(1 2) '(3 4) '(5))");
      const result = evalExpr(expr, env);
      expect(result.type).toBe("list");
      const list = result.value as any[];
      expect(list.length).toBe(5);
      expect(list[0].value).toBe(1);
      expect(list[4].value).toBe(5);
    });

    test("reverse function", () => {
      const expr = parseExpr("(reverse '(1 2 3 4))");
      const result = evalExpr(expr, env);
      expect(result.type).toBe("list");
      const list = result.value as any[];
      expect(list.length).toBe(4);
      expect(list[0].value).toBe(4);
      expect(list[3].value).toBe(1);
    });

    test("nth function", () => {
      let expr = parseExpr("(nth 0 '(a b c))");
      let result = evalExpr(expr, env);
      expect(result.type).toBe("symbol");
      expect(result.value).toBe("a");

      expr = parseExpr("(nth 2 '(a b c))");
      result = evalExpr(expr, env);
      expect(result.type).toBe("symbol");
      expect(result.value).toBe("c");

      expr = parseExpr("(nth 5 '(a b c))");
      result = evalExpr(expr, env);
      expect(result.type).toBe("nil");
    });

    test("last function", () => {
      let expr = parseExpr("(last '(1 2 3 4))");
      let result = evalExpr(expr, env);
      expect(result).toEqual(createNumber(4));

      expr = parseExpr("(last '())");
      result = evalExpr(expr, env);
      expect(result.type).toBe("nil");
    });

    test("member function", () => {
      let expr = parseExpr("(member 2 '(1 2 3 4))");
      let result = evalExpr(expr, env);
      expect(result.type).toBe("list");
      let list = result.value as any[];
      expect(list.length).toBe(3);
      expect(list[0].value).toBe(2);

      expr = parseExpr("(member 5 '(1 2 3 4))");
      result = evalExpr(expr, env);
      expect(result.type).toBe("nil");
    });
  });

  describe("should handle type predicates", () => {
    test("basic type predicates", () => {
      let expr = parseExpr("(numberp 42)");
      let result = evalExpr(expr, env);
      expect(result).toEqual(createBoolean(true));

      expr = parseExpr('(stringp "hello")');
      result = evalExpr(expr, env);
      expect(result).toEqual(createBoolean(true));

      expr = parseExpr("(symbolp 'foo)");
      result = evalExpr(expr, env);
      expect(result).toEqual(createBoolean(true));

      expr = parseExpr("(listp '(1 2 3))");
      result = evalExpr(expr, env);
      expect(result).toEqual(createBoolean(true));

      expr = parseExpr("(functionp +)");
      result = evalExpr(expr, env);
      expect(result).toEqual(createBoolean(true));
    });

    test("number predicates", () => {
      let expr = parseExpr("(zerop 0)");
      let result = evalExpr(expr, env);
      expect(result).toEqual(createBoolean(true));

      expr = parseExpr("(zerop 5)");
      result = evalExpr(expr, env);
      expect(result).toEqual(createBoolean(false));

      expr = parseExpr("(evenp 4)");
      result = evalExpr(expr, env);
      expect(result).toEqual(createBoolean(true));

      expr = parseExpr("(evenp 3)");
      result = evalExpr(expr, env);
      expect(result).toEqual(createBoolean(false));

      expr = parseExpr("(oddp 3)");
      result = evalExpr(expr, env);
      expect(result).toEqual(createBoolean(true));

      expr = parseExpr("(oddp 4)");
      result = evalExpr(expr, env);
      expect(result).toEqual(createBoolean(false));
    });
  });

  describe("should handle mathematical operations", () => {
    test("basic math functions", () => {
      let expr = parseExpr("(abs -5)");
      let result = evalExpr(expr, env);
      expect(result).toEqual(createNumber(5));

      expr = parseExpr("(abs 3)");
      result = evalExpr(expr, env);
      expect(result).toEqual(createNumber(3));

      expr = parseExpr("(min 3 1 4 2)");
      result = evalExpr(expr, env);
      expect(result).toEqual(createNumber(1));

      expr = parseExpr("(max 3 1 4 2)");
      result = evalExpr(expr, env);
      expect(result).toEqual(createNumber(4));
    });

    test("advanced math functions", () => {
      let expr = parseExpr("(sqrt 16)");
      let result = evalExpr(expr, env);
      expect(result).toEqual(createNumber(4));

      expr = parseExpr("(expt 2 3)");
      result = evalExpr(expr, env);
      expect(result).toEqual(createNumber(8));

      expr = parseExpr("(mod 7 3)");
      result = evalExpr(expr, env);
      expect(result).toEqual(createNumber(1));

      expr = parseExpr("(floor 3.7)");
      result = evalExpr(expr, env);
      expect(result).toEqual(createNumber(3));

      expr = parseExpr("(ceiling 3.2)");
      result = evalExpr(expr, env);
      expect(result).toEqual(createNumber(4));

      expr = parseExpr("(round 3.6)");
      result = evalExpr(expr, env);
      expect(result).toEqual(createNumber(4));
    });
  });

  test("should handle logical operations", () => {
    let expr = parseExpr("(not t)");
    let result = evalExpr(expr, env);
    expect(result).toEqual(createBoolean(false));

    expr = parseExpr("(not nil)");
    result = evalExpr(expr, env);
    expect(result).toEqual(createBoolean(true));

    expr = parseExpr("(not 0)");
    result = evalExpr(expr, env);
    expect(result).toEqual(createBoolean(false));
  });

  test("should handle I/O operations", () => {
    // Test print function (returns nil)
    const expr = parseExpr('(print "hello" 42 t)');
    const result = evalExpr(expr, env);
    expect(result.type).toBe("nil");
  });

  describe("should handle errors appropriately", () => {
    test("should return error on wrong argument types", () => {
      const expr1 = parseExpr("(length 42)");
      const result1 = evaluator.eval(expr1, env);
      expect(Either.isLeft(result1)).toBe(true);

      const expr2 = parseExpr("(sqrt -4)");
      const result2 = evaluator.eval(expr2, env);
      expect(Either.isLeft(result2)).toBe(true);

      const expr3 = parseExpr("(mod 5 0)");
      const result3 = evaluator.eval(expr3, env);
      expect(Either.isLeft(result3)).toBe(true);
    });

    test("should return error on wrong argument counts", () => {
      const expr1 = parseExpr("(abs 1 2)");
      const result1 = evaluator.eval(expr1, env);
      expect(Either.isLeft(result1)).toBe(true);

      const expr2 = parseExpr("(min)");
      const result2 = evaluator.eval(expr2, env);
      expect(Either.isLeft(result2)).toBe(true);
    });
  });

  describe("should handle complex standard library usage", () => {
    test("combined string and list operations", () => {
      const expr = parseExpr(`
        (let ((words '("hello" "world" "from" "T-Lisp")))
          (length (string-append
            (nth 0 words)
            " "
            (nth 1 words))))
      `);
      const result = evalExpr(expr, env);
      expect(result).toEqual(createNumber(11)); // "hello world".length
    });

    test("mathematical computations", () => {
      const expr = parseExpr(`
        (let ((numbers '(1 2 3 4 5)))
          (+ (abs (- (nth 0 numbers) (nth 4 numbers)))
             (sqrt (expt (nth 1 numbers) 2))))
      `);
      const result = evalExpr(expr, env);
      expect(result).toEqual(createNumber(6)); // abs(1-5) + sqrt(2^2) = 4 + 2 = 6
    });

    test("type checking and conditional logic", () => {
      const expr = parseExpr(`
        (defun describe-value (x)
          (if (numberp x)
              (if (zerop x)
                  "zero"
                  (if (evenp x) "even number" "odd number"))
              (if (stringp x)
                  "text"
                  "other")))
      `);
      evaluator.eval(expr, env);

      let testExpr = parseExpr("(describe-value 0)");
      let result = evalExpr(testExpr, env);
      expect(result).toEqual(createString("zero"));

      testExpr = parseExpr("(describe-value 4)");
      result = evalExpr(testExpr, env);
      expect(result).toEqual(createString("even number"));

      testExpr = parseExpr("(describe-value 3)");
      result = evalExpr(testExpr, env);
      expect(result).toEqual(createString("odd number"));

      testExpr = parseExpr('(describe-value "hello")');
      result = evalExpr(testExpr, env);
      expect(result).toEqual(createString("text"));
    });
  });
});
