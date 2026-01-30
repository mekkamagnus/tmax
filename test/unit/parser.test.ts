/**
 * @file parser.test.ts
 * @description Tests for T-Lisp parser
 */

import { describe, test, expect } from "bun:test";
import { TLispParser } from "../../src/tlisp/parser.ts";
import { valueToString } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";

/**
 * Test suite for T-Lisp parser
 */
describe("T-Lisp Parser", () => {
  let parser: TLispParser;

  test("should create parser", () => {
    parser = new TLispParser();
    expect(typeof parser.parse).toBe("function");
  });

  // Helper to parse and extract .right value
  const parseResult = (code: string) => {
    const result = parser.parse(code);
    if (Either.isLeft(result)) {
      throw new Error(`Parse error: ${JSON.stringify(result.left)}`);
    }
    return result.right;
  };

  test("should parse nil", () => {
    const result = parseResult("nil");
    expect(result.type).toBe("nil");
    expect(valueToString(result)).toBe("nil");
  });

  test("should parse booleans", () => {
    const trueResult = parseResult("t");
    expect(trueResult.type).toBe("boolean");
    expect(trueResult.value).toBe(true);

    const falseResult = parseResult("nil");
    expect(falseResult.type).toBe("nil");
  });

  test("should parse numbers", () => {
    const intResult = parseResult("42");
    expect(intResult.type).toBe("number");
    expect(intResult.value).toBe(42);

    const floatResult = parseResult("3.14");
    expect(floatResult.type).toBe("number");
    expect(floatResult.value).toBe(3.14);

    const negativeResult = parseResult("-10");
    expect(negativeResult.type).toBe("number");
    expect(negativeResult.value).toBe(-10);
  });

  test("should parse strings", () => {
    const result = parseResult('"hello world"');
    expect(result.type).toBe("string");
    expect(result.value).toBe("hello world");

    const emptyResult = parseResult('""');
    expect(emptyResult.type).toBe("string");
    expect(emptyResult.value).toBe("");
  });

  test("should parse symbols", () => {
    const result = parseResult("foo");
    expect(result.type).toBe("symbol");
    expect(result.value).toBe("foo");

    const complexResult = parseResult("foo-bar?");
    expect(complexResult.type).toBe("symbol");
    expect(complexResult.value).toBe("foo-bar?");
  });

  test("should parse empty list", () => {
    const result = parseResult("()");
    expect(result.type).toBe("list");
    expect((result.value as any[]).length).toBe(0);
  });

  test("should parse simple list", () => {
    const result = parseResult("(+ 1 2)");
    expect(result.type).toBe("list");

    const list = result.value as any[];
    expect(list.length).toBe(3);
    expect(list[0].type).toBe("symbol");
    expect(list[0].value).toBe("+");
    expect(list[1].type).toBe("number");
    expect(list[1].value).toBe(1);
    expect(list[2].type).toBe("number");
    expect(list[2].value).toBe(2);
  });

  test("should parse nested lists", () => {
    const result = parseResult("(+ (* 2 3) 4)");
    expect(result.type).toBe("list");

    const list = result.value as any[];
    expect(list.length).toBe(3);
    expect(list[0].value).toBe("+");
    expect(list[1].type).toBe("list");
    expect(list[2].value).toBe(4);

    const nestedList = list[1].value as any[];
    expect(nestedList.length).toBe(3);
    expect(nestedList[0].value).toBe("*");
    expect(nestedList[1].value).toBe(2);
    expect(nestedList[2].value).toBe(3);
  });

  test("should parse quoted expressions", () => {
    const result = parseResult("'foo");
    expect(result.type).toBe("list");

    const list = result.value as any[];
    expect(list.length).toBe(2);
    expect(list[0].type).toBe("symbol");
    expect(list[0].value).toBe("quote");
    expect(list[1].type).toBe("symbol");
    expect(list[1].value).toBe("foo");
  });

  test("should parse quoted lists", () => {
    const result = parseResult("'(1 2 3)");
    expect(result.type).toBe("list");

    const list = result.value as any[];
    expect(list.length).toBe(2);
    expect(list[0].value).toBe("quote");
    expect(list[1].type).toBe("list");

    const quotedList = list[1].value as any[];
    expect(quotedList.length).toBe(3);
    expect(quotedList[0].value).toBe(1);
    expect(quotedList[1].value).toBe(2);
    expect(quotedList[2].value).toBe(3);
  });

  test("should parse function definition", () => {
    const result = parseResult("(defun square (x) (* x x))");
    expect(result.type).toBe("list");

    const list = result.value as any[];
    expect(list.length).toBe(4);
    expect(list[0].value).toBe("defun");
    expect(list[1].value).toBe("square");
    expect(list[2].type).toBe("list");
    expect(list[3].type).toBe("list");
  });

  test("should handle whitespace and comments", () => {
    const result = parseResult(`
      ; This is a comment
      (+ 1 2) ; Another comment
    `);
    expect(result.type).toBe("list");

    const list = result.value as any[];
    expect(list.length).toBe(3);
    expect(list[0].value).toBe("+");
    expect(list[1].value).toBe(1);
    expect(list[2].value).toBe(2);
  });

  test("should throw on unmatched parentheses", () => {
    expect(() => parseResult("(+ 1 2")).toThrow();
    expect(() => parseResult("+ 1 2)")).toThrow();
    expect(() => parseResult("((+ 1 2)")).toThrow();
  });

  test("should throw on unterminated string", () => {
    expect(() => parseResult('"unterminated')).toThrow();
  });

  test("should parse multiple expressions", () => {
    const result = parseResult("(+ 1 2) (* 3 4)");
    // Should return first expression
    expect(result.type).toBe("list");
    const list = result.value as any[];
    expect(list[0].value).toBe("+");
  });
});