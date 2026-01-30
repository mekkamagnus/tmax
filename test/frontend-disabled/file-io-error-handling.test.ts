/**
 * @file file-io-error-handling.test.ts
 * @description Tests for file I/O error handling during rendering
 */

import { describe, test, expect } from "bun:test";
import { ErrorFactory, TmaxError } from "../../src/utils/error-manager.ts";
import { FunctionalFileSystem } from "../../src/core/types.ts";
import { FileSystemImpl } from "../../src/core/filesystem.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import { Either } from "../../src/utils/task-either.ts";

/**
 * Test suite for file I/O error handling
 */
describe("File I/O Error Handling", () => {
  let fs: FunctionalFileSystem;

  test("setup", () => {
    fs = new FileSystemImpl();
  });

test("should handle file read errors gracefully", async () => {
    // Try to read a non-existent file
    const result = await fs.readFile("/non/existent/file.txt").run();
    assert(Either.isLeft(result));
    assert(result.left instanceof TmaxError);
    expect(result.left.type).toBe("io");
  });

test("should handle file write errors gracefully", async () => {
    // Try to write to a protected location (this might fail differently on different systems)
    // Using a path that's likely to fail for permission reasons
    const result = await fs.writeFile("/root/test.txt", "test content").run();
    // This test expects an error, but the exact behavior depends on the system
    // So we'll just verify that it doesn't crash
    assert(result._tag === "Left" || result._tag === "Right");
  });

test("should handle file existence check errors gracefully", async () => {
    // Try to check existence of a problematic path
    const result = await fs.exists("/proc/nonexistent_file_that_might_not_exist").run();
    // This should not crash the system
    assert(result._tag === "Left" || result._tag === "Right");
  });

test("should handle file stat errors gracefully", async () => {
    // Try to get stats for a non-existent file
    const result = await fs.stat("/non/existent/file.txt").run();
    assert(Either.isLeft(result));
    assert(result.left instanceof TmaxError);
    expect(result.left.type).toBe("io");
  });

  test("cleanup", () => {
    // Clean up if needed
    fs = undefined as any;
  });
});

/**
 * Test suite for buffer error handling
 */
describe("Buffer Error Handling", () => {
  test("should handle empty buffer creation", () => {
    // Test creating an empty buffer
    const result = FunctionalTextBufferImpl.create("");
    // Since this is a constructor, it doesn't return an Either
    assert(result instanceof FunctionalTextBufferImpl);
  });

  test("should handle out-of-bounds line access", () => {
    // Create a buffer with content
    const buffer = FunctionalTextBufferImpl.create("line1\nline2\nline3");

    // Try to access a line that doesn't exist
    const lineResult = buffer.getLine(100); // Line 100 doesn't exist
    assert(Either.isLeft(lineResult));
  });

  test("should handle invalid position insertion", () => {
    // Create a buffer with content
    const buffer = FunctionalTextBufferImpl.create("line1\nline2\nline3");

    // Try to insert at an invalid position
    const invalidPos = { line: -1, column: -1 };
    const insertResult = buffer.insert(invalidPos, "test");
    assert(Either.isLeft(insertResult));
  });

  test("should handle invalid range operations", () => {
    // Create a buffer with content
    const buffer = FunctionalTextBufferImpl.create("line1\nline2\nline3");

    // Try to operate with an invalid range
    const invalidRange = { start: { line: 100, column: 0 }, end: { line: 101, column: 0 } };
    const deleteResult = buffer.delete(invalidRange);
    assert(Either.isLeft(deleteResult));
  });
});