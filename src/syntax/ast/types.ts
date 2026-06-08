/**
 * @file types.ts
 * @description AST core types for the native parsing engine
 */

import type { SourceSpan } from "../../tlisp/source.ts";
import type { Either } from "../../utils/task-either.ts";
import type { ConfigError } from "../../error/types.ts";

export type ParseError = ConfigError;

/**
 * Base AST node kinds shared across all languages.
 * Parsers extend this with language-specific kinds.
 */
export type BaseASTNodeKind =
  | "file"
  | "function"
  | "class"
  | "method"
  | "interface"
  | "block"
  | "call"
  | "assignment"
  | "variable"
  | "parameter"
  | "import"
  | "export"
  | "comment"
  | "string"
  | "number"
  | "identifier"
  | "error";

/**
 * AST node. Text is extracted on demand via span + source, never stored.
 * `label` is an optional short name for named nodes (function/class/variable names).
 */
export interface ASTNode {
  id: number;
  kind: string;
  span: SourceSpan;
  children: ASTNode[];
  parent: ASTNode | null;
  language: string;
  label?: string;
}

let _nextId = 0;

export function createNode(
  kind: string,
  span: SourceSpan,
  language: string,
  children: ASTNode[] = [],
  label?: string,
): ASTNode {
  const node: ASTNode = {
    id: _nextId++,
    kind,
    span,
    children,
    parent: null,
    language,
    label,
  };
  for (const child of children) {
    child.parent = node;
  }
  return node;
}

export function resetNodeIdCounter(): void {
  _nextId = 0;
}

export interface ASTVisitor<T> {
  enter?(node: ASTNode): T | undefined;
  exit?(node: ASTNode): T | undefined;
}

export interface EditDescriptor {
  startOffset: number;
  endOffset: number;
  newText: string;
}

export interface LanguageParser {
  parse(source: string, name: string): Either<ParseError, ASTNode>;
  parseIncremental(
    source: string,
    name: string,
    previous: ASTNode,
    edit: EditDescriptor,
  ): Either<ParseError, ASTNode>;
}
