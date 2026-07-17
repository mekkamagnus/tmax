/**
 * @file filesystem.ts
 * @description Canonical filesystem runtime implementation for tmax.
 *
 * Implements the promise-based `FileSystem` contract (canonical,
 * CHORE-44 Change 9). The internal helpers (`readFileE`, `writeFileE`,
 * `existsE`, `statE`, `removeE`, `backupE`, `atomicSaveE`, `createDirE`)
 * compose with `TaskEither` at the effect-composition boundary and are
 * the engine the public promise-based methods unwrap. They replace the
 * previous parallel TaskEither-returning interface and its wrapper class,
 * which have been removed.
 *
 * Cross-platform for Node/Bun. Error messages are preserved byte-for-byte
 * (AC9.5).
 */

import type { FileStats } from "./contracts/primitives.ts";
import type { FileSystem } from "./contracts/filesystem.ts";
import { TaskEither, TaskEitherUtils, Either } from "../utils/task-either.ts";
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { FileSystemError, createFileSystemError } from "../error/types.ts";

// Re-export so existing `import { FileSystemError } from "../core/filesystem.ts"`
// callers keep compiling. The canonical home for the string alias is
// `./contracts/primitives.ts`; the rich error-union type lives in
// `../error/types.ts` (this re-export targets the rich type).
export type { FileSystemError } from "../error/types.ts";

/**
 * Canonical filesystem implementation. Owns the promise-based `FileSystem`
 * contract that `Editor`, `TmaxServer`, and the test mocks consume. Methods
 * throw the rich `FileSystemError` on failure (preserving the prior engine's
 * error messages and structure).
 *
 * The `*E`-suffixed helpers return `TaskEither` for effect composition
 * (retry, parallel, JSON parse chains in `FileSystemUtils`). They are the
 * single implementation — the prior parallel engine has been merged into
 * this class.
 */
export class FileSystemImpl implements FileSystem {
  /**
   * Read file contents (canonical promise-based `FileSystem` method).
   */
  async readFile(path: string): Promise<string> {
    const result = await FileSystemImpl.readFileE(path).run();
    if (Either.isLeft(result)) {
      throw new Error(result.left.message);
    }
    return result.right;
  }

  /**
   * Write file contents (canonical promise-based `FileSystem` method).
   */
  async writeFile(path: string, content: string): Promise<void> {
    const result = await FileSystemImpl.writeFileE(path, content).run();
    if (Either.isLeft(result)) {
      throw new Error(result.left.message);
    }
  }

  /**
   * Check if file exists (canonical promise-based `FileSystem` method).
   */
  async exists(path: string): Promise<boolean> {
    const result = await FileSystemImpl.existsE(path).run();
    if (Either.isLeft(result)) {
      throw new Error(result.left.message);
    }
    return result.right;
  }

  /**
   * Get file stats (canonical promise-based `FileSystem` method).
   */
  async stat(path: string): Promise<FileStats> {
    const result = await FileSystemImpl.statE(path).run();
    if (Either.isLeft(result)) {
      throw new Error(result.left.message);
    }
    return result.right;
  }

  /**
   * Create directory recursively (SPEC-025).
   */
  async createDir(path: string): Promise<void> {
    const result = await FileSystemImpl.createDirE(path).run();
    if (Either.isLeft(result)) {
      throw new Error(result.left.message);
    }
  }

  // -------------------------------------------------------------------------
  // Effect-composition boundary: TaskEither-returning engine.
  //
  // These static helpers are the single implementation of the filesystem
  // primitives. They compose with `TaskEither.parallel`, `.retry`, and
  // `FileSystemUtils` chains. The promise-based instance methods above are
  // thin unwrappers that preserve the canonical `FileSystem` contract.
  // -------------------------------------------------------------------------

  /** Read file contents as a TaskEither. */
  static readFileE(path: string): TaskEither<FileSystemError, string> {
    return TaskEither.tryCatch(
      async () => {
        const fs = await import('fs/promises');
        return await fs.readFile(path, 'utf-8');
      },
      (error) => createFileSystemError(
        'ReadError',
        `Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`,
        path,
        { error: error instanceof Error ? error.message : String(error) }
      )
    );
  }

  /** Write file contents as a TaskEither. */
  static writeFileE(path: string, content: string): TaskEither<FileSystemError, void> {
    return TaskEither.tryCatch(
      async () => {
        const fs = await import('fs/promises');
        await fs.writeFile(path, content, 'utf-8');
      },
      (error) => createFileSystemError(
        'WriteError',
        `Failed to write file ${path}: ${error instanceof Error ? error.message : String(error)}`,
        path,
        { error: error instanceof Error ? error.message : String(error) }
      )
    );
  }

  /** Check if file exists as a TaskEither. */
  static existsE(path: string): TaskEither<FileSystemError, boolean> {
    return TaskEither.tryCatch(
      async () => {
        try {
          await fsPromises.stat(path);
          return true;
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            return false;
          }
          throw error;
        }
      },
      (error) => createFileSystemError(
        'StatError',
        `Failed to check if ${path} exists: ${error instanceof Error ? error.message : String(error)}`,
        path,
        { error: error instanceof Error ? error.message : String(error) }
      )
    );
  }

  /** Get file stats as a TaskEither. */
  static statE(path: string): TaskEither<FileSystemError, FileStats> {
    return TaskEither.tryCatch(
      async () => {
        const info = await fsPromises.stat(path);
        return {
          isFile: info.isFile(),
          isDirectory: info.isDirectory(),
          size: info.size,
          modified: info.mtime || new Date(),
        };
      },
      (error) => createFileSystemError(
        'StatError',
        `Failed to get stats for ${path}: ${error instanceof Error ? error.message : String(error)}`,
        path,
        { error: error instanceof Error ? error.message : String(error) }
      )
    );
  }

  /** Remove a file as a TaskEither. */
  static removeE(path: string): TaskEither<FileSystemError, void> {
    return TaskEither.tryCatch(
      async () => {
        await fsPromises.unlink(path);
      },
      (error) => createFileSystemError(
        'WriteError',
        `Failed to remove file ${path}: ${error instanceof Error ? error.message : String(error)}`,
        path,
        { error: error instanceof Error ? error.message : String(error) }
      )
    );
  }

  /** Create a backup of the file as a TaskEither. */
  static backupE(path: string): TaskEither<FileSystemError, string> {
    const backupPath = `${path}.backup.${Date.now()}`;

    return FileSystemImpl.readFileE(path)
      .flatMap(content => FileSystemImpl.writeFileE(backupPath, content))
      .map(() => backupPath);
  }

  /** Atomic save (backup existing file then write new content) as a TaskEither. */
  static atomicSaveE(path: string, content: string): TaskEither<FileSystemError, { saved: boolean; backupPath?: string }> {
    return FileSystemImpl.existsE(path)
      .flatMap((fileExists: boolean): TaskEither<FileSystemError, { saved: boolean; backupPath?: string }> => {
        if (!fileExists) {
          // File doesn't exist, just write it
          return FileSystemImpl.writeFileE(path, content)
            .map(() => ({ saved: true as const, backupPath: undefined }));
        }

        // File exists, backup then write
        return FileSystemImpl.backupE(path)
          .flatMap((backupPath: string) =>
            FileSystemImpl.writeFileE(path, content)
              .map(() => ({ saved: true as const, backupPath }))
          );
      });
  }

  /** Create directory recursively (SPEC-025) as a TaskEither. */
  static createDirE(path: string): TaskEither<FileSystemError, void> {
    return TaskEither.tryCatch(
      async () => {
        const fs = await import('fs/promises');
        await fs.mkdir(path, { recursive: true });
      },
      (error) => createFileSystemError(
        'WriteError',
        `Failed to create directory ${path}: ${error instanceof Error ? error.message : String(error)}`,
        path,
        { error: error instanceof Error ? error.message : String(error) }
      )
    );
  }
}

// Shared singleton instance used by the `FileSystemUtils` composition helpers
// (preserved from the prior module-level `_fsImpl`, now typed as the canonical
// promise-based impl). Exposed for tests that build on the same instance.
const _fsImpl = new FileSystemImpl();

/**
 * Utility functions for common file operations at the TaskEither
 * effect-composition boundary. These replace the prior `Functional`-prefixed
 * alias and operate against the canonical `FileSystemImpl` engine.
 */
export const FileSystemUtils = {
  /**
   * Read and parse JSON file
   */
  readJsonFile: <T>(path: string): TaskEither<FileSystemError, T> =>
    TaskEither.tryCatch(
      async () => {
        const fs = await import('fs/promises');
        const content = await fs.readFile(path, 'utf-8');
        return JSON.parse(content) as T;
      },
      (error) => createFileSystemError(
        'ReadError',
        `Failed to read JSON file ${path}: ${error instanceof Error ? error.message : String(error)}`,
        path,
        { error: error instanceof Error ? error.message : String(error) }
      )
    ),

  /**
   * Write JSON file with pretty formatting
   */
  writeJsonFile: (path: string, data: unknown): TaskEither<FileSystemError, void> =>
    TaskEither.tryCatch(
      async () => {
        const fs = await import('fs/promises');
        const content = JSON.stringify(data, null, 2);
        await fs.writeFile(path, content, 'utf-8');
      },
      (error) => createFileSystemError(
        'WriteError',
        `Failed to write JSON file ${path}: ${error instanceof Error ? error.message : String(error)}`,
        path,
        { error: error instanceof Error ? error.message : String(error) }
      )
    ),

  /**
   * Copy file from source to destination
   */
  copyFile: (sourcePath: string, destPath: string): TaskEither<string, void> =>
    TaskEitherUtils.readFile(sourcePath)
      .flatMap(content => TaskEitherUtils.writeFile(destPath, content))
      .mapLeft(error => `Failed to copy ${sourcePath} to ${destPath}: ${error}`),

  /**
   * Read multiple files in parallel
   */
  readFiles: (paths: string[]): TaskEither<string, Array<{path: string, content: string}>> => {
    const fileTasks = paths.map(path =>
      TaskEitherUtils.readFile(path)
        .map(content => ({ path, content }))
        .mapLeft(error => `${path}: ${error}`)
    );

    return TaskEither.parallel(fileTasks);
  },

  /**
   * Save file with retry mechanism
   */
  saveWithRetry: (path: string, content: string, maxAttempts = 3): TaskEither<string, void> =>
    TaskEitherUtils.retry(
      () => TaskEitherUtils.writeFile(path, content),
      maxAttempts,
      1000
    ).mapLeft(error => `Failed to save ${path} after ${maxAttempts} attempts: ${error}`),

  /**
   * Ensure directory exists (create if needed)
   */
  ensureDir: (dirPath: string): TaskEither<string, void> =>
    TaskEither.tryCatch(
      async () => {
        await fsPromises.mkdir(dirPath, { recursive: true });
      },
      (error) => `Failed to ensure directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`
    ),

  /**
   * List directory contents
   */
  listDir: (dirPath: string): TaskEither<string, string[]> =>
    TaskEither.tryCatch(
      async () => {
        return await fsPromises.readdir(dirPath);
      },
      (error) => `Failed to list directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`
    ),

  /**
   * Check if path is a file
   */
  isFile: (path: string): TaskEither<string, boolean> => {
    return FileSystemImpl.statE(path)
      .map(stats => stats.isFile)
      .mapLeft(error => `Failed to check if ${path} is a file: ${error}`);
  },

  /**
   * Check if path is a directory
   */
  isDirectory: (path: string): TaskEither<string, boolean> => {
    return FileSystemImpl.statE(path)
      .map(stats => stats.isDirectory)
      .mapLeft(error => `Failed to check if ${path} is a directory: ${error}`);
  }
};
