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
  setCursorColumn: (column: number) => void,
  getCurrentFilename?: () => string | undefined,
  setCurrentFilename?: (path: string) => void,
  getBufferModified?: () => boolean,
  setBufferModified?: (flag: boolean) => void,
  readonlyBuffers?: Set<string>
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();
  const readonly = readonlyBuffers ?? new Set<string>();

  function isReadonly(): boolean {
    for (const [name, buf] of buffers) {
      if (buf === getCurrentBuffer() && readonly.has(name)) return true;
    }
    return false;
  }

  api.set("buffer-create", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "buffer-create");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const nameArg = args[0]!
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

    const nameArg = args[0]!
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
      return Either.left({ type: 'BufferError', variant: 'InvalidOperation', message: contentResult.left });
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
      const lineArg = args[0]!
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

    if (isReadonly()) return Either.left(createBufferError('ReadOnly', 'Buffer is read-only'));

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const textArg = args[0]!
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
    setBufferModified?.(true);

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

    if (isReadonly()) return Either.left(createBufferError('ReadOnly', 'Buffer is read-only'));

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const countArg = args[0]!
    const typeValidation = validateArgType(countArg, "number", 0, "buffer-delete");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const count = Math.max(0, countArg.value as number);
    if (count === 0) {
      return Either.right(createString(""));
    }

    const lineResult = currentBuffer!.getLine(getCursorLine());
    if (Either.isLeft(lineResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line: ${lineResult.left}`));
    }

    const startColumn = Math.max(0, Math.min(getCursorColumn(), lineResult.right.length));
    const endColumn = Math.min(startColumn + count, lineResult.right.length);
    const deletedText = lineResult.right.slice(startColumn, endColumn);

    const deleteResult = currentBuffer!.delete({
      start: { line: getCursorLine(), column: startColumn },
      end: { line: getCursorLine(), column: endColumn }
    });

    if (Either.isLeft(deleteResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to delete: ${deleteResult.left}`));
    }

    setCurrentBuffer(deleteResult.right);
    setCursorColumn(startColumn);
    setBufferModified?.(true);

    return Either.right(createString(deletedText));
  });

  api.set("buffer-insert-at-position", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 3, "buffer-insert-at-position");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    if (isReadonly()) return Either.left(createBufferError('ReadOnly', 'Buffer is read-only'));

    const lineArg = args[0]!
    const lineValidation = validateArgType(lineArg, "number", 0, "buffer-insert-at-position");
    if (Either.isLeft(lineValidation)) {
      return Either.left(lineValidation.left);
    }

    const colArg = args[1]!
    const colValidation = validateArgType(colArg, "number", 1, "buffer-insert-at-position");
    if (Either.isLeft(colValidation)) {
      return Either.left(colValidation.left);
    }

    const textArg = args[2]!
    const textValidation = validateArgType(textArg, "string", 2, "buffer-insert-at-position");
    if (Either.isLeft(textValidation)) {
      return Either.left(textValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const line = Math.max(0, lineArg.value as number);
    const column = Math.max(0, colArg.value as number);
    const text = textArg.value as string;
    const position = { line, column };

    const insertResult = currentBuffer!.insert(position, text);
    if (Either.isLeft(insertResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to insert text: ${insertResult.left}`));
    }

    setCurrentBuffer(insertResult.right);

    const insertedLines = text.split("\n");
    if (insertedLines.length > 1) {
      setCursorLine(line + insertedLines.length - 1);
      setCursorColumn(insertedLines[insertedLines.length - 1]!.length);
    } else {
      setCursorLine(line);
      setCursorColumn(column + text.length);
    }
    setBufferModified?.(true);

    return Either.right(createString(text));
  });

  api.set("buffer-get-range", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 4, "buffer-get-range");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const values: number[] = [];
    for (let i = 0; i < 4; i++) {
      const arg = args[i]!
      const validation = validateArgType(arg, "number", i, "buffer-get-range");
      if (Either.isLeft(validation)) {
        return Either.left(validation.left);
      }
      values.push(arg.value as number);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const textResult = currentBuffer!.getText({
      start: { line: values[0]!, column: values[1]! },
      end: { line: values[2]!, column: values[3]! }
    });
    if (Either.isLeft(textResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get range: ${textResult.left}`));
    }

    return Either.right(createString(textResult.right));
  });

  api.set("buffer-delete-range", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 4, "buffer-delete-range");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    if (isReadonly()) return Either.left(createBufferError('ReadOnly', 'Buffer is read-only'));

    const values: number[] = [];
    for (let i = 0; i < 4; i++) {
      const arg = args[i]!
      const validation = validateArgType(arg, "number", i, "buffer-delete-range");
      if (Either.isLeft(validation)) {
        return Either.left(validation.left);
      }
      values.push(arg.value as number);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const range = {
      start: { line: values[0]!, column: values[1]! },
      end: { line: values[2]!, column: values[3]! }
    };

    const textResult = currentBuffer!.getText(range);
    if (Either.isLeft(textResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get deleted range: ${textResult.left}`));
    }

    const deleteResult = currentBuffer!.delete(range);
    if (Either.isLeft(deleteResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to delete range: ${deleteResult.left}`));
    }

    setCurrentBuffer(deleteResult.right);
    setCursorLine(range.start.line);
    setCursorColumn(range.start.column);
    setBufferModified?.(true);

    return Either.right(createString(textResult.right));
  });

  // Buffer metadata primitives (SPEC-035 Phase 0a)

  api.set("buffer-filename", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "buffer-filename");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    if (!getCurrentFilename) {
      return Either.right(createNil());
    }

    const filename = getCurrentFilename();
    if (filename === undefined) {
      return Either.right(createNil());
    }

    return Either.right(createString(filename));
  });

  api.set("set-buffer-filename", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "set-buffer-filename");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const pathArg = args[0]!
    const typeValidation = validateArgType(pathArg, "string", 0, "set-buffer-filename");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    if (!setCurrentFilename) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'set-buffer-filename: filename setter not available',
        'setCurrentFilename',
        undefined,
        'function'
      ));
    }

    const path = pathArg.value as string;
    setCurrentFilename(path);
    return Either.right(createString(path));
  });

  api.set("buffer-modified-p", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "buffer-modified-p");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    if (!getBufferModified) {
      return Either.right(createBoolean(false));
    }

    return Either.right(createBoolean(getBufferModified()));
  });

  api.set("set-buffer-modified-p", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "set-buffer-modified-p");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const flagArg = args[0]!
    const typeValidation = validateArgType(flagArg, "boolean", 0, "set-buffer-modified-p");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    if (!setBufferModified) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'set-buffer-modified-p: modified setter not available',
        'setBufferModified',
        undefined,
        'function'
      ));
    }

    const flag = flagArg.value as boolean;
    setBufferModified(flag);
    return Either.right(createNil());
  });

  api.set("buffer-get-line-indent", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "buffer-get-line-indent");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const lineArg = args[0]!
    const typeValidation = validateArgType(lineArg, "number", 0, "buffer-get-line-indent");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const lineNumber = lineArg.value as number;
    const lineResult = currentBuffer!.getLine(lineNumber);
    if (Either.isLeft(lineResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line: ${lineResult.left}`));
    }

    const lineContent = lineResult.right;
    const match = lineContent.match(/^( *)/);
    const indent = match ? match[1]!.length : 0;

    return Either.right(createNumber(indent));
  });

  api.set("buffer-set-line-indent", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "buffer-set-line-indent");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const lineArg = args[0]!
    const lineTypeValidation = validateArgType(lineArg, "number", 0, "buffer-set-line-indent");
    if (Either.isLeft(lineTypeValidation)) {
      return Either.left(lineTypeValidation.left);
    }

    const colArg = args[1]!
    const colTypeValidation = validateArgType(colArg, "number", 1, "buffer-set-line-indent");
    if (Either.isLeft(colTypeValidation)) {
      return Either.left(colTypeValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const lineNumber = lineArg.value as number;
    const targetColumn = colArg.value as number;

    const lineResult = currentBuffer!.getLine(lineNumber);
    if (Either.isLeft(lineResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line: ${lineResult.left}`));
    }

    const lineContent = lineResult.right;
    const match = lineContent.match(/^( *)/);
    const currentIndent = match ? match[1]!.length : 0;

    if (currentIndent !== targetColumn) {
      // Delete existing indentation
      if (currentIndent > 0) {
        const deleteRange = {
          start: { line: lineNumber, column: 0 },
          end: { line: lineNumber, column: currentIndent }
        };
        const deleteResult = currentBuffer!.delete(deleteRange);
        if (Either.isLeft(deleteResult)) {
          return Either.left(createBufferError('InvalidOperation', `Failed to delete indent: ${deleteResult.left}`));
        }
        setCurrentBuffer(deleteResult.right);

        // Insert new indentation
        const newIndent = " ".repeat(targetColumn);
        const insertResult = deleteResult.right.insert({ line: lineNumber, column: 0 }, newIndent);
        if (Either.isLeft(insertResult)) {
          return Either.left(createBufferError('InvalidOperation', `Failed to insert indent: ${insertResult.left}`));
        }
        setCurrentBuffer(insertResult.right);
      } else {
        // No existing indent, just insert
        const newIndent = " ".repeat(targetColumn);
        const insertResult = currentBuffer!.insert({ line: lineNumber, column: 0 }, newIndent);
        if (Either.isLeft(insertResult)) {
          return Either.left(createBufferError('InvalidOperation', `Failed to insert indent: ${insertResult.left}`));
        }
        setCurrentBuffer(insertResult.right);
      }
    }

    return Either.right(createNil());
  });

  api.set("buffer-previous-non-blank-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "buffer-previous-non-blank-line");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const lineArg = args[0]!
    const typeValidation = validateArgType(lineArg, "number", 0, "buffer-previous-non-blank-line");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const startLine = lineArg.value as number;

    for (let i = startLine - 1; i >= 0; i--) {
      const lineResult = currentBuffer!.getLine(i);
      if (Either.isLeft(lineResult)) {
        continue;
      }
      if (lineResult.right.trim().length > 0) {
        return Either.right(createNumber(i));
      }
    }

    return Either.right(createNumber(-1));
  });

  api.set("buffer-line-matches", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "buffer-line-matches");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const lineArg = args[0]!
    const lineTypeValidation = validateArgType(lineArg, "number", 0, "buffer-line-matches");
    if (Either.isLeft(lineTypeValidation)) {
      return Either.left(lineTypeValidation.left);
    }

    const patternArg = args[1]!
    const patternTypeValidation = validateArgType(patternArg, "string", 1, "buffer-line-matches");
    if (Either.isLeft(patternTypeValidation)) {
      return Either.left(patternTypeValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const lineNumber = lineArg.value as number;
    const pattern = patternArg.value as string;

    const lineResult = currentBuffer!.getLine(lineNumber);
    if (Either.isLeft(lineResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line: ${lineResult.left}`));
    }

    try {
      const regex = new RegExp(pattern);
      const matches = regex.test(lineResult.right);
      return Either.right(createBoolean(matches));
    } catch {
      return Either.left(createValidationError(
        'FormatError',
        `buffer-line-matches: invalid regex pattern: ${pattern}`,
        'pattern',
        pattern,
        'valid regex'
      ));
    }
  });

  return api;
}
