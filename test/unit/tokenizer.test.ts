/**
 * @file tokenizer.test.ts
 * @description Tests for T-Lisp tokenizer
 */

import { assertEquals } from "@std/assert";
import { TLispTokenizer } from "../../src/tlisp/tokenizer.ts";

/**
 * Test suite for T-Lisp tokenizer
 */
Deno.test("T-Lisp Tokenizer", async (t) => {
  let tokenizer: TLispTokenizer;

  await t.step("should create tokenizer", () => {
    tokenizer = new TLispTokenizer();
    assertEquals(typeof tokenizer.tokenize, "function");
  });

  await t.step("should tokenize empty string", () => {
    const tokens = tokenizer.tokenize("");
    assertEquals(tokens, []);
  });

  await t.step("should tokenize whitespace", () => {
    const tokens = tokenizer.tokenize("   \t\n  ");
    assertEquals(tokens, []);
  });

  await t.step("should tokenize single atoms", () => {
    assertEquals(tokenizer.tokenize("42"), ["42"]);
    assertEquals(tokenizer.tokenize("hello"), ["hello"]);
    assertEquals(tokenizer.tokenize("t"), ["t"]);
    assertEquals(tokenizer.tokenize("nil"), ["nil"]);
  });

  await t.step("should tokenize strings", () => {
    assertEquals(tokenizer.tokenize('"hello"'), ['"hello"']);
    assertEquals(tokenizer.tokenize('"hello world"'), ['"hello world"']);
    assertEquals(tokenizer.tokenize('""'), ['""']);
  });

  await t.step("should tokenize symbols", () => {
    assertEquals(tokenizer.tokenize("foo"), ["foo"]);
    assertEquals(tokenizer.tokenize("foo-bar"), ["foo-bar"]);
    assertEquals(tokenizer.tokenize("foo?"), ["foo?"]);
    assertEquals(tokenizer.tokenize("foo!"), ["foo!"]);
  });

  await t.step("should tokenize parentheses", () => {
    assertEquals(tokenizer.tokenize("()"), ["(", ")"]);
    assertEquals(tokenizer.tokenize("(foo)"), ["(", "foo", ")"]);
    assertEquals(tokenizer.tokenize("(foo bar)"), ["(", "foo", "bar", ")"]);
  });

  await t.step("should tokenize nested lists", () => {
    assertEquals(
      tokenizer.tokenize("(foo (bar baz))"),
      ["(", "foo", "(", "bar", "baz", ")", ")"]
    );
  });

  await t.step("should tokenize quote", () => {
    assertEquals(tokenizer.tokenize("'foo"), ["'", "foo"]);
    assertEquals(tokenizer.tokenize("'(foo bar)"), ["'", "(", "foo", "bar", ")"]);
  });

  await t.step("should tokenize arithmetic expressions", () => {
    assertEquals(
      tokenizer.tokenize("(+ 1 2)"),
      ["(", "+", "1", "2", ")"]
    );
    assertEquals(
      tokenizer.tokenize("(* (+ 1 2) 3)"),
      ["(", "*", "(", "+", "1", "2", ")", "3", ")"]
    );
  });

  await t.step("should tokenize function definitions", () => {
    assertEquals(
      tokenizer.tokenize("(defun square (x) (* x x))"),
      ["(", "defun", "square", "(", "x", ")", "(", "*", "x", "x", ")", ")"]
    );
  });

  await t.step("should handle comments", () => {
    assertEquals(
      tokenizer.tokenize("(+ 1 2) ; this is a comment"),
      ["(", "+", "1", "2", ")"]
    );
    assertEquals(
      tokenizer.tokenize("; full line comment\n(+ 1 2)"),
      ["(", "+", "1", "2", ")"]
    );
  });

  await t.step("should handle complex expressions", () => {
    const code = `
      (defun factorial (n)
        (if (= n 0)
            1
            (* n (factorial (- n 1)))))
    `;
    const tokens = tokenizer.tokenize(code);
    assertEquals(tokens, [
      "(", "defun", "factorial", "(", "n", ")",
      "(", "if", "(", "=", "n", "0", ")",
      "1",
      "(", "*", "n", "(", "factorial", "(", "-", "n", "1", ")", ")", ")",
      ")", ")"
    ]);
  });
});