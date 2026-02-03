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
import { Either } from "../../utils/task-either.ts";
import {
  deleteInnerWord,
  deleteAroundWord,
  changeInnerSingleQuote,
  changeAroundSingleQuote,
  changeInnerDoubleQuote,
  changeAroundDoubleQuote,
  deleteInnerParen,
  changeInnerParen,
  deleteInnerBrace,
  changeInnerBrace,
  deleteInnerBracket,
  deleteInnerAngle,
  deleteInnerTag
} from "./text-objects.ts";

/**
 * Create text object operations for T-Lisp API
 */
export function createTextObjectsOps(
  getCurrentBuffer: () => FunctionalTextBuffer | null,
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void,
  getCursorLine: () => number,
  getCursorColumn: () => number,
  setMode: (mode: "normal" | "insert" | "visual" | "command" | "mx") => void
): Map<string, TLispFunctionImpl> {
  const ops = new Map<string, TLispFunctionImpl>();

  /**
   * Delete inner word (diw)
   * T-Lisp: (delete-inner-word)
   */
  ops.set("delete-inner-word", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return createNil();
    }

    const result = deleteInnerWord(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return createNil();
    }

    setCurrentBuffer(result.right);
    return createNil();
  });

  /**
   * Delete around word (daw)
   * T-Lisp: (delete-around-word)
   */
  ops.set("delete-around-word", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return createNil();
    }

    const result = deleteAroundWord(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return createNil();
    }

    setCurrentBuffer(result.right);
    return createNil();
  });

  /**
   * Change inner single quote (ci')
   * T-Lisp: (change-inner-single-quote)
   */
  ops.set("change-inner-single-quote", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return createNil();
    }

    const result = changeInnerSingleQuote(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return createNil();
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return createSymbol("INSERT");
  });

  /**
   * Change around single quote (ca')
   * T-Lisp: (change-around-single-quote)
   */
  ops.set("change-around-single-quote", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return createNil();
    }

    const result = changeAroundSingleQuote(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return createNil();
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return createSymbol("INSERT");
  });

  /**
   * Change inner double quote (ci")
   * T-Lisp: (change-inner-double-quote)
   */
  ops.set("change-inner-double-quote", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return createNil();
    }

    const result = changeInnerDoubleQuote(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return createNil();
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return createSymbol("INSERT");
  });

  /**
   * Change around double quote (ca")
   * T-Lisp: (change-around-double-quote)
   */
  ops.set("change-around-double-quote", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return createNil();
    }

    const result = changeAroundDoubleQuote(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return createNil();
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return createSymbol("INSERT");
  });

  /**
   * Delete inner parenthesis (di))
   * T-Lisp: (delete-inner-paren)
   */
  ops.set("delete-inner-paren", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return createNil();
    }

    const result = deleteInnerParen(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return createNil();
    }

    setCurrentBuffer(result.right);
    return createNil();
  });

  /**
   * Change inner parenthesis (ci))
   * T-Lisp: (change-inner-paren)
   */
  ops.set("change-inner-paren", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return createNil();
    }

    const result = changeInnerParen(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return createNil();
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return createSymbol("INSERT");
  });

  /**
   * Delete inner brace (di{)
   * T-Lisp: (delete-inner-brace)
   */
  ops.set("delete-inner-brace", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return createNil();
    }

    const result = deleteInnerBrace(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return createNil();
    }

    setCurrentBuffer(result.right);
    return createNil();
  });

  /**
   * Change inner brace (ci{)
   * T-Lisp: (change-inner-brace)
   */
  ops.set("change-inner-brace", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return createNil();
    }

    const result = changeInnerBrace(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return createNil();
    }

    setCurrentBuffer(result.right);
    setMode("insert");
    return createSymbol("INSERT");
  });

  /**
   * Delete inner bracket (di])
   * T-Lisp: (delete-inner-bracket)
   */
  ops.set("delete-inner-bracket", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return createNil();
    }

    const result = deleteInnerBracket(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return createNil();
    }

    setCurrentBuffer(result.right);
    return createNil();
  });

  /**
   * Delete inner angle bracket (di<)
   * T-Lisp: (delete-inner-angle)
   */
  ops.set("delete-inner-angle", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return createNil();
    }

    const result = deleteInnerAngle(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return createNil();
    }

    setCurrentBuffer(result.right);
    return createNil();
  });

  /**
   * Delete inner tag (dit)
   * T-Lisp: (delete-inner-tag)
   */
  ops.set("delete-inner-tag", () => {
    const buffer = getCurrentBuffer();
    if (!buffer) {
      return createNil();
    }

    const result = deleteInnerTag(buffer, getCursorLine(), getCursorColumn());
    if (Either.isLeft(result)) {
      return createNil();
    }

    setCurrentBuffer(result.right);
    return createNil();
  });

  return ops;
}
