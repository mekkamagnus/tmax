/**
 * @file tlisp-ast-parser.test.ts
 * @description Tests for T-Lisp AST parser adapter: defun, defvar, let, if, lambda
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { tlispParser } from "../../../../src/syntax/ast/parsers/tlisp-parser.ts";
import { Either } from "../../../../src/utils/task-either.ts";
import { resetNodeIdCounter } from "../../../../src/syntax/ast/types.ts";
import { getText } from "../../../../src/syntax/ast/tree-ops.ts";

describe("T-Lisp AST Parser", () => {
  beforeEach(() => resetNodeIdCounter());

  test("parses empty source", () => {
    const result = tlispParser.parse("", "empty");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.kind).toBe("file");
      expect(result.right.children).toHaveLength(0);
    }
  });

  test("parses defun", () => {
    const result = tlispParser.parse("(defun greet (name) (print name))", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.children.length).toBeGreaterThan(0);
      const fn = result.right.children[0]!;
      expect(fn.kind).toBe("function");
      expect(fn.label).toBe("greet");
    }
  });

  test("parses defvar", () => {
    const result = tlispParser.parse("(defvar x 42)", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const v = result.right.children[0]!;
      expect(v.kind).toBe("variable");
      expect(v.label).toBe("x");
    }
  });

  test("parses let", () => {
    const result = tlispParser.parse("(let ((a 1)) a)", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.children[0]!.kind).toBe("block");
    }
  });

  test("parses if", () => {
    const result = tlispParser.parse("(if t 1 2)", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.children[0]!.kind).toBe("if-stmt");
    }
  });

  test("parses bare expression as call", () => {
    const result = tlispParser.parse("(+ 1 2)", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.children[0]!.kind).toBe("call");
    }
  });

  test("parses nested expressions", () => {
    const result = tlispParser.parse("(defun f (x) (if (> x 0) x (- x)))", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const fn = result.right.children[0]!;
      expect(fn.kind).toBe("function");
      expect(fn.label).toBe("f");
      expect(fn.children.length).toBeGreaterThan(0);
    }
  });

  test("parses multiple top-level forms", () => {
    const source = "(defvar x 1)\n(defun f () x)";
    const result = tlispParser.parse(source, "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.children.length).toBe(2);
    }
  });

  test("source spans are correct", () => {
    const source = "(defun f () x)";
    const result = tlispParser.parse(source, "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const fn = result.right.children[0]!;
      // Span should cover the defun form
      expect(fn.span.start.offset).toBeGreaterThanOrEqual(0);
      expect(fn.span.end.offset).toBeLessThanOrEqual(source.length);
    }
  });

  test("text extraction via getText returns source substring", () => {
    const source = "(+ 1 2)";
    const result = tlispParser.parse(source, "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const call = result.right.children[0]!;
      const text = getText(call, source);
      // Text should be a substring of source matching the span
      expect(text).toBe(source.slice(call.span.start.offset, call.span.end.offset));
    }
  });

  test("parseIncremental delegates to parse", () => {
    const result = tlispParser.parseIncremental("(+ 1 2)", "test", {} as any, {} as any);
    expect(Either.isRight(result)).toBe(true);
  });

  test("root node is file kind", () => {
    const result = tlispParser.parse("(defvar x 1)", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.kind).toBe("file");
    }
  });

  test("root node language is tlisp", () => {
    const result = tlispParser.parse("(+ 1 2)", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.language).toBe("tlisp");
    }
  });

  test("parses defmacro as function with macro name", () => {
    const result = tlispParser.parse(
      "(defmacro unless (condition &rest body) (list 'if (list 'not condition) (cons 'progn body)))",
      "test",
    );
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const node = result.right.children[0]!;
      expect(node.kind).toBe("function");
      expect(node.label).toBe("unless");
    }
  });

  test("parses defconst as variable with constant name", () => {
    const result = tlispParser.parse("(defconst PI 3.14)", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const node = result.right.children[0]!;
      expect(node.kind).toBe("variable");
      expect(node.label).toBe("PI");
    }
  });

  test("parses lambda as function node", () => {
    const result = tlispParser.parse("(lambda (x) (+ x 1))", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const node = result.right.children[0]!;
      expect(node.kind).toBe("function");
      expect(node.label).toBe("lambda");
      // First child should be the params node containing "x"
      expect(node.children.length).toBeGreaterThanOrEqual(1);
      const params = node.children[0]!;
      expect(params.kind).toBe("call");
      expect(params.children.length).toBe(1);
      expect(params.children[0]!.label).toBe("x");
    }
  });
});
