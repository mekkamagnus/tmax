/**
 * @file typescript-scope.ts
 * @description TypeScript scope builder — const/let/var, function, class, import scoping
 */

import type { ASTNode } from "../types.ts";
import type { SourceSpan } from "../../../tlisp/source.ts";
import { SymbolTable, type Scope, type SymbolKind } from "../scope.ts";

export function buildTypeScriptScopes(root: ASTNode): SymbolTable {
  const table = new SymbolTable(root);
  walkTS(root, table.root, table, false);
  return table;
}

function walkTS(node: ASTNode, scope: Scope, table: SymbolTable, inFunction: boolean): void {
  switch (node.kind) {
    case "function": {
      if (node.label) {
        table.declareSymbol(node.label, "function", node.span, scope);
      }
      const funcScope = table.createScope(node.label ?? "anon", scope, node);
      if (node.children.length > 0) {
        const params = node.children[0]!;
        collectParams(params, funcScope, table);
        for (let i = 1; i < node.children.length; i++) {
          walkTS(node.children[i]!, funcScope, table, true);
        }
      }
      return;
    }

    case "arrow-function": {
      const funcScope = table.createScope("arrow", scope, node);
      if (node.children.length > 0) {
        const params = node.children[0]!;
        collectParams(params, funcScope, table);
        for (let i = 1; i < node.children.length; i++) {
          walkTS(node.children[i]!, funcScope, table, true);
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
        walkTS(child, classScope, table, false);
      }
      return;
    }

    case "block": {
      const blockScope = table.createScope("block", scope, node);
      for (const child of node.children) {
        walkTS(child, blockScope, table, inFunction);
      }
      return;
    }

    case "variable": {
      const isDeclKeyword = node.label === "var" || node.label === "let" || node.label === "const";
      const shouldHoist = node.label === "var" && inFunction;

      // Parser output: outer "variable" node with label "var"/"let"/"const"
      // and children being declarators (variable or object/array destructuring).
      if (isDeclKeyword) {
        for (const child of node.children) {
          if (child.kind === "variable" && child.label) {
            declareVar(child.label, "variable", child.span, scope, table, shouldHoist);
          } else if (child.kind === "object" || child.kind === "array") {
            declareDestructuredBindings(child, shouldHoist, scope, table);
          }
          walkTS(child, scope, table, inFunction);
        }
        return;
      }

      // Destructuring: if children contain variable/spread/object/array nodes,
      // declare each binding individually (handles manually constructed ASTs too).
      const hasBindings = node.children.some(c =>
        c.kind === "variable" || c.kind === "spread" || c.kind === "object" || c.kind === "array"
      );
      if (node.children.length > 0 && hasBindings) {
        for (const child of node.children) {
          if (child.kind === "variable" && child.label) {
            declareVar(child.label, "variable", child.span, scope, table, shouldHoist);
          }
          if (child.kind === "spread" && child.label) {
            declareVar(child.label, "variable", child.span, scope, table, shouldHoist);
          }
          if (child.kind === "object" || child.kind === "array") {
            declareDestructuredBindings(child, shouldHoist, scope, table);
          }
        }
        for (const child of node.children) {
          walkTS(child, scope, table, inFunction);
        }
        return;
      }

      // Simple variable declaration (label is the name)
      if (node.label) {
        declareVar(node.label, "variable", node.span, scope, table, shouldHoist);
      }
      for (const child of node.children) {
        walkTS(child, scope, table, inFunction);
      }
      return;
    }

    case "import": {
      for (const child of node.children) {
        if (child.kind === "identifier" && child.label) {
          table.declareSymbol(child.label, "import", child.span, scope);
        }
        if (child.kind === "object") {
          for (const spec of child.children) {
            if (spec.kind === "property" && spec.label) {
              table.declareSymbol(spec.label, "import", spec.span, scope);
            }
            if (spec.kind === "variable" && spec.label) {
              table.declareSymbol(spec.label, "import", spec.span, scope);
            }
          }
        }
      }
      return;
    }

    default:
      for (const child of node.children) {
        walkTS(child, scope, table, inFunction);
      }
  }
}

function collectParams(paramsNode: ASTNode, scope: Scope, table: SymbolTable): void {
  if (paramsNode.kind === "call" || paramsNode.kind === "object" || paramsNode.kind === "block") {
    for (const child of paramsNode.children) {
      collectParams(child, scope, table);
    }
  }
  if (paramsNode.kind === "parameter" || paramsNode.kind === "variable") {
    if (paramsNode.label) {
      table.declareSymbol(paramsNode.label, "parameter", paramsNode.span, scope);
    }
  }
  if (paramsNode.kind === "identifier" && paramsNode.label) {
    table.declareSymbol(paramsNode.label, "parameter", paramsNode.span, scope);
  }
}

/**
 * Walk up the scope chain to find the nearest function scope (or root).
 * `var` declarations are hoisted to this scope.
 */
function findFunctionScope(scope: Scope, table: SymbolTable): Scope {
  let current: Scope | null = scope;
  while (current) {
    if (current === table.root) return current;
    const nodeKind = current.node.kind;
    if (nodeKind === "function" || nodeKind === "arrow-function") return current;
    current = current.parent;
  }
  return table.root;
}

/**
 * Declare a variable, optionally hoisting it to the nearest function scope.
 */
function declareVar(
  name: string,
  kind: SymbolKind,
  span: SourceSpan,
  scope: Scope,
  table: SymbolTable,
  hoist: boolean,
): void {
  const targetScope = hoist ? findFunctionScope(scope, table) : scope;
  table.declareSymbol(name, kind, span, targetScope);
}

/**
 * Recursively declare bindings from a destructuring pattern (object or array).
 */
function declareDestructuredBindings(
  node: ASTNode,
  hoist: boolean,
  scope: Scope,
  table: SymbolTable,
): void {
  for (const child of node.children) {
    if (child.kind === "variable" && child.label) {
      declareVar(child.label, "variable", child.span, scope, table, hoist);
    }
    if (child.kind === "spread" && child.label) {
      declareVar(child.label, "variable", child.span, scope, table, hoist);
    }
    if (child.kind === "property" && child.children.length > 0) {
      // { x: alias } — the alias is the last variable child
      const valueNode = child.children[child.children.length - 1]!;
      if (valueNode.kind === "variable" && valueNode.label) {
        declareVar(valueNode.label, "variable", valueNode.span, scope, table, hoist);
      }
    }
    if (child.kind === "object" || child.kind === "array") {
      declareDestructuredBindings(child, hoist, scope, table);
    }
  }
}
