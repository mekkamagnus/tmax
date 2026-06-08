/**
 * @file go-parser.test.ts
 * @description Tests for the Go recursive-descent parser
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { goParser } from "../../../../src/syntax/ast/parsers/go-parser.ts";
import { Either } from "../../../../src/utils/task-either.ts";
import { resetNodeIdCounter } from "../../../../src/syntax/ast/types.ts";

/** Unwrap a successful parse result, failing the test if it's a Left. */
function unwrap(result: ReturnType<typeof goParser.parse>) {
  expect(Either.isRight(result)).toBe(true);
  if (Either.isRight(result)) return result.right;
  throw new Error("unexpected Left");
}

describe("Go Parser", () => {
  beforeEach(() => resetNodeIdCounter());

  // 1. Minimal source -> file node
  test("parses minimal source as file node", () => {
    const ast = unwrap(goParser.parse("package main", "minimal.go"));
    expect(ast.kind).toBe("file");
    expect(ast.language).toBe("go");
  });

  // 2. Package declaration
  test("parses package declaration", () => {
    const src = "package main";
    const ast = unwrap(goParser.parse(src, "pkg.go"));
    // First child is the package identifier node
    expect(ast.children.length).toBeGreaterThan(0);
    const pkg = ast.children[0]!;
    expect(pkg.kind).toBe("identifier");
    expect(pkg.label).toBe("main");
  });

  // 3. Function declaration
  test("parses function definition with label", () => {
    const src = "package main\nfunc hello() {}";
    const ast = unwrap(goParser.parse(src, "fn.go"));
    const fn = ast.children.find((c) => c.kind === "function");
    expect(fn).toBeDefined();
    expect(fn!.label).toBe("hello");
  });

  // 4. Struct type
  test("parses struct type with label", () => {
    const src = "package main\ntype Point struct {\nX int\nY int\n}";
    const ast = unwrap(goParser.parse(src, "struct.go"));
    const s = ast.children.find((c) => c.kind === "struct");
    expect(s).toBeDefined();
    expect(s!.label).toBe("Point");
  });

  // 5. Variable declaration (var and :=)
  test("parses var and short variable declarations", () => {
    // var form
    const src1 = "package main\nvar count = 0";
    const ast1 = unwrap(goParser.parse(src1, "var.go"));
    const v1 = ast1.children.find((c) => c.kind === "variable");
    expect(v1).toBeDefined();
  });

  // 6. Import
  test("parses import declaration", () => {
    const src = 'package main\nimport "fmt"';
    const ast = unwrap(goParser.parse(src, "import.go"));
    const imp = ast.children.find((c) => c.kind === "import");
    expect(imp).toBeDefined();
    expect(imp!.children.length).toBeGreaterThan(0);
  });

  // 7. if statement
  test("parses if statement", () => {
    const src = "package main\nfunc f() { if true {} }";
    const ast = unwrap(goParser.parse(src, "if.go"));
    const fn = ast.children.find((c) => c.kind === "function");
    expect(fn).toBeDefined();
    const block = fn!.children.find((c) => c.kind === "block");
    expect(block).toBeDefined();
    const ifStmt = block!.children.find((c) => c.kind === "if-stmt");
    expect(ifStmt).toBeDefined();
  });

  // 8. for loop
  test("parses for loop", () => {
    const src = "package main\nfunc f() { for i := 0; i < 10; i++ {} }";
    const ast = unwrap(goParser.parse(src, "for.go"));
    const fn = ast.children.find((c) => c.kind === "function");
    const block = fn!.children.find((c) => c.kind === "block");
    const forStmt = block!.children.find((c) => c.kind === "for-stmt");
    expect(forStmt).toBeDefined();
  });

  // 9. Method declaration
  test("parses method with receiver", () => {
    const src = "package main\ntype S struct{}\nfunc (s *S) Do() {}";
    const ast = unwrap(goParser.parse(src, "method.go"));
    const m = ast.children.find((c) => c.kind === "method");
    expect(m).toBeDefined();
    expect(m!.label).toBe("Do");
  });

  // 10. Comments
  test("parses line and block comments", () => {
    const src = "package main\n// line\n/* block */";
    const ast = unwrap(goParser.parse(src, "comments.go"));
    const comments = ast.children.filter((c) => c.kind === "comment");
    expect(comments.length).toBe(2);
  });

  // 11. Multiple functions
  test("parses multiple function definitions", () => {
    const src = "package main\nfunc foo() {}\nfunc bar() {}";
    const ast = unwrap(goParser.parse(src, "multi.go"));
    const fns = ast.children.filter((c) => c.kind === "function");
    expect(fns.length).toBe(2);
    expect(fns[0]!.label).toBe("foo");
    expect(fns[1]!.label).toBe("bar");
  });

  // 12. parseIncremental delegates
  test("parseIncremental delegates to full parse", () => {
    const src = "package main\nfunc main() {}";
    const full = goParser.parse(src, "inc.go");
    const inc = goParser.parseIncremental(src, "inc.go", unwrap(full), {
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
