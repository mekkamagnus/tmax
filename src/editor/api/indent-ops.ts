/**
 * @file indent-ops.ts
 * @description Indent operation primitives for T-Lisp editor API
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createList } from "../../tlisp/values.ts";
import type { TextBuffer } from "../../core/types.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
import { Either } from "../../utils/task-either.ts";
import {
  validateArgsCount,
  validateArgType,
  validateBufferExists
} from "../../utils/validation.ts";
import {
  createValidationError,
  createBufferError,
  AppError
} from "../../error/types.ts";

/**
 * WeakMap for storing indent rules keyed by buffer object reference.
 * This avoids needing the buffer name string directly.
 */
const indentRulesByBuffer: WeakMap<TextBuffer, { increase: string[]; decrease: string[] }> = new WeakMap();

/**
 * Helper: extract a list of strings from a T-Lisp list value
 */
function extractStringList(listVal: TLispValue, argName: string, funcName: string): Either<AppError, string[]> {
  if (listVal.type !== "list") {
    return Either.left(createValidationError(
      'TypeError',
      `${funcName} requires a list for ${argName}`,
      argName,
      listVal,
      'list'
    ));
  }
  const items = listVal.value as TLispValue[];
  const strings: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.type !== "string") {
      return Either.left(createValidationError(
        'TypeError',
        `${funcName}: ${argName} must contain only strings, got ${item.type} at index ${i}`,
        argName,
        item,
        'string'
      ));
    }
    strings.push(item.value as string);
  }
  return Either.right(strings);
}

/**
 * Create indent operation API functions
 * @param getCurrentBuffer - Function to get current buffer
 * @param setCurrentBuffer - Function to set current buffer
 * @param getCursorLine - Function to get cursor line
 * @param setCursorLine - Function to set cursor line
 * @param getTabSize - Function to get current tab size
 * @returns Map of indent function names to implementations
 */
export function createIndentOps(
  access: EditorModelAccess,
  setCurrentBuffer: (buffer: TextBuffer) => void,
  setCursorLine: (line: number) => void,
  getTabSize: () => number
): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: cursor/buffer reads flow through the State monad against
  // EditorModel; writes stay on the supplied setters to preserve side effects.
  const getCursorLine = (): number => runModel(access, readModelField("cursorPosition")).line;
  const getCurrentBuffer = (): TextBuffer | null =>
    runModel(access, readModelField("currentBuffer")) ?? null;
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * indent-calculate-column - calculate indent column for a line
   * Usage: (indent-calculate-column LINE INCREASE-PATTERNS DECREASE-PATTERNS)
   *
   * Takes a line number and two lists of regex strings. Gets previous non-blank
   * line's indent. For each increase pattern, if previous line matches it, add tabSize.
   * For each decrease pattern, if current line matches it, subtract tabSize.
   * Returns the calculated column number.
   */
  api.set("indent-calculate-column", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 3, "indent-calculate-column");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const lineArg = args[0]!
    const lineTypeValidation = validateArgType(lineArg, "number", 0, "indent-calculate-column");
    if (Either.isLeft(lineTypeValidation)) {
      return Either.left(lineTypeValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const increaseResult = extractStringList(args[1]!, "increase-patterns", "indent-calculate-column");
    if (Either.isLeft(increaseResult)) {
      return Either.left(increaseResult.left);
    }

    const decreaseResult = extractStringList(args[2]!, "decrease-patterns", "indent-calculate-column");
    if (Either.isLeft(decreaseResult)) {
      return Either.left(decreaseResult.left);
    }

    const lineNumber = lineArg.value as number;
    const increasePatterns = increaseResult.right;
    const decreasePatterns = decreaseResult.right;
    const tabSize = getTabSize();

    // Validate line number
    const lineCountResult = currentBuffer!.getLineCount();
    if (Either.isLeft(lineCountResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line count: ${lineCountResult.left}`));
    }

    if (lineNumber < 0 || lineNumber >= lineCountResult.right) {
      return Either.left(createBufferError('OutOfBounds', `Line number ${lineNumber} out of bounds`));
    }

    // Get current line content
    const currentLineResult = currentBuffer!.getLine(lineNumber);
    if (Either.isLeft(currentLineResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line ${lineNumber}: ${currentLineResult.left}`));
    }
    const currentLineText = currentLineResult.right;

    // Find previous non-blank line
    let prevLineNum = -1;
    let prevLineIndent = 0;
    let prevLineText = "";

    for (let i = lineNumber - 1; i >= 0; i--) {
      const lineResult = currentBuffer!.getLine(i);
      if (Either.isLeft(lineResult)) {
        continue;
      }
      const text = lineResult.right;
      if (text.trim().length > 0) {
        prevLineNum = i;
        prevLineText = text;
        const match = text.match(/^( *)/);
        prevLineIndent = match ? match[1]!.length : 0;
        break;
      }
    }

    // Start from previous indent (or 0 if no previous non-blank line)
    let column = prevLineIndent;

    // Apply increase patterns: if previous line matches, add tabSize
    if (prevLineNum >= 0) {
      for (const pattern of increasePatterns) {
        try {
          const regex = new RegExp(pattern);
          if (regex.test(prevLineText)) {
            column += tabSize;
          }
        } catch {
          return Either.left(createValidationError(
            'FormatError',
            `indent-calculate-column: invalid regex pattern: ${pattern}`,
            'increase-patterns',
            pattern,
            'valid regex'
          ));
        }
      }
    }

    // Apply decrease patterns: if current line matches, subtract tabSize
    for (const pattern of decreasePatterns) {
      try {
        const regex = new RegExp(pattern);
        if (regex.test(currentLineText)) {
          column -= tabSize;
        }
      } catch {
        return Either.left(createValidationError(
          'FormatError',
          `indent-calculate-column: invalid regex pattern: ${pattern}`,
          'decrease-patterns',
          pattern,
          'valid regex'
        ));
      }
    }

    // Clamp to non-negative
    if (column < 0) {
      column = 0;
    }

    return Either.right(createNumber(column));
  });

  /**
   * indent-set-rules - store indent rules for current buffer
   * Usage: (indent-set-rules INCREASE DECREASE)
   *
   * Takes 2 lists of strings. Stores them keyed by buffer reference.
   * Returns nil.
   */
  api.set("indent-set-rules", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "indent-set-rules");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.right(createNil());
    }

    const increaseResult = extractStringList(args[0]!, "increase", "indent-set-rules");
    if (Either.isLeft(increaseResult)) {
      return Either.left(increaseResult.left);
    }

    const decreaseResult = extractStringList(args[1]!, "decrease", "indent-set-rules");
    if (Either.isLeft(decreaseResult)) {
      return Either.left(decreaseResult.left);
    }

    indentRulesByBuffer.set(currentBuffer!, {
      increase: increaseResult.right,
      decrease: decreaseResult.right
    });

    return Either.right(createNil());
  });

  /**
   * indent-get-rules - get indent rules for current buffer
   * Usage: (indent-get-rules)
   *
   * Returns the current buffer's indent rules as a T-Lisp list of two lists:
   * (increase-rules decrease-rules). Returns nil if no rules set.
   */
  api.set("indent-get-rules", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "indent-get-rules");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const rules = indentRulesByBuffer.get(currentBuffer!);
    if (!rules) {
      return Either.right(createNil());
    }

    const increaseList = createList(rules.increase.map(s => createString(s)));
    const decreaseList = createList(rules.decrease.map(s => createString(s)));

    return Either.right(createList([increaseList, decreaseList]));
  });

  /**
   * indent-apply-line - calculate indent for a line and return the column
   * Usage: (indent-apply-line LINE)
   *
   * Gets rules, calculates column for LINE. Returns the calculated column
   * as a number so T-Lisp can use it with buffer-set-line-indent.
   */
  api.set("indent-apply-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "indent-apply-line");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const lineArg = args[0]!
    const lineTypeValidation = validateArgType(lineArg, "number", 0, "indent-apply-line");
    if (Either.isLeft(lineTypeValidation)) {
      return Either.left(lineTypeValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const rules = indentRulesByBuffer.get(currentBuffer!);
    if (!rules) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'indent-apply-line: no indent rules set for current buffer',
        'rules',
        undefined,
        'indent rules via indent-set-rules'
      ));
    }

    // Delegate to indent-calculate-column with stored rules
    const result = api.get("indent-calculate-column")!([
      lineArg,
      createList(rules.increase.map(s => createString(s))),
      createList(rules.decrease.map(s => createString(s)))
    ]);

    return result;
  });

  /**
   * indent-apply-region - calculate indent for each line in a range
   * Usage: (indent-apply-region START END)
   *
   * Loops from START to END, for each line calculates indent column.
   * Returns nil.
   */
  api.set("indent-apply-region", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "indent-apply-region");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const startArg = args[0]!
    const startTypeValidation = validateArgType(startArg, "number", 0, "indent-apply-region");
    if (Either.isLeft(startTypeValidation)) {
      return Either.left(startTypeValidation.left);
    }

    const endArg = args[1]!
    const endTypeValidation = validateArgType(endArg, "number", 1, "indent-apply-region");
    if (Either.isLeft(endTypeValidation)) {
      return Either.left(endTypeValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const rules = indentRulesByBuffer.get(currentBuffer!);
    if (!rules) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'indent-apply-region: no indent rules set for current buffer',
        'rules',
        undefined,
        'indent rules via indent-set-rules'
      ));
    }

    const startLine = startArg.value as number;
    const endLine = endArg.value as number;

    // Calculate indent for each line
    for (let line = startLine; line <= endLine; line++) {
      const _colResult = api.get("indent-calculate-column")!([
        createNumber(line),
        createList(rules.increase.map(s => createString(s))),
        createList(rules.decrease.map(s => createString(s)))
      ]);
      // In a full implementation, we'd apply the column via buffer-set-line-indent here
    }

    return Either.right(createNil());
  });

  return api;
}
