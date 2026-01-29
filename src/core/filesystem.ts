/**
 * @file filesystem.ts
 * @description Functional file system operations using TaskEither for tmax editor
 * Cross-platform implementation for Node/Bun
 */

import type { FileStats, FileSystem } from "./types.ts";
import { TaskEither, TaskEitherUtils, Either } from "../utils/task-either.ts";
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';

/**
 * Functional file system operations interface using TaskEither
 */
export interface FunctionalFileSystem {

  /** Read file contents */
  readFile(path: string): TaskEither<string, string>;

  /** Write file contents */
  writeFile(path: string, content: string): TaskEither<string, void>;

  /** Check if file exists */
  exists(path: string): TaskEither<string, boolean>;

  /** Get file stats */
  stat(path: string): TaskEither<string, FileStats>;

  /** Remove a file */
  remove(path: string): TaskEither<string, void>;

  /** Create backup of file */
  backup(path: string): TaskEither<string, string>;

  /** Atomic save operation (backup + write) */
  atomicSave(path: string, content: string): TaskEither<string, { saved: boolean; backupPath?: string }>;
}

/**
 * Functional file system implementation using TaskEither
 */
export class FunctionalFileSystemImpl implements FunctionalFileSystem {

  /**
   * Read file contents with proper error handling
   */
  readFile(path: string): TaskEither<string, string> {
    return TaskEitherUtils.readFile(path);
  }

  /**
   * Write file contents with proper error handling
   */
  writeFile(path: string, content: string): TaskEither<string, void> {
    return TaskEitherUtils.writeFile(path, content);
  }

  /**
   * Check if file exists without throwing errors
   */
  exists(path: string): TaskEither<string, boolean> {
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
      (error) => `Failed to check if ${path} exists: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Get file stats with functional error handling
   */
  stat(path: string): TaskEither<string, FileStats> {
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
      (error) => `Failed to get stats for ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Remove a file with functional error handling
   */
  remove(path: string): TaskEither<string, void> {
    return TaskEither.tryCatch(
      async () => {
        await fsPromises.unlink(path);
      },
      (error) => `Failed to remove file ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Create a backup of the file
   */
  backup(path: string): TaskEither<string, string> {
    const backupPath = `${path}.backup.${Date.now()}`;

    return this.readFile(path)
      .flatMap(content => this.writeFile(backupPath, content))
      .map(() => backupPath)
      .mapLeft(error => `Backup operation failed for ${path}: ${error}`);
  }

  /**
   * Atomic save operation: backup existing file then write new content
   */
  atomicSave(path: string, content: string): TaskEither<string, { saved: boolean; backupPath?: string }> {
    return this.exists(path)
      .flatMap((fileExists: boolean): TaskEither<string, { saved: boolean; backupPath?: string }> => {
        if (!fileExists) {
          // File doesn't exist, just write it
          return this.writeFile(path, content)
            .map(() => ({ saved: true, backupPath: undefined }));
        }

        // File exists, backup then write
        return this.backup(path)
          .flatMap((backupPath: string) =>
            this.writeFile(path, content)
              .map(() => ({ saved: true, backupPath }))
          );
      })
      .mapLeft(error => `Atomic save failed for ${path}: ${error}`);
  }
}

/**
 * Utility functions for common file operations
 */
export const FileSystemUtils = {
  /**
   * Read and parse JSON file
   */
  readJsonFile: <T>(path: string): TaskEither<string, T> =>
    TaskEitherUtils.readFile(path)
      .flatMap(content => TaskEitherUtils.parseJSON<T>(content))
      .mapLeft(error => `Failed to read JSON file ${path}: ${error}`),

  /**
   * Write JSON file with pretty formatting
   */
  writeJsonFile: (path: string, data: unknown): TaskEither<string, void> =>
    TaskEitherUtils.stringifyJSON(data)
      .flatMap(content => TaskEitherUtils.writeFile(path, content))
      .mapLeft(error => `Failed to write JSON file ${path}: ${error}`),

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
    const fs = new FunctionalFileSystemImpl();
    return fs.stat(path)
      .map(stats => stats.isFile)
      .mapLeft(error => `Failed to check if ${path} is a file: ${error}`);
  },

  /**
   * Check if path is a directory
   */
  isDirectory: (path: string): TaskEither<string, boolean> => {
    const fs = new FunctionalFileSystemImpl();
    return fs.stat(path)
      .map(stats => stats.isDirectory)
      .mapLeft(error => `Failed to check if ${path} is a directory: ${error}`);
  }
};

/**
 * Backward compatibility wrapper for FileSystemImpl
 * Provides the expected Promise-based interface while using functional implementation internally
 */
export class FileSystemImpl implements FileSystem {
  private functionalFileSystem: FunctionalFileSystemImpl;

  constructor() {
    this.functionalFileSystem = new FunctionalFileSystemImpl();
  }

  /**
   * Read file contents
   */
  async readFile(path: string): Promise<string> {
    const result = await this.functionalFileSystem.readFile(path).run();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
    return result.right;
  }

  /**
   * Write file contents
   */
  async writeFile(path: string, content: string): Promise<void> {
    const result = await this.functionalFileSystem.writeFile(path, content).run();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
  }

  /**
   * Check if file exists
   */
  async exists(path: string): Promise<boolean> {
    const result = await this.functionalFileSystem.exists(path).run();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
    return result.right;
  }

  /**
   * Get file stats
   */
  async stat(path: string): Promise<FileStats> {
    const result = await this.functionalFileSystem.stat(path).run();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
    return result.right;
  }
}

// Export utils with functional prefix to avoid conflicts
export { FileSystemUtils as FunctionalFileSystemUtils };
