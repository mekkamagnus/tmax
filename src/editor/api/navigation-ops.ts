/**
 * @file navigation-ops.ts
 * @description T-Lisp primitives for code navigation: go-to-definition, find-references, scope queries
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
import { AppError, createValidationError } from "../../error/types.ts";
import type { Symbol as ASTSymbol, SymbolTable } from "../../syntax/ast/scope.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
import { findDefinition, findReferences, findScopeAtPosition, getSymbolsInScope, getDocumentSymbols } from "../../syntax/ast/navigation.ts";
import { getNodeAtPosition } from "../../syntax/ast/tree-ops.ts";

interface CachedAST {
  tree: import("../../syntax/ast/types.ts").ASTNode;
  symbolTable: SymbolTable;
  sourceHash: number;
}

/** Shared reference to the AST cache from ast-ops.ts */
let _astCacheRef: Map<string, CachedAST> | null = null;

export function setAstCacheRef(cache: Map<string, CachedAST>): void {
  _astCacheRef = cache;
}

export interface NavigationOpsDeps {
  /** CHORE-39 Phase 4: when provided, cursor reads use the State monad against EditorModel. */
  access?: EditorModelAccess;
  getBufferName: () => string;
  getBufferText: () => string;
  getCursorLine: () => number;
  getCursorColumn: () => number;
  getCursorOffset: () => number;
  gotoPosition: (line: number, column: number) => void;
  setStatusMessage: (msg: string) => void;
}

export function createNavigationOps(deps: NavigationOpsDeps): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: prefer State-monad cursor reads when access is supplied
  // (real editor runtime); fall back to the deps callbacks otherwise (legacy
  // test harnesses that override getCursorLine/getCursorColumn per-test).
  const getCursorLine = (): number =>
    deps.access ? runModel(deps.access, readModelField("cursorPosition")).line : deps.getCursorLine();
  const getCursorColumn = (): number =>
    deps.access ? runModel(deps.access, readModelField("cursorPosition")).column : deps.getCursorColumn();
  const api = new Map<string, TLispFunctionImpl>();

  function getAST(): CachedAST | null {
    return _astCacheRef?.get(deps.getBufferName()) ?? null;
  }

  /**
   * go-to-definition — jump to the definition of the symbol at cursor.
   * Usage: (go-to-definition)
   */
  api.set("go-to-definition", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "go-to-definition");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getAST();
    if (!cached) {
      deps.setStatusMessage("No AST — run ast-parse-buffer first");
      return Either.right(createNil());
    }

    const position = {
      line: getCursorLine(),
      column: getCursorColumn(),
      offset: deps.getCursorOffset(),
    };

    const sym = findDefinition(cached.symbolTable, position, cached.tree);
    if (!sym) {
      deps.setStatusMessage("No definition found");
      return Either.right(createNil());
    }

    deps.gotoPosition(sym.definition.start.line, sym.definition.start.column);
    return Either.right(createString(sym.name));
  });

  /**
   * find-references — find all references to the symbol at cursor.
   * Usage: (find-references) or (find-references "symbol-name")
   */
  api.set("find-references", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 1) {
      return Either.left(createValidationError("FormatError", "find-references expects 0 or 1 arguments"));
    }

    const cached = getAST();
    if (!cached) {
      deps.setStatusMessage("No AST — run ast-parse-buffer first");
      return Either.right(createNil());
    }

    let symbolName: string;
    if (args.length === 1) {
      const nameV = validateArgType(args[0]!, "string", 0, "find-references");
      if (Either.isLeft(nameV)) return Either.left(nameV.left);
      symbolName = args[0]!.value as string;
    } else {
      const node = getNodeAtPosition(cached.tree, {
        line: getCursorLine(),
        column: getCursorColumn(),
        offset: deps.getCursorOffset(),
      });
      if (!node?.label) {
        deps.setStatusMessage("No symbol at cursor");
        return Either.right(createNil());
      }
      symbolName = node.label;
    }

    const refs = findReferences(cached.symbolTable, symbolName);
    const refValues = refs.map((span) =>
      createHashmap([
        ["line", createNumber(span.start.line)],
        ["column", createNumber(span.start.column)],
        ["endLine", createNumber(span.end.line)],
        ["endColumn", createNumber(span.end.column)],
      ] as [string, TLispValue][])
    );

    return Either.right(createList(refValues));
  });

  /**
   * document-symbols — return all top-level symbols for document outline.
   * Usage: (document-symbols)
   */
  api.set("document-symbols", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "document-symbols");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getAST();
    if (!cached) return Either.right(createNil());

    const symbols = getDocumentSymbols(cached.symbolTable);
    const values = symbols.map((sym: ASTSymbol) =>
      createHashmap([
        ["name", createString(sym.name)],
        ["kind", createSymbol(sym.kind)],
        ["line", createNumber(sym.definition.start.line)],
        ["column", createNumber(sym.definition.start.column)],
      ] as [string, TLispValue][])
    );

    return Either.right(createList(values));
  });

  /**
   * symbol-at-cursor — return the symbol at the current cursor position.
   * Usage: (symbol-at-cursor)
   */
  api.set("symbol-at-cursor", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "symbol-at-cursor");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getAST();
    if (!cached) return Either.right(createNil());

    const position = {
      line: getCursorLine(),
      column: getCursorColumn(),
      offset: deps.getCursorOffset(),
    };

    const node = getNodeAtPosition(cached.tree, position);
    if (!node?.label) return Either.right(createNil());

    // Look up in scope chain
    const scope = findScopeAtPosition(cached.symbolTable, position, cached.tree);
    if (!scope) return Either.right(createNil());

    const sym = cached.symbolTable.lookup(node.label, scope);
    if (!sym) return Either.right(createNil());

    return Either.right(createHashmap([
      ["name", createString(sym.name)],
      ["kind", createSymbol(sym.kind)],
      ["line", createNumber(sym.definition.start.line)],
      ["column", createNumber(sym.definition.start.column)],
    ] as [string, TLispValue][]));
  });

  /**
   * symbols-in-scope — return all symbols visible from the cursor position.
   * Usage: (symbols-in-scope)
   */
  api.set("symbols-in-scope", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "symbols-in-scope");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getAST();
    if (!cached) return Either.right(createNil());

    const position = {
      line: getCursorLine(),
      column: getCursorColumn(),
      offset: deps.getCursorOffset(),
    };

    const scope = findScopeAtPosition(cached.symbolTable, position, cached.tree);
    if (!scope) return Either.right(createNil());

    const symbols = getSymbolsInScope(scope);
    const values = symbols.map((sym: ASTSymbol) =>
      createHashmap([
        ["name", createString(sym.name)],
        ["kind", createSymbol(sym.kind)],
        ["line", createNumber(sym.definition.start.line)],
      ] as [string, TLispValue][])
    );

    return Either.right(createList(values));
  });

  /**
   * scope-at-cursor — return info about the innermost scope at cursor.
   * Usage: (scope-at-cursor)
   */
  api.set("scope-at-cursor", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsV = validateArgsCount(args, 0, "scope-at-cursor");
    if (Either.isLeft(argsV)) return Either.left(argsV.left);

    const cached = getAST();
    if (!cached) return Either.right(createNil());

    const position = {
      line: getCursorLine(),
      column: getCursorColumn(),
      offset: deps.getCursorOffset(),
    };

    const scope = findScopeAtPosition(cached.symbolTable, position, cached.tree);
    if (!scope) return Either.right(createNil());

    return Either.right(createHashmap([
      ["name", createString(scope.name)],
      ["id", createNumber(scope.id)],
      ["bindingCount", createNumber(scope.bindings.size)],
      ["parentName", createString(scope.parent?.name ?? "none")],
    ] as [string, TLispValue][]));
  });

  return api;
}
