/**
 * @file dired-ops.ts
 * @description Directory editor (dired) operations for T-Lisp editor API
 *
 * Dired provides a file manager interface within the editor. Operations
 * include formatting directory listings, marking files for deletion,
 * and refreshing the view.
 *
 * Available operations:
 * - dired-format-listing: Format directory entries into a display string
 * - dired-insert-listing: Insert formatted listing into current buffer
 * - dired-parse-current-entry: Extract filename from current line
 * - dired-is-directory-p: Check if an entry string is a directory
 * - dired-toggle-mark: Toggle delete mark on current line
 * - dired-get-marked: Return list of files marked for deletion
 * - dired-refresh: Re-read directory and rebuild listing
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList } from "../../tlisp/values.ts";
import type { TextBuffer } from "../../core/contracts/buffer.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
import { Either } from "../../utils/task-either.ts";
import {
  validateArgsCount,
  validateArgType,
  validateBufferExists,
} from "../../utils/validation.ts";
import {
  createValidationError,
  createBufferError,
  AppError,
} from "../../error/types.ts";

/**
 * Extract a value by key from a T-Lisp plist (alternating symbol/value list)
 */
function plistGet(entries: TLispValue[], key: string): TLispValue | undefined {
  for (let i = 0; i < entries.length - 1; i++) {
    if (entries[i]!.type === "symbol" && entries[i]!.value === key) {
      return entries[i + 1];
    }
  }
  return undefined;
}

type EntryLike = TLispValue[] | Map<string, TLispValue>;

function entryGet(entry: EntryLike, key: string): TLispValue | undefined {
  if (entry instanceof Map) return entry.get(key);
  return plistGet(entry, key);
}

/**
 * Format a single directory entry into a display line
 */
function formatEntryLine(entry: EntryLike, marked: boolean): string {
  const nameVal = entryGet(entry, "name");
  const isDirVal = entryGet(entry, "isDirectory");
  const sizeVal = entryGet(entry, "size");
  const modifiedVal = entryGet(entry, "modified");

  const name = nameVal && nameVal.type === "string" ? nameVal.value as string : "???";
  const isDir = isDirVal && isDirVal.type === "boolean" ? isDirVal.value as boolean : false;
  const size = sizeVal && sizeVal.type === "number" ? sizeVal.value as number : 0;
  const modified = modifiedVal && modifiedVal.type === "string" ? modifiedVal.value as string : "";

  const markPrefix = marked ? "D" : " ";
  const dirSuffix = isDir ? "/" : "";
  const permissions = isDir ? "drwxr-xr-x" : "-rw-r--r--";
  const sizeStr = String(size).padStart(10);
  const dateStr = modified.length >= 10 ? modified.substring(0, 10) : modified;

  return `${markPrefix}  ${permissions}  ${sizeStr}  ${dateStr}  ${name}${dirSuffix}`;
}

/**
 * Create dired operations API functions
 * @param getCurrentBuffer - Function to get current buffer
 * @param setCurrentBuffer - Function to set current buffer
 * @param getCursorLine - Function to get cursor line
 * @param buffers - Map of buffer names to buffer instances
 * @returns Map of dired function names to implementations
 */
export function createDiredOps(
  access: EditorModelAccess,
  setCurrentBuffer: (buffer: TextBuffer) => void,
  buffers: Map<string, TextBuffer>
): Map<string, TLispFunctionImpl> {
  // CHORE-44 Change 1: per-editor Dired state lives on the model-held
  // `access.getModel().session.dired` object; mutated in place.
  const s = access.getModel().session.dired;

  // CHORE-39 Phase 4: cursor/buffer reads flow through the State monad against
  // EditorModel; writes stay on the supplied setter to preserve side effects.
  const getCursorLine = (): number => runModel(access, readModelField("cursorPosition")).line;
  const getCurrentBuffer = (): TextBuffer | null =>
    runModel(access, readModelField("currentBuffer")) ?? null;
  const api = new Map<string, TLispFunctionImpl>();

  // (dired-format-listing PATH ENTRIES)
  api.set("dired-format-listing", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "dired-format-listing");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const pathArg = args[0]!
    const pathValidation = validateArgType(pathArg, "string", 0, "dired-format-listing");
    if (Either.isLeft(pathValidation)) {
      return Either.left(pathValidation.left);
    }

    const entriesArg = args[1]!
    const entriesValidation = validateArgType(entriesArg, "list", 1, "dired-format-listing");
    if (Either.isLeft(entriesValidation)) {
      return Either.left(entriesValidation.left);
    }

    const dirPath = pathArg.value as string;
    const entries = entriesArg.value as TLispValue[];

    // Each entry is a hashmap or plist (alternating symbol/value list)
    const entryValues = entries.map((e): EntryLike | null => {
      if (e.type === "hashmap") return e.value as Map<string, TLispValue>;
      if (e.type === "list") return (e.value as TLispValue[]).length > 0 ? e.value as TLispValue[] : null;
      return null;
    }).filter((e): e is EntryLike => e !== null);

    const lines: string[] = [];

    // Header line is the directory path
    lines.push(dirPath);

    // Format each entry
    for (let i = 0; i < entryValues.length; i++) {
      const marked = s.markedForDelete.has(i);
      lines.push(formatEntryLine(entryValues[i]!, marked));
    }

    return Either.right(createString(lines.join("\n")));
  });

  // (dired-insert-listing PATH ENTRIES)
  api.set("dired-insert-listing", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "dired-insert-listing");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const pathArg = args[0]!
    const pathValidation = validateArgType(pathArg, "string", 0, "dired-insert-listing");
    if (Either.isLeft(pathValidation)) {
      return Either.left(pathValidation.left);
    }

    const entriesArg = args[1]!
    const entriesValidation = validateArgType(entriesArg, "list", 1, "dired-insert-listing");
    if (Either.isLeft(entriesValidation)) {
      return Either.left(entriesValidation.left);
    }

    const dirPath = pathArg.value as string;
    s.path = dirPath;
    s.markedForDelete.clear();

    const entries = entriesArg.value as TLispValue[];
    const entryValues = entries.map((e): EntryLike | null => {
      if (e.type === "hashmap") return e.value as Map<string, TLispValue>;
      if (e.type === "list") return (e.value as TLispValue[]).length > 0 ? e.value as TLispValue[] : null;
      return null;
    }).filter((e): e is EntryLike => e !== null);

    const lines: string[] = [dirPath];
    for (let i = 0; i < entryValues.length; i++) {
      lines.push(formatEntryLine(entryValues[i]!, false));
    }

    const formatted = lines.join("\n");

    // Insert into current buffer
    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    // Clear buffer and insert the listing
    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const lineCountResult = currentBuffer!.getLineCount();
    if (Either.isLeft(lineCountResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get line count: ${lineCountResult.left}`));
    }

    // Delete entire buffer content and insert the listing
    if (lineCountResult.right > 0) {
      const deleteRange = {
        start: { line: 0, column: 0 },
        end: { line: lineCountResult.right - 1, column: 0 },
      };
      // Get last line length for accurate range
      const lastLineResult = currentBuffer!.getLine(lineCountResult.right - 1);
      if (Either.isRight(lastLineResult)) {
        deleteRange.end.column = lastLineResult.right.length;
      }

      const deleteResult = currentBuffer!.delete(deleteRange);
      if (Either.isLeft(deleteResult)) {
        return Either.left(createBufferError('InvalidOperation', `Failed to clear buffer: ${deleteResult.left}`));
      }

      const insertResult = deleteResult.right.insert({ line: 0, column: 0 }, formatted);
      if (Either.isLeft(insertResult)) {
        return Either.left(createBufferError('InvalidOperation', `Failed to insert listing: ${insertResult.left}`));
      }
      setCurrentBuffer(insertResult.right);
    } else {
      const insertResult = currentBuffer!.insert({ line: 0, column: 0 }, formatted);
      if (Either.isLeft(insertResult)) {
        return Either.left(createBufferError('InvalidOperation', `Failed to insert listing: ${insertResult.left}`));
      }
      setCurrentBuffer(insertResult.right);
    }

    return Either.right(createNil());
  });

  // (dired-parse-current-entry)
  api.set("dired-parse-current-entry", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "dired-parse-current-entry");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const line = getCursorLine();
    const lineResult = currentBuffer!.getLine(line);
    if (Either.isLeft(lineResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line ${line}: ${lineResult.left}`));
    }

    const lineContent = lineResult.right;
    // Extract filename: last column, stripping trailing /
    const parts = lineContent.trim().split(/\s+/);
    if (parts.length === 0) {
      return Either.right(createString(""));
    }

    const lastPart = parts[parts.length - 1]!;
    // Strip trailing / for directory entries
    const filename = lastPart.endsWith("/") ? lastPart.slice(0, -1) : lastPart;

    return Either.right(createString(filename));
  });

  // (dired-is-directory-p ENTRY)
  api.set("dired-is-directory-p", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "dired-is-directory-p");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const entryArg = args[0]!
    const typeValidation = validateArgType(entryArg, "string", 0, "dired-is-directory-p");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const entry = entryArg.value as string;
    return Either.right(createBoolean(entry.endsWith("/")));
  });

  // (dired-toggle-mark MARK)
  api.set("dired-toggle-mark", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "dired-toggle-mark");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const markArg = args[0]!
    const typeValidation = validateArgType(markArg, "string", 0, "dired-toggle-mark");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const mark = markArg.value as string;
    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const line = getCursorLine();

    if (mark === "D") {
      s.markedForDelete.add(line);
    } else {
      s.markedForDelete.delete(line);
    }

    // Modify the line in the buffer to show/hide the "D" prefix
    const lineResult = currentBuffer!.getLine(line);
    if (Either.isLeft(lineResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line ${line}: ${lineResult.left}`));
    }

    let lineContent = lineResult.right;

    if (mark === "D") {
      // Add "D" prefix if not already there
      if (!lineContent.startsWith("D")) {
        if (lineContent.startsWith(" ")) {
          lineContent = "D" + lineContent.substring(1);
        } else {
          lineContent = "D " + lineContent;
        }
      }
    } else {
      // Remove "D" prefix
      if (lineContent.startsWith("D")) {
        lineContent = " " + lineContent.substring(1);
      }
    }

    // Replace the line in the buffer
    const lineLenResult = currentBuffer!.getLine(line);
    if (Either.isLeft(lineLenResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line ${line}: ${lineLenResult.left}`));
    }

    const oldLineLength = lineLenResult.right.length;
    const deleteRange = {
      start: { line, column: 0 },
      end: { line, column: oldLineLength },
    };
    const deleteResult = currentBuffer!.delete(deleteRange);
    if (Either.isLeft(deleteResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to modify line: ${deleteResult.left}`));
    }

    const insertResult = deleteResult.right.insert({ line, column: 0 }, lineContent);
    if (Either.isLeft(insertResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to modify line: ${insertResult.left}`));
    }
    setCurrentBuffer(insertResult.right);

    return Either.right(createNil());
  });

  // (dired-get-marked)
  api.set("dired-get-marked", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "dired-get-marked");
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
      return Either.left(createBufferError('InvalidOperation', `Failed to get line count: ${lineCountResult.left}`));
    }

    const marked: TLispValue[] = [];

    for (let i = 0; i < lineCountResult.right; i++) {
      const lineResult = currentBuffer!.getLine(i);
      if (Either.isLeft(lineResult)) continue;

      const lineContent = lineResult.right;
      if (lineContent.startsWith("D")) {
        // Extract filename from this line (last column)
        const parts = lineContent.trim().split(/\s+/);
        if (parts.length > 0) {
          const lastPart = parts[parts.length - 1]!;
          const filename = lastPart.endsWith("/") ? lastPart.slice(0, -1) : lastPart;
          marked.push(createString(filename));
        }
      }
    }

    return Either.right(createList(marked));
  });

  // (dired-refresh)
  api.set("dired-refresh", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "dired-refresh");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    if (!s.path) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'dired-refresh: no directory path set',
        's.path',
        s.path,
        'non-empty directory path'
      ));
    }

    // Re-read the directory using sync fs calls (matching file-ops.ts pattern)
    try {
      const entries = fs.readdirSync(s.path, { withFileTypes: true });
      const result: TLispValue[] = entries
        .filter((entry) => {
          if (!s.showHidden && entry.name.startsWith(".")) return false;
          return true;
        })
        .map((entry) => {
          const entryPath = path.join(s.path, entry.name);
          let size = 0;
          let modified = "";
          try {
            const stat = fs.statSync(entryPath);
            size = stat.size;
            modified = stat.mtime.toISOString();
          } catch {
            // use defaults for entries we can't stat
          }
          return createList([
            createString("name"), createString(entry.name),
            createString("isFile"), createBoolean(entry.isFile()),
            createString("isDirectory"), createBoolean(entry.isDirectory()),
            createString("size"), createNumber(size),
            createString("modified"), createString(modified),
          ]);
        });

      // Build the formatted listing
      s.markedForDelete.clear();
      const lines: string[] = [s.path];
      for (const entryList of result) {
        const entryArr = entryList.value as TLispValue[];
        lines.push(formatEntryLine(entryArr, false));
      }

      // Insert into current buffer
      const currentBuffer = getCurrentBuffer();
      const bufferValidation = validateBufferExists(currentBuffer);
      if (Either.isLeft(bufferValidation)) {
        return Either.left(bufferValidation.left);
      }

      const formatted = lines.join("\n");

      const lineCountResult = currentBuffer!.getLineCount();
      if (Either.isLeft(lineCountResult)) {
        return Either.left(createBufferError('InvalidOperation', `Failed to get line count: ${lineCountResult.left}`));
      }

      if (lineCountResult.right > 0) {
        const lastLineResult = currentBuffer!.getLine(lineCountResult.right - 1);
        const deleteRange = {
          start: { line: 0, column: 0 },
          end: {
            line: lineCountResult.right - 1,
            column: Either.isRight(lastLineResult) ? lastLineResult.right.length : 0,
          },
        };

        const deleteResult = currentBuffer!.delete(deleteRange);
        if (Either.isLeft(deleteResult)) {
          return Either.left(createBufferError('InvalidOperation', `Failed to clear buffer: ${deleteResult.left}`));
        }

        const insertResult = deleteResult.right.insert({ line: 0, column: 0 }, formatted);
        if (Either.isLeft(insertResult)) {
          return Either.left(createBufferError('InvalidOperation', `Failed to insert listing: ${insertResult.left}`));
        }
        setCurrentBuffer(insertResult.right);
      } else {
        const insertResult = currentBuffer!.insert({ line: 0, column: 0 }, formatted);
        if (Either.isLeft(insertResult)) {
          return Either.left(createBufferError('InvalidOperation', `Failed to insert listing: ${insertResult.left}`));
        }
        setCurrentBuffer(insertResult.right);
      }

      return Either.right(createNil());
    } catch {
      return Either.left(createValidationError(
        'ConstraintViolation',
        `dired-refresh: failed to read directory '${s.path}'`,
        's.path',
        s.path,
        'readable directory'
      ));
    }
  });

  return api;
}
