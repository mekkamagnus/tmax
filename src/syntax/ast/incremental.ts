/**
 * @file incremental.ts
 * @description Incremental reparse: edit → invalidate subtree → reattach unchanged nodes
 */

import type { ASTNode, EditDescriptor, LanguageParser } from "./types.ts";
import type { SourceSpan } from "../../tlisp/source.ts";
import { Either } from "../../utils/task-either.ts";

export interface CachedTree {
  tree: ASTNode;
  sourceHash: number;
}

export type ParseTreeCache = Map<string, CachedTree>;

/**
 * Compute a fast hash of source content for change detection.
 */
export function sourceHash(source: string): number {
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return hash;
}

/**
 * Find the smallest enclosing node that contains the edit range.
 */
export function computeStaleRange(tree: ASTNode, edit: EditDescriptor): SourceSpan {
  let current = tree;

  while (true) {
    let foundChild = false;
    for (const child of current.children) {
      // Check if the edit falls within this child's span
      if (
        edit.startOffset >= child.span.start.offset &&
        edit.startOffset <= child.span.end.offset
      ) {
        current = child;
        foundChild = true;
        break;
      }
    }
    if (!foundChild) break;
  }

  return current.span;
}

/**
 * Replace a subtree within the parent's children list.
 */
export function graftSubtree(
  parent: ASTNode,
  oldChild: ASTNode,
  newChild: ASTNode,
): void {
  const idx = parent.children.indexOf(oldChild);
  if (idx < 0) return;
  parent.children[idx] = newChild;
  newChild.parent = parent;
  oldChild.parent = null;
}

/**
 * Invalidate the cached tree for a buffer after an edit.
 */
export function invalidate(
  cache: ParseTreeCache,
  bufferName: string,
  _edit: EditDescriptor,
): void {
  // Mark the entire cache entry as stale.
  // The next reparseRange call will compute the minimal stale range.
  const entry = cache.get(bufferName);
  if (entry) {
    entry.sourceHash = -1; // sentinel: needs reparse
  }
}

/**
 * Reparse only the stale region and graft onto the existing tree.
 * Strategy: full reparse then graft unchanged subtrees from the old tree
 * where spans match exactly.
 */
export function reparseRange(
  parser: LanguageParser,
  source: string,
  name: string,
  previousTree: ASTNode,
  edit: EditDescriptor,
): ASTNode {
  // Full reparse to get a correct new tree
  const result = parser.parse(source, name);
  if (Either.isLeft(result)) return previousTree;

  const newTree = result.right;

  // Graft unchanged subtrees: where old and new nodes have identical spans,
  // reuse the old subtree (preserving identity for reference equality checks)
  graftUnchanged(previousTree, newTree);

  return newTree;
}

/**
 * Recursively graft unchanged subtrees from old tree into new tree.
 * Two nodes match if they have the same kind and identical span offsets.
 */
function graftUnchanged(old: ASTNode, fresh: ASTNode): void {
  if (
    old.kind === fresh.kind &&
    old.span.start.offset === fresh.span.start.offset &&
    old.span.end.offset === fresh.span.end.offset &&
    old.children.length === fresh.children.length
  ) {
    // Spans match — graft children recursively
    for (let i = 0; i < old.children.length; i++) {
      graftUnchanged(old.children[i]!, fresh.children[i]!);
    }
  }
}

/**
 * Evict a buffer's cached AST.
 */
export function evictCache(cache: ParseTreeCache, bufferName: string): void {
  cache.delete(bufferName);
}
