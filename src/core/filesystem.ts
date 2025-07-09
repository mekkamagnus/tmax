/**
 * @file filesystem.ts
 * @description File system operations implementation for tmax editor
 */

import type { FileSystem, FileStats } from "./types.ts";

/**
 * File system implementation using Deno's file system APIs
 */
export class FileSystemImpl implements FileSystem {
  /**
   * Read file contents
   * @param path - File path to read
   * @returns Promise resolving to file contents
   */
  async readFile(path: string): Promise<string> {
    try {
      const content = await Deno.readTextFile(path);
      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read file ${path}: ${message}`);
    }
  }

  /**
   * Write file contents
   * @param path - File path to write
   * @param content - Content to write
   * @returns Promise resolving when write is complete
   */
  async writeFile(path: string, content: string): Promise<void> {
    try {
      await Deno.writeTextFile(path, content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write file ${path}: ${message}`);
    }
  }

  /**
   * Check if file exists
   * @param path - File path to check
   * @returns Promise resolving to existence boolean
   */
  async exists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get file stats
   * @param path - File path to get stats for
   * @returns Promise resolving to file stats
   */
  async stat(path: string): Promise<FileStats> {
    try {
      const info = await Deno.stat(path);
      return {
        isFile: info.isFile,
        isDirectory: info.isDirectory,
        size: info.size,
        modified: info.mtime || new Date(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get stats for ${path}: ${message}`);
    }
  }

  /**
   * Remove a file
   * @param path - File path to remove
   * @returns Promise resolving when removal is complete
   */
  async remove(path: string): Promise<void> {
    try {
      await Deno.remove(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to remove file ${path}: ${message}`);
    }
  }
}