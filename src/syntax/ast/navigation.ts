/**
 * @file navigation.ts
 * @description Code navigation operations: find definition, find references, scope queries
 */

import type { ASTNode } from "./types.ts";
import type { SourceSpan, SourcePosition } from "../../tlisp/source.ts";
import type { SymbolTable, Symbol, Scope } from "./scope.ts";
import { getNodeAtPosition } from "./tree-ops.ts";

/**
 * Find the definition of the symbol at or near the given position.
 */
export function findDefinition(
  symbolTable: SymbolTable,
  position: SourcePosition,
  root: ASTNode,
): Symbol | null {
  const node = getNodeAtPosition(root, position);
  if (!node || !node.label) return null;

  // Walk up the scope chain to find the symbol
  const scope = findScopeAtPosition(symbolTable, position, root);
  if (!scope) return null;

  return symbolTable.lookup(node.label, scope);
}

/**
 * Find all references to a symbol by name.
 */
export function findReferences(
  symbolTable: SymbolTable,
  symbolName: string,
): SourceSpan[] {
  const symbols = symbolTable.symbols.get(symbolName);
  if (!symbols) return [];

  const refs: SourceSpan[] = [];
  for (const sym of symbols) {
    refs.push(sym.definition);
    refs.push(...sym.references);
  }
  return refs;
}

/**
 * Get the scope at a given source position.
 */
export function findScopeAtPosition(
  symbolTable: SymbolTable,
  position: SourcePosition,
  root: ASTNode,
): Scope | null {
  const node = getNodeAtPosition(root, position);
  if (!node) return symbolTable.root;

  // Find the tightest scope whose node contains the position
  let bestScope: Scope | null = symbolTable.root;
  for (const scope of symbolTable.scopes) {
    if (scope === symbolTable.root) continue;
    const span = scope.node.span;
    if (
      position.offset >= span.start.offset &&
      position.offset <= span.end.offset
    ) {
      // Prefer tighter (deeper) scopes
      if (!bestScope || bestScope === symbolTable.root ||
          (bestScope.node.span.end.offset - bestScope.node.span.start.offset) >
          (span.end.offset - span.start.offset)) {
        bestScope = scope;
      }
    }
  }

  return bestScope;
}

/**
 * Get all symbols visible from a scope (walk up parent chain).
 */
export function getSymbolsInScope(scope: Scope): Symbol[] {
  return symbolTableGetSymbolsInScope(scope);
}

function symbolTableGetSymbolsInScope(scope: Scope): Symbol[] {
  const result: Symbol[] = [];
  let current: Scope | null = scope;
  while (current) {
    result.push(...current.bindings.values());
    current = current.parent;
  }
  return result;
}

/**
 * Get top-level symbols for document outline.
 */
export function getDocumentSymbols(symbolTable: SymbolTable): Symbol[] {
  return symbolTable.getDocumentSymbols();
}
