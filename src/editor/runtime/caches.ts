/**
 * @file caches.ts
 * @description Per-editor non-serializable derived runtime caches.
 *
 * CHORE-44 Change 1: editor session state that is derived, non-serializable,
 * or too transient to belong on the immutable `EditorModel` lives here. Each
 * `Editor` constructs exactly one `EditorRuntimeCaches` instance; the AST/parse
 * caches are therefore NOT shared between concurrently running editors and are
 * never written into serialized workspace JSON (AC1.4).
 *
 * These caches are intentionally a mutable per-editor container — they hold
 * parse artifacts that are expensive to recompute but fully reconstructible from
 * buffer text, so they have no place in the deterministic model layer.
 */

import type { ASTNode } from "../../syntax/ast/types.ts";
import type { SymbolTable } from "../../syntax/ast/scope.ts";
import type { ParseTreeCache } from "../../syntax/ast/incremental.ts";

/**
 * A parsed buffer entry in the AST cache: `bufferName → CachedAST`.
 */
export interface CachedAST {
  tree: ASTNode;
  symbolTable: SymbolTable;
  sourceHash: number;
}

/**
 * Mutable per-editor runtime caches. Owned by one `Editor`; never serialized.
 */
export interface EditorRuntimeCaches {
  /** Parsed AST + symbol table per buffer name. */
  readonly ast: Map<string, CachedAST>;
  /** Incremental parse-tree cache keyed by source hash. */
  readonly parseTree: ParseTreeCache;
}

/**
 * Construct a fresh, independent set of runtime caches for one editor.
 */
export function createEditorRuntimeCaches(): EditorRuntimeCaches {
  return {
    ast: new Map(),
    parseTree: new Map(),
  };
}
