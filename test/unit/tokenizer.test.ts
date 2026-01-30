/**
 * @file tokenizer.test.ts
 * @description Tests for T-Lisp tokenizer
 */

import { describe, test, expect } from "bun:test";
import { TLispTokenizer } from "../../src/tlisp/tokenizer.ts";
import { Either } from "../../src/utils/task-either.ts";

/**
 * Test suite for T-Lisp tokenizer
 */
describe("T-Lisp Tokenizer", () => {
  let tokenizer: TLispTokenizer;

  test("should create tokenizer", () => {
    tokenizer = new TLispTokenizer();
    expect(typeof tokenizer.tokenize).toBe("function");
  });

  test("should tokenize empty string", () => {
    const result = tokenizer.tokenize("");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual([]);
    }
  });

  test("should tokenize whitespace", () => {
    const result = tokenizer.tokenize("   \t\n  ");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual([]);
    }
  });

  test("should tokenize single atoms", () => {
    const result1 = tokenizer.tokenize("42");
    expect(Either.isRight(result1)).toBe(true);
    if (Either.isRight(result1)) {
      expect(result1.right).toEqual(["42"]);
    }

    const result2 = tokenizer.tokenize("hello");
    expect(Either.isRight(result2)).toBe(true);
    if (Either.isRight(result2)) {
      expect(result2.right).toEqual(["hello"]);
    }

    const result3 = tokenizer.tokenize("t");
    expect(Either.isRight(result3)).toBe(true);
    if (Either.isRight(result3)) {
      expect(result3.right).toEqual(["t"]);
    }

    const result4 = tokenizer.tokenize("nil");
    expect(Either.isRight(result4)).toBe(true);
    if (Either.isRight(result4)) {
      expect(result4.right).toEqual(["nil"]);
    }
  });

  test("should tokenize strings", () => {
    const result1 = tokenizer.tokenize('"hello"');
    expect(Either.isRight(result1)).toBe(true);
    if (Either.isRight(result1)) {
      expect(result1.right).toEqual(['"hello"']);
    }

    const result2 = tokenizer.tokenize('"hello world"');
    expect(Either.isRight(result2)).toBe(true);
    if (Either.isRight(result2)) {
      expect(result2.right).toEqual(['"hello world"']);
    }

    const result3 = tokenizer.tokenize('""');
    expect(Either.isRight(result3)).toBe(true);
    if (Either.isRight(result3)) {
      expect(result3.right).toEqual(['""']);
    }
  });

  test("should tokenize symbols", () => {
    const result1 = tokenizer.tokenize("foo");
    expect(Either.isRight(result1)).toBe(true);
    if (Either.isRight(result1)) {
      expect(result1.right).toEqual(["foo"]);
    }

    const result2 = tokenizer.tokenize("foo-bar");
    expect(Either.isRight(result2)).toBe(true);
    if (Either.isRight(result2)) {
      expect(result2.right).toEqual(["foo-bar"]);
    }

    const result3 = tokenizer.tokenize("foo?");
    expect(Either.isRight(result3)).toBe(true);
    if (Either.isRight(result3)) {
      expect(result3.right).toEqual(["foo?"]);
    }

    const result4 = tokenizer.tokenize("foo!");
    expect(Either.isRight(result4)).toBe(true);
    if (Either.isRight(result4)) {
      expect(result4.right).toEqual(["foo!"]);
    }
  });

  test("should tokenize parentheses", () => {
    const result1 = tokenizer.tokenize("()");
    expect(Either.isRight(result1)).toBe(true);
    if (Either.isRight(result1)) {
      expect(result1.right).toEqual(["(", ")"]);
    }

    const result2 = tokenizer.tokenize("(foo)");
    expect(Either.isRight(result2)).toBe(true);
    if (Either.isRight(result2)) {
      expect(result2.right).toEqual(["(", "foo", ")"]);
    }

    const result3 = tokenizer.tokenize("(foo bar)");
    expect(Either.isRight(result3)).toBe(true);
    if (Either.isRight(result3)) {
      expect(result3.right).toEqual(["(", "foo", "bar", ")"]);
    }
  });

  test("should tokenize nested lists", () => {
    const result = tokenizer.tokenize("(foo (bar baz))");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(["(", "foo", "(", "bar", "baz", ")", ")"]);
    }
  });

  test("should tokenize quote", () => {
    const result1 = tokenizer.tokenize("'foo");
    expect(Either.isRight(result1)).toBe(true);
    if (Either.isRight(result1)) {
      expect(result1.right).toEqual(["'", "foo"]);
    }

    const result2 = tokenizer.tokenize("'(foo bar)");
    expect(Either.isRight(result2)).toBe(true);
    if (Either.isRight(result2)) {
      expect(result2.right).toEqual(["'", "(", "foo", "bar", ")"]);
    }
  });

  test("should tokenize arithmetic expressions", () => {
    const result1 = tokenizer.tokenize("(+ 1 2)");
    expect(Either.isRight(result1)).toBe(true);
    if (Either.isRight(result1)) {
      expect(result1.right).toEqual(["(", "+", "1", "2", ")"]);
    }

    const result2 = tokenizer.tokenize("(* (+ 1 2) 3)");
    expect(Either.isRight(result2)).toBe(true);
    if (Either.isRight(result2)) {
      expect(result2.right).toEqual(["(", "*", "(", "+", "1", "2", ")", "3", ")"]);
    }
  });

  test("should tokenize function definitions", () => {
    const result = tokenizer.tokenize("(defun square (x) (* x x))");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(["(", "defun", "square", "(", "x", ")", "(", "*", "x", "x", ")", ")"]);
    }
  });

  test("should handle comments", () => {
    const result1 = tokenizer.tokenize("(+ 1 2) ; this is a comment");
    expect(Either.isRight(result1)).toBe(true);
    if (Either.isRight(result1)) {
      expect(result1.right).toEqual(["(", "+", "1", "2", ")"]);
    }

    const result2 = tokenizer.tokenize("; full line comment\n(+ 1 2)");
    expect(Either.isRight(result2)).toBe(true);
    if (Either.isRight(result2)) {
      expect(result2.right).toEqual(["(", "+", "1", "2", ")"]);
    }
  });

  test("should handle complex expressions", () => {
    const code = `
      (defun factorial (n)
        (if (= n 0)
            1
            (* n (factorial (- n 1)))))
    `;
    const result = tokenizer.tokenize(code);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual([
        "(", "defun", "factorial", "(", "n", ")",
        "(", "if", "(", "=", "n", "0", ")",
        "1",
        "(", "*", "n", "(", "factorial", "(", "-", "n", "1", ")", ")", ")",
        ")", ")"
      ]);
    }
  });
});