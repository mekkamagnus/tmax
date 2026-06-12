/**
 * @file workspace-manager.test.ts
 * @description Unit tests for WorkspaceManager
 *
 * Tests name validation, CRUD lifecycle, atomic write verification,
 * backup recovery, format version handling, and concurrent operations.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { WorkspaceManager, CURRENT_WORKSPACE_FORMAT_VERSION } from "../../src/core/workspace.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import type { FunctionalTextBuffer, WorkspaceState, WorkspaceData } from "../../src/core/types.ts";
import type { Either } from "../../src/utils/task-either.ts";
import * as fs from "fs/promises";
import * as path from "path";

function unwrapRight<L, R>(result: Either<L, R>): R {
  if (result._tag === "Left") {
    throw new Error(String(result.left));
  }
  return result.right;
}

describe("WorkspaceManager", () => {
  let tempDir: string;
  let manager: WorkspaceManager;

  beforeEach(async () => {
    // Create a temporary directory for each test
    const os = await import('os');
    tempDir = path.join(os.tmpdir(), `workspace-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(tempDir, { recursive: true });
    manager = new WorkspaceManager(tempDir);
    await manager.init().run();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Name validation tests
   */
  describe("validateName", () => {
    test("should accept valid alphanumeric names", () => {
      const result = manager.validateName("project-a");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right).toBe("project-a");
      }
    });

    test("should accept names with underscores and hyphens", () => {
      expect(manager.validateName("my_project-123")._tag).toBe("Right");
      expect(manager.validateName("_test")._tag).toBe("Right");
      expect(manager.validateName("test-")._tag).toBe("Right");
    });

    test("should reject empty names", () => {
      const result = manager.validateName("");
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toContain("empty");
      }
    });

    test("should reject names with spaces", () => {
      const result = manager.validateName("has spaces");
      expect(result._tag).toBe("Left");
    });

    test("should reject names with path separators", () => {
      expect(manager.validateName("../evil")._tag).toBe("Left");
      expect(manager.validateName("path/test")._tag).toBe("Left");
      expect(manager.validateName("back\\slash")._tag).toBe("Left");
    });

    test("should reject names longer than 64 characters", () => {
      const longName = "a".repeat(65);
      const result = manager.validateName(longName);
      expect(result._tag).toBe("Left");
    });

    test("should accept exactly 64 character names", () => {
      const name = "a".repeat(64);
      expect(manager.validateName(name)._tag).toBe("Right");
    });

    test("should reject names with special characters", () => {
      expect(manager.validateName("test@project")._tag).toBe("Left");
      expect(manager.validateName("test.project")._tag).toBe("Left");
      expect(manager.validateName("test:project")._tag).toBe("Left");
    });
  });

  /**
   * CRUD lifecycle tests
   */
  describe("CRUD operations", () => {
    test("should create a new workspace", async () => {
      const result = await manager.create("test-workspace").run();
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.metadata.name).toBe("test-workspace");
        expect(result.right.buffers.has("*scratch*")).toBe(true);
        expect(result.right.metadata.formatVersion).toBe(CURRENT_WORKSPACE_FORMAT_VERSION);
      }
    });

    test("should reject duplicate workspace creation", async () => {
      await manager.create("duplicate").run();
      const result = await manager.create("duplicate").run();
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toContain("already exists");
      }
    });

    test("should list workspaces", async () => {
      await manager.create("workspace-a").run();
      await manager.create("workspace-b").run();
      await manager.create("workspace-c").run();

      const result = await manager.list().run();
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.length).toBe(3);
        const names = result.right.map(w => w.name).sort();
        expect(names).toEqual(["workspace-a", "workspace-b", "workspace-c"]);
      }
    });

    test("should load a workspace from disk", async () => {
      // Create and save a workspace
      const createResult = await manager.create("load-test").run();
      expect(createResult._tag).toBe("Right");
      const workspace = unwrapRight(createResult);
      await manager.save(workspace).run();

      // Unload from memory
      manager.unload("load-test");

      // Load from disk
      const loadResult = await manager.load("load-test").run();
      expect(loadResult._tag).toBe("Right");
      if (loadResult._tag === "Right") {
        expect(loadResult.right.metadata.name).toBe("load-test");
        expect(loadResult.right.buffers.has("*scratch*")).toBe(true);
      }
    });

    test("should delete a workspace", async () => {
      await manager.create("delete-test").run();

      // Verify it exists
      let existsResult = await manager.exists("delete-test").run();
      expect(existsResult._tag).toBe("Right");
      expect(unwrapRight(existsResult)).toBe(true);

      // Delete
      const deleteResult = await manager.delete("delete-test").run();
      expect(deleteResult._tag).toBe("Right");

      // Verify it's gone
      existsResult = await manager.exists("delete-test").run();
      expect(existsResult._tag).toBe("Right");
      expect(unwrapRight(existsResult)).toBe(false);
    });

    test("should rename a workspace", async () => {
      await manager.create("old-name").run();

      const renameResult = await manager.rename("old-name", "new-name").run();
      expect(renameResult._tag).toBe("Right");

      // Old name doesn't exist
      const oldExists = await manager.exists("old-name").run();
      expect(unwrapRight(oldExists)).toBe(false);

      // New name exists
      const newExists = await manager.exists("new-name").run();
      expect(unwrapRight(newExists)).toBe(true);
    });

    test("should reject rename to existing workspace", async () => {
      await manager.create("workspace-a").run();
      await manager.create("workspace-b").run();

      const result = await manager.rename("workspace-a", "workspace-b").run();
      expect(result._tag).toBe("Left");
    });

    test("should check if workspace exists", async () => {
      const notExists = await manager.exists("nonexistent").run();
      expect(notExists._tag).toBe("Right");
      expect(unwrapRight(notExists)).toBe(false);

      await manager.create("exists-test").run();
      const exists = await manager.exists("exists-test").run();
      expect(exists._tag).toBe("Right");
      expect(unwrapRight(exists)).toBe(true);
    });
  });

  /**
   * Atomic write verification tests
   */
  describe("atomic write", () => {
    test("should create both .json and .json~ files after save", async () => {
      const createResult = await manager.create("atomic-test").run();
      expect(createResult._tag).toBe("Right");
      const workspace = unwrapRight(createResult);

      await manager.save(workspace).run();

      // Check both files exist
      const jsonPath = path.join(tempDir, "atomic-test.json");
      const backupPath = path.join(tempDir, "atomic-test.json~");

      const jsonExists = await fs.access(jsonPath).then(() => true).catch(() => false);
      const backupExists = await fs.access(backupPath).then(() => true).catch(() => false);

      expect(jsonExists).toBe(true);
      expect(backupExists).toBe(true);
    });

    test("saveWithContentHash reads buffer content once for a successful save", async () => {
      const createResult = await manager.create("hash-save-test").run();
      expect(createResult._tag).toBe("Right");
      const workspace = unwrapRight(createResult);
      const base = FunctionalTextBufferImpl.create("large content");
      let getContentCount = 0;
      const countedBuffer: FunctionalTextBuffer = {
        getContent: () => {
          getContentCount++;
          return base.getContent();
        },
        getLine: (lineNumber) => base.getLine(lineNumber),
        getLineCount: () => base.getLineCount(),
        insert: (position, text) => base.insert(position, text),
        delete: (range) => base.delete(range),
        replace: (range, text) => base.replace(range, text),
        getText: (range) => base.getText(range),
        getStats: () => base.getStats(),
      };
      workspace.buffers.set("large.txt", countedBuffer);
      workspace.bufferMetadata.set("large.txt", {
        name: "large.txt",
        modified: true,
        cursorLine: 0,
        cursorColumn: 0,
      });

      const result = await manager.saveWithContentHash(workspace, { force: true }).run();

      expect(result._tag).toBe("Right");
      expect(unwrapRight(result).saved).toBe(true);
      expect(getContentCount).toBe(1);
    });

    test("should backup previous file on second save", async () => {
      const createResult = await manager.create("backup-test").run();
      expect(createResult._tag).toBe("Right");
      const workspace = unwrapRight(createResult);

      // First save
      await manager.save(workspace).run();

      // Modify workspace
      workspace.metadata.lastAccessed = new Date().toISOString();

      // Second save
      await manager.save(workspace).run();

      // Verify backup exists and contains old data
      const backupPath = path.join(tempDir, "backup-test.json~");
      const backupContent = await fs.readFile(backupPath, "utf-8");
      const backupData = JSON.parse(backupContent) as WorkspaceData;

      expect(backupData.metadata.name).toBe("backup-test");
    });

    test("should recover from corrupt main file using backup", async () => {
      const createResult = await manager.create("corrupt-test").run();
      expect(createResult._tag).toBe("Right");
      const workspace = unwrapRight(createResult);

      // Save workspace
      await manager.save(workspace).run();

      // Corrupt the main file
      const jsonPath = path.join(tempDir, "corrupt-test.json");
      await fs.writeFile(jsonPath, "corrupt data {invalid json", "utf-8");

      // Unload from memory
      manager.unload("corrupt-test");

      // Load should recover from backup
      const loadResult = await manager.load("corrupt-test").run();
      expect(loadResult._tag).toBe("Right");
      if (loadResult._tag === "Right") {
        expect(loadResult.right.metadata.name).toBe("corrupt-test");
      }
    });

    test("should return Left when both main and backup are corrupt", async () => {
      const createResult = await manager.create("both-corrupt").run();
      expect(createResult._tag).toBe("Right");
      const workspace = unwrapRight(createResult);

      // Save workspace
      await manager.save(workspace).run();

      // Corrupt both files
      const jsonPath = path.join(tempDir, "both-corrupt.json");
      const backupPath = path.join(tempDir, "both-corrupt.json~");
      await fs.writeFile(jsonPath, "corrupt", "utf-8");
      await fs.writeFile(backupPath, "also corrupt", "utf-8");

      // Unload from memory
      manager.unload("both-corrupt");

      // Load should fail
      const loadResult = await manager.load("both-corrupt").run();
      expect(loadResult._tag).toBe("Left");
    });
  });

  /**
   * Format version tests
   */
  describe("format versioning", () => {
    test("should refuse to load newer format version", async () => {
      const jsonPath = path.join(tempDir, "new-version.json");
      const data: WorkspaceData = {
        metadata: {
          id: "test-id",
          name: "new-version",
          createdAt: new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
          formatVersion: CURRENT_WORKSPACE_FORMAT_VERSION + 1  // Newer version
        },
        buffers: [],
        windows: [],
        tabs: [],
        cursorState: { line: 0, column: 0 },
        viewportState: { top: 0 }
      };
      await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), "utf-8");

      const result = await manager.load("new-version").run();
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.toLowerCase()).toContain("please upgrade");
      }
    });

    test("should load older format version with defaults", async () => {
      const jsonPath = path.join(tempDir, "old-version.json");
      const data: WorkspaceData = {
        metadata: {
          id: "test-id",
          name: "old-version",
          createdAt: new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
          formatVersion: CURRENT_WORKSPACE_FORMAT_VERSION - 1  // Older version
        },
        buffers: [],
        windows: [],
        tabs: [],
        cursorState: { line: 0, column: 0 },
        viewportState: { top: 0 }
      };
      await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), "utf-8");

      const result = await manager.load("old-version").run();
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.metadata.name).toBe("old-version");
        // Should have *scratch* buffer added as default
        expect(result.right.buffers.has("*scratch*")).toBe(true);
      }
    });
  });

  /**
   * Cache management tests
   */
  describe("cache management", () => {
    test("should track loaded workspaces", async () => {
      expect(manager.isLoaded("cached")).toBe(false);

      const createResult = await manager.create("cached").run();
      expect(createResult._tag).toBe("Right");

      expect(manager.isLoaded("cached")).toBe(true);
      expect(manager.getLoadedNames()).toContain("cached");
    });

    test("should get loaded workspace from cache", async () => {
      await manager.create("cache-test").run();
      expect(manager.isLoaded("cache-test")).toBe(true);

      const result = manager.getLoaded("cache-test");
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.metadata.name).toBe("cache-test");
      }
    });

    test("should unload workspace from memory", async () => {
      const createResult = await manager.create("unload-test").run();
      expect(createResult._tag).toBe("Right");

      expect(manager.isLoaded("unload-test")).toBe(true);

      const unloadResult = manager.unload("unload-test");
      expect(unloadResult._tag).toBe("Right");

      expect(manager.isLoaded("unload-test")).toBe(false);
    });

    test("should return Left when unloading non-loaded workspace", () => {
      const result = manager.unload("not-loaded");
      expect(result._tag).toBe("Left");
    });

    test("should return Left when getting non-loaded workspace", () => {
      const result = manager.getLoaded("not-loaded");
      expect(result._tag).toBe("Left");
    });
  });

  /**
   * Buffer management tests
   */
  describe("buffer management", () => {
    test("should create workspace with initial content", async () => {
      const initialContent = new Map([
        ["buffer1", "content 1"],
        ["buffer2", "content 2"]
      ]);

      const result = await manager.create("with-buffers", { initialContent }).run();
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.buffers.size).toBe(3); // *scratch* + 2 buffers
        expect(result.right.buffers.has("buffer1")).toBe(true);
        expect(result.right.buffers.has("buffer2")).toBe(true);
        expect(result.right.buffers.has("*scratch*")).toBe(true);

        const buffer1 = result.right.buffers.get("buffer1");
        const content1 = buffer1!.getContent();
        if (content1._tag === "Right") {
          expect(content1.right).toBe("content 1");
        }
      }
    });

    test("should associate project root with workspace", async () => {
      const result = await manager.create("project-workspace", {
        projectRoot: "/path/to/project"
      }).run();

      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.metadata.projectRoot).toBe("/path/to/project");
      }
    });
  });

  /**
   * Edge case tests
   */
  describe("edge cases", () => {
    test("should handle workspace with no buffers", async () => {
      // Create workspace with *scratch* (can't have zero buffers due to *scratch* requirement)
      const createResult = await manager.create("only-scratch").run();
      expect(createResult._tag).toBe("Right");

      // Save and load
      await manager.save(unwrapRight(createResult)).run();
      manager.unload("only-scratch");

      const loadResult = await manager.load("only-scratch").run();
      expect(loadResult._tag).toBe("Right");
      if (loadResult._tag === "Right") {
        expect(loadResult.right.buffers.size).toBe(1); // Only *scratch*
      }
    });

    test("should reject empty workspace name", async () => {
      const result = await manager.create("").run();
      expect(result._tag).toBe("Left");
    });

    test("should handle special characters in project root", async () => {
      const result = await manager.create("special-chars", {
        projectRoot: "/path/with spaces/project"
      }).run();

      expect(result._tag).toBe("Right");
      expect(unwrapRight(result).metadata.projectRoot).toBe("/path/with spaces/project");
    });
  });
});
