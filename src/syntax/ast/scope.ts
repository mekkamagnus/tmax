/**
 * @file scope.ts
 * @description Scope and symbol table infrastructure for code navigation
 */

import type { ASTNode } from "./types.ts";
import type { SourceSpan } from "../../tlisp/source.ts";

export interface Scope {
  id: number;
  name: string;
  parent: Scope | null;
  bindings: Map<string, Symbol>;
  node: ASTNode;
}

export type SymbolKind = "variable" | "function" | "macro" | "parameter" | "constant" | "import" | "type" | "property";

export interface Symbol {
  name: string;
  kind: SymbolKind;
  definition: SourceSpan;
  references: SourceSpan[];
  scope: Scope;
}

export class SymbolTable {
  scopes: Scope[] = [];
  symbols: Map<string, Symbol[]> = new Map();
  root: Scope;
  private nextScopeId = 0;

  constructor(rootNode: ASTNode) {
    this.root = this.createScope("root", null, rootNode);
  }

  createScope(name: string, parent: Scope | null, node: ASTNode): Scope {
    const scope: Scope = {
      id: this.nextScopeId++,
      name,
      parent,
      bindings: new Map(),
      node,
    };
    this.scopes.push(scope);
    return scope;
  }

  declareSymbol(
    name: string,
    kind: SymbolKind,
    definition: SourceSpan,
    scope: Scope,
  ): Symbol {
    const sym: Symbol = { name, kind, definition, references: [], scope };
    scope.bindings.set(name, sym);
    const existing = this.symbols.get(name) ?? [];
    existing.push(sym);
    this.symbols.set(name, existing);
    return sym;
  }

  addReference(sym: Symbol, ref: SourceSpan): void {
    sym.references.push(ref);
  }

  /**
   * Look up a symbol by name in the scope chain (walks up parents).
   */
  lookup(name: string, scope: Scope): Symbol | null {
    let current: Scope | null = scope;
    while (current) {
      const sym = current.bindings.get(name);
      if (sym) return sym;
      current = current.parent;
    }
    return null;
  }

  /**
   * Get all symbols visible from a scope (walks up parent chain).
   */
  getSymbolsInScope(scope: Scope): Symbol[] {
    const result: Symbol[] = [];
    let current: Scope | null = scope;
    while (current) {
      result.push(...current.bindings.values());
      current = current.parent;
    }
    return result;
  }

  /**
   * Get top-level symbols (document outline).
   */
  getDocumentSymbols(): Symbol[] {
    return [...this.root.bindings.values()];
  }
}

/**
 * Interface for language-specific scope builders.
 */
export interface LanguageScopeBuilder {
  /**
   * Called when entering a node. Return a new scope if this node creates one.
   */
  enterScope(node: ASTNode, scope: Scope): Scope | null;
  /**
   * Called when exiting a node that created a scope.
   */
  exitScope(node: ASTNode, scope: Scope): void;
  /**
   * Declare a symbol in the current scope.
   */
  declareSymbol(node: ASTNode, scope: Scope, kind: SymbolKind): void;
  /**
   * Extract references to symbols from a node.
   */
  extractReferences(node: ASTNode, scope: Scope): void;
}

/**
 * Build a symbol table from an AST using a language-specific builder.
 */
export function buildScopes(root: ASTNode, builder: LanguageScopeBuilder): SymbolTable {
  const table = new SymbolTable(root);
  buildScopesRecursive(root, table.root, builder, table);
  return table;
}

function buildScopesRecursive(
  node: ASTNode,
  currentScope: Scope,
  builder: LanguageScopeBuilder,
  table: SymbolTable,
): void {
  const newScope = builder.enterScope(node, currentScope);
  const activeScope = newScope ?? currentScope;

  for (const child of node.children) {
    buildScopesRecursive(child, activeScope, builder, table);
  }

  builder.extractReferences(node, activeScope);

  if (newScope) {
    builder.exitScope(node, newScope);
  }
}
