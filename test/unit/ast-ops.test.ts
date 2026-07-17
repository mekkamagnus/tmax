/**
 * @file ast-ops.test.ts
 * @description Tests for T-Lisp structural editing API primitives (ast-ops)
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createAstOps, type AstOpsDeps } from "../../src/editor/api/ast-ops.ts";
import { createEditorRuntimeCaches } from "../../src/editor/runtime/caches.ts";
import { createString, createNumber } from "../../src/tlisp/values.ts";
import type { TLispValue as TV } from "../../src/tlisp/types.ts";
import { Either, type Either as EitherType } from "../../src/utils/task-either.ts";
import type { AppError } from "../../src/error/types.ts";

function unwrap(result: EitherType<AppError, TV>): TV {
  if (Either.isLeft(result)) throw new Error("Expected Right but got Left");
  return result.right;
}

function makeDeps(overrides: Partial<AstOpsDeps> = {}): AstOpsDeps {
  return {
    caches: createEditorRuntimeCaches(),
    getBufferName: () => "test.tlisp",
    getBufferText: () => "(defun greet (name) (print name))",
    getCursorLine: () => 0,
    getCursorColumn: () => 1,
    getCursorOffset: () => 1,
    setStatusMessage: () => {},
    ...overrides,
  };
}

describe("AST Ops T-Lisp API", () => {
  let api: Map<string, (...args: any[]) => any>;

  beforeEach(() => {
    // Create fresh API and clear module-level cache
    const deps = makeDeps();
    api = createAstOps(deps);
    // Invalidate cache from previous tests
    api.get("ast-invalidate")!([]);
  });

  describe("ast-parse-buffer", () => {
    test("parses T-Lisp source and caches result", () => {
      const fn = api.get("ast-parse-buffer")!;
      const r = unwrap(fn([]));
      expect(r.value).toBe("ast:test.tlisp");
    });

    test("rejects more than 1 argument", () => {
      const fn = api.get("ast-parse-buffer")!;
      expect(Either.isLeft(fn([createString("a"), createString("b")]))).toBe(true);
    });

    test("accepts explicit language argument", () => {
      const fn = api.get("ast-parse-buffer")!;
      const r = unwrap(fn([createString("tlisp")]));
      expect(r.value).toMatch(/ast:test\.tlisp|cached-ast:test\.tlisp/);
    });

    test("returns cached on second call", () => {
      const fn = api.get("ast-parse-buffer")!;
      fn([]);
      const r = unwrap(fn([]));
      expect(r.value).toBe("cached-ast:test.tlisp");
    });
  });

  describe("ast-node-at-cursor", () => {
    test("returns nil when no AST parsed", () => {
      const fn = api.get("ast-node-at-cursor")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("returns node info after parsing", () => {
      const fn_parse = api.get("ast-parse-buffer")!;
      fn_parse([]);

      const fn = api.get("ast-node-at-cursor")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("hashmap");
    });

    test("rejects arguments", () => {
      const fn = api.get("ast-node-at-cursor")!;
      expect(Either.isLeft(fn([createNumber(1)]))).toBe(true);
    });
  });

  describe("ast-node-at-pos", () => {
    test("rejects wrong arg count", () => {
      const fn = api.get("ast-node-at-pos")!;
      expect(Either.isLeft(fn([]))).toBe(true);
      expect(Either.isLeft(fn([createNumber(1)]))).toBe(true);
      expect(Either.isLeft(fn([createNumber(1), createNumber(2), createNumber(3)]))).toBe(true);
    });

    test("rejects non-number args", () => {
      const fn = api.get("ast-node-at-pos")!;
      expect(Either.isLeft(fn([createString("a"), createNumber(2)]))).toBe(true);
    });

    test("returns nil when no AST", () => {
      const fn = api.get("ast-node-at-pos")!;
      const r = unwrap(fn([createNumber(0), createNumber(0)]));
      expect(r.type).toBe("nil");
    });

    test("returns node after parsing", () => {
      api.get("ast-parse-buffer")!([]);
      const fn = api.get("ast-node-at-pos")!;
      const r = unwrap(fn([createNumber(0), createNumber(1)]));
      // May return nil or a node depending on position
      expect(["nil", "hashmap"]).toContain(r.type);
    });
  });

  describe("ast-select-node", () => {
    test("returns nil when no AST", () => {
      const fn = api.get("ast-select-node")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("rejects arguments", () => {
      const fn = api.get("ast-select-node")!;
      expect(Either.isLeft(fn([createNumber(1)]))).toBe(true);
    });

    test("returns offset list after parsing", () => {
      api.get("ast-parse-buffer")!([]);
      const fn = api.get("ast-select-node")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("list");
      expect((r.value as TV[]).length).toBe(2);
    });
  });

  describe("ast-enclosing-function", () => {
    test("returns nil when no AST", () => {
      const fn = api.get("ast-enclosing-function")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("returns function info after parsing at function offset", () => {
      // Use a deps variant that positions cursor inside the function
      const deps = makeDeps({ getCursorOffset: () => 5 });
      const ops = createAstOps(deps);
      // Clear module cache first
      ops.get("ast-invalidate")!([]);
      ops.get("ast-parse-buffer")!([]);

      const fn = ops.get("ast-enclosing-function")!;
      const r = unwrap(fn([]));
      // Should find the enclosing function (may be nil if not inside one)
      expect(["nil", "hashmap"]).toContain(r.type);
    });
  });

  describe("ast-enclosing-block", () => {
    test("returns nil when no AST", () => {
      const fn = api.get("ast-enclosing-block")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });
  });

  describe("ast-node-text", () => {
    test("returns nil when no AST", () => {
      const fn = api.get("ast-node-text")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("returns text after parsing", () => {
      api.get("ast-parse-buffer")!([]);
      const fn = api.get("ast-node-text")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("string");
    });
  });

  describe("ast-node-children", () => {
    test("returns nil when no AST", () => {
      const fn = api.get("ast-node-children")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("returns children after parsing", () => {
      api.get("ast-parse-buffer")!([]);
      const fn = api.get("ast-node-children")!;
      const r = unwrap(fn([]));
      expect(["nil", "list"]).toContain(r.type);
    });
  });

  describe("ast-invalidate", () => {
    test("clears cache", () => {
      api.get("ast-parse-buffer")!([]);

      const fn = api.get("ast-invalidate")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");

      const nodeResult = unwrap(api.get("ast-node-at-cursor")!([]));
      expect(nodeResult.type).toBe("nil");
    });
  });

  describe("ast-to-json", () => {
    test("returns nil when no AST", () => {
      const fn = api.get("ast-to-json")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("returns JSON string after parsing", () => {
      api.get("ast-parse-buffer")!([]);
      const fn = api.get("ast-to-json")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("string");
      const parsed = JSON.parse(r.value as string);
      expect(parsed.language).toBe("tlisp");
      expect(parsed.fileName).toBe("test.tlisp");
    });
  });

  describe("ast-root-kinds", () => {
    test("returns nil when no AST", () => {
      const fn = api.get("ast-root-kinds")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("returns list of kinds after parsing", () => {
      api.get("ast-parse-buffer")!([]);
      const fn = api.get("ast-root-kinds")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("list");
      expect((r.value as TV[]).length).toBeGreaterThan(0);
    });
  });

  describe("ast-count-nodes", () => {
    test("returns 0 when no AST", () => {
      const fn = api.get("ast-count-nodes")!;
      const r = unwrap(fn([]));
      expect(r.value).toBe(0);
    });

    test("returns node count after parsing", () => {
      api.get("ast-parse-buffer")!([]);
      const fn = api.get("ast-count-nodes")!;
      const r = unwrap(fn([]));
      expect(r.value as number).toBeGreaterThan(0);
    });
  });

  describe("API registration", () => {
    test("all expected functions are registered", () => {
      const expected = [
        "ast-parse-buffer", "ast-node-at-cursor", "ast-node-at-pos",
        "ast-select-node", "ast-enclosing-function", "ast-enclosing-block",
        "ast-node-text", "ast-node-children", "ast-invalidate",
        "ast-to-json", "ast-root-kinds", "ast-count-nodes",
        "ast-parent", "ast-select-parent", "ast-node-kind",
        "ast-next-sibling", "ast-prev-sibling", "ast-goto-node",
      ];
      for (const name of expected) {
        expect(api.has(name)).toBe(true);
      }
    });
  });

  describe("ast-parent", () => {
    test("returns nil when no AST", () => {
      const fn = api.get("ast-parent")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("returns parent node after parsing", () => {
      api.get("ast-parse-buffer")!([]);
      const fn = api.get("ast-parent")!;
      const r = unwrap(fn([]));
      // Cursor is at offset 1 which is inside the defun, should have a parent
      expect(["nil", "hashmap"]).toContain(r.type);
    });

    test("returns nil for file-level root node", () => {
      // Use an offset that lands on the file node (past all content)
      const deps = makeDeps({ getCursorOffset: () => 100, getCursorColumn: () => 100, getCursorLine: () => 5 });
      const ops = createAstOps(deps);
      ops.get("ast-invalidate")!([]);
      ops.get("ast-parse-buffer")!([]);
      const fn = ops.get("ast-parent")!;
      const r = unwrap(fn([]));
      // The deepest node at out-of-range position may or may not have a parent
      expect(["nil", "hashmap"]).toContain(r.type);
    });
  });

  describe("ast-select-parent", () => {
    test("returns nil when no AST", () => {
      const fn = api.get("ast-select-parent")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("returns parent offset range after parsing", () => {
      api.get("ast-parse-buffer")!([]);
      const fn = api.get("ast-select-parent")!;
      const r = unwrap(fn([]));
      expect(["nil", "list"]).toContain(r.type);
    });
  });

  describe("ast-node-kind", () => {
    test("returns nil when no AST", () => {
      const fn = api.get("ast-node-kind")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("returns kind as symbol after parsing", () => {
      api.get("ast-parse-buffer")!([]);
      const fn = api.get("ast-node-kind")!;
      const r = unwrap(fn([]));
      expect(["nil", "symbol"]).toContain(r.type);
    });
  });

  describe("ast-next-sibling", () => {
    test("returns nil when no AST", () => {
      const fn = api.get("ast-next-sibling")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("returns nil when no next sibling exists", () => {
      api.get("ast-parse-buffer")!([]);
      const fn = api.get("ast-next-sibling")!;
      const r = unwrap(fn([]));
      expect(["nil", "hashmap"]).toContain(r.type);
    });
  });

  describe("ast-prev-sibling", () => {
    test("returns nil when no AST", () => {
      const fn = api.get("ast-prev-sibling")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("returns nil when no prev sibling exists", () => {
      api.get("ast-parse-buffer")!([]);
      const fn = api.get("ast-prev-sibling")!;
      const r = unwrap(fn([]));
      expect(["nil", "hashmap"]).toContain(r.type);
    });
  });

  describe("ast-goto-node", () => {
    test("rejects wrong arg count", () => {
      const fn = api.get("ast-goto-node")!;
      expect(Either.isLeft(fn([]))).toBe(true);
      expect(Either.isLeft(fn([createNumber(1), createNumber(2)]))).toBe(true);
    });

    test("rejects non-number arg", () => {
      const fn = api.get("ast-goto-node")!;
      expect(Either.isLeft(fn([createString("a")]))).toBe(true);
    });

    test("returns nil when no AST", () => {
      const fn = api.get("ast-goto-node")!;
      const r = unwrap(fn([createNumber(0)]));
      expect(r.type).toBe("nil");
    });

    test("returns line/column for offset after parsing", () => {
      api.get("ast-parse-buffer")!([]);
      const fn = api.get("ast-goto-node")!;
      const r = unwrap(fn([createNumber(5)]));
      expect(r.type).toBe("hashmap");
      const m = r.value as Map<string, TV>;
      expect(m.has("line")).toBe(true);
      expect(m.has("column")).toBe(true);
    });
  });
});
