/**
 * @file go-scope.ts
 * @description Go scope builder — package/function/struct scoping
 */

import type { ASTNode } from "../types.ts";
import { SymbolTable, type Scope } from "../scope.ts";

export function buildGoScopes(root: ASTNode): SymbolTable {
  const table = new SymbolTable(root);
  walkGo(root, table.root, table);
  return table;
}

function walkGo(node: ASTNode, scope: Scope, table: SymbolTable): void {
  switch (node.kind) {
    case "function": {
      if (node.label) {
        table.declareSymbol(node.label, "function", node.span, scope);
      }
      const funcScope = table.createScope(node.label ?? "func", scope, node);
      for (const child of node.children) {
        if (child.kind === "parameter") {
          if (child.label) {
            table.declareSymbol(child.label, "parameter", child.span, funcScope);
          }
        } else {
          walkGo(child, funcScope, table);
        }
      }
      return;
    }

    case "method": {
      // Find the receiver parameter (first child with kind "parameter" that
      // has type identifier children) to determine the receiver type.
      let receiverTypeName: string | undefined;
      let receiverParam: ASTNode | null = null;
      const otherChildren: ASTNode[] = [];

      for (const child of node.children) {
        if (child.kind === "parameter" && !receiverParam) {
          receiverParam = child;
          // Find the type name: last identifier child of the receiver
          const typeIdent = findReceiverTypeName(child);
          if (typeIdent) receiverTypeName = typeIdent;
        } else {
          otherChildren.push(child);
        }
      }

      // Declare the method name in the enclosing scope
      if (node.label) {
        table.declareSymbol(node.label, "function", node.span, scope);
      }

      // Also declare it in the receiver type's scope if found
      if (receiverTypeName && node.label) {
        const typeScope = findTypeScope(receiverTypeName, table);
        if (typeScope) {
          table.declareSymbol(node.label, "function", node.span, typeScope);
        }
      }

      const funcScope = table.createScope(node.label ?? "method", scope, node);

      // Declare receiver variable in method scope
      if (receiverParam && receiverParam.label) {
        table.declareSymbol(receiverParam.label, "parameter", receiverParam.span, funcScope);
      }

      for (const child of otherChildren) {
        if (child.kind === "parameter") {
          if (child.label) {
            table.declareSymbol(child.label, "parameter", child.span, funcScope);
          }
        } else {
          walkGo(child, funcScope, table);
        }
      }
      return;
    }

    case "struct":
    case "interface": {
      if (node.label) {
        table.declareSymbol(node.label, "type", node.span, scope);
      }
      const typeScope = table.createScope(node.label ?? "type", scope, node);
      for (const child of node.children) {
        if (child.kind === "function" && child.label) {
          table.declareSymbol(child.label, "function", child.span, typeScope);
        }
        if (child.kind === "variable" && child.label) {
          table.declareSymbol(child.label, "property", child.span, typeScope);
        }
        walkGo(child, typeScope, table);
      }
      return;
    }

    case "block": {
      const blockScope = table.createScope("block", scope, node);
      for (const child of node.children) {
        walkGo(child, blockScope, table);
      }
      return;
    }

    case "short-decl": {
      // Short variable declaration (:=). Declare LHS identifiers as variables.
      // Children are [lhs identifiers..., rhs expressions...]
      // We declare identifier children that appear before the last assignment
      for (const child of node.children) {
        if (child.kind === "identifier" && child.label) {
          table.declareSymbol(child.label, "variable", child.span, scope);
        }
        walkGo(child, scope, table);
      }
      return;
    }

    case "assignment":
    case "variable": {
      if (node.label) {
        table.declareSymbol(node.label, "variable", node.span, scope);
      }
      for (const child of node.children) {
        walkGo(child, scope, table);
      }
      return;
    }

    case "import": {
      for (const child of node.children) {
        if (child.kind === "string" && child.label) {
          table.declareSymbol(child.label, "import", child.span, scope);
        }
        if (child.kind === "identifier" && child.label) {
          table.declareSymbol(child.label, "import", child.span, scope);
        }
      }
      return;
    }

    default:
      for (const child of node.children) {
        walkGo(child, scope, table);
      }
  }
}

/**
 * Find the type name from a method receiver parameter.
 * Returns the last identifier child's label (the type name).
 */
function findReceiverTypeName(receiverNode: ASTNode): string | undefined {
  let lastIdent: string | undefined;
  for (const child of receiverNode.children) {
    if (child.kind === "identifier" && child.label) {
      lastIdent = child.label;
    }
  }
  return lastIdent;
}

/**
 * Find the scope for a named type (struct/interface) by searching all scopes.
 */
function findTypeScope(typeName: string, table: SymbolTable): Scope | null {
  for (const scope of table.scopes) {
    if (scope.node.kind === "struct" || scope.node.kind === "interface") {
      if (scope.name === typeName) return scope;
    }
  }
  return null;
}
