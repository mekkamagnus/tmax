/**
 * @file ast-navigation.test.ts
 * @description Tests for code navigation: findDefinition, findReferences, scope queries
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { resetNodeIdCounter } from "../../../src/syntax/ast/types.ts";
import { findDefinition, findReferences, findScopeAtPosition, getSymbolsInScope, getDocumentSymbols } from "../../../src/syntax/ast/navigation.ts";
import { buildTlispScopes } from "../../../src/syntax/ast/scopes/tlisp-scope.ts";
import { tlispParser } from "../../../src/syntax/ast/parsers/tlisp-parser.ts";
import { Either } from "../../../src/utils/task-either.ts";
import type { SymbolTable, Scope } from "../../../src/syntax/ast/scope.ts";
import type { ASTNode } from "../../../src/syntax/ast/types.ts";

function pos(offset: number, line: number, col: number) {
  return { offset, line, column: col };
}

describe("AST Navigation", () => {
  let table: SymbolTable;
  let fileNode: ASTNode;

  beforeEach(() => {
    resetNodeIdCounter();
    const source = "(defun greet (name) (print name))";
    const result = tlispParser.parse(source, "test");
    if (Either.isLeft(result)) throw new Error("Parse failed");
    fileNode = result.right;
    table = buildTlispScopes(fileNode);
  });

  describe("findDefinition", () => {
    test("finds function definition by name", () => {
      // Find position of the "greet" function node
      const fnNode = fileNode.children[0]!;
      const sym = findDefinition(table, pos(fnNode.span.start.offset + 1, 0, 1), fileNode);
      expect(sym).not.toBeNull();
      expect(sym!.name).toBe("greet");
    });

    test("returns null for out-of-range position", () => {
      const sym = findDefinition(table, pos(100, 5, 0), fileNode);
      expect(sym).toBeNull();
    });
  });

  describe("findReferences", () => {
    test("finds definition span for declared symbol", () => {
      const refs = findReferences(table, "greet");
      expect(refs.length).toBeGreaterThan(0);
      expect(refs[0]!.start.offset).toBe(0);
    });

    test("returns empty array for unknown symbol", () => {
      const refs = findReferences(table, "nonexistent");
      expect(refs).toEqual([]);
    });
  });

  describe("findScopeAtPosition", () => {
    test("returns root scope for out-of-range position", () => {
      const scope = findScopeAtPosition(table, pos(100, 10, 0), fileNode);
      expect(scope).toBe(table.root);
    });

    test("returns tightest scope at position", () => {
      // Find the greet scope and use a position within its span
      const greetScope = table.scopes.find(s => s.name === "greet");
      expect(greetScope).toBeDefined();
      const scopeNode = greetScope!.node;
      const midOffset = Math.floor((scopeNode.span.start.offset + scopeNode.span.end.offset) / 2);
      const scope = findScopeAtPosition(table, pos(midOffset, 0, midOffset), fileNode);
      expect(scope).not.toBeNull();
      expect(scope!.name).toBe("greet");
    });
  });

  describe("getSymbolsInScope", () => {
    test("returns symbols from scope chain", () => {
      const fnScope: Scope | undefined = table.scopes.find(s => s.name === "greet");
      expect(fnScope).toBeDefined();
      const symbols = getSymbolsInScope(fnScope!);
      const names = symbols.map(s => s.name);
      // Should include "name" parameter from fn scope
      expect(names).toContain("name");
      // Walking up should include root scope symbols
      expect(names).toContain("greet");
    });

    test("root scope returns only root bindings", () => {
      const symbols = getSymbolsInScope(table.root);
      const names = symbols.map(s => s.name);
      expect(names).toContain("greet");
    });
  });

  describe("getDocumentSymbols", () => {
    test("returns root-level declarations", () => {
      const syms = getDocumentSymbols(table);
      expect(syms.length).toBeGreaterThan(0);
      expect(syms[0]!.name).toBe("greet");
      expect(syms[0]!.kind).toBe("function");
    });
  });
});
