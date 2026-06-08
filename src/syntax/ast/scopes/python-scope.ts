/**
 * @file python-scope.ts
 * @description Python scope builder — LEGB rule
 */

import type { ASTNode } from "../types.ts";
import { SymbolTable, type Scope } from "../scope.ts";

export function buildPythonScopes(root: ASTNode): SymbolTable {
  const table = new SymbolTable(root);
  walkPy(root, table.root, table);
  return table;
}

function walkPy(node: ASTNode, scope: Scope, table: SymbolTable): void {
  switch (node.kind) {
    case "function": {
      if (node.label) {
        table.declareSymbol(node.label, "function", node.span, scope);
      }
      const funcScope = table.createScope(node.label ?? "def", scope, node);
      if (node.children.length > 0) {
        const params = node.children[0]!;
        collectPyParams(params, funcScope, table);
        for (let i = 1; i < node.children.length; i++) {
          walkPy(node.children[i]!, funcScope, table);
        }
      }
      return;
    }

    case "class": {
      if (node.label) {
        table.declareSymbol(node.label, "function", node.span, scope);
      }
      const classScope = table.createScope(node.label ?? "class", scope, node);
      for (const child of node.children) {
        if (child.kind === "function" && child.label) {
          table.declareSymbol(child.label, "function", child.span, classScope);
        }
        walkPy(child, classScope, table);
      }
      return;
    }

    case "lambda": {
      const lambdaScope = table.createScope("lambda", scope, node);
      if (node.children.length > 0) {
        collectPyParams(node.children[0]!, lambdaScope, table);
        for (let i = 1; i < node.children.length; i++) {
          walkPy(node.children[i]!, lambdaScope, table);
        }
      }
      return;
    }

    case "comprehension": {
      const compScope = table.createScope("comp", scope, node);
      for (const child of node.children) {
        // Comprehension for-stmt targets: declare loop variables in comp scope
        if (child.kind === "for-stmt" && child.children.length > 0) {
          declarePyTargets(child.children[0]!, compScope, table);
        }
        walkPy(child, compScope, table);
      }
      return;
    }

    case "block": {
      const blockScope = table.createScope("block", scope, node);
      for (const child of node.children) {
        walkPy(child, blockScope, table);
      }
      return;
    }

    case "assignment":
    case "variable": {
      if (node.label) {
        table.declareSymbol(node.label, "variable", node.span, scope);
      }
      for (const child of node.children) {
        walkPy(child, scope, table);
      }
      return;
    }

    case "import": {
      for (const child of node.children) {
        if (child.label) {
          table.declareSymbol(child.label, "import", child.span, scope);
        }
      }
      return;
    }

    case "identifier": {
      // global/nonlocal statements: identifier node with label "global"/"nonlocal"
      // and variable children for the names being declared
      if (node.label === "global") {
        const globalScope = findModuleScope(scope, table);
        for (const child of node.children) {
          if (child.label) {
            table.declareSymbol(child.label, "variable", child.span, globalScope);
          }
        }
        return;
      }
      if (node.label === "nonlocal") {
        const enclosingScope = findEnclosingFunctionScope(scope, table);
        for (const child of node.children) {
          if (child.label) {
            table.declareSymbol(child.label, "variable", child.span, enclosingScope);
          }
        }
        return;
      }
      break;
    }

    default:
      for (const child of node.children) {
        walkPy(child, scope, table);
      }
  }
}

function collectPyParams(paramsNode: ASTNode, scope: Scope, table: SymbolTable): void {
  if (paramsNode.kind === "block" || paramsNode.kind === "call") {
    for (const child of paramsNode.children) {
      collectPyParams(child, scope, table);
    }
  }
  if (paramsNode.kind === "parameter" || paramsNode.kind === "variable" || paramsNode.kind === "identifier") {
    if (paramsNode.label) {
      table.declareSymbol(paramsNode.label, "parameter", paramsNode.span, scope);
    }
  }
}

/**
 * Declare target variables from for-loop / comprehension targets.
 */
function declarePyTargets(targetNode: ASTNode, scope: Scope, table: SymbolTable): void {
  if (targetNode.kind === "variable" && targetNode.label) {
    table.declareSymbol(targetNode.label, "variable", targetNode.span, scope);
  }
  if (targetNode.kind === "identifier" && targetNode.label) {
    // Tuple target: label is "tuple-target", children are individual variables
    if (targetNode.label === "tuple-target") {
      for (const child of targetNode.children) {
        declarePyTargets(child, scope, table);
      }
    }
  }
  for (const child of targetNode.children) {
    declarePyTargets(child, scope, table);
  }
}

/**
 * Find the module (root) scope for global declarations.
 */
function findModuleScope(scope: Scope, table: SymbolTable): Scope {
  return table.root;
}

/**
 * Find the enclosing function scope for nonlocal declarations.
 * Skips the current scope (which is the function containing the nonlocal).
 */
function findEnclosingFunctionScope(scope: Scope, table: SymbolTable): Scope {
  let current: Scope | null = scope.parent;
  while (current) {
    if (current === table.root) return current;
    const nodeKind = current.node.kind;
    if (nodeKind === "function" || nodeKind === "lambda") return current;
    current = current.parent;
  }
  return table.root;
}
