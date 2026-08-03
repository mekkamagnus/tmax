/**
 * @file case-ops.ts
 * @description Character transposition + word-level case operations (SPEC-080)
 *
 * Pure primitives only — no editor decisions. Each op performs a factual
 * buffer mutation (immutable `buffer.replace` -> `setBuffer`, mirroring
 * `visual-ops.ts:446-459` so undo groups each as one step) and a factual
 * cursor placement. The Emacs-style "advance to next word" / "no-op at end
 * of buffer" semantics live here only as far as the word-boundary scan
 * demands; higher-level decisions stay in T-Lisp.
 *
 * Word boundaries reuse `isWordChar` / `findWordEnd` from `text-utils.ts`
 * (the same source of truth used by `word-ops.ts`).
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createString } from "../../tlisp/values.ts";
import type { TextBuffer } from "../../core/contracts/buffer.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
import { Either } from "../../utils/task-either.ts";
import { validateArgsCount, validateBufferExists } from "../../utils/validation.ts";
import { createBufferError, AppError } from "../../error/types.ts";
import { isWordChar, findWordEnd } from "./text-utils.ts";

/**
 * Create case/transposition primitive API functions.
 * @param access - Editor model access (cursor/buffer reads via State monad)
 * @param setCurrentBuffer - Push the new immutable buffer so undo groups the step
 * @param setCursorLine - Set cursor line
 * @param setCursorColumn - Set cursor column
 * @returns Map of primitive names to implementations
 */
export function createCaseOps(
  access: EditorModelAccess,
  setCurrentBuffer: (buffer: TextBuffer) => void,
  setCursorLine: (line: number) => void,
  setCursorColumn: (column: number) => void
): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: cursor/buffer reads flow through the State monad against
  // EditorModel. Buffer writes stay on the supplied setter so undo grouping
  // (setBuffer) is preserved.
  const getCursorLine = (): number => runModel(access, readModelField("cursorPosition")).line;
  const getCursorColumn = (): number => runModel(access, readModelField("cursorPosition")).column;
  const getCurrentBuffer = (): TextBuffer | null =>
    runModel(access, readModelField("currentBuffer")) ?? null;
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * transpose-chars - SPEC-080.
   * Swap the char at point with the char immediately before it, advancing
   * point by one. At column 0 (and not on the first line) transpose the last
   * char of the previous line with the first char of the current line
   * (Emacs C-t cross-line behavior). No-op on a buffer too short to transpose.
   *
   * Usage: (transpose-chars) -> string (the swapped pair) | nil
   */
  api.set("transpose-chars", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "transpose-chars");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const buffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(buffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const contentResult = buffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }
    const content = contentResult.right;
    if (content.length < 2) {
      return Either.right(createNil());
    }

    const lines = content.split('\n');
    const line = Math.max(0, Math.min(getCursorLine(), lines.length - 1));
    const lineText = lines[line]!;
    const col = Math.max(0, Math.min(getCursorColumn(), lineText.length));

    let range: { startLine: number; startCol: number; endLine: number; endCol: number } | null = null;

    if (col >= 1 && col <= lineText.length && lineText.length >= 2) {
      // Same-line transpose: swap lineText[col-1] with lineText[col].
      // When the cursor is at end-of-line (col === lineText.length), swap the
      // last two chars of the line (Emacs allows this).
      const a = col - 1;
      const b = col < lineText.length ? col : col - 1;
      if (a !== b) {
        range = { startLine: line, startCol: a, endLine: line, endCol: b + 1 };
      }
    }

    if (!range && col === 0 && line > 0) {
      // Cross-line transpose: last char of previous line with first char of this.
      const prevLine = lines[line - 1]!;
      if (prevLine.length >= 1 && lineText.length >= 1) {
        range = {
          startLine: line - 1,
          startCol: prevLine.length - 1,
          endLine: line,
          endCol: 1
        };
      }
    }

    if (!range) {
      return Either.right(createNil());
    }

    // Fetch the two-char span, reverse it, replace.
    const start = { line: range.startLine, column: range.startCol };
    const end = { line: range.endLine, column: range.endCol };
    const textResult = buffer!.getText({ start, end });
    if (Either.isLeft(textResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get transpose span: ${textResult.left}`));
    }
    const span = textResult.right;
    if (span.length !== 2) {
      return Either.right(createNil());
    }
    const swapped = span[1]! + span[0]!;
    const replaceResult = buffer!.replace({ start, end }, swapped);
    if (Either.isLeft(replaceResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to transpose: ${replaceResult.left}`));
    }
    setCurrentBuffer(replaceResult.right);

    // Advance point to land one past the start char (i.e. on the second char
    // of the now-swapped pair). For same-line this is column `col+1` clamped;
    // for cross-line this is column 1 of the current line.
    if (range.startLine === range.endLine) {
      setCursorLine(range.startLine);
      setCursorColumn(Math.min(range.endCol, lines[line]!.length));
    } else {
      setCursorLine(range.endLine);
      setCursorColumn(1);
    }

    return Either.right(createString(swapped));
  });

  /**
   * Shared word-case transform: locate the word at point (or the next word
   * forward when point sits on a non-word char, per Emacs semantics), apply
   * the transform, replace the span, and land point after the transformed
   * word so repeated invocations advance word by word.
   */
  const transformWordAtPoint = (
    transform: (s: string) => string,
    opName: string
  ): Either<AppError, TLispValue> => {
    const buffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(buffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const contentResult = buffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }
    const text = contentResult.right;
    if (text.length === 0) {
      return Either.right(createNil());
    }

    const lines = text.split('\n');
    const line = Math.max(0, Math.min(getCursorLine(), lines.length - 1));
    const lineText = lines[line]!;
    let col = Math.max(0, Math.min(getCursorColumn(), lineText.length));

    // Resolve the word at point, or skip forward to the next word.
    // findWordEnd returns the column AFTER the last word char on this line.
    // When point is not on a word char it skips forward (Emacs semantics).
    if (col >= lineText.length || !isWordChar(lineText[col]!)) {
      // Scan forward to the next word on this line.
      while (col < lineText.length && !isWordChar(lineText[col]!)) {
        col++;
      }
      if (col >= lineText.length) {
        // No word forward on this line; nothing to do.
        return Either.right(createNil());
      }
    }

    const wordEndCol = findWordEnd(text, line, col).column;
    if (wordEndCol <= col || wordEndCol > lineText.length) {
      return Either.right(createNil());
    }

    const start = { line, column: col };
    const end = { line, column: wordEndCol };
    const wordResult = buffer!.getText({ start, end });
    if (Either.isLeft(wordResult)) {
      return Either.left(createBufferError('InvalidOperation', `${opName}: failed to get word: ${wordResult.left}`));
    }
    const transformed = transform(wordResult.right);
    const replaceResult = buffer!.replace({ start, end }, transformed);
    if (Either.isLeft(replaceResult)) {
      return Either.left(createBufferError('InvalidOperation', `${opName}: failed to replace word: ${replaceResult.left}`));
    }
    setCurrentBuffer(replaceResult.right);

    // Land point after the transformed word (Emacs: repeated M-u walks words).
    setCursorLine(line);
    setCursorColumn(wordEndCol);

    return Either.right(createString(transformed));
  };

  /**
   * upcase-word - SPEC-080. Uppercase the word at (or just after) point.
   * Usage: (upcase-word) -> string | nil
   */
  api.set("upcase-word", (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(_args, 0, "upcase-word");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }
    return transformWordAtPoint((s) => s.toUpperCase(), "upcase-word");
  });

  /**
   * downcase-word - SPEC-080. Lowercase the word at (or just after) point.
   * Usage: (downcase-word) -> string | nil
   */
  api.set("downcase-word", (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(_args, 0, "downcase-word");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }
    return transformWordAtPoint((s) => s.toLowerCase(), "downcase-word");
  });

  /**
   * capitalize-word - SPEC-080. Capitalize the first letter, lowercase the
   * rest, of the word at (or just after) point (Emacs M-c semantics).
   * Usage: (capitalize-word) -> string | nil
   */
  api.set("capitalize-word", (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(_args, 0, "capitalize-word");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }
    return transformWordAtPoint(
      (s) => (s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1).toLowerCase()),
      "capitalize-word"
    );
  });

  return api;
}
