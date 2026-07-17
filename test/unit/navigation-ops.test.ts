/**
 * @file navigation-ops.test.ts
 * @description Tests for T-Lisp navigation API primitives (navigation-ops)
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createNavigationOps, type NavigationOpsDeps } from "../../src/editor/api/navigation-ops.ts";
import { createEditorRuntimeCaches } from "../../src/editor/runtime/caches.ts";
import { createString, createNumber } from "../../src/tlisp/values.ts";
import type { TLispValue } from "../../src/tlisp/types.ts";
import { Either, type Either as EitherType } from "../../src/utils/task-either.ts";
import type { AppError } from "../../src/error/types.ts";

function unwrap(result: EitherType<AppError, TLispValue>): TLispValue {
  if (Either.isLeft(result)) throw new Error("Expected Right but got Left");
  return result.right;
}

function makeDeps(overrides: Partial<NavigationOpsDeps> = {}): NavigationOpsDeps {
  return {
    caches: createEditorRuntimeCaches(),
    getBufferName: () => "test.tlisp",
    getBufferText: () => "(defun greet (name) (print name))",
    getCursorLine: () => 0,
    getCursorColumn: () => 1,
    getCursorOffset: () => 1,
    gotoPosition: () => {},
    setStatusMessage: () => {},
    ...overrides,
  };
}

describe("Navigation Ops T-Lisp API", () => {
  let api: Map<string, (...args: any[]) => any>;

  beforeEach(() => {
    // CHORE-44 Change 1: each makeDeps() builds a fresh per-editor cache, so
    // tests are isolated without a module-global cache reset.
    api = createNavigationOps(makeDeps());
  });

  describe("go-to-definition", () => {
    test("returns nil when no AST cached", () => {
      const freshApi = createNavigationOps(makeDeps());
      const fn = freshApi.get("go-to-definition")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("rejects arguments", () => {
      const fn = api.get("go-to-definition")!;
      expect(Either.isLeft(fn([createNumber(1)]))).toBe(true);
    });
  });

  describe("find-references", () => {
    test("returns nil when no AST cached", () => {
      const freshApi = createNavigationOps(makeDeps());
      const fn = freshApi.get("find-references")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("rejects more than 1 argument", () => {
      const fn = api.get("find-references")!;
      expect(Either.isLeft(fn([createString("a"), createString("b")]))).toBe(true);
    });

    test("accepts optional symbol name argument", () => {
      const fn = api.get("find-references")!;
      const r = unwrap(fn([createString("greet")]));
      // Returns nil because cache is not shared (known bug)
      expect(r.type).toBe("nil");
    });

    test("accepts zero arguments", () => {
      const fn = api.get("find-references")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });
  });

  describe("document-symbols", () => {
    test("returns nil when no AST cached", () => {
      const freshApi = createNavigationOps(makeDeps());
      const fn = freshApi.get("document-symbols")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("rejects arguments", () => {
      const fn = api.get("document-symbols")!;
      expect(Either.isLeft(fn([createNumber(1)]))).toBe(true);
    });
  });

  describe("symbol-at-cursor", () => {
    test("returns nil when no AST cached", () => {
      const freshApi = createNavigationOps(makeDeps());
      const fn = freshApi.get("symbol-at-cursor")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("rejects arguments", () => {
      const fn = api.get("symbol-at-cursor")!;
      expect(Either.isLeft(fn([createNumber(1)]))).toBe(true);
    });
  });

  describe("symbols-in-scope", () => {
    test("returns nil when no AST cached", () => {
      const freshApi = createNavigationOps(makeDeps());
      const fn = freshApi.get("symbols-in-scope")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("rejects arguments", () => {
      const fn = api.get("symbols-in-scope")!;
      expect(Either.isLeft(fn([createNumber(1)]))).toBe(true);
    });
  });

  describe("scope-at-cursor", () => {
    test("returns nil when no AST cached", () => {
      const freshApi = createNavigationOps(makeDeps());
      const fn = freshApi.get("scope-at-cursor")!;
      const r = unwrap(fn([]));
      expect(r.type).toBe("nil");
    });

    test("rejects arguments", () => {
      const fn = api.get("scope-at-cursor")!;
      expect(Either.isLeft(fn([createNumber(1)]))).toBe(true);
    });
  });

  describe("API registration", () => {
    test("all expected functions are registered", () => {
      const expected = [
        "go-to-definition", "find-references", "document-symbols",
        "symbol-at-cursor", "symbols-in-scope", "scope-at-cursor",
      ];
      for (const name of expected) {
        expect(api.has(name)).toBe(true);
      }
    });

    test("returns exactly 6 functions", () => {
      expect(api.size).toBe(6);
    });
  });
});
