/**
 * @file filesystem.test.ts
 * @description Tests for file system operations
 */

import { describe, test, expect } from "bun:test";
import { FileSystemImpl } from "../../src/core/filesystem.ts";
import type { FileSystem } from "../../src/core/types.ts";

/**
 * Test suite for file system functionality
 */
describe("FileSystem", () => {
  let fs: FileSystem;
  const testFilePath = "/tmp/tmax-test.txt";
  const testContent = "Hello, tmax!";

  test("should create filesystem instance", () => {
    fs = new FileSystemImpl();
    expect(fs).toBeDefined();
  });

  test("should write file", async () => {
    await fs.writeFile(testFilePath, testContent);
    const exists = await fs.exists(testFilePath);
    expect(exists).toBe(true);
  });

  test("should read file", async () => {
    const content = await fs.readFile(testFilePath);
    expect(content).toBe(testContent);
  });

  test("should get file stats", async () => {
    const stats = await fs.stat(testFilePath);
    expect(stats).toBeDefined();
    expect(stats.isFile).toBe(true);
  });

  test("should handle non-existent file", async () => {
    const exists = await fs.exists("/tmp/non-existent-file.txt");
    expect(exists).toBe(false);

    await expect(fs.readFile("/tmp/non-existent-file.txt")).rejects.toThrow(Error);
  });

  // Cleanup
  test("cleanup test file", async () => {
    try {
      // @ts-ignore - Bun compatibility
      await Deno.remove(testFilePath);
    } catch {
      // Ignore cleanup errors
    }
  });
});
