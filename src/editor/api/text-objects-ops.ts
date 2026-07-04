/**
 * @file text-objects-ops.ts
 * @description T-Lisp API wrapper for text objects (US-1.8.1)
 *
 * Exports text object functions to T-Lisp with proper error handling
 * and state management integration.
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createString, createSymbol } from "../../tlisp/values.ts";
import type { FunctionalTextBuffer } from "../../core/types.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
import { Either } from "../../utils/task-either.ts";
import type { AppError } from "../../error/types.ts";
import {
  deleteInnerWord,
  deleteAroundWord,
  changeInnerWord,
  changeAroundWord,
  deleteInnerSingleQuote,
  deleteAroundSingleQuote,
  deleteInnerDoubleQuote,
  deleteAroundDoubleQuote,
  changeInnerSingleQuote,
  changeAroundSingleQuote,
  changeInnerDoubleQuote,
  changeAroundDoubleQuote,
  deleteInnerParen,
  changeInnerParen,
  deleteAroundParen,
  changeAroundParen,
  deleteInnerBrace,
  changeInnerBrace,
  deleteAroundBrace,
  changeAroundBrace,
  deleteInnerBracket,
  changeInnerBracket,
  deleteAroundBracket,
  changeAroundBracket,
  deleteInnerAngle,
  changeInnerAngle,
  deleteAroundAngle,
  changeAroundAngle,
  deleteInnerTag,
  changeInnerTag,
  deleteAroundTag,
  changeAroundTag
} from "./text-objects.ts";

/**
 * Create text object operations for T-Lisp API
 */
export function createTextObjectsOps(
  access: EditorModelAccess,
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void,
  setMode: (mode: "normal" | "insert" | "visual" | "command" | "mx" | "replace") => void
): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: cursor/buffer reads flow through the State monad against
  // EditorModel; writes stay on the supplied setters to preserve side effects.
  const getCursorLine = (): number => runModel(access, readModelField("cursorPosition")).line;
  const getCursorColumn = (): number => runModel(access, readModelField("cursorPosition")).column;
  const getCurrentBuffer = (): FunctionalTextBuffer | null =>
    runModel(access, readModelField("currentBuffer")) ?? null;
  const ops = new Map<string, TLispFunctionImpl>();

  /**
   * Delete inner word (diw)
   * T-Lisp: (delete-inner-word) or (delete-inner-word count)
   * COUNT multiplies the text object (d2iw deletes two inner words).
   */
  ops.set("delete-inner-word", (args: TLispValue[]) => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const count = optionalCount(args);
    const result = deleteInnerWord(buffer, getCursorLine(), getCursorColumn(), count);
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Delete around word (daw)
   * T-Lisp: (delete-around-word) or (delete-around-word count)
   * COUNT multiplies the text object (d2aw deletes two around-words).
   */
  ops.set("delete-around-word", (args: TLispValue[]) => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const count = optionalCount(args);
    const result = deleteAroundWord(buffer, getCursorLine(), getCursorColumn(), count);
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Change inner word (ciw)
   * T-Lisp: (change-inner-word) or (change-inner-word count)
   */
  ops.set("change-inner-word", (args: TLispValue[]) => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const count = optionalCount(args);
    const result = changeInnerWord(buffer, getCursorLine(), getCursorColumn(), count);
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  /**
   * Change around word (caw)
   * T-Lisp: (change-around-word) or (change-around-word count)
   */
  ops.set("change-around-word", (args: TLispValue[]) => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const count = optionalCount(args);
    const result = changeAroundWord(buffer, getCursorLine(), getCursorColumn(), count);
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  /**
   * Delete inner single quote (di')
   * T-Lisp: (delete-inner-single-quote)
   */
  ops.set("delete-inner-single-quote", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = deleteInnerSingleQuote(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Delete around single quote (da')
   * T-Lisp: (delete-around-single-quote)
   */
  ops.set("delete-around-single-quote", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = deleteAroundSingleQuote(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Delete inner double quote (di")
   * T-Lisp: (delete-inner-double-quote)
   */
  ops.set("delete-inner-double-quote", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = deleteInnerDoubleQuote(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Delete around double quote (da")
   * T-Lisp: (delete-around-double-quote)
   */
  ops.set("delete-around-double-quote", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = deleteAroundDoubleQuote(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Change inner single quote (ci')
   * T-Lisp: (change-inner-single-quote)
   */
  ops.set("change-inner-single-quote", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = changeInnerSingleQuote(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  /**
   * Change around single quote (ca')
   * T-Lisp: (change-around-single-quote)
   */
  ops.set("change-around-single-quote", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = changeAroundSingleQuote(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  /**
   * Change inner double quote (ci")
   * T-Lisp: (change-inner-double-quote)
   */
  ops.set("change-inner-double-quote", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = changeInnerDoubleQuote(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  /**
   * Change around double quote (ca")
   * T-Lisp: (change-around-double-quote)
   */
  ops.set("change-around-double-quote", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = changeAroundDoubleQuote(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  /**
   * Delete inner parenthesis (di))
   * T-Lisp: (delete-inner-paren)
   */
  ops.set("delete-inner-paren", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = deleteInnerParen(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Change inner parenthesis (ci))
   * T-Lisp: (change-inner-paren)
   */
  ops.set("change-inner-paren", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = changeInnerParen(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  /**
   * Delete around parenthesis (da))
   * T-Lisp: (delete-around-paren)
   */
  ops.set("delete-around-paren", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = deleteAroundParen(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Change around parenthesis (ca))
   * T-Lisp: (change-around-paren)
   */
  ops.set("change-around-paren", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = changeAroundParen(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  /**
   * Delete inner brace (di{)
   * T-Lisp: (delete-inner-brace)
   */
  ops.set("delete-inner-brace", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = deleteInnerBrace(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Change inner brace (ci{)
   * T-Lisp: (change-inner-brace)
   */
  ops.set("change-inner-brace", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = changeInnerBrace(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  /**
   * Delete around brace (da})
   * T-Lisp: (delete-around-brace)
   */
  ops.set("delete-around-brace", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = deleteAroundBrace(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Change around brace (ca})
   * T-Lisp: (change-around-brace)
   */
  ops.set("change-around-brace", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = changeAroundBrace(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  /**
   * Delete inner bracket (di])
   * T-Lisp: (delete-inner-bracket)
   */
  ops.set("delete-inner-bracket", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = deleteInnerBracket(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Change inner bracket (ci])
   * T-Lisp: (change-inner-bracket)
   */
  ops.set("change-inner-bracket", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = changeInnerBracket(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  /**
   * Delete around bracket (da])
   * T-Lisp: (delete-around-bracket)
   */
  ops.set("delete-around-bracket", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = deleteAroundBracket(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Change around bracket (ca])
   * T-Lisp: (change-around-bracket)
   */
  ops.set("change-around-bracket", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = changeAroundBracket(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  /**
   * Delete inner angle bracket (di<)
   * T-Lisp: (delete-inner-angle)
   */
  ops.set("delete-inner-angle", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = deleteInnerAngle(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Change inner angle bracket (ci<)
   * T-Lisp: (change-inner-angle)
   */
  ops.set("change-inner-angle", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = changeInnerAngle(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  /**
   * Delete around angle bracket (da<)
   * T-Lisp: (delete-around-angle)
   */
  ops.set("delete-around-angle", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = deleteAroundAngle(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Change around angle bracket (ca<)
   * T-Lisp: (change-around-angle)
   */
  ops.set("change-around-angle", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = changeAroundAngle(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  /**
   * Delete inner tag (dit)
   * T-Lisp: (delete-inner-tag)
   */
  ops.set("delete-inner-tag", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = deleteInnerTag(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Change inner tag (cit)
   * T-Lisp: (change-inner-tag)
   */
  ops.set("change-inner-tag", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = changeInnerTag(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  /**
   * Delete around tag (dat)
   * T-Lisp: (delete-around-tag)
   */
  ops.set("delete-around-tag", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = deleteAroundTag(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    return Either.right(createNil());
  });

  /**
   * Change around tag (cat)
   * T-Lisp: (change-around-tag)
   */
  ops.set("change-around-tag", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return Either.right(createNil());
    }

    const result = changeAroundTag(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return Either.right(createNil());
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return Either.right(createSymbol("INSERT"));
  });

  return ops;
}

/**
 * Extract an optional count argument from a T-Lisp call. Returns 1 when no
 * argument is supplied or the argument is not a positive number. Caps at 1
 * to preserve existing behavior for non-count callers.
 */
function optionalCount(args: TLispValue[]): number {
  if (args.length === 0) return 1;
  const first = args[0]!;
  if (first.type !== "number" || typeof first.value !== "number") return 1;
  if (!Number.isFinite(first.value) || first.value < 1) return 1;
  return Math.floor(first.value);
}
