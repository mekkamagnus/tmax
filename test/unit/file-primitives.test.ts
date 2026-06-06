/**
 * @file file-primitives.test.ts
 * @description Tests for file primitive functions (SPEC-035)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createFileOps } from "../../src/editor/api/file-ops.ts";
import { Either } from "../../src/utils/task-either.ts";
import { createString, createNumber, createBoolean } from "../../src/tlisp/values.ts";

describe("File Primitives", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tmax-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  function getOps() {
    return createFileOps(undefined, () => {});
  }

  // Helper: call an API function and return the Right value
  function call(name: string, args: any[] = []) {
    const ops = getOps();
    const fn = ops.get(name);
    if (!fn) throw new Error(`Function ${name} not found`);
    const result = fn(args);
    if (Either.isLeft(result)) throw new Error(`Function ${name} returned Left: ${JSON.stringify(result.left)}`);
    return result.right;
  }

  // Helper: call an API function and return the raw Either
  function callEither(name: string, args: any[] = []) {
    const ops = getOps();
    const fn = ops.get(name);
    if (!fn) throw new Error(`Function ${name} not found`);
    return fn(args);
  }

  // --- file-exists-p ---

  describe("file-exists-p", () => {
    test("returns true for an existing file", () => {
      const filePath = path.join(tmpDir, "exists.txt");
      fs.writeFileSync(filePath, "content");
      const result = call("file-exists-p", [createString(filePath)]);
      expect(result.type).toBe("boolean");
      expect(result.value).toBe(true);
    });

    test("returns false for a nonexistent file", () => {
      const result = call("file-exists-p", [createString("/nonexistent/path/file.txt")]);
      expect(result.type).toBe("boolean");
      expect(result.value).toBe(false);
    });

    test("returns true for an existing directory", () => {
      const result = call("file-exists-p", [createString(tmpDir)]);
      expect(result.type).toBe("boolean");
      expect(result.value).toBe(true);
    });

    test("rejects non-string argument", () => {
      const result = callEither("file-exists-p", [createNumber(42)]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("rejects wrong argument count", () => {
      const result = callEither("file-exists-p", []);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- read-dir ---

  describe("read-dir", () => {
    test("returns list of entries for a directory with files", () => {
      const dirPath = path.join(tmpDir, "readdir-test");
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, "a.txt"), "a");
      fs.writeFileSync(path.join(dirPath, "b.txt"), "b");

      const result = call("read-dir", [createString(dirPath)]);
      expect(result.type).toBe("list");

      const entries = result.value as any[];
      const names = entries.map((e: any) => e.value.get("name")?.value);

      expect(names).toContain("a.txt");
      expect(names).toContain("b.txt");
      expect(names.length).toBe(2);
    });

    test("returns empty list for an empty directory", () => {
      const emptyDir = path.join(tmpDir, "empty-dir");
      fs.mkdirSync(emptyDir, { recursive: true });

      const result = call("read-dir", [createString(emptyDir)]);
      expect(result.type).toBe("list");
      expect((result.value as any[]).length).toBe(0);
    });

    test("returns nil for a nonexistent directory", () => {
      const result = call("read-dir", [createString("/nonexistent/dir")]);
      expect(result.type).toBe("nil");
    });

    test("includes isFile and isDirectory info for entries", () => {
      const dirPath = path.join(tmpDir, "readdir-mixed");
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, "file.txt"), "data");
      fs.mkdirSync(path.join(dirPath, "subdir"));

      const result = call("read-dir", [createString(dirPath)]);
      expect(result.type).toBe("list");

      const entries = result.value as any[];
      const entryMap = new Map<string, { isFile: boolean; isDirectory: boolean }>();

      for (const entry of entries) {
        const map = entry.value as Map<string, any>;
        const name = map.get("name")?.value;
        const isFile = map.get("isFile")?.value;
        const isDir = map.get("isDirectory")?.value;
        entryMap.set(name, { isFile, isDirectory: isDir });
      }

      expect(entryMap.get("file.txt")?.isFile).toBe(true);
      expect(entryMap.get("file.txt")?.isDirectory).toBe(false);
      expect(entryMap.get("subdir")?.isFile).toBe(false);
      expect(entryMap.get("subdir")?.isDirectory).toBe(true);
    });

    test("rejects non-string argument", () => {
      const result = callEither("read-dir", [createNumber(42)]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("rejects wrong argument count", () => {
      const result = callEither("read-dir", []);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- file-remove ---

  describe("file-remove", () => {
    test("deletes an existing file", () => {
      const filePath = path.join(tmpDir, "to-delete.txt");
      fs.writeFileSync(filePath, "delete me");
      expect(fs.existsSync(filePath)).toBe(true);

      const result = call("file-remove", [createString(filePath)]);
      expect(result.type).toBe("nil");
      expect(fs.existsSync(filePath)).toBe(false);
    });

    test("returns nil for a nonexistent file without error", () => {
      const filePath = path.join(tmpDir, "does-not-exist.txt");
      expect(fs.existsSync(filePath)).toBe(false);

      const result = call("file-remove", [createString(filePath)]);
      expect(result.type).toBe("nil");
    });

    test("rejects non-string argument", () => {
      const result = callEither("file-remove", [createNumber(42)]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("rejects wrong argument count", () => {
      const result = callEither("file-remove", []);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- read-file-content ---

  describe("read-file-content", () => {
    test("reads file contents as a string", () => {
      const filePath = path.join(tmpDir, "read-test.txt");
      fs.writeFileSync(filePath, "file content here");
      const result = call("read-file-content", [createString(filePath)]);
      expect(result.type).toBe("string");
      expect(result.value).toBe("file content here");
    });

    test("returns nil for nonexistent file", () => {
      const result = call("read-file-content", [createString("/nonexistent/file.txt")]);
      expect(result.type).toBe("nil");
    });

    test("reads multi-line file content", () => {
      const filePath = path.join(tmpDir, "multiline.txt");
      fs.writeFileSync(filePath, "line1\nline2\nline3");
      const result = call("read-file-content", [createString(filePath)]);
      expect(result.type).toBe("string");
      expect(result.value).toBe("line1\nline2\nline3");
    });
  });

  // --- write-file-content (fire-and-forget async) ---

  describe("write-file-content", () => {
    test("returns nil immediately (fire-and-forget)", () => {
      const filePath = path.join(tmpDir, "write-test.txt");
      const result = call("write-file-content", [createString(filePath), createString("written data")]);
      expect(result.type).toBe("nil");
    });

    test("rejects wrong argument count", () => {
      const result = callEither("write-file-content", [createString("path")]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("rejects non-string arguments", () => {
      const result = callEither("write-file-content", [createNumber(1), createNumber(2)]);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- file-copy ---

  describe("file-copy", () => {
    test("copies a file", () => {
      const srcPath = path.join(tmpDir, "copy-src.txt");
      const destPath = path.join(tmpDir, "copy-dest.txt");
      fs.writeFileSync(srcPath, "copy me");

      const result = call("file-copy", [createString(srcPath), createString(destPath)]);
      expect(result.type).toBe("nil");
      expect(fs.existsSync(destPath)).toBe(true);
      expect(fs.readFileSync(destPath, "utf-8")).toBe("copy me");
    });

    test("returns nil for nonexistent source (swallows error)", () => {
      const destPath = path.join(tmpDir, "copy-noop.txt");
      const result = call("file-copy", [createString("/nonexistent/src.txt"), createString(destPath)]);
      expect(result.type).toBe("nil");
    });
  });

  // --- file-mkdir ---

  describe("file-mkdir", () => {
    test("creates a directory", () => {
      const dirPath = path.join(tmpDir, "new-dir");
      const result = call("file-mkdir", [createString(dirPath)]);
      expect(result.type).toBe("nil");
      expect(fs.existsSync(dirPath)).toBe(true);
      expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });

    test("creates nested directories with recursive", () => {
      const nestedPath = path.join(tmpDir, "parent", "child", "grandchild");
      const result = call("file-mkdir", [createString(nestedPath)]);
      expect(result.type).toBe("nil");
      expect(fs.existsSync(nestedPath)).toBe(true);
    });
  });
});
