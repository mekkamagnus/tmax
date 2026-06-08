/**
 * @file ast-incremental.test.ts
 * @description Tests for incremental reparse: sourceHash, computeStaleRange, graftSubtree, cache ops
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createNode, resetNodeIdCounter } from "../../../src/syntax/ast/types.ts";
import type { EditDescriptor } from "../../../src/syntax/ast/types.ts";
import { sourceHash, computeStaleRange, graftSubtree, invalidate, evictCache } from "../../../src/syntax/ast/incremental.ts";
import type { ParseTreeCache } from "../../../src/syntax/ast/incremental.ts";

function pos(offset: number, line: number, col: number) {
  return { offset, line, column: col };
}

function span(so: number, sl: number, sc: number, eo: number, el: number, ec: number) {
  return { start: pos(so, sl, sc), end: pos(eo, el, ec) };
}

describe("Incremental Reparse", () => {
  beforeEach(() => resetNodeIdCounter());

  describe("sourceHash", () => {
    test("is deterministic", () => {
      expect(sourceHash("hello world")).toBe(sourceHash("hello world"));
    });

    test("differs for different inputs", () => {
      expect(sourceHash("hello")).not.toBe(sourceHash("world"));
    });

    test("returns number", () => {
      expect(typeof sourceHash("")).toBe("number");
    });

    test("handles empty string", () => {
      const h = sourceHash("");
      expect(typeof h).toBe("number");
    });

    test("handles long strings", () => {
      const long = "x".repeat(10000);
      const h = sourceHash(long);
      expect(typeof h).toBe("number");
      expect(h).toBe(sourceHash(long));
    });
  });

  describe("computeStaleRange", () => {
    test("finds smallest enclosing node for edit inside child", () => {
      const child = createNode("function", span(5, 0, 5, 15, 0, 15), "tlisp");
      const root = createNode("file", span(0, 0, 0, 20, 0, 20), "tlisp", [child]);

      const edit: EditDescriptor = { startOffset: 8, endOffset: 10, newText: "xx" };
      const stale = computeStaleRange(root, edit);
      expect(stale.start.offset).toBe(5);
      expect(stale.end.offset).toBe(15);
    });

    test("returns root span when edit is outside all children", () => {
      const root = createNode("file", span(0, 0, 0, 20, 0, 20), "tlisp");
      const edit: EditDescriptor = { startOffset: 10, endOffset: 12, newText: "x" };
      const stale = computeStaleRange(root, edit);
      expect(stale.start.offset).toBe(0);
      expect(stale.end.offset).toBe(20);
    });

    test("navigates to deeply nested child", () => {
      const inner = createNode("identifier", span(8, 0, 8, 12, 0, 12), "tlisp");
      const mid = createNode("block", span(5, 0, 5, 15, 0, 15), "tlisp", [inner]);
      const root = createNode("file", span(0, 0, 0, 20, 0, 20), "tlisp", [mid]);

      const edit: EditDescriptor = { startOffset: 9, endOffset: 11, newText: "y" };
      const stale = computeStaleRange(root, edit);
      expect(stale.start.offset).toBe(8);
      expect(stale.end.offset).toBe(12);
    });
  });

  describe("graftSubtree", () => {
    test("replaces child in parent", () => {
      const oldChild = createNode("function", span(5, 0, 5, 15, 0, 15), "tlisp", [], "old");
      const root = createNode("file", span(0, 0, 0, 15, 0, 15), "tlisp", [oldChild]);
      const newChild = createNode("function", span(5, 0, 5, 20, 0, 20), "tlisp", [], "new");

      graftSubtree(root, oldChild, newChild);
      expect(root.children[0]).toBe(newChild);
      expect(newChild.parent).toBe(root);
      expect(oldChild.parent).toBeNull();
    });

    test("no-op if oldChild not found", () => {
      const child = createNode("function", span(5, 0, 5, 15, 0, 15), "tlisp");
      const root = createNode("file", span(0, 0, 0, 20, 0, 20), "tlisp", [child]);
      const orphan = createNode("function", span(0, 0, 0, 5, 0, 5), "tlisp");
      const replacement = createNode("function", span(0, 0, 0, 5, 0, 5), "tlisp");

      graftSubtree(root, orphan, replacement);
      expect(root.children[0]).toBe(child);
    });
  });

  describe("invalidate", () => {
    test("marks cache entry as stale", () => {
      const cache: ParseTreeCache = new Map();
      cache.set("test", { tree: createNode("file", span(0, 0, 0, 0, 0, 0), "tlisp"), sourceHash: 12345 });

      invalidate(cache, "test", { startOffset: 0, endOffset: 1, newText: "x" });
      expect(cache.get("test")!.sourceHash).toBe(-1);
    });

    test("no-op for missing buffer", () => {
      const cache: ParseTreeCache = new Map();
      invalidate(cache, "nonexistent", { startOffset: 0, endOffset: 1, newText: "x" });
      expect(cache.has("nonexistent")).toBe(false);
    });
  });

  describe("evictCache", () => {
    test("removes cache entry", () => {
      const cache: ParseTreeCache = new Map();
      cache.set("test", { tree: createNode("file", span(0, 0, 0, 0, 0, 0), "tlisp"), sourceHash: 12345 });

      evictCache(cache, "test");
      expect(cache.has("test")).toBe(false);
    });

    test("no-op for missing buffer", () => {
      const cache: ParseTreeCache = new Map();
      evictCache(cache, "nonexistent");
      expect(cache.size).toBe(0);
    });
  });
});
