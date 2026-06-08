/**
 * @file ast-types.test.ts
 * @description Tests for AST core types: createNode, resetNodeIdCounter, type definitions
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createNode, resetNodeIdCounter } from "../../../src/syntax/ast/types.ts";
import type { ASTNode, EditDescriptor, LanguageParser } from "../../../src/syntax/ast/types.ts";

function pos(offset: number, line: number, col: number) {
  return { offset, line, column: col };
}

function span(so: number, sl: number, sc: number, eo: number, el: number, ec: number) {
  return { start: pos(so, sl, sc), end: pos(eo, el, ec) };
}

describe("AST Core Types", () => {
  beforeEach(() => resetNodeIdCounter());

  describe("createNode", () => {
    test("assigns sequential IDs", () => {
      const a = createNode("file", span(0, 0, 0, 10, 0, 10), "tlisp");
      const b = createNode("function", span(0, 0, 0, 5, 0, 5), "tlisp");
      expect(a.id).toBeLessThan(b.id);
      expect(a.id).toBe(0);
      expect(b.id).toBe(1);
    });

    test("sets kind and language", () => {
      const node = createNode("function", span(0, 0, 0, 10, 0, 10), "typescript");
      expect(node.kind).toBe("function");
      expect(node.language).toBe("typescript");
    });

    test("stores span", () => {
      const s = span(5, 1, 0, 15, 3, 5);
      const node = createNode("block", s, "c");
      expect(node.span).toBe(s);
    });

    test("stores label when provided", () => {
      const node = createNode("function", span(0, 0, 0, 10, 0, 10), "tlisp", [], "my-fn");
      expect(node.label).toBe("my-fn");
    });

    test("label is undefined when not provided", () => {
      const node = createNode("block", span(0, 0, 0, 10, 0, 10), "tlisp");
      expect(node.label).toBeUndefined();
    });

    test("sets parent links on children", () => {
      const child = createNode("identifier", span(0, 0, 0, 3, 0, 3), "tlisp", [], "foo");
      const parent = createNode("call", span(0, 0, 0, 5, 0, 5), "tlisp", [child]);
      expect(child.parent).toBe(parent);
      expect(parent.children).toContain(child);
    });

    test("parent is null for root nodes", () => {
      const node = createNode("file", span(0, 0, 0, 10, 0, 10), "tlisp");
      expect(node.parent).toBeNull();
    });

    test("children default to empty array", () => {
      const node = createNode("file", span(0, 0, 0, 10, 0, 10), "tlisp");
      expect(node.children).toEqual([]);
    });

    test("sets parent on multiple children", () => {
      const c1 = createNode("string", span(0, 0, 0, 1, 0, 1), "tlisp", [], "a");
      const c2 = createNode("string", span(2, 0, 2, 3, 0, 3), "tlisp", [], "b");
      const c3 = createNode("string", span(4, 0, 4, 5, 0, 5), "tlisp", [], "c");
      const parent = createNode("call", span(0, 0, 0, 5, 0, 5), "tlisp", [c1, c2, c3]);
      expect(c1.parent).toBe(parent);
      expect(c2.parent).toBe(parent);
      expect(c3.parent).toBe(parent);
      expect(parent.children).toHaveLength(3);
    });
  });

  describe("resetNodeIdCounter", () => {
    test("resets counter to 0", () => {
      createNode("file", span(0, 0, 0, 10, 0, 10), "tlisp");
      createNode("file", span(0, 0, 0, 10, 0, 10), "tlisp");
      resetNodeIdCounter();
      const node = createNode("file", span(0, 0, 0, 10, 0, 10), "tlisp");
      expect(node.id).toBe(0);
    });
  });

  describe("EditDescriptor", () => {
    test("can construct an edit descriptor", () => {
      const edit: EditDescriptor = { startOffset: 5, endOffset: 10, newText: "hello" };
      expect(edit.startOffset).toBe(5);
      expect(edit.endOffset).toBe(10);
      expect(edit.newText).toBe("hello");
    });
  });

  describe("ASTNode interface compliance", () => {
    test("node has all required fields", () => {
      const node = createNode("function", span(0, 0, 0, 10, 0, 10), "tlisp", [], "test");
      expect(node).toHaveProperty("id");
      expect(node).toHaveProperty("kind");
      expect(node).toHaveProperty("span");
      expect(node).toHaveProperty("children");
      expect(node).toHaveProperty("parent");
      expect(node).toHaveProperty("language");
      expect(node).toHaveProperty("label");
    });
  });
});
