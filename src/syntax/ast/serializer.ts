/**
 * @file serializer.ts
 * @description AST → JSON serialization for AI context builder
 */

import type { ASTNode } from "./types.ts";
import type { SymbolTable, Symbol } from "./scope.ts";
import type { SourcePosition } from "../../tlisp/source.ts";

export interface SerializerOptions {
  maxDepth?: number;
  includeSpans?: boolean;
  includeText?: boolean;
  includeScope?: boolean;
  filterKinds?: string[];
}

export interface SerializedNode {
  kind: string;
  label?: string;
  text?: string;
  span?: { startLine: number; startCol: number; endLine: number; endCol: number };
  children?: SerializedNode[];
}

export interface SerializedSymbol {
  name: string;
  kind: string;
  line: number;
}

export interface ASTSerialization {
  language: string;
  fileName: string;
  nodes: SerializedNode[];
  symbols?: SerializedSymbol[];
  cursor?: { line: number; column: number; enclosingNode: string };
}

export function serializeAST(
  root: ASTNode,
  source: string,
  options: SerializerOptions = {},
): SerializedNode {
  return serializeNode(root, source, options, 0);
}

function serializeNode(
  node: ASTNode,
  source: string,
  options: SerializerOptions,
  depth: number,
): SerializedNode {
  const maxDepth = options.maxDepth ?? 5;
  const result: SerializedNode = { kind: node.kind };

  if (node.label) result.label = node.label;

  if (options.includeSpans) {
    result.span = {
      startLine: node.span.start.line,
      startCol: node.span.start.column,
      endLine: node.span.end.line,
      endCol: node.span.end.column,
    };
  }

  if (options.includeText) {
    result.text = source.slice(node.span.start.offset, node.span.end.offset);
  }

  if (depth < maxDepth && node.children.length > 0) {
    let children = node.children;
    if (options.filterKinds) {
      children = children.filter((c) => options.filterKinds!.includes(c.kind));
    }
    result.children = children.map((c) => serializeNode(c, source, options, depth + 1));
  }

  return result;
}

export function serializeForAI(
  root: ASTNode,
  source: string,
  symbolTable: SymbolTable | null,
  cursorPosition: SourcePosition | null,
  fileName: string,
): ASTSerialization {
  const rootSerialized = serializeNode(root, source, {
    maxDepth: 5,
    includeSpans: true,
    includeText: false,
  }, 0);

  const result: ASTSerialization = {
    language: root.language,
    fileName,
    nodes: rootSerialized.children ?? [],
  };

  if (symbolTable) {
    result.symbols = [...symbolTable.symbols.values()]
      .flat()
      .map((sym: Symbol) => ({
        name: sym.name,
        kind: sym.kind,
        line: sym.definition.start.line,
      }));
  }

  if (cursorPosition) {
    // Find the enclosing node kind at cursor position
    let enclosing = "";
    let current: ASTNode | null = root;
    while (current) {
      if (
        cursorPosition.offset >= current.span.start.offset &&
        cursorPosition.offset <= current.span.end.offset
      ) {
        enclosing = current.kind;
        // Try to go deeper
        const child: ASTNode | undefined = current.children.find(
          (c: ASTNode) =>
            cursorPosition!.offset >= c.span.start.offset &&
            cursorPosition!.offset <= c.span.end.offset,
        );
        current = child ?? null;
      } else {
        break;
      }
    }

    result.cursor = {
      line: cursorPosition.line,
      column: cursorPosition.column,
      enclosingNode: enclosing,
    };
  }

  return result;
}
