/**
 * @file ast-ops.ts
 * @description T-Lisp primitives for AST structural editing operations
 *
 * Exposes parse, node queries, node selection, and scope queries
 * so T-Lisp code can drive structural editing and code awareness.
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import {
  createNil,
  createNumber,
  createString,
  createBoolean,
  createList,
  createSymbol,
  createHashmap,
} from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { validateArgsCount, validateArgType } from "../../utils/validation.ts";
import { AppError, createValidationError, createConfigError } from "../../error/types.ts";
import type { ASTNode } from "../../syntax/ast/types.ts";
import { resetNodeIdCounter } from "../../syntax/ast/types.ts";
import { getNodeAtPosition, getEnclosingFunction, getEnclosingBlock, getText, flatten, nextSibling, prevSibling } from "../../syntax/ast/tree-ops.ts";
import type { SymbolTable } from "../../syntax/ast/scope.ts";
import { getParserForLanguage, getParserForFile, getScopeBuilder, getLanguageForFile } from "../../syntax/ast/registry.ts";
import { serializeForAI } from "../../syntax/ast/serializer.ts";
import { ParseTreeCache, sourceHash, invalidate, evictCache } from "../../syntax/ast/incremental.ts";

/** Cache: bufferName → { tree, symbolTable, sourceHash } */
interface CachedAST {
  tree: ASTNode;
  symbolTable: SymbolTable;
  sourceHash: number;
}

const astCache = new Map<string, CachedAST>();
const parseTreeCache: ParseTreeCache = new Map();

/** Expose the module-level cache so other modules can share it. */
export function getAstCache(): Map<string, CachedAST> {
  return astCache;
}

export interface AstOpsDeps {
  getBufferName: () => string;
  getBufferText: () => string;
  getCursorLine: () => number;
  getCursorColumn: () => number;
  getCursorOffset: () => number;
  setStatusMessage: (msg: string) => void;
}

export function createAstOps(deps: AstOpsDeps): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * ast-parse-buffer — parse the current buffer's source into an AST.
   * Caches the result; re-parses only if source changed.
   * Usage: (ast-parse-buffer) or (ast-parse-buffer "language")
   */
  api.set("ast-parse-buffer", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 1) {
      return Either.left(createValidationError("FormatError", "ast-parse-buffer expects 0 or 1 arguments"));
    }

    const source = deps.getBufferText();
    const name = deps.getBufferName();
    const lang = args.length === 1 && args[0]!.type === "string"
      ? args[0]!.value as string
      : getLanguageForFile(name);

    if (!lang) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        `Cannot determine language for buffer: ${name}`,
        "language", name,
      ));
    }

    const parser = getParserForLanguage(lang);
    if (!parser) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        `No parser registered for language: ${lang}`,
        "language", lang,
      ));
    }

    const hash = sourceHash(source);
    const cached = astCache.get(name);
    if (cached && cached.sourceHash === hash) {
      return Either.right(createString(`cached-ast:${name}`));
    }

    resetNodeIdCounter();
    const result = parser.parse(source, name);
    if (Either.isLeft(result)) {
      return Either.left(createConfigError("ParseError", result.left.message, name));
    }

    const tree = result.right;
    const scopeBuilder = getScopeBuilder(lang);
    const symbolTable = scopeBuilder ? scopeBuilder(tree) : new EmptySymbolTable(tree) as unknown as SymbolTable;

    astCache.set(name, { tree, symbolTable, sourceHash: hash });

    return Either.right(createString(`ast:${name}`));
  });

  /**
   * ast-node-at-cursor — return the AST node at the current cursor position.
   * Usage: (ast-node-at-cursor)
   * Returns: hashmap with kind, label, line, column, or nil if no AST.
   */
  api.set("ast-node-at-cursor", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "ast-node-at-cursor");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getCachedAST(deps.getBufferName());
    if (!cached) return Either.right(createNil());

    const node = getNodeAtPosition(cached.tree, {
      line: deps.getCursorLine(),
      column: deps.getCursorColumn(),
      offset: deps.getCursorOffset(),
    });

    if (!node) return Either.right(createNil());
    return Either.right(nodeToValue(node, deps.getBufferText()));
  });

  /**
   * ast-node-at-pos — return the AST node at a given line/column.
   * Usage: (ast-node-at-pos LINE COL)
   */
  api.set("ast-node-at-pos", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 2, "ast-node-at-pos");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const lineV = validateArgType(args[0]!, "number", 0, "ast-node-at-pos");
    if (Either.isLeft(lineV)) return Either.left(lineV.left);
    const colV = validateArgType(args[1]!, "number", 1, "ast-node-at-pos");
    if (Either.isLeft(colV)) return Either.left(colV.left);

    const cached = getCachedAST(deps.getBufferName());
    if (!cached) return Either.right(createNil());

    const line = args[0]!.value as number;
    const col = args[1]!.value as number;
    const source = deps.getBufferText();
    const offset = lineOffset(source, line) + col;

    const node = getNodeAtPosition(cached.tree, { line, column: col, offset });
    if (!node) return Either.right(createNil());

    return Either.right(nodeToValue(node, source));
  });

  /**
   * ast-select-node — select the node at cursor (set mark at start, point at end).
   * Returns: (start-offset . end-offset) or nil.
   * Usage: (ast-select-node)
   */
  api.set("ast-select-node", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "ast-select-node");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getCachedAST(deps.getBufferName());
    if (!cached) return Either.right(createNil());

    const node = getNodeAtPosition(cached.tree, {
      line: deps.getCursorLine(),
      column: deps.getCursorColumn(),
      offset: deps.getCursorOffset(),
    });

    if (!node) return Either.right(createNil());

    return Either.right(createList([
      createNumber(node.span.start.offset),
      createNumber(node.span.end.offset),
    ]));
  });

  /**
   * ast-enclosing-function — return the enclosing function node.
   * Usage: (ast-enclosing-function)
   */
  api.set("ast-enclosing-function", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "ast-enclosing-function");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getCachedAST(deps.getBufferName());
    if (!cached) return Either.right(createNil());

    const node = getNodeAtPosition(cached.tree, {
      line: deps.getCursorLine(),
      column: deps.getCursorColumn(),
      offset: deps.getCursorOffset(),
    });
    if (!node) return Either.right(createNil());

    const fn = getEnclosingFunction(node);
    if (!fn) return Either.right(createNil());

    return Either.right(nodeToValue(fn, deps.getBufferText()));
  });

  /**
   * ast-enclosing-block — return the enclosing block node.
   * Usage: (ast-enclosing-block)
   */
  api.set("ast-enclosing-block", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "ast-enclosing-block");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getCachedAST(deps.getBufferName());
    if (!cached) return Either.right(createNil());

    const node = getNodeAtPosition(cached.tree, {
      line: deps.getCursorLine(),
      column: deps.getCursorColumn(),
      offset: deps.getCursorOffset(),
    });
    if (!node) return Either.right(createNil());

    const block = getEnclosingBlock(node);
    if (!block) return Either.right(createNil());

    return Either.right(nodeToValue(block, deps.getBufferText()));
  });

  /**
   * ast-node-text — get the source text of the node at cursor.
   * Usage: (ast-node-text)
   */
  api.set("ast-node-text", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "ast-node-text");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getCachedAST(deps.getBufferName());
    if (!cached) return Either.right(createNil());

    const node = getNodeAtPosition(cached.tree, {
      line: deps.getCursorLine(),
      column: deps.getCursorColumn(),
      offset: deps.getCursorOffset(),
    });
    if (!node) return Either.right(createNil());

    return Either.right(createString(getText(node, deps.getBufferText())));
  });

  /**
   * ast-node-children — return the children of the node at cursor.
   * Usage: (ast-node-children)
   */
  api.set("ast-node-children", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "ast-node-children");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getCachedAST(deps.getBufferName());
    if (!cached) return Either.right(createNil());

    const node = getNodeAtPosition(cached.tree, {
      line: deps.getCursorLine(),
      column: deps.getCursorColumn(),
      offset: deps.getCursorOffset(),
    });
    if (!node) return Either.right(createNil());

    const source = deps.getBufferText();
    const children = node.children.map((c) => nodeToValue(c, source));
    return Either.right(createList(children));
  });

  /**
   * ast-parent — return the parent of the node at cursor.
   * Usage: (ast-parent)
   */
  api.set("ast-parent", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "ast-parent");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getCachedAST(deps.getBufferName());
    if (!cached) return Either.right(createNil());

    const node = getNodeAtPosition(cached.tree, {
      line: deps.getCursorLine(),
      column: deps.getCursorColumn(),
      offset: deps.getCursorOffset(),
    });
    if (!node?.parent) return Either.right(createNil());

    return Either.right(nodeToValue(node.parent, deps.getBufferText()));
  });

  /**
   * ast-select-parent — select the parent node's range (expand selection outward).
   * Usage: (ast-select-parent)
   */
  api.set("ast-select-parent", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "ast-select-parent");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getCachedAST(deps.getBufferName());
    if (!cached) return Either.right(createNil());

    const node = getNodeAtPosition(cached.tree, {
      line: deps.getCursorLine(),
      column: deps.getCursorColumn(),
      offset: deps.getCursorOffset(),
    });
    if (!node?.parent) return Either.right(createNil());

    const parent = node.parent;
    return Either.right(createList([
      createNumber(parent.span.start.offset),
      createNumber(parent.span.end.offset),
    ]));
  });

  /**
   * ast-node-kind — return the kind of node at cursor as a symbol.
   * Usage: (ast-node-kind)
   */
  api.set("ast-node-kind", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "ast-node-kind");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getCachedAST(deps.getBufferName());
    if (!cached) return Either.right(createNil());

    const node = getNodeAtPosition(cached.tree, {
      line: deps.getCursorLine(),
      column: deps.getCursorColumn(),
      offset: deps.getCursorOffset(),
    });
    if (!node) return Either.right(createNil());

    return Either.right(createSymbol(node.kind));
  });

  /**
   * ast-next-sibling — return the next sibling of the node at cursor.
   * Usage: (ast-next-sibling)
   */
  api.set("ast-next-sibling", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "ast-next-sibling");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getCachedAST(deps.getBufferName());
    if (!cached) return Either.right(createNil());

    const node = getNodeAtPosition(cached.tree, {
      line: deps.getCursorLine(),
      column: deps.getCursorColumn(),
      offset: deps.getCursorOffset(),
    });
    if (!node) return Either.right(createNil());

    const sib = nextSibling(node);
    if (!sib) return Either.right(createNil());

    return Either.right(nodeToValue(sib, deps.getBufferText()));
  });

  /**
   * ast-prev-sibling — return the previous sibling of the node at cursor.
   * Usage: (ast-prev-sibling)
   */
  api.set("ast-prev-sibling", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "ast-prev-sibling");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getCachedAST(deps.getBufferName());
    if (!cached) return Either.right(createNil());

    const node = getNodeAtPosition(cached.tree, {
      line: deps.getCursorLine(),
      column: deps.getCursorColumn(),
      offset: deps.getCursorOffset(),
    });
    if (!node) return Either.right(createNil());

    const sib = prevSibling(node);
    if (!sib) return Either.right(createNil());

    return Either.right(nodeToValue(sib, deps.getBufferText()));
  });

  /**
   * ast-goto-node — move cursor to the start of a node specified by offset.
   * Usage: (ast-goto-node OFFSET)
   */
  api.set("ast-goto-node", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 1, "ast-goto-node");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const offsetV = validateArgType(args[0]!, "number", 0, "ast-goto-node");
    if (Either.isLeft(offsetV)) return Either.left(offsetV.left);

    const cached = getCachedAST(deps.getBufferName());
    if (!cached) return Either.right(createNil());

    const source = deps.getBufferText();
    const offset = args[0]!.value as number;
    const line = lineCount(source, offset);
    const col = offset - lineStartOffset(source, line);

    return Either.right(createHashmap([
      ["line", createNumber(line)],
      ["column", createNumber(col)],
    ] as [string, TLispValue][]));
  });

  /**
   * ast-invalidate — invalidate the AST cache for the current buffer.
   * Call after editing the buffer content.
   * Usage: (ast-invalidate)
   */
  api.set("ast-invalidate", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "ast-invalidate");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const name = deps.getBufferName();
    astCache.delete(name);
    evictCache(parseTreeCache, name);
    return Either.right(createNil());
  });

  /**
   * ast-to-json — serialize the current buffer's AST as JSON for AI context.
   * Usage: (ast-to-json)
   */
  api.set("ast-to-json", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "ast-to-json");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const name = deps.getBufferName();
    const cached = getCachedAST(name);
    if (!cached) return Either.right(createNil());

    const serialized = serializeForAI(
      cached.tree,
      deps.getBufferText(),
      cached.symbolTable,
      { line: deps.getCursorLine(), column: deps.getCursorColumn(), offset: deps.getCursorOffset() },
      name,
    );

    return Either.right(createString(JSON.stringify(serialized)));
  });

  /**
   * ast-root-kinds — list all top-level node kinds in the current AST.
   * Usage: (ast-root-kinds)
   */
  api.set("ast-root-kinds", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "ast-root-kinds");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getCachedAST(deps.getBufferName());
    if (!cached) return Either.right(createNil());

    const kinds = cached.tree.children.map((c) => createSymbol(c.kind));
    return Either.right(createList(kinds));
  });

  /**
   * ast-count-nodes — count total nodes in the AST.
   * Usage: (ast-count-nodes)
   */
  api.set("ast-count-nodes", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "ast-count-nodes");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getCachedAST(deps.getBufferName());
    if (!cached) return Either.right(createNumber(0));

    const all = flatten(cached.tree);
    return Either.right(createNumber(all.length));
  });

  return api;
}

function getCachedAST(name: string): CachedAST | null {
  return astCache.get(name) ?? null;
}

function nodeToValue(node: ASTNode, source: string): TLispValue {
  const pairs: [string, TLispValue][] = [
    ["kind", createSymbol(node.kind)],
    ["startLine", createNumber(node.span.start.line)],
    ["startCol", createNumber(node.span.start.column)],
    ["startOffset", createNumber(node.span.start.offset)],
    ["endLine", createNumber(node.span.end.line)],
    ["endCol", createNumber(node.span.end.column)],
    ["endOffset", createNumber(node.span.end.offset)],
    ["childCount", createNumber(node.children.length)],
  ];
  if (node.label) pairs.push(["label", createString(node.label)]);
  if (node.parent) pairs.push(["parentKind", createSymbol(node.parent.kind)]);
  return createHashmap(pairs);
}

function lineOffset(source: string, line: number): number {
  let offset = 0;
  for (let i = 0; i < line && offset < source.length; i++) {
    const nl = source.indexOf("\n", offset);
    if (nl < 0) break;
    offset = nl + 1;
  }
  return offset;
}

function lineCount(source: string, targetOffset: number): number {
  let line = 0;
  for (let i = 0; i < targetOffset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

function lineStartOffset(source: string, line: number): number {
  let offset = 0;
  for (let i = 0; i < line && offset < source.length; i++) {
    const nl = source.indexOf("\n", offset);
    if (nl < 0) break;
    offset = nl + 1;
  }
  return offset;
}

/** Minimal SymbolTable stand-in when no scope builder is available. */
class EmptySymbolTable {
  scopes: import("../../syntax/ast/scope.ts").Scope[] = [];
  symbols: Map<string, import("../../syntax/ast/scope.ts").Symbol[]> = new Map();
  root: import("../../syntax/ast/scope.ts").Scope;
  constructor(rootNode: ASTNode) {
    this.root = {
      id: 0, name: "empty", parent: null,
      bindings: new Map(),
      node: rootNode,
    };
  }
}
