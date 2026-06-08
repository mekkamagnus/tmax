/**
 * @file cross-file-resolver.test.ts
 * @description Tests for cross-file symbol resolution: ModuleGraph, import resolution
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { resetNodeIdCounter, createNode } from "../../../src/syntax/ast/types.ts";
import { ModuleGraph } from "../../../src/syntax/ast/cross-file-resolver.ts";
import { buildTlispScopes } from "../../../src/syntax/ast/scopes/tlisp-scope.ts";
import { SymbolTable } from "../../../src/syntax/ast/scope.ts";
import type { ASTNode } from "../../../src/syntax/ast/types.ts";

function makeGraph(
  files: Record<string, string>,
): ModuleGraph {
  const readFile = async (path: string): Promise<string | null> => {
    return files[path] ?? null;
  };
  const buildScopes = (_tree: ASTNode, _lang: string): SymbolTable => {
    return buildTlispScopes(_tree);
  };
  return new ModuleGraph({ readFile, buildScopes });
}

describe("Cross-File Resolver", () => {
  beforeEach(() => resetNodeIdCounter());

  describe("ModuleGraph", () => {
    test("parseIfCached returns null for missing file", async () => {
      const graph = makeGraph({});
      const entry = await graph.parseIfCached("/nonexistent.tlisp");
      expect(entry).toBeNull();
    });

    test("parseIfCached parses and caches a file", async () => {
      const graph = makeGraph({
        "/test.tlisp": "(defun hello () (print \"world\"))",
      });
      const entry = await graph.parseIfCached("/test.tlisp");
      expect(entry).not.toBeNull();
      expect(entry!.filePath).toBe("/test.tlisp");
      expect(entry!.tree).toBeDefined();
      expect(entry!.symbolTable).toBeDefined();

      // Second call returns cached
      const cached = await graph.parseIfCached("/test.tlisp");
      expect(cached).toBe(entry);
    });

    test("getModules returns all cached modules", async () => {
      const graph = makeGraph({
        "/a.tlisp": "(defun a () 1)",
        "/b.tlisp": "(defun b () 2)",
      });
      await graph.parseIfCached("/a.tlisp");
      await graph.parseIfCached("/b.tlisp");
      expect(graph.getModules().size).toBe(2);
    });

    test("clear removes all cached modules", async () => {
      const graph = makeGraph({
        "/test.tlisp": "(defun f () 1)",
      });
      await graph.parseIfCached("/test.tlisp");
      expect(graph.getModules().size).toBe(1);
      graph.clear();
      expect(graph.getModules().size).toBe(0);
    });
  });

  describe("resolveImport", () => {
    test("returns null for import with no string child", () => {
      const graph = makeGraph({});
      const importNode = createNode("import",
        { start: { offset: 0, line: 0, column: 0 }, end: { offset: 10, line: 0, column: 10 } },
        "tlisp", [],
      );
      const result = graph.resolveImport(importNode, "/src/");
      expect(result).toBeNull();
    });
  });

  describe("findDefinitionAcrossFiles", () => {
    test("returns null when source file not in graph", async () => {
      const graph = makeGraph({});
      const result = await graph.findDefinitionAcrossFiles(
        { name: "x", kind: "variable", definition: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 1, line: 0, column: 1 } }, references: [], scope: null as any },
        "/missing.tlisp",
      );
      expect(result).toBeNull();
    });
  });
});
