import { test, expect } from "bun:test";
import { TLispParser } from "../../src/tlisp/parser";
import { Either } from "../../src/utils/task-either";

test("should parse valid expressions successfully", () => {
  const parser = new TLispParser();
  const result = parser.parse("42");
  // After refactoring, this should return Either<ParseError, TLispValue>
  expect(result).toBeDefined();
  expect('right' in result).toBe(true); // Should be a right (success) Either
  expect(result.right?.type).toBe("number");
  expect(result.right?.value).toBe(42);
});

test("should handle unmatched closing parenthesis error", () => {
  const parser = new TLispParser();
  const result = parser.parse("())");
  // After refactoring, this should return Either.left with ParseError
  expect(result).toBeDefined();
  expect('left' in result).toBe(true); // Should be a left (error) Either
});

test("should handle unmatched opening parenthesis error", () => {
  const parser = new TLispParser();
  const result = parser.parse("((");
  // After refactoring, this should return Either.left with ParseError
  expect(result).toBeDefined();
  expect('left' in result).toBe(true); // Should be a left (error) Either
});

test("should handle unexpected end of input error", () => {
  const parser = new TLispParser();
  const result = parser.parse("(");
  // After refactoring, this should return Either.left with ParseError
  expect(result).toBeDefined();
  expect('left' in result).toBe(true); // Should be a left (error) Either
});

test("should handle unexpected closing parenthesis error", () => {
  const parser = new TLispParser();
  const result = parser.parse(")");
  // After refactoring, this should return Either.left with ParseError
  expect(result).toBeDefined();
  expect('left' in result).toBe(true); // Should be a left (error) Either
});

test("should handle expected closing parenthesis error", () => {
  const parser = new TLispParser();
  const result = parser.parse("(");
  // After refactoring, this should return Either.left with ParseError
  expect(result).toBeDefined();
  expect('left' in result).toBe(true); // Should be a left (error) Either
});

test("should handle invalid string literal error", () => {
  const parser = new TLispParser();
  const result = parser.parse("\"invalid");
  // After refactoring, this should return Either.left with ParseError
  expect(result).toBeDefined();
  expect('left' in result).toBe(true); // Should be a left (error) Either
});

test("should handle expected token mismatch error", () => {
  // This would happen internally when consume() is called with wrong token
  // We'll test this indirectly by providing malformed input
  const parser = new TLispParser();
  const result = parser.parse("'"); // Quote without following expression
  expect(result).toBeDefined();
  expect('left' in result).toBe(true); // Should be a left (error) Either
});