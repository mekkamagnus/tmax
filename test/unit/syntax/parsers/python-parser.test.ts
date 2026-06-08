/**
 * @file python-parser.test.ts
 * @description Tests for the Python AST parser: functions, classes, control flow,
 *   imports, assignments, decorators, literals, comments, and error recovery.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { pythonParser } from "../../../../src/syntax/ast/parsers/python-parser.ts";
import { Either } from "../../../../src/utils/task-either.ts";
import { resetNodeIdCounter } from "../../../../src/syntax/ast/types.ts";

const unwrap = (result: ReturnType<typeof pythonParser.parse>) => {
  expect(Either.isRight(result)).toBe(true);
  return Either.isRight(result) ? result.right : (undefined as never);
};

describe("Python AST Parser", () => {
  beforeEach(() => resetNodeIdCounter());

  test("empty source produces a file node", () => {
    const root = unwrap(pythonParser.parse("", "empty.py"));
    expect(root.kind).toBe("file");
    expect(root.label).toBe("empty.py");
    expect(root.language).toBe("python");
    expect(root.children).toHaveLength(0);
  });

  test("def produces a function node with the function name", () => {
    const root = unwrap(pythonParser.parse("def greet():\n    pass\n", "test.py"));
    const fn = root.children[0]!;
    expect(fn.kind).toBe("function");
    expect(fn.label).toBe("greet");
  });

  test("def with parameters", () => {
    const root = unwrap(pythonParser.parse("def add(a, b):\n    pass\n", "test.py"));
    const fn = root.children[0]!;
    expect(fn.kind).toBe("function");
    expect(fn.label).toBe("add");
    // First child is the params block
    const params = fn.children[0]!;
    expect(params.kind).toBe("block");
    expect(params.label).toBe("params");
    expect(params.children.length).toBeGreaterThanOrEqual(2);
  });

  test("class produces a class node with the class name", () => {
    const root = unwrap(pythonParser.parse("class Foo:\n    pass\n", "test.py"));
    const cls = root.children[0]!;
    expect(cls.kind).toBe("class");
    expect(cls.label).toBe("Foo");
  });

  test("if / elif / else chain", () => {
    const src = [
      "if x > 0:",
      "    pass",
      "elif x < 0:",
      "    pass",
      "else:",
      "    pass",
    ].join("\n");
    const root = unwrap(pythonParser.parse(src, "test.py"));
    const ifStmt = root.children[0]!;
    expect(ifStmt.kind).toBe("if-stmt");
    // Children: condition, block, elif (if-stmt), else (block)
    expect(ifStmt.children.length).toBeGreaterThanOrEqual(3);
  });

  test("for loop", () => {
    const root = unwrap(pythonParser.parse("for i in range(10):\n    pass\n", "test.py"));
    const forStmt = root.children[0]!;
    expect(forStmt.kind).toBe("for-stmt");
    expect(forStmt.children.length).toBeGreaterThanOrEqual(2);
  });

  test("while loop", () => {
    const root = unwrap(pythonParser.parse("while True:\n    break\n", "test.py"));
    const whileStmt = root.children[0]!;
    expect(whileStmt.kind).toBe("while-stmt");
    expect(whileStmt.children.length).toBeGreaterThanOrEqual(1);
  });

  test("import statement", () => {
    const root = unwrap(pythonParser.parse("import os\n", "test.py"));
    const imp = root.children[0]!;
    expect(imp.kind).toBe("import");
  });

  test("from...import statement", () => {
    const root = unwrap(pythonParser.parse("from os.path import join\n", "test.py"));
    const imp = root.children[0]!;
    expect(imp.kind).toBe("import");
    expect(imp.children.length).toBeGreaterThanOrEqual(2);
  });

  test("assignment", () => {
    const root = unwrap(pythonParser.parse("x = 42\n", "test.py"));
    const assign = root.children[0]!;
    expect(assign.kind).toBe("assignment");
  });

  test("decorators before def", () => {
    const src = ["@staticmethod", "def foo():", "    pass"].join("\n");
    const root = unwrap(pythonParser.parse(src, "test.py"));
    const fn = root.children[0]!;
    expect(fn.kind).toBe("function");
    // Decorators are merged as leading children of the function node
    const hasDecorator = fn.children.some((c) => c.kind === "decorator");
    expect(hasDecorator).toBe(true);
  });

  test("string literals", () => {
    const root = unwrap(pythonParser.parse('x = "hello"\n', "test.py"));
    const assign = root.children[0]!;
    expect(assign.kind).toBe("assignment");
    // RHS should contain a string node
    const hasString = assign.children.some(
      (c) => c.kind === "string" || c.children?.some((cc) => cc.kind === "string"),
    );
    expect(hasString).toBe(true);
  });

  test("comments are parsed", () => {
    const root = unwrap(pythonParser.parse("# this is a comment\n", "test.py"));
    expect(root.children.length).toBeGreaterThanOrEqual(1);
    const comment = root.children[0]!;
    expect(comment.kind).toBe("comment");
  });

  test("multiple top-level statements", () => {
    const src = ["x = 1", "y = 2", "def f():", "    pass"].join("\n");
    const root = unwrap(pythonParser.parse(src, "test.py"));
    // Two assignments + one function
    expect(root.children.length).toBe(3);
  });

  test("error recovery on malformed input", () => {
    // Missing class name — parser recovers via expect() and keeps going
    const root = unwrap(pythonParser.parse("class\n", "broken.py"));
    expect(root.kind).toBe("file");
    expect(root.children.length).toBeGreaterThanOrEqual(1);
  });

  test("parseIncremental delegates to full parse", () => {
    const result = pythonParser.parseIncremental("x = 1\n", "test.py", {} as any, {} as any);
    const root = unwrap(result);
    expect(root.kind).toBe("file");
  });
});
