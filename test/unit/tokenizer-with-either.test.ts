import { test, expect } from "bun:test";
import { TLispTokenizer } from "../../src/tlisp/tokenizer";
import { Either } from "../../src/utils/task-either";

test("should tokenize valid expressions successfully", () => {
  const tokenizer = new TLispTokenizer();
  const result = tokenizer.tokenize("(+ 1 2)");
  // After refactoring, this should return Either<TokenizeError, string[]>
  expect(result).toBeDefined();
  expect('right' in result).toBe(true); // Should be a right (success) Either
  expect(Array.isArray(result.right)).toBe(true);
  expect(result.right).toEqual(["(", "+", "1", "2", ")"]);
});

test("should handle unterminated string literal error", () => {
  const tokenizer = new TLispTokenizer();
  const result = tokenizer.tokenize('("hello');
  // After refactoring, this should return Either.left with TokenizeError
  expect(result).toBeDefined();
  expect('left' in result).toBe(true); // Should be a left (error) Either
  expect(result.left).toBeDefined();
  expect(result.left.message).toContain("Unterminated string literal");
});

test("should tokenize simple expressions", () => {
  const tokenizer = new TLispTokenizer();
  const result = tokenizer.tokenize("42");
  expect('right' in result).toBe(true);
  expect(Array.isArray(result.right)).toBe(true);
  expect(result.right).toEqual(["42"]);
});

test("should tokenize quoted expressions", () => {
  const tokenizer = new TLispTokenizer();
  const result = tokenizer.tokenize("'(a b c)");
  expect('right' in result).toBe(true);
  expect(Array.isArray(result.right)).toBe(true);
  expect(result.right).toEqual(["'", "(", "a", "b", "c", ")"]);
});

test("should tokenize string literals", () => {
  const tokenizer = new TLispTokenizer();
  const result = tokenizer.tokenize('"hello world"');
  expect('right' in result).toBe(true);
  expect(Array.isArray(result.right)).toBe(true);
  expect(result.right).toEqual(['"hello world"']);
});

test("should handle multiple expressions", () => {
  const tokenizer = new TLispTokenizer();
  const result = tokenizer.tokenize("(+ 1 2) (- 3 4)");
  expect('right' in result).toBe(true);
  expect(Array.isArray(result.right)).toBe(true);
  expect(result.right).toEqual(["(", "+", "1", "2", ")", "(", "-", "3", "4", ")"]);
});