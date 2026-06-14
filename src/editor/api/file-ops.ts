/**
 * @file file-ops.ts
 * @description File operations for T-Lisp editor API
 */

import * as fs from 'fs';
import type { EvalContext, TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList, createSymbol, createHashmap, createPromise } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { validateArgsCount, validateArgType } from "../../utils/validation.ts";
import { AppError } from "../../error/types.ts";
import { isAsyncMode } from "../../tlisp/async.ts";

/**
 * Filesystem interface for async operations (write-file-content).
 * Matches the core FileSystem interface subset needed here.
 */
export interface FileOpsFilesystem {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  stat: (path: string) => Promise<{ isFile: boolean; isDirectory: boolean; size: number; modified: Date }>;
  createDir: (path: string) => Promise<void>;
}

/**
 * T-Lisp function implementation that returns Either for error handling
 */
export type TLispFunctionWithEither = (args: TLispValue[]) => Either<AppError, TLispValue>;

function fsRuntimeError(operation: string, path: string, error: unknown): AppError {
  const message = error instanceof Error ? error.message : String(error);
  return {
    type: "EvalError",
    variant: "RuntimeError",
    message: `${operation}: ${message}`,
    details: { operation, path, error: message },
  };
}

/**
 * Create file operations API functions
 * @param operations - Editor operations reference
 * @param setStatusMessage - Function to set status message
 * @param filesystem - Optional filesystem interface for async operations
 * @param logMessage - Optional message logger (e.g. to *Messages* buffer)
 * @returns Map of file function names to implementations
 */
export function createFileOps(
  operations: { saveFile?: () => Promise<void>; openFile?: (filename: string) => Promise<void> } | undefined,
  setStatusMessage: (message: string) => void,
  filesystem?: FileOpsFilesystem,
  logMessage?: (msg: string) => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();
  const log = logMessage ?? ((_msg: string) => {});

  // --- Async fire-and-forget ---

  api.set("write-file-content", (args: TLispValue[], context?: EvalContext): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "write-file-content");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const pathArg = args[0]!
    const pathTypeValidation = validateArgType(pathArg, "string", 0, "write-file-content");
    if (Either.isLeft(pathTypeValidation)) {
      return Either.left(pathTypeValidation.left);
    }

    const contentArg = args[1]!
    const contentTypeValidation = validateArgType(contentArg, "string", 1, "write-file-content");
    if (Either.isLeft(contentTypeValidation)) {
      return Either.left(contentTypeValidation.left);
    }

    const path = pathArg.value as string;
    const content = contentArg.value as string;

    if (isAsyncMode(context)) {
      const writePromise = filesystem
        ? filesystem.writeFile(path, content)
        : fs.promises.writeFile(path, content, "utf-8");
      return Either.right(createPromise(writePromise.then(() => createNil()).catch((error) => {
        throw fsRuntimeError("write-file-content", path, error);
      })));
    }

    if (filesystem) {
      filesystem.writeFile(path, content)
        .then(() => log(`Wrote ${path}`))
        .catch((e) => log(`Write error: ${e instanceof Error ? e.message : String(e)}`));
    } else {
      setStatusMessage("write-file-content: no filesystem available");
    }

    return Either.right(createNil());
  });

  // --- Synchronous reads (fs.readFileSync) ---

  api.set("read-file-content", (args: TLispValue[], context?: EvalContext): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "read-file-content");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const pathArg = args[0]!
    const typeValidation = validateArgType(pathArg, "string", 0, "read-file-content");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const path = (pathArg.value as string).replace(/^~/, process.env.HOME ?? '~');
    if (isAsyncMode(context)) {
      return Either.right(createPromise(fs.promises.readFile(path, 'utf-8')
        .then((content) => createString(content))
        .catch(() => createNil())));
    }

    try {
      const content = fs.readFileSync(path, 'utf-8');
      return Either.right(createString(content));
    } catch {
      return Either.right(createNil());
    }
  });

  // --- Synchronous stat-based ---

  api.set("file-exists-p", (args: TLispValue[], context?: EvalContext): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "file-exists-p");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const pathArg = args[0]!
    const typeValidation = validateArgType(pathArg, "string", 0, "file-exists-p");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const path = pathArg.value as string;
    if (isAsyncMode(context)) {
      return Either.right(createPromise(fs.promises.access(path)
        .then(() => createBoolean(true))
        .catch(() => createBoolean(false))));
    }

    return Either.right(createBoolean(fs.existsSync(path)));
  });

  api.set("file-modtime", (args: TLispValue[], context?: EvalContext): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "file-modtime");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const pathArg = args[0]!
    const typeValidation = validateArgType(pathArg, "string", 0, "file-modtime");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const path = pathArg.value as string;
    if (isAsyncMode(context)) {
      return Either.right(createPromise(fs.promises.stat(path)
        .then((stat) => createString(stat.mtime.toISOString()))
        .catch(() => createNil())));
    }

    try {
      const stat = fs.statSync(path);
      return Either.right(createString(stat.mtime.toISOString()));
    } catch {
      return Either.right(createNil());
    }
  });

  api.set("file-stat", (args: TLispValue[], context?: EvalContext): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "file-stat");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const pathArg = args[0]!
    const typeValidation = validateArgType(pathArg, "string", 0, "file-stat");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const path = pathArg.value as string;
    const statToValue = (stat: fs.Stats) => createList([
      createSymbol("size"),
      createNumber(stat.size),
      createSymbol("modified"),
      createString(stat.mtime.toISOString()),
      createSymbol("isFile"),
      createBoolean(stat.isFile()),
      createSymbol("isDirectory"),
      createBoolean(stat.isDirectory()),
    ]);

    if (isAsyncMode(context)) {
      return Either.right(createPromise(fs.promises.stat(path)
        .then((stat) => statToValue(stat))
        .catch(() => createNil())));
    }

    try {
      const stat = fs.statSync(path);
      return Either.right(statToValue(stat));
    } catch {
      return Either.right(createNil());
    }
  });

  api.set("file-copy", (args: TLispValue[], context?: EvalContext): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "file-copy");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const srcArg = args[0]!
    const srcTypeValidation = validateArgType(srcArg, "string", 0, "file-copy");
    if (Either.isLeft(srcTypeValidation)) {
      return Either.left(srcTypeValidation.left);
    }

    const destArg = args[1]!
    const destTypeValidation = validateArgType(destArg, "string", 1, "file-copy");
    if (Either.isLeft(destTypeValidation)) {
      return Either.left(destTypeValidation.left);
    }

    const src = srcArg.value as string;
    const dest = destArg.value as string;
    if (isAsyncMode(context)) {
      return Either.right(createPromise(fs.promises.copyFile(src, dest)
        .then(() => createNil())
        .catch((error) => {
          throw fsRuntimeError("file-copy", src, error);
        })));
    }

    try {
      fs.copyFileSync(src, dest);
      return Either.right(createNil());
    } catch {
      return Either.right(createNil());
    }
  });

  api.set("make-backup-file", (args: TLispValue[], context?: EvalContext): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "make-backup-file");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const pathArg = args[0]!
    const typeValidation = validateArgType(pathArg, "string", 0, "make-backup-file");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const path = pathArg.value as string;
    if (isAsyncMode(context)) {
      return Either.right(createPromise(fs.promises.copyFile(path, path + '~')
        .then(() => createNil())
        .catch((error) => {
          throw fsRuntimeError("make-backup-file", path, error);
        })));
    }

    try {
      fs.copyFileSync(path, path + '~');
      return Either.right(createNil());
    } catch {
      return Either.right(createNil());
    }
  });

  api.set("file-remove", (args: TLispValue[], context?: EvalContext): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "file-remove");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const pathArg = args[0]!
    const typeValidation = validateArgType(pathArg, "string", 0, "file-remove");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const path = pathArg.value as string;
    if (isAsyncMode(context)) {
      return Either.right(createPromise(fs.promises.unlink(path)
        .then(() => createNil())
        .catch(() => createNil())));
    }

    try {
      fs.unlinkSync(path);
    } catch {
      // swallow - return nil regardless
    }
    return Either.right(createNil());
  });

  api.set("file-mkdir", (args: TLispValue[], context?: EvalContext): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "file-mkdir");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const pathArg = args[0]!
    const typeValidation = validateArgType(pathArg, "string", 0, "file-mkdir");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const path = pathArg.value as string;
    if (isAsyncMode(context)) {
      return Either.right(createPromise(fs.promises.mkdir(path, { recursive: true })
        .then(() => createNil())
        .catch(() => createNil())));
    }

    try {
      fs.mkdirSync(path, { recursive: true });
    } catch {
      // swallow - return nil regardless
    }
    return Either.right(createNil());
  });

  // --- Directory listing ---

  api.set("read-dir", (args: TLispValue[], context?: EvalContext): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "read-dir");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const pathArg = args[0]!
    const typeValidation = validateArgType(pathArg, "string", 0, "read-dir");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const path = pathArg.value as string;
    const entryToValue = (entry: fs.Dirent, size: number, modified: string) => createHashmap([
      ["name", createString(entry.name)],
      ["isFile", createBoolean(entry.isFile())],
      ["isDirectory", createBoolean(entry.isDirectory())],
      ["size", createNumber(size)],
      ["modified", createString(modified)],
    ]);

    if (isAsyncMode(context)) {
      return Either.right(createPromise(fs.promises.readdir(path, { withFileTypes: true })
        .then(async (entries) => {
          const result = await Promise.all(entries.map(async (entry) => {
            const entryPath = path + '/' + entry.name;
            try {
              const stat = await fs.promises.stat(entryPath);
              return entryToValue(entry, stat.size, stat.mtime.toISOString());
            } catch {
              return entryToValue(entry, 0, '');
            }
          }));
          return createList(result);
        })
        .catch(() => createNil())));
    }

    try {
      const entries = fs.readdirSync(path, { withFileTypes: true });
      const result: TLispValue[] = entries.map((entry) => {
        const entryPath = path + '/' + entry.name;
        let size = 0;
        let modified = '';
        try {
          const stat = fs.statSync(entryPath);
          size = stat.size;
          modified = stat.mtime.toISOString();
        } catch {
          // use defaults for entries we can't stat
        }
        return entryToValue(entry, size, modified);
      });
      return Either.right(createList(result));
    } catch {
      return Either.right(createNil());
    }
  });

  return api;
}
