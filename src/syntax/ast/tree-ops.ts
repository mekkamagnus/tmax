/**
 * @file tree-ops.ts
 * @description AST tree traversal and query operations
 */

import type { ASTNode, ASTVisitor } from "./types.ts";
import type { SourcePosition } from "../../tlisp/source.ts";

/**
 * Find the deepest node whose span contains the given position.
 * Uses binary search on children (sorted by source position).
 */
export function getNodeAtPosition(
  root: ASTNode,
  position: SourcePosition,
): ASTNode | null {
  const offset = position.offset;
  if (
    offset < root.span.start.offset ||
    offset > root.span.end.offset
  ) {
    return null;
  }

  let current: ASTNode = root;

  while (current.children.length > 0) {
    let lo = 0;
    let hi = current.children.length - 1;
    let found = false;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const child = current.children[mid]!;
      if (
        offset >= child.span.start.offset &&
        offset <= child.span.end.offset
      ) {
        current = child;
        found = true;
        break;
      }
      if (offset < child.span.start.offset) {
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    if (!found) break;
  }

  return current;
}

export function getParentOfType(
  node: ASTNode,
  kind: string,
): ASTNode | null {
  let current = node.parent;
  while (current) {
    if (current.kind === kind) return current;
    current = current.parent;
  }
  return null;
}

const FUNCTION_LIKE_KINDS = new Set(["function", "arrow-function", "method", "lambda"]);

export function getEnclosingFunction(node: ASTNode): ASTNode | null {
  let current = node.parent;
  while (current) {
    if (FUNCTION_LIKE_KINDS.has(current.kind)) return current;
    current = current.parent;
  }
  return null;
}

export function getEnclosingBlock(node: ASTNode): ASTNode | null {
  return getParentOfType(node, "block");
}

export function getChildrenOfKind(
  node: ASTNode,
  kind: string,
): ASTNode[] {
  return node.children.filter((c) => c.kind === kind);
}

export function walk(root: ASTNode, visitor: ASTVisitor<void>): void {
  const enterResult = visitor.enter?.(root);
  if (enterResult !== undefined) return;
  for (const child of root.children) {
    walk(child, visitor);
  }
  visitor.exit?.(root);
}

export function flatten(root: ASTNode): ASTNode[] {
  const result: ASTNode[] = [];
  walk(root, {
    enter(node) {
      result.push(node);
    },
  });
  return result;
}

export function getText(node: ASTNode, source: string): string {
  return source.slice(node.span.start.offset, node.span.end.offset);
}

export function findNode(
  root: ASTNode,
  predicate: (n: ASTNode) => boolean,
): ASTNode | null {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

export function nextSibling(node: ASTNode): ASTNode | null {
  if (!node.parent) return null;
  const siblings = node.parent.children;
  const idx = siblings.indexOf(node);
  if (idx < 0 || idx >= siblings.length - 1) return null;
  return siblings[idx + 1]!;
}

export function prevSibling(node: ASTNode): ASTNode | null {
  if (!node.parent) return null;
  const siblings = node.parent.children;
  const idx = siblings.indexOf(node);
  if (idx <= 0) return null;
  return siblings[idx - 1]!;
}
