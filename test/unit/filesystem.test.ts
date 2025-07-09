/**
 * @file filesystem.test.ts
 * @description Tests for file system operations
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { FileSystemImpl } from "../../src/core/filesystem.ts";
import type { FileSystem } from "../../src/core/types.ts";

/**
 * Test suite for file system functionality
 */
Deno.test("FileSystem", async (t) => {
  let fs: FileSystem;
  const testFilePath = "/tmp/tmax-test.txt";
  const testContent = "Hello, tmax!";

  await t.step("should create filesystem instance", () => {
    fs = new FileSystemImpl();
    assertExists(fs);
  });

  await t.step("should write file", async () => {
    await fs.writeFile(testFilePath, testContent);
    const exists = await fs.exists(testFilePath);
    assertEquals(exists, true);
  });

  await t.step("should read file", async () => {
    const content = await fs.readFile(testFilePath);
    assertEquals(content, testContent);
  });

  await t.step("should get file stats", async () => {
    const stats = await fs.stat(testFilePath);
    assertExists(stats);
    assertEquals(stats.isFile, true);
  });

  await t.step("should handle non-existent file", async () => {
    const exists = await fs.exists("/tmp/non-existent-file.txt");
    assertEquals(exists, false);
    
    await assertRejects(
      () => fs.readFile("/tmp/non-existent-file.txt"),
      Error
    );
  });

  // Cleanup
  await t.step("cleanup test file", async () => {
    try {
      await Deno.remove(testFilePath);
    } catch {
      // Ignore cleanup errors
    }
  });
});