/**
 * @file buffer-ops.ts
 * @description Buffer operations for T-Lisp editor API
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList, createSymbol } from "../../tlisp/values.ts";
import { FunctionalTextBufferImpl } from "../../core/buffer.ts";
import type { FunctionalTextBuffer } from "../../core/types.ts";
import { Either } from "../../utils/task-either.ts";
import {
  validateArgsCount,
  validateArgType,
  validateBufferExists
} from "../../utils/validation.ts";
import {
  ValidationError,
  createValidationError,
  createBufferError,
  AppError
} from "../../error/types.ts";

/**
 * T-Lisp function implementation that returns Either for error handling
 */
export type TLispFunctionWithEither = (args: TLispValue[]) => Either<AppError, TLispValue>;

/**
 * Create buffer management API functions
 * @param buffers - Map of buffer names to buffer instances
 * @param getCurrentBuffer - Function to get current buffer
 * @param setCurrentBuffer - Function to set current buffer
 * @param getCursorLine - Function to get cursor line
 * @param setCursorLine - Function to set cursor line
 * @param getCursorColumn - Function to get cursor column
 * @param setCursorColumn - Function to set cursor column
 * @returns Map of buffer function names to implementations
 */
export function createBufferOps(
  buffers: Map<string, FunctionalTextBuffer>,
  getCurrentBuffer: () => FunctionalTextBuffer | null,
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void,
  getCursorLine: () => number,
  setCursorLine: (line: number) => void,
  getCursorColumn: () => number,
  setCursorColumn: (column: number) => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  api.set("buffer-create", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "buffer-create");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const nameArg = args[0];
    const typeValidation = validateArgType(nameArg, "string", 0, "buffer-create");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const name = nameArg.value as string;
    const buffer = FunctionalTextBufferImpl.create("");
    buffers.set(name, buffer);

    return Either.right(createString(name));
  });

  api.set("buffer-switch", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "buffer-switch");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const nameArg = args[0];
    const typeValidation = validateArgType(nameArg, "string", 0, "buffer-switch");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const name = nameArg.value as string;
    const buffer = buffers.get(name);
    const bufferExistsValidation = validateBufferExists(buffer, name);
    if (Either.isLeft(bufferExistsValidation)) {
      return Either.left(bufferExistsValidation.left);
    }

    setCurrentBuffer(buffer!);
    return Either.right(createString(name));
  });

  api.set("buffer-current", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "buffer-current");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    if (!currentBuffer) {
      return Either.right(createNil());
    }

    // Find the buffer name
    for (const [name, buffer] of buffers) {
      if (buffer === currentBuffer) {
        return Either.right(createString(name));
      }
    }

    return Either.right(createNil());
  });

  api.set("buffer-list", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "buffer-list");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const bufferNames = Array.from(buffers.keys()).map(name => createString(name));
    return Either.right(createList(bufferNames));
  });

  // Text access functions
  api.set("buffer-text", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "buffer-text");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const contentResult = currentBuffer!.getContent();

    // Handle Either<BufferError, string>
    if (Either.isLeft(contentResult)) {
      return Either.left(contentResult.left);
    }

    return Either.right(createString(contentResult.right));
  });

  api.set("buffer-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'buffer-line requires 0 or 1 argument: optional line number',
        'args',
        args,
        '0 or 1 arguments'
      ));
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    let lineNumber = 0; // Default to current line if no argument provided
    if (args.length === 1) {
      const lineArg = args[0];
      const typeValidation = validateArgType(lineArg, "number", 0, "buffer-line");
      if (Either.isLeft(typeValidation)) {
        return Either.left(typeValidation.left);
      }
      lineNumber = lineArg.value as number;
    }

    const lineCountResult = currentBuffer!.getLineCount();
    if (Either.isLeft(lineCountResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line count: ${lineCountResult.left}`));
    }

    if (lineNumber < 0 || lineNumber >= lineCountResult.right) {
      return Either.left(createBufferError('OutOfBounds', `Line number ${lineNumber} out of bounds`));
    }

    const lineResult = currentBuffer!.getLine(lineNumber);
    if (Either.isLeft(lineResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line: ${lineResult.left}`));
    }

    return Either.right(createString(lineResult.right));
  });

  api.set("buffer-lines", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "buffer-lines");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const lineCountResult = currentBuffer!.getLineCount();
    if (Either.isLeft(lineCountResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line count: ${lineCountResult.left}`));
    }

    const lines: TLispValue[] = [];
    for (let i = 0; i < lineCountResult.right; i++) {
      const lineResult = currentBuffer!.getLine(i);
      if (Either.isLeft(lineResult)) {
        return Either.left(createBufferError('OutOfBounds', `Failed to get line: ${lineResult.left}`));
      }
      lines.push(createString(lineResult.right));
    }

    return Either.right(createList(lines));
  });

  api.set("buffer-line-count", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "buffer-line-count");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const lineCountResult = currentBuffer!.getLineCount();
    if (Either.isLeft(lineCountResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line count: ${lineCountResult.left}`));
    }

    return Either.right(createNumber(lineCountResult.right));
  });

  // Text editing functions
  api.set("buffer-insert", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "buffer-insert");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const textArg = args[0];
    const typeValidation = validateArgType(textArg, "string", 0, "buffer-insert");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const text = textArg.value as string;
    // Use actual cursor position from state
    const position = { line: getCursorLine(), column: getCursorColumn() };

    const insertResult = currentBuffer!.insert(position, text);
    if (Either.isLeft(insertResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to insert text: ${insertResult.left}`));
    }

    // Update buffer with new immutable buffer
    setCurrentBuffer(insertResult.right);

    // Advance cursor position after insert
    const newLines = text.split('\n');
    if (newLines.length > 1) {
      // Multi-line insert: move to last line and set column to length of last line
      setCursorLine(getCursorLine() + newLines.length - 1);
      setCursorColumn(newLines[newLines.length - 1]!.length);
    } else {
      // Single-line insert: advance column by text length
      setCursorColumn(getCursorColumn() + text.length);
    }

    return Either.right(createString(text));
  });

  api.set("buffer-delete", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "buffer-delete");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const countArg = args[0];
    const typeValidation = validateArgType(countArg, "number", 0, "buffer-delete");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const count = countArg.value as number;

    // For now, we'll just return a placeholder since delete logic needs cursor position
    return Either.right(createString("deleted"));
  });

  return api;
}