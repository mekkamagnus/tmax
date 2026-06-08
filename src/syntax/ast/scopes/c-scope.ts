/**
 * @file c-scope.ts
 * @description C scope builder — block/file/static scoping
 */

import type { ASTNode } from "../types.ts";
import { SymbolTable, type Scope, type SymbolKind } from "../scope.ts";

export function buildCScopes(root: ASTNode): SymbolTable {
  const table = new SymbolTable(root);
  walkC(root, table.root, table);
  return table;
}

function walkC(node: ASTNode, scope: Scope, table: SymbolTable): void {
  switch (node.kind) {
    case "function": {
      const isStatic = hasStorageClass(node, "static");
      const isExtern = hasStorageClass(node, "extern");
      if (node.label) {
        const kind: SymbolKind = (isStatic || isExtern) ? "constant" : "function";
        table.declareSymbol(node.label, kind, node.span, scope);
      }
      const funcScope = table.createScope(node.label ?? "func", scope, node);
      for (const child of node.children) {
        if (child.kind === "parameter") {
          if (child.label) {
            table.declareSymbol(child.label, "parameter", child.span, funcScope);
          }
        } else {
          walkC(child, funcScope, table);
        }
      }
      return;
    }

    case "struct":
    case "union": {
      if (node.label) {
        table.declareSymbol(node.label, "type", node.span, scope);
      }
      const structScope = table.createScope(node.label ?? "struct", scope, node);
      for (const child of node.children) {
        if (child.kind === "variable" && child.label) {
          table.declareSymbol(child.label, "property", child.span, structScope);
        }
        walkC(child, structScope, table);
      }
      return;
    }

    case "typedef": {
      if (node.label) {
        table.declareSymbol(node.label, "type", node.span, scope);
      }
      for (const child of node.children) {
        walkC(child, scope, table);
      }
      return;
    }

    case "block": {
      const blockScope = table.createScope("block", scope, node);
      for (const child of node.children) {
        walkC(child, blockScope, table);
      }
      return;
    }

    case "variable": {
      // Check if this is a typedef (type-annotation has "typedef" storage class child)
      if (isTypedef(node)) {
        if (node.label) {
          table.declareSymbol(node.label, "type", node.span, scope);
        }
        for (const child of node.children) {
          walkC(child, scope, table);
        }
        return;
      }

      if (node.label) {
        const kind: SymbolKind = "variable";
        table.declareSymbol(node.label, kind, node.span, scope);
      }
      for (const child of node.children) {
        walkC(child, scope, table);
      }
      return;
    }

    case "preprocessor": {
      // #include, #define etc. — no symbols to extract
      return;
    }

    default:
      for (const child of node.children) {
        walkC(child, scope, table);
      }
  }
}

/**
 * Check if a function/variable node has a storage class specifier.
 * Handles both labeled identifier children and "storage-specifier" kind nodes.
 */
function hasStorageClass(node: ASTNode, storageClass: string): boolean {
  for (const child of node.children) {
    if (child.kind === "storage-specifier" && child.label === storageClass) return true;
    if (child.kind === "type-annotation") {
      for (const typeChild of child.children) {
        if (typeChild.kind === "storage-specifier" && typeChild.label === storageClass) return true;
        if (typeChild.kind === "identifier" && typeChild.label === storageClass) return true;
      }
    }
  }
  return false;
}

/**
 * Check if a variable node represents a typedef declaration.
 */
function isTypedef(node: ASTNode): boolean {
  return hasStorageClass(node, "typedef");
}
