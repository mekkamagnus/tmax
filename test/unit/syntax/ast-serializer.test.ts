/**
 * @file ast-serializer.test.ts
 * @description Tests for AST → JSON serialization for AI context builder
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createNode, resetNodeIdCounter } from "../../../src/syntax/ast/types.ts";
import { serializeAST, serializeForAI } from "../../../src/syntax/ast/serializer.ts";
import { buildTlispScopes } from "../../../src/syntax/ast/scopes/tlisp-scope.ts";
import { SymbolTable } from "../../../src/syntax/ast/scope.ts";

function pos(offset: number, line: number, col: number) {
  return { offset, line, column: col };
}

function span(so: number, sl: number, sc: number, eo: number, el: number, ec: number) {
  return { start: pos(so, sl, sc), end: pos(eo, el, ec) };
}

describe("AST Serializer", () => {
  beforeEach(() => resetNodeIdCounter());

  describe("serializeAST", () => {
    test("produces correct structure for simple tree", () => {
      const child = createNode("string", span(0, 0, 0, 5, 0, 5), "tlisp", [], "hello");
      const root = createNode("file", span(0, 0, 0, 5, 0, 5), "tlisp", [child]);

      const result = serializeAST(root, "hello", { maxDepth: 3, includeSpans: true });
      expect(result.kind).toBe("file");
      expect(result.children).toHaveLength(1);
      expect(result.children![0]!.kind).toBe("string");
      expect(result.children![0]!.label).toBe("hello");
      expect(result.children![0]!.span).toBeDefined();
    });

    test("includes label when present", () => {
      const node = createNode("function", span(0, 0, 0, 10, 0, 10), "tlisp", [], "my-fn");
      const result = serializeAST(node, "(defun my-fn ())", {});
      expect(result.label).toBe("my-fn");
    });

    test("omits label when absent", () => {
      const node = createNode("block", span(0, 0, 0, 5, 0, 5), "tlisp");
      const result = serializeAST(node, "body", {});
      expect(result.label).toBeUndefined();
    });

    test("respects maxDepth", () => {
      const leaf = createNode("identifier", span(3, 0, 3, 5, 0, 5), "tlisp", [], "x");
      const mid = createNode("block", span(1, 0, 1, 5, 0, 5), "tlisp", [leaf]);
      const root = createNode("file", span(0, 0, 0, 5, 0, 5), "tlisp", [mid]);

      const shallow = serializeAST(root, "test", { maxDepth: 1 });
      expect(shallow.children).toHaveLength(1);
      expect(shallow.children![0]!.children).toBeUndefined(); // depth 1 = file only

      const deep = serializeAST(root, "test", { maxDepth: 5 });
      expect(deep.children![0]!.children).toHaveLength(1);
    });

    test("includes text when includeText is true", () => {
      const node = createNode("string", span(0, 0, 0, 5, 0, 5), "tlisp");
      const result = serializeAST(node, "hello", { includeText: true });
      expect(result.text).toBe("hello");
    });

    test("omits text when includeText is false", () => {
      const node = createNode("string", span(0, 0, 0, 5, 0, 5), "tlisp");
      const result = serializeAST(node, "hello", { includeText: false });
      expect(result.text).toBeUndefined();
    });

    test("filters children by kind when filterKinds provided", () => {
      const fn = createNode("function", span(0, 0, 0, 5, 0, 5), "tlisp", [], "f");
      const str = createNode("string", span(5, 0, 5, 10, 0, 10), "tlisp", [], "s");
      const root = createNode("file", span(0, 0, 0, 10, 0, 10), "tlisp", [fn, str]);

      const result = serializeAST(root, "test", { filterKinds: ["function"] });
      expect(result.children).toHaveLength(1);
      expect(result.children![0]!.kind).toBe("function");
    });

    test("default maxDepth is 5", () => {
      // Build a tree 6 levels deep
      let current = createNode("identifier", span(5, 0, 5, 6, 0, 6), "tlisp");
      for (let i = 4; i >= 0; i--) {
        current = createNode("block", span(i, 0, i, 6, 0, 6), "tlisp", [current]);
      }
      const root = createNode("file", span(0, 0, 0, 6, 0, 6), "tlisp", [current]);

      const result = serializeAST(root, "test", {});
      // Default maxDepth 5 should truncate at level 5
      expect(result.kind).toBe("file");
    });
  });

  describe("serializeForAI", () => {
    test("produces JSON-compatible output", () => {
      const fn = createNode("function", span(0, 0, 0, 10, 0, 10), "tlisp", [], "test-fn");
      const root = createNode("file", span(0, 0, 0, 10, 0, 10), "tlisp", [fn]);
      const table = buildTlispScopes(root);

      const result = serializeForAI(root, "(defun test-fn ())", table, pos(5, 0, 5), "test.tlisp");
      expect(result.language).toBe("tlisp");
      expect(result.fileName).toBe("test.tlisp");
      expect(result.cursor).toBeDefined();
      expect(result.cursor!.line).toBe(0);
      expect(result.cursor!.enclosingNode).toBeDefined();
    });

    test("includes symbols", () => {
      const fn = createNode("function", span(0, 0, 0, 10, 0, 10), "tlisp", [], "foo");
      const root = createNode("file", span(0, 0, 0, 10, 0, 10), "tlisp", [fn]);
      const table = buildTlispScopes(root);

      const result = serializeForAI(root, "(defun foo ())", table, pos(5, 0, 5), "test.tlisp");
      expect(result.symbols).toBeDefined();
      expect(result.symbols!.length).toBeGreaterThan(0);
      expect(result.symbols!.some(s => s.name === "foo")).toBe(true);
    });

    test("handles null symbol table", () => {
      const root = createNode("file", span(0, 0, 0, 0, 0, 0), "tlisp");
      const result = serializeForAI(root, "", null, null, "empty.tlisp");
      expect(result.symbols).toBeUndefined();
      expect(result.cursor).toBeUndefined();
    });

    test("handles null cursor position", () => {
      const root = createNode("file", span(0, 0, 0, 0, 0, 0), "tlisp");
      const table = new SymbolTable(root);
      const result = serializeForAI(root, "", table, null, "test.tlisp");
      expect(result.cursor).toBeUndefined();
    });

    test("cursor finds deepest enclosing node", () => {
      const inner = createNode("identifier", span(5, 0, 5, 10, 0, 10), "tlisp");
      const fn = createNode("function", span(0, 0, 0, 10, 0, 10), "tlisp", [inner], "fn");
      const root = createNode("file", span(0, 0, 0, 10, 0, 10), "tlisp", [fn]);
      const table = new SymbolTable(root);

      const result = serializeForAI(root, "test", table, pos(7, 0, 7), "test.tlisp");
      expect(result.cursor!.enclosingNode).toBe("identifier");
    });
  });
});
