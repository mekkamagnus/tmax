/**
 * @file tlisp-scope.ts
 * @description T-Lisp scope builder — defun, let, defvar, lambda
 */

import type { ASTNode } from "../types.ts";
import { SymbolTable, type Scope, type SymbolKind } from "../scope.ts";

export const tlispScopeBuilder = {
  enterScope(_node: ASTNode, _scope: Scope): Scope | null {
    return null;
  },

  exitScope(_node: ASTNode, _scope: Scope): void {},

  declareSymbol(_node: ASTNode, _scope: Scope, _kind: SymbolKind): void {},

  extractReferences(_node: ASTNode, _scope: Scope): void {},
};

/**
 * Build a T-Lisp symbol table by walking the AST directly.
 */
export function buildTlispScopes(root: ASTNode): SymbolTable {
  const table = new SymbolTable(root);
  walkTlisp(root, table.root, table);
  return table;
}

function walkTlisp(node: ASTNode, scope: Scope, table: SymbolTable): void {
  if (node.kind === "function" && node.label) {
    table.declareSymbol(node.label, "function", node.span, scope);
    const funcScope = table.createScope(node.label, scope, node);

    if (node.children.length > 0) {
      const params = node.children[0]!;
      if (params.kind === "call") {
        for (const param of params.children) {
          if (param.label) {
            table.declareSymbol(param.label, "parameter", param.span, funcScope);
          }
        }
      }
      for (let i = 1; i < node.children.length; i++) {
        walkTlisp(node.children[i]!, funcScope, table);
      }
    }
    return;
  }

  if (node.kind === "block") {
    const blockScope = table.createScope("let", scope, node);

    if (node.children.length > 0) {
      const bindings = node.children[0]!;
      if (bindings.kind === "call") {
        for (const binding of bindings.children) {
          if (binding.kind === "call" && binding.children.length >= 1) {
            const nameNode = binding.children[0]!;
            if (nameNode.label) {
              table.declareSymbol(nameNode.label, "variable", nameNode.span, blockScope);
            }
          }
          if (binding.kind === "call") {
            for (let i = 1; i < binding.children.length; i++) {
              walkTlisp(binding.children[i]!, scope, table);
            }
          }
        }
      }
      for (let i = 1; i < node.children.length; i++) {
        walkTlisp(node.children[i]!, blockScope, table);
      }
    }
    return;
  }

  if (node.kind === "variable" && node.label) {
    table.declareSymbol(node.label, "variable", node.span, scope);
  }

  if (node.kind === "import") {
    for (const child of node.children) {
      if (child.label) {
        table.declareSymbol(child.label, "import", child.span, scope);
      }
    }
  }

  for (const child of node.children) {
    walkTlisp(child, scope, table);
  }
}
