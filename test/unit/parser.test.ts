/**
 * @file parser.test.ts
 * @description Tests for T-Lisp parser
 */

import { assertEquals, assertThrows } from "@std/assert";
import { TLispParser } from "../../src/tlisp/parser.ts";
import { valueToString } from "../../src/tlisp/values.ts";

/**
 * Test suite for T-Lisp parser
 */
Deno.test("T-Lisp Parser", async (t) => {
  let parser: TLispParser;

  await t.step("should create parser", () => {
    parser = new TLispParser();
    assertEquals(typeof parser.parse, "function");
  });

  await t.step("should parse nil", () => {
    const result = parser.parse("nil");
    assertEquals(result.type, "nil");
    assertEquals(valueToString(result), "nil");
  });

  await t.step("should parse booleans", () => {
    const trueResult = parser.parse("t");
    assertEquals(trueResult.type, "boolean");
    assertEquals(trueResult.value, true);
    
    const falseResult = parser.parse("nil");
    assertEquals(falseResult.type, "nil");
  });

  await t.step("should parse numbers", () => {
    const intResult = parser.parse("42");
    assertEquals(intResult.type, "number");
    assertEquals(intResult.value, 42);
    
    const floatResult = parser.parse("3.14");
    assertEquals(floatResult.type, "number");
    assertEquals(floatResult.value, 3.14);
    
    const negativeResult = parser.parse("-10");
    assertEquals(negativeResult.type, "number");
    assertEquals(negativeResult.value, -10);
  });

  await t.step("should parse strings", () => {
    const result = parser.parse('"hello world"');
    assertEquals(result.type, "string");
    assertEquals(result.value, "hello world");
    
    const emptyResult = parser.parse('""');
    assertEquals(emptyResult.type, "string");
    assertEquals(emptyResult.value, "");
  });

  await t.step("should parse symbols", () => {
    const result = parser.parse("foo");
    assertEquals(result.type, "symbol");
    assertEquals(result.value, "foo");
    
    const complexResult = parser.parse("foo-bar?");
    assertEquals(complexResult.type, "symbol");
    assertEquals(complexResult.value, "foo-bar?");
  });

  await t.step("should parse empty list", () => {
    const result = parser.parse("()");
    assertEquals(result.type, "list");
    assertEquals((result.value as any[]).length, 0);
  });

  await t.step("should parse simple list", () => {
    const result = parser.parse("(+ 1 2)");
    assertEquals(result.type, "list");
    
    const list = result.value as any[];
    assertEquals(list.length, 3);
    assertEquals(list[0].type, "symbol");
    assertEquals(list[0].value, "+");
    assertEquals(list[1].type, "number");
    assertEquals(list[1].value, 1);
    assertEquals(list[2].type, "number");
    assertEquals(list[2].value, 2);
  });

  await t.step("should parse nested lists", () => {
    const result = parser.parse("(+ (* 2 3) 4)");
    assertEquals(result.type, "list");
    
    const list = result.value as any[];
    assertEquals(list.length, 3);
    assertEquals(list[0].value, "+");
    assertEquals(list[1].type, "list");
    assertEquals(list[2].value, 4);
    
    const nestedList = list[1].value as any[];
    assertEquals(nestedList.length, 3);
    assertEquals(nestedList[0].value, "*");
    assertEquals(nestedList[1].value, 2);
    assertEquals(nestedList[2].value, 3);
  });

  await t.step("should parse quoted expressions", () => {
    const result = parser.parse("'foo");
    assertEquals(result.type, "list");
    
    const list = result.value as any[];
    assertEquals(list.length, 2);
    assertEquals(list[0].type, "symbol");
    assertEquals(list[0].value, "quote");
    assertEquals(list[1].type, "symbol");
    assertEquals(list[1].value, "foo");
  });

  await t.step("should parse quoted lists", () => {
    const result = parser.parse("'(1 2 3)");
    assertEquals(result.type, "list");
    
    const list = result.value as any[];
    assertEquals(list.length, 2);
    assertEquals(list[0].value, "quote");
    assertEquals(list[1].type, "list");
    
    const quotedList = list[1].value as any[];
    assertEquals(quotedList.length, 3);
    assertEquals(quotedList[0].value, 1);
    assertEquals(quotedList[1].value, 2);
    assertEquals(quotedList[2].value, 3);
  });

  await t.step("should parse function definition", () => {
    const result = parser.parse("(defun square (x) (* x x))");
    assertEquals(result.type, "list");
    
    const list = result.value as any[];
    assertEquals(list.length, 4);
    assertEquals(list[0].value, "defun");
    assertEquals(list[1].value, "square");
    assertEquals(list[2].type, "list");
    assertEquals(list[3].type, "list");
  });

  await t.step("should handle whitespace and comments", () => {
    const result = parser.parse(`
      ; This is a comment
      (+ 1 2) ; Another comment
    `);
    assertEquals(result.type, "list");
    
    const list = result.value as any[];
    assertEquals(list.length, 3);
    assertEquals(list[0].value, "+");
    assertEquals(list[1].value, 1);
    assertEquals(list[2].value, 2);
  });

  await t.step("should throw on unmatched parentheses", () => {
    assertThrows(() => parser.parse("(+ 1 2"));
    assertThrows(() => parser.parse("+ 1 2)"));
    assertThrows(() => parser.parse("((+ 1 2)"));
  });

  await t.step("should throw on unterminated string", () => {
    assertThrows(() => parser.parse('"unterminated'));
  });

  await t.step("should parse multiple expressions", () => {
    const result = parser.parse("(+ 1 2) (* 3 4)");
    // Should return first expression
    assertEquals(result.type, "list");
    const list = result.value as any[];
    assertEquals(list[0].value, "+");
  });
});