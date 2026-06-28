/**
 * @file syntax-ops.ts
 * @description Syntax highlighting T-Lisp API primitives (SPEC-035)
 *
 * Exposes language selection, tokenizer, and highlight span management
 * so T-Lisp code can drive syntax highlighting.
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import {
  createNil,
  createNumber,
  createString,
  createBoolean,
  createList,
  createSymbol,
} from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import {
  validateArgsCount,
  validateArgType,
} from "../../utils/validation.ts";
import {
  createValidationError,
  createBufferError,
  AppError,
} from "../../error/types.ts";
import type { SyntaxToken, HighlightSpan } from "../../core/types.ts";
import { tokenize } from "../../syntax/tokenizer.ts";
import { highlightLine } from "../../syntax/highlighter.ts";
import { languageMap } from "../../syntax/language-registry.ts";

/**
 * Module-level state for the active language and highlight toggle.
 */
let activeLanguage: string = "";
let highlightEnabled: boolean = false;
let storedSpans: HighlightSpan[][] = [];

/**
 * Create syntax highlighting API functions.
 * @param getCurrentBuffer - Function to get current buffer
 * @param getLineCount - Function to get buffer line count
 * @param getLine - Function to get a specific line's content
 * @returns Map of syntax function names to implementations
 */
export function createSyntaxOps(
  getCurrentBuffer: () => unknown,
  getLineCount: () => number,
  getLine: (line: number) => string
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * syntax-set-language — set the active language for tokenization
   * Usage: (syntax-set-language "name")
   */
  api.set("syntax-set-language", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "syntax-set-language");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const nameArg = args[0]!
    const typeValidation = validateArgType(nameArg, "string", 0, "syntax-set-language");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const name = (nameArg.value as string).toLowerCase();
    if (!languageMap.has(name)) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        `Unknown language: ${name}. Available: ${Array.from(languageMap.keys()).join(", ")}`,
        "language",
        name,
        "one of: " + Array.from(languageMap.keys()).join(", ")
      ));
    }

    activeLanguage = name;
    return Either.right(createString(activeLanguage));
  });

  /**
   * syntax-get-language — return the current language name
   * Usage: (syntax-get-language)
   */
  api.set("syntax-get-language", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "syntax-get-language");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    return Either.right(createString(activeLanguage));
  });

  /**
   * syntax-highlight-enable — enable syntax highlighting
   * Usage: (syntax-highlight-enable)
   */
  api.set("syntax-highlight-enable", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "syntax-highlight-enable");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    highlightEnabled = true;
    return Either.right(createNil());
  });

  /**
   * syntax-highlight-disable — disable syntax highlighting
   * Usage: (syntax-highlight-disable)
   */
  api.set("syntax-highlight-disable", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "syntax-highlight-disable");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    highlightEnabled = false;
    return Either.right(createNil());
  });

  /**
   * syntax-highlight-toggle — toggle syntax highlighting on/off
   * Usage: (syntax-highlight-toggle)
   */
  api.set("syntax-highlight-toggle", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "syntax-highlight-toggle");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    highlightEnabled = !highlightEnabled;
    return Either.right(createBoolean(highlightEnabled));
  });

  /**
   * syntax-tokenize-line — tokenize a buffer line and return tokens as T-Lisp data
   * Usage: (syntax-tokenize-line LINE-NUM)
   * Returns: list of (type value line startCol endCol) lists
   */
  api.set("syntax-tokenize-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "syntax-tokenize-line");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const lineArg = args[0]!
    const typeValidation = validateArgType(lineArg, "number", 0, "syntax-tokenize-line");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    if (!activeLanguage) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        "No language set. Use (syntax-set-language \"name\") first.",
        "language",
        "",
        "non-empty string"
      ));
    }

    const lineNum = lineArg.value as number;
    const totalLines = getLineCount();
    if (lineNum < 0 || lineNum >= totalLines) {
      return Either.left(createBufferError(
        "OutOfBounds",
        `Line number ${lineNum} out of bounds (0-${totalLines - 1})`
      ));
    }

    const rules = languageMap.get(activeLanguage)!;
    const lineText = getLine(lineNum);
    const result = tokenize(lineText, lineNum, rules);
    const tokens = Array.isArray(result) ? result : (result as { tokens?: SyntaxToken[] }).tokens ?? [];

    // Convert tokens to T-Lisp lists: (type value line startCol endCol)
    const tokenValues = tokens.map((t: SyntaxToken) =>
      createList([
        createSymbol(t.type),
        createString(t.value),
        createNumber(t.line),
        createNumber(t.startCol),
        createNumber(t.endCol),
      ])
    );

    return Either.right(createList(tokenValues));
  });

  /**
   * syntax-apply-highlights — store highlight spans for rendering (placeholder)
   * Usage: (syntax-apply-highlights SPANS)
   * Returns nil for now (spans are not yet wired to the render pipeline)
   */
  api.set("syntax-apply-highlights", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "syntax-apply-highlights");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    // For now, just return nil. Full wiring to the render pipeline comes later.
    return Either.right(createNil());
  });

  /**
   * syntax-clear-highlights — clear all stored highlight spans
   * Usage: (syntax-clear-highlights)
   */
  api.set("syntax-clear-highlights", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "syntax-clear-highlights");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    storedSpans = [];
    return Either.right(createNil());
  });

  /**
   * syntax-highlight-line — tokenize one line and return highlight spans
   * Usage: (syntax-highlight-line LINE-NUM)
   * Returns: list of (start end ((fg COLOR) (bg COLOR) (bold BOOL))) lists
   */
  api.set("syntax-highlight-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "syntax-highlight-line");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const lineArg = args[0]!
    const typeValidation = validateArgType(lineArg, "number", 0, "syntax-highlight-line");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    if (!activeLanguage) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        "No language set. Use (syntax-set-language \"name\") first.",
        "language",
        "",
        "non-empty string"
      ));
    }

    const lineNum = lineArg.value as number;
    const totalLines = getLineCount();
    if (lineNum < 0 || lineNum >= totalLines) {
      return Either.left(createBufferError(
        "OutOfBounds",
        `Line number ${lineNum} out of bounds (0-${totalLines - 1})`
      ));
    }

    const rules = languageMap.get(activeLanguage)!;
    const lineText = getLine(lineNum);
    const result = tokenize(lineText, lineNum, rules);
    const tokens = Array.isArray(result) ? result : (result as { tokens?: SyntaxToken[] }).tokens ?? [];
    const spans = highlightLine(tokens);

    // Convert spans to T-Lisp: (start end style-alist)
    const spanValues = spans.map((s: HighlightSpan) => {
      const stylePairs: TLispValue[] = [];
      if (s.style.fg) stylePairs.push(createList([createSymbol("fg"), createString(s.style.fg)]));
      if (s.style.bg) stylePairs.push(createList([createSymbol("bg"), createString(s.style.bg)]));
      if (s.style.bold !== undefined) stylePairs.push(createList([createSymbol("bold"), createBoolean(s.style.bold)]));
      if (s.style.underline !== undefined) stylePairs.push(createList([createSymbol("underline"), createBoolean(s.style.underline)]));
      if (s.style.dim !== undefined) stylePairs.push(createList([createSymbol("dim"), createBoolean(s.style.dim)]));

      return createList([
        createNumber(s.start),
        createNumber(s.end),
        createList(stylePairs),
      ]);
    });

    return Either.right(createList(spanValues));
  });

  return api;
}
