/**
 * @file filesystem.ts
 * @description Mock filesystem implementation for testing
 */

import type { FileSystem, FileStats } from "../../src/core/types.ts";

/**
 * Mock filesystem implementation for testing
 */
export class MockFileSystem implements FileSystem {
  public files: Map<string, string> = new Map();
  private stats: Map<string, FileStats> = new Map();

  /**
   * Read file contents
   * @param path - File path
   * @returns File contents
   */
  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  /**
   * Write file contents
   * @param path - File path
   * @param content - File content to write
   */
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.stats.set(path, {
      isFile: true,
      isDirectory: false,
      size: content.length,
      modified: new Date(),
    });
  }

  /**
   * Get file/directory stats
   * @param path - File path
   * @returns File stats
   */
  async stat(path: string): Promise<FileStats> {
    const stats = this.stats.get(path);
    if (!stats) {
      throw new Error(`File not found: ${path}`);
    }
    return stats;
  }

  /**
   * Check if file exists
   * @param path - File path
   * @returns True if file exists
   */
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  /**
   * Create directory
   * @param path - Directory path
   */
  async mkdir(path: string): Promise<void> {
    this.stats.set(path, {
      isFile: false,
      isDirectory: true,
      size: 0,
      modified: new Date(),
    });
  }

  /**
   * List directory contents
   * @param path - Directory path
   * @returns Array of file names
   */
  async readdir(path: string): Promise<string[]> {
    const files: string[] = [];
    for (const [filePath] of this.files) {
      if (filePath.startsWith(path + "/")) {
        const relativePath = filePath.substring(path.length + 1);
        if (!relativePath.includes("/")) {
          files.push(relativePath);
        }
      }
    }
    return files;
  }

  /**
   * Remove file
   * @param path - File path
   */
  async remove(path: string): Promise<void> {
    this.files.delete(path);
    this.stats.delete(path);
  }

  // Test helper methods

  /**
   * Clear all files and stats
   */
  clear(): void {
    this.files.clear();
    this.stats.clear();
  }

  /**
   * Set file content directly (for testing)
   * @param path - File path
   * @param content - File content
   */
  setFile(path: string, content: string): void {
    this.files.set(path, content);
    this.stats.set(path, {
      isFile: true,
      isDirectory: false,
      size: content.length,
      modified: new Date(),
    });
  }

  /**
   * Get file content directly (for testing)
   * @param path - File path
   * @returns File content or undefined
   */
  getFile(path: string): string | undefined {
    return this.files.get(path);
  }

  /**
   * Get all file paths
   * @returns Array of file paths
   */
  getAllFiles(): string[] {
    return Array.from(this.files.keys());
  }
}