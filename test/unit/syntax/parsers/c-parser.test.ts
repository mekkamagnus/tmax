/**
 * @file c-parser.test.ts
 * @description Tests for the C recursive-descent parser
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { cParser } from "../../../../src/syntax/ast/parsers/c-parser.ts";
import { Either } from "../../../../src/utils/task-either.ts";
import { resetNodeIdCounter } from "../../../../src/syntax/ast/types.ts";

/** Unwrap a successful parse result, failing the test if it's a Left. */
function unwrap(result: ReturnType<typeof cParser.parse>) {
  expect(Either.isRight(result)).toBe(true);
  if (Either.isRight(result)) return result.right;
  throw new Error("unexpected Left");
}

describe("C Parser", () => {
  beforeEach(() => resetNodeIdCounter());

  // 1. Empty source -> file node
  test("parses empty source as file node", () => {
    const ast = unwrap(cParser.parse("", "empty.c"));
    expect(ast.kind).toBe("file");
    expect(ast.children).toHaveLength(0);
    expect(ast.language).toBe("c");
  });

  // 2. Function declaration
  test("parses function definition with label", () => {
    const src = "int main() { return 0; }";
    const ast = unwrap(cParser.parse(src, "main.c"));
    expect(ast.children.length).toBeGreaterThan(0);
    const fn = ast.children.find((c) => c.kind === "function");
    expect(fn).toBeDefined();
    expect(fn!.label).toBe("main");
  });

  // 3. Struct
  test("parses struct definition with label", () => {
    const src = "struct Point { int x; int y; };";
    const ast = unwrap(cParser.parse(src, "struct.c"));
    const s = ast.children.find((c) => c.kind === "struct");
    expect(s).toBeDefined();
    expect(s!.label).toBe("Point");
  });

  // 4. Variable declaration
  test("parses variable declaration", () => {
    const src = "int count = 0;";
    const ast = unwrap(cParser.parse(src, "var.c"));
    const v = ast.children.find((c) => c.kind === "variable");
    expect(v).toBeDefined();
    expect(v!.label).toBe("count");
  });

  // 5. if/else
  test("parses if/else statement", () => {
    const src = "int f() { if (1) { return 1; } else { return 0; } }";
    const ast = unwrap(cParser.parse(src, "ifelse.c"));
    const fn = ast.children.find((c) => c.kind === "function");
    expect(fn).toBeDefined();
    const block = fn!.children.find((c) => c.kind === "block");
    expect(block).toBeDefined();
    const ifStmt = block!.children.find((c) => c.kind === "if-stmt");
    expect(ifStmt).toBeDefined();
    expect(ifStmt!.children.length).toBeGreaterThanOrEqual(2);
  });

  // 6. for loop
  test("parses for loop", () => {
    const src = "void f() { for (int i = 0; i < 10; i++) {} }";
    const ast = unwrap(cParser.parse(src, "for.c"));
    const fn = ast.children.find((c) => c.kind === "function");
    const block = fn!.children.find((c) => c.kind === "block");
    const forStmt = block!.children.find((c) => c.kind === "for-stmt");
    expect(forStmt).toBeDefined();
  });

  // 7. while loop
  test("parses while loop", () => {
    const src = "void f() { while (1) {} }";
    const ast = unwrap(cParser.parse(src, "while.c"));
    const fn = ast.children.find((c) => c.kind === "function");
    const block = fn!.children.find((c) => c.kind === "block");
    const whileStmt = block!.children.find((c) => c.kind === "while-stmt");
    expect(whileStmt).toBeDefined();
  });

  // 8. Preprocessor directives
  test("parses preprocessor directives", () => {
    const src = '#include <stdio.h>\n#define MAX 100';
    const ast = unwrap(cParser.parse(src, "preproc.c"));
    const pp = ast.children.filter((c) => c.kind === "preprocessor");
    expect(pp.length).toBe(2);
  });

  // 9. Comments
  test("parses line and block comments", () => {
    const src = "// line comment\n/* block comment */";
    const ast = unwrap(cParser.parse(src, "comments.c"));
    const comments = ast.children.filter((c) => c.kind === "comment");
    expect(comments.length).toBe(2);
  });

  // 10. Multiple functions
  test("parses multiple function definitions", () => {
    const src = "void foo() {}\nint bar() { return 1; }";
    const ast = unwrap(cParser.parse(src, "multi.c"));
    const fns = ast.children.filter((c) => c.kind === "function");
    expect(fns.length).toBe(2);
    expect(fns[0]!.label).toBe("foo");
    expect(fns[1]!.label).toBe("bar");
  });

  // 11. Error recovery on malformed input
  test("recovers from malformed input", () => {
    const src = "@@@@ int x;";
    const result = cParser.parse(src, "bad.c");
    // Parser should still produce a result (Right), not throw
    expect(Either.isRight(result)).toBe(true);
  });

  // 12. parseIncremental delegates
  test("parseIncremental delegates to full parse", () => {
    const src = "int main() {}";
    const full = cParser.parse(src, "inc.c");
    const inc = cParser.parseIncremental(src, "inc.c", unwrap(full), {
      startOffset: 0,
      endOffset: 0,
      newText: "",
    });
    expect(Either.isRight(inc)).toBe(true);
    if (Either.isRight(inc)) {
      expect(inc.right.kind).toBe("file");
    }
  });
});
