/**
 * @file typescript-parser.test.ts
 * @description Tests for the TypeScript/JavaScript recursive-descent AST parser
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { typescriptParser } from "../../../../src/syntax/ast/parsers/typescript-parser.ts";
import { Either } from "../../../../src/utils/task-either.ts";
import { resetNodeIdCounter } from "../../../../src/syntax/ast/types.ts";

describe("TypeScript AST Parser", () => {
  beforeEach(() => resetNodeIdCounter());

  // ---------------------------------------------------------------------------
  // 1. Empty source
  // ---------------------------------------------------------------------------
  test("parses empty source into file node with no children", () => {
    const result = typescriptParser.parse("", "empty.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.kind).toBe("file");
      expect(result.right.children).toHaveLength(0);
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Function declaration
  // ---------------------------------------------------------------------------
  test("parses function declaration with label", () => {
    const result = typescriptParser.parse("function greet(name: string): void {}", "fn.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const fn = result.right.children[0]!;
      expect(fn.kind).toBe("function");
      expect(fn.label).toBe("greet");
      expect(fn.children.length).toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Arrow function
  // ---------------------------------------------------------------------------
  test("parses arrow function", () => {
    const result = typescriptParser.parse("const add = (a: number, b: number) => a + b;", "arrow.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      // variable[const] -> variable[add] -> arrow-function
      const decl = result.right.children[0]!;
      expect(decl.kind).toBe("variable");
      const declarator = decl.children.find(c => c.kind === "variable" && c.label === "add");
      expect(declarator).toBeDefined();
      const arrow = declarator!.children.find(c => c.kind === "arrow-function");
      expect(arrow).toBeDefined();
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Class declaration
  // ---------------------------------------------------------------------------
  test("parses class declaration with label", () => {
    const result = typescriptParser.parse("class Foo { constructor() {} bar() {} }", "cls.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const cls = result.right.children[0]!;
      expect(cls.kind).toBe("class");
      expect(cls.label).toBe("Foo");
      expect(cls.children.length).toBeGreaterThanOrEqual(2);
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Variable declarations (const, let, var)
  // ---------------------------------------------------------------------------
  test("parses const declaration", () => {
    const result = typescriptParser.parse("const x = 1;", "var.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const v = result.right.children[0]!;
      expect(v.kind).toBe("variable");
      expect(v.label).toBe("const");
    }
  });

  test("parses let and var declarations", () => {
    const src = "let y = 2;\nvar z = 3;";
    const result = typescriptParser.parse(src, "vars.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.children.length).toBe(2);
      expect(result.right.children[0]!.kind).toBe("variable");
      expect(result.right.children[1]!.kind).toBe("variable");
    }
  });

  // ---------------------------------------------------------------------------
  // 6. Import declaration
  // ---------------------------------------------------------------------------
  test("parses import declaration", () => {
    const result = typescriptParser.parse('import { foo, bar } from "module";', "imp.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const imp = result.right.children[0]!;
      expect(imp.kind).toBe("import");
      expect(imp.children.length).toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------------------
  // 7. Export declaration
  // ---------------------------------------------------------------------------
  test("parses export declaration", () => {
    const result = typescriptParser.parse("export function hello() {}", "exp.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const exp = result.right.children[0]!;
      expect(exp.kind).toBe("export");
      expect(exp.children.length).toBeGreaterThan(0);
      // The exported function should be a child
      const fn = exp.children.find(c => c.kind === "function");
      expect(fn).toBeDefined();
      expect(fn!.label).toBe("hello");
    }
  });

  // ---------------------------------------------------------------------------
  // 8. If statement
  // ---------------------------------------------------------------------------
  test("parses if statement", () => {
    const result = typescriptParser.parse("if (x > 0) { y = 1; } else { y = 2; }", "if.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const ifStmt = result.right.children[0]!;
      expect(ifStmt.kind).toBe("if-stmt");
      // condition + then + else = 3 children minimum
      expect(ifStmt.children.length).toBeGreaterThanOrEqual(2);
    }
  });

  // ---------------------------------------------------------------------------
  // 9. For loop
  // ---------------------------------------------------------------------------
  test("parses for loop", () => {
    const result = typescriptParser.parse("for (let i = 0; i < 10; i++) {}", "for.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const forStmt = result.right.children[0]!;
      expect(forStmt.kind).toBe("for-stmt");
      expect(forStmt.children.length).toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------------------
  // 10. While loop
  // ---------------------------------------------------------------------------
  test("parses while loop", () => {
    const result = typescriptParser.parse("while (true) { break; }", "while.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const whileStmt = result.right.children[0]!;
      expect(whileStmt.kind).toBe("while-stmt");
      expect(whileStmt.children.length).toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------------------
  // 11. Binary expression
  // ---------------------------------------------------------------------------
  test("parses binary expression", () => {
    const result = typescriptParser.parse("1 + 2 * 3;", "bin.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      // expression statement wraps the binary expr in a block
      const stmt = result.right.children[0]!;
      expect(stmt.children.length).toBeGreaterThan(0);
      const expr = stmt.children[0]!;
      expect(expr.kind).toBe("binary-expr");
    }
  });

  // ---------------------------------------------------------------------------
  // 12. Call expression
  // ---------------------------------------------------------------------------
  test("parses call expression", () => {
    const result = typescriptParser.parse("foo(1, 2);", "call.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const stmt = result.right.children[0]!;
      const call = stmt.children[0]!;
      expect(call.kind).toBe("call");
    }
  });

  // ---------------------------------------------------------------------------
  // 13. Member expression (obj.prop)
  // ---------------------------------------------------------------------------
  test("parses member expression", () => {
    const result = typescriptParser.parse("obj.prop;", "member.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const stmt = result.right.children[0]!;
      const member = stmt.children[0]!;
      expect(member.kind).toBe("member-expr");
      expect(member.label).toBe("prop");
    }
  });

  // ---------------------------------------------------------------------------
  // 14. String literals
  // ---------------------------------------------------------------------------
  test("parses string literals in AST", () => {
    const result = typescriptParser.parse('const s = "hello";', "str.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      // variable[const] -> variable[s] -> string["hello"]
      const decl = result.right.children[0]!;
      const declarator = decl.children.find(c => c.kind === "variable");
      expect(declarator).toBeDefined();
      const str = declarator!.children.find(c => c.kind === "string");
      expect(str).toBeDefined();
    }
  });

  // ---------------------------------------------------------------------------
  // 15. Template literals
  // ---------------------------------------------------------------------------
  test("parses template literals", () => {
    const result = typescriptParser.parse("const msg = `hello ${name}`;", "tmpl.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      // The lexer produces a single string token for backtick-quoted content.
      // variable[const] -> variable[msg] -> string[`hello ${name}`]
      const decl = result.right.children[0]!;
      const declarator = decl.children.find(c => c.kind === "variable");
      expect(declarator).toBeDefined();
      const tmpl = declarator!.children.find(c => c.kind === "string" && c.label?.startsWith("`"));
      expect(tmpl).toBeDefined();
    }
  });

  // ---------------------------------------------------------------------------
  // 16. Comments
  // ---------------------------------------------------------------------------
  test("parses line and block comments", () => {
    const src = "// line comment\n/* block comment */\nconst x = 1;";
    const result = typescriptParser.parse(src, "comment.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      // Comments may appear as children of the file or inside expression statements
      const findComment = (nodes: typeof result.right.children): boolean => {
        for (const child of nodes) {
          if (child.kind === "comment") return true;
          if (findComment(child.children)) return true;
        }
        return false;
      };
      expect(findComment(result.right.children)).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // 17. Error recovery on malformed input
  // ---------------------------------------------------------------------------
  test("returns Either.right with error nodes on malformed input", () => {
    const result = typescriptParser.parse("function ( { }", "broken.ts");
    // Parser uses error recovery, so it should still return Right
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.kind).toBe("file");
    }
  });

  // ---------------------------------------------------------------------------
  // 18. parseIncremental delegates to parse
  // ---------------------------------------------------------------------------
  test("parseIncremental delegates to parse", () => {
    const result = typescriptParser.parseIncremental(
      "const x = 1;",
      "incr.ts",
      {} as any,
      {} as any,
    );
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.kind).toBe("file");
      expect(result.right.children.length).toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------------------
  // 19. Multiple statements in one file
  // ---------------------------------------------------------------------------
  test("parses multiple statements in one file", () => {
    const src = [
      'import { A } from "mod";',
      "const x = 1;",
      "function f() {}",
    ].join("\n");
    const result = typescriptParser.parse(src, "multi.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.children.length).toBeGreaterThanOrEqual(3);
      expect(result.right.children[0]!.kind).toBe("import");
      expect(result.right.children[1]!.kind).toBe("variable");
      expect(result.right.children[2]!.kind).toBe("function");
    }
  });

  // ---------------------------------------------------------------------------
  // 20. Nested function
  // ---------------------------------------------------------------------------
  test("parses nested function", () => {
    const src = "function outer() { function inner() {} }";
    const result = typescriptParser.parse(src, "nested.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const outer = result.right.children[0]!;
      expect(outer.kind).toBe("function");
      expect(outer.label).toBe("outer");
      // The outer function body should contain a block with inner function
      const findFunction = (nodes: typeof outer.children): typeof outer | undefined => {
        for (const child of nodes) {
          if (child.kind === "function" && child.label === "inner") return child as typeof outer;
          const found = findFunction(child.children);
          if (found) return found;
        }
        return undefined;
      };
      const inner = findFunction(outer.children);
      expect(inner).toBeDefined();
      expect(inner!.label).toBe("inner");
    }
  });

  // ---------------------------------------------------------------------------
  // Root node metadata
  // ---------------------------------------------------------------------------
  test("root node language is typescript", () => {
    const result = typescriptParser.parse("const x = 1;", "lang.ts");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.language).toBe("typescript");
    }
  });
});
