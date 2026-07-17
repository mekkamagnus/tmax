/**
 * @file node-factory.ts
 * @description CHORE-44 Change 11 AC11.4 — shared AST node/span/error-node
 * construction mechanics for the native recursive-descent parsers.
 *
 * Every native parser was open-coding the same trio:
 *   - a `pos(offset, line, col)` struct constructor (Go),
 *   - a `span(start, end)` pair wrapper (Go, since its lexer emits positions),
 *   - `createNode("error", span, LANG, [], message)` boilerplate for synthetic
 *     error nodes (C, Python, TypeScript).
 *
 * This module factors those mechanics out. It deliberately does NOT:
 *   - introduce a grammar abstraction (AC11.6),
 *   - prescribe node `kind` naming — each language keeps its own kinds,
 *   - touch the `id` allocator or parent-linking logic, which already live in
 *     `ast/types.ts` `createNode` (this module is a thin wrapper over it).
 *
 * Node identity, span math, parent links, and language tagging are preserved
 * byte-for-byte from each parser's prior inline code, so serialized AST output
 * is unchanged (AC11.5).
 */
import type { SourcePosition, SourceSpan } from "../../../../tlisp/source.ts";
import { createNode, type ASTNode } from "../../types.ts";

/**
 * Construct a `SourcePosition` from explicit components. Used by parsers whose
 * lexer already tracks `(line, col)` alongside the byte offset (Go). Does no
 * arithmetic — pure struct constructor, exactly matching the prior per-parser
 * `pos(offset, line, col)` helpers.
 */
export function makePosition(offset: number, line: number, column: number): SourcePosition {
  return { offset, line, column };
}

/**
 * Construct a `SourceSpan` from two already-resolved positions. Used by
 * parsers whose tokens carry `SourcePosition` bounds (Go). Mirrors the prior
 * `span(start, end)` helpers byte-for-byte.
 */
export function makeSpan(start: SourcePosition, end: SourcePosition): SourceSpan {
  return { start, end };
}

/**
 * Construct an `error`-kind leaf node carrying `message` as its label.
 *
 * Used by every parser that synthesizes error nodes for recovery reporting
 * (C, Python, TypeScript). The shape — kind `"error"`, empty children, message
 * as label, no language-specific decoration — is identical across all of them,
 * hence the extraction. The span is the caller's responsibility (each parser
 * computes it from its own token / offset representation).
 */
export function errorNode(span: SourceSpan, language: string, message: string): ASTNode {
  return createNode("error", span, language, [], message);
}

/**
 * A language-bound node factory. Bakes the `language` tag into a pair of
 * constructors so call sites stop repeating it:
 *
 *   const F = bindNodeFactory("c");
 *   F.node("function", span, children, "main");
 *   F.error(span, "expected ;");
 *
 * Both methods are pure forwarders to `createNode` / `errorNode` — no new
 * behavior, just less boilerplate. Parsers that build many nodes inline
 * (TypeScript) get the most mileage; parsers that already route through a
 * private helper (C's `this.node`, Python's `synNode`) can swap that helper's
 * body for one call here.
 */
export interface NodeFactory {
  /** Construct a node of `kind` with `language` baked in. */
  node(
    kind: string,
    span: SourceSpan,
    children?: ASTNode[],
    label?: string,
  ): ASTNode;
  /** Construct an `error`-kind node with `language` baked in. */
  error(span: SourceSpan, message: string): ASTNode;
}

export function bindNodeFactory(language: string): NodeFactory {
  return {
    node(kind, span, children = [], label) {
      return createNode(kind, span, language, children, label);
    },
    error(span, message) {
      return errorNode(span, language, message);
    },
  };
}
