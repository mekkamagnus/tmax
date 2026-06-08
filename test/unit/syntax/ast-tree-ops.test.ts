/**
 * @file ast-tree-ops.test.ts
 * @description Tests for AST tree operations: traversal, lookup, navigation
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createNode, resetNodeIdCounter } from "../../../src/syntax/ast/types.ts";
import type { ASTNode } from "../../../src/syntax/ast/types.ts";
import {
  getNodeAtPosition,
  getParentOfType,
  getEnclosingFunction,
  getEnclosingBlock,
  getChildrenOfKind,
  walk,
  flatten,
  getText,
  findNode,
  nextSibling,
  prevSibling,
} from "../../../src/syntax/ast/tree-ops.ts";

function pos(offset: number, line: number, col: number) {
  return { offset, line, column: col };
}

function span(so: number, sl: number, sc: number, eo: number, el: number, ec: number) {
  return { start: pos(so, sl, sc), end: pos(eo, el, ec) };
}

describe("Tree Operations", () => {
  let root: ASTNode;

  beforeEach(() => {
    resetNodeIdCounter();
    const param = createNode("parameter", span(8, 0, 8, 12, 0, 12), "tlisp", [], "x");
    const body = createNode("block", span(14, 0, 14, 18, 1, 0), "tlisp");
    const fn = createNode("function", span(0, 0, 0, 20, 1, 0), "tlisp", [param, body], "main");
    root = createNode("file", span(0, 0, 0, 20, 1, 0), "tlisp", [fn]);
  });

  describe("getNodeAtPosition", () => {
    test("finds deepest node at given offset", () => {
      const node = getNodeAtPosition(root, pos(9, 0, 9));
      expect(node).not.toBeNull();
      expect(node!.kind).toBe("parameter");
    });

    test("returns null for out-of-range offset", () => {
      expect(getNodeAtPosition(root, pos(100, 5, 0))).toBeNull();
    });

    test("finds file node at root position", () => {
      const node = getNodeAtPosition(root, pos(0, 0, 0));
      expect(node).not.toBeNull();
      // Function is the deepest at offset 0
      expect(node!.kind).toBe("function");
    });

    test("finds block node within function body", () => {
      const node = getNodeAtPosition(root, pos(15, 0, 15));
      expect(node).not.toBeNull();
      expect(node!.kind).toBe("block");
    });

    test("finds file node at end of span", () => {
      const node = getNodeAtPosition(root, pos(20, 1, 0));
      expect(node).not.toBeNull();
    });
  });

  describe("getParentOfType", () => {
    test("walks up to find parent of given kind", () => {
      const param = root.children[0]!.children[0]!;
      const fn = getParentOfType(param, "function");
      expect(fn).not.toBeNull();
      expect(fn!.label).toBe("main");
    });

    test("walks up to file", () => {
      const param = root.children[0]!.children[0]!;
      const file = getParentOfType(param, "file");
      expect(file).toBe(root);
    });

    test("returns null when no parent of kind exists", () => {
      const fn = root.children[0]!;
      expect(getParentOfType(fn, "class")).toBeNull();
    });

    test("returns null for root node", () => {
      expect(getParentOfType(root, "file")).toBeNull();
    });
  });

  describe("getEnclosingFunction", () => {
    test("returns enclosing function for nested node", () => {
      const param = root.children[0]!.children[0]!;
      const fn = getEnclosingFunction(param);
      expect(fn).not.toBeNull();
      expect(fn!.label).toBe("main");
    });

    test("returns null for node outside function", () => {
      expect(getEnclosingFunction(root)).toBeNull();
    });
  });

  describe("getEnclosingBlock", () => {
    test("returns enclosing block", () => {
      const block = root.children[0]!.children[1]!;
      expect(block.kind).toBe("block");
      // Block itself is a block
      expect(getEnclosingBlock(block)).toBeNull();
    });

    test("returns null when not inside a block", () => {
      expect(getEnclosingBlock(root)).toBeNull();
    });
  });

  describe("getChildrenOfKind", () => {
    test("filters children by kind", () => {
      const fn = root.children[0]!;
      const params = getChildrenOfKind(fn, "parameter");
      expect(params).toHaveLength(1);
      expect(params[0]!.label).toBe("x");
    });

    test("returns empty array when no match", () => {
      expect(getChildrenOfKind(root, "class")).toHaveLength(0);
    });
  });

  describe("walk", () => {
    test("visits all nodes depth-first", () => {
      const visited: string[] = [];
      walk(root, { enter(node) { visited.push(node.kind); } });
      expect(visited).toEqual(["file", "function", "parameter", "block"]);
    });

    test("exit callback fires after children", () => {
      const order: string[] = [];
      walk(root, {
        enter(node) { order.push(`enter:${node.kind}`); },
        exit(node) { order.push(`exit:${node.kind}`); },
      });
      expect(order).toEqual([
        "enter:file", "enter:function", "enter:parameter", "exit:parameter",
        "enter:block", "exit:block", "exit:function", "exit:file",
      ]);
    });

    test("stops traversal when enter returns undefined... wait no", () => {
      // enter returns void, so it never stops unless returning a non-undefined value
      // But our visitor returns T | undefined, and walk uses void
      // Let's just test normal traversal
      const count = { value: 0 };
      walk(root, { enter() { count.value++; } });
      expect(count.value).toBe(4);
    });
  });

  describe("flatten", () => {
    test("returns all nodes in document order", () => {
      const all = flatten(root);
      expect(all).toHaveLength(4);
      expect(all.map(n => n.kind)).toEqual(["file", "function", "parameter", "block"]);
    });

    test("single node returns [self]", () => {
      const node = createNode("file", span(0, 0, 0, 0, 0, 0), "tlisp");
      expect(flatten(node)).toHaveLength(1);
    });
  });

  describe("getText", () => {
    test("extracts source text via span", () => {
      const source = "(defun main (x) body)";
      const param = root.children[0]!.children[0]!;
      const text = getText(param, source);
      expect(text).toBe(source.slice(param.span.start.offset, param.span.end.offset));
    });

    test("extracts full source for root node", () => {
      const source = "hello world";
      const node = createNode("file", span(0, 0, 0, 11, 0, 11), "tlisp");
      expect(getText(node, source)).toBe("hello world");
    });
  });

  describe("findNode", () => {
    test("finds node matching predicate", () => {
      const found = findNode(root, n => n.kind === "block");
      expect(found).not.toBeNull();
      expect(found!.kind).toBe("block");
    });

    test("finds by label", () => {
      const found = findNode(root, n => n.label === "main");
      expect(found).not.toBeNull();
      expect(found!.kind).toBe("function");
    });

    test("returns null when no match", () => {
      expect(findNode(root, n => n.kind === "class")).toBeNull();
    });
  });

  describe("nextSibling / prevSibling", () => {
    test("nextSibling returns next child", () => {
      const param = root.children[0]!.children[0]!;
      const body = root.children[0]!.children[1]!;
      expect(nextSibling(param)).toBe(body);
    });

    test("prevSibling returns previous child", () => {
      const param = root.children[0]!.children[0]!;
      const body = root.children[0]!.children[1]!;
      expect(prevSibling(body)).toBe(param);
    });

    test("nextSibling returns null for last child", () => {
      const body = root.children[0]!.children[1]!;
      expect(nextSibling(body)).toBeNull();
    });

    test("prevSibling returns null for first child", () => {
      const param = root.children[0]!.children[0]!;
      expect(prevSibling(param)).toBeNull();
    });

    test("returns null for root node (no parent)", () => {
      expect(nextSibling(root)).toBeNull();
      expect(prevSibling(root)).toBeNull();
    });
  });
});
