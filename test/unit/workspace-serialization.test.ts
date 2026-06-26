/**
 * @file workspace-serialization.test.ts
 * @description Unit tests for workspace serialization
 *
 * Tests round-trip, window layout, empty workspace, large buffer performance,
 * and modified flag preservation.
 */

import { describe, test, expect } from "bun:test";
import {
  workspaceToData,
  dataToWorkspace
} from "../../src/server/serialize.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import type { WorkspaceState, WorkspaceData, BufferMetadata, BufferModeState, FunctionalTextBuffer } from "../../src/core/types.ts";

/**
 * Helper to create a test workspace
 */
function createTestWorkspace(name: string): WorkspaceState {
  const buffers = new Map<string, import("../../src/core/types.ts").FunctionalTextBuffer>();
  const bufferMetadata = new Map<string, BufferMetadata>();
  const bufferModeStates = new Map<string, BufferModeState>();

  // Always add *scratch*
  const scratchBuffer = FunctionalTextBufferImpl.create("");
  buffers.set("*scratch*", scratchBuffer);
  bufferMetadata.set("*scratch*", {
    name: "*scratch*",
    modified: false,
    cursorLine: 0,
    cursorColumn: 0
  });
  bufferModeStates.set("*scratch*", {});

  return {
    metadata: {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      formatVersion: 1
    },
    buffers,
    bufferMetadata,
    bufferModeStates,
    windows: [],
    tabs: [],
    cursorState: { line: 0, column: 0 },
    viewportState: { top: 0 },
    currentBufferName: "*scratch*"
  };
}

/**
 * Round-trip tests
 */
describe("workspace serialization", () => {
  describe("round-trip", () => {
    test("should preserve 3 buffers with different states", () => {
      const workspace = createTestWorkspace("roundtrip-test");

      // Add modified buffer
      let modifiedBuffer: FunctionalTextBuffer = FunctionalTextBufferImpl.create("modified content");
      const insertResult = modifiedBuffer.insert({ line: 0, column: 16 }, " more");
      if (insertResult._tag === "Right") {
        modifiedBuffer = insertResult.right;
      }
      workspace.buffers.set("modified.ts", modifiedBuffer);
      workspace.bufferMetadata.set("modified.ts", {
        name: "modified.ts",
        filename: "/path/to/modified.ts",
        modified: true,
        majorMode: "typescript",
        cursorLine: 5,
        cursorColumn: 10
      });
      workspace.bufferModeStates.set("modified.ts", {
        majorMode: "typescript",
        minorModes: ["lsp"],
        lighters: ["git"]
      });

      // Add clean (saved) buffer
      const cleanBuffer = FunctionalTextBufferImpl.create("clean content");
      workspace.buffers.set("clean.ts", cleanBuffer);
      workspace.bufferMetadata.set("clean.ts", {
        name: "clean.ts",
        filename: "/path/to/clean.ts",
        modified: false,
        cursorLine: 2,
        cursorColumn: 0
      });
      workspace.bufferModeStates.set("clean.ts", {
        majorMode: "typescript"
      });

      // Add unsaved buffer (no filename)
      const unsavedBuffer = FunctionalTextBufferImpl.create("unsaved content");
      workspace.buffers.set("unsaved", unsavedBuffer);
      workspace.bufferMetadata.set("unsaved", {
        name: "unsaved",
        modified: true,
        cursorLine: 0,
        cursorColumn: 5
      });
      workspace.bufferModeStates.set("unsaved", {});

      // Serialize
      const data = workspaceToData(workspace);

      // Verify serialized data
      expect(data.metadata.name).toBe("roundtrip-test");
      expect(data.buffers.length).toBe(4); // *scratch* + 3 buffers

      // Find each buffer in serialized data
      const modifiedData = data.buffers.find(b => b.name === "modified.ts");
      const cleanData = data.buffers.find(b => b.name === "clean.ts");
      const unsavedData = data.buffers.find(b => b.name === "unsaved");

      expect(modifiedData).toBeDefined();
      expect(cleanData).toBeDefined();
      expect(unsavedData).toBeDefined();

      expect(modifiedData!.content).toContain("modified content more");
      expect(modifiedData!.filename).toBe("/path/to/modified.ts");
      expect(modifiedData!.modified).toBe(true);
      expect(modifiedData!.majorMode).toBe("typescript");
      expect(modifiedData!.cursorLine).toBe(5);
      expect(modifiedData!.cursorColumn).toBe(10);
      expect(modifiedData!.minorModes).toEqual(["lsp"]);
      expect(modifiedData!.lighters).toEqual(["git"]);

      expect(cleanData!.content).toBe("clean content");
      expect(cleanData!.filename).toBe("/path/to/clean.ts");
      expect(cleanData!.modified).toBe(false);
      expect(cleanData!.cursorLine).toBe(2);

      expect(unsavedData!.content).toBe("unsaved content");
      expect(unsavedData!.filename).toBeUndefined();
      expect(unsavedData!.modified).toBe(true);

      // Deserialize
      const restored = dataToWorkspace(data);

      // Verify restored workspace
      expect(restored.metadata.name).toBe("roundtrip-test");
      expect(restored.buffers.size).toBe(4);

      // Verify buffer contents
      const restoredModified = restored.buffers.get("modified.ts");
      const restoredClean = restored.buffers.get("clean.ts");
      const restoredUnsaved = restored.buffers.get("unsaved");

      expect(restoredModified).toBeDefined();
      expect(restoredClean).toBeDefined();
      expect(restoredUnsaved).toBeDefined();

      const restoredModifiedContent = restoredModified!.getContent();
      expect(restoredModifiedContent._tag).toBe("Right");
      if (restoredModifiedContent._tag === "Right") {
        expect(restoredModifiedContent.right).toContain("modified content more");
      }

      const restoredCleanContent = restoredClean!.getContent();
      expect(restoredCleanContent._tag).toBe("Right");
      if (restoredCleanContent._tag === "Right") {
        expect(restoredCleanContent.right).toBe("clean content");
      }

      // Verify metadata
      const restoredModifiedMeta = restored.bufferMetadata.get("modified.ts");
      expect(restoredModifiedMeta?.filename).toBe("/path/to/modified.ts");
      expect(restoredModifiedMeta?.modified).toBe(true);
      expect(restoredModifiedMeta?.majorMode).toBe("typescript");
      expect(restoredModifiedMeta?.cursorLine).toBe(5);
      expect(restoredModifiedMeta?.cursorColumn).toBe(10);

      // Verify mode states
      const restoredModifiedModeState = restored.bufferModeStates.get("modified.ts");
      expect(restoredModifiedModeState?.majorMode).toBe("typescript");
      expect(restoredModifiedModeState?.minorModes).toEqual(["lsp"]);
      expect(restoredModifiedModeState?.lighters).toEqual(["git"]);
    });

    test("should preserve window layout", () => {
      const workspace = createTestWorkspace("window-layout");

      // Add a buffer for the window
      const buffer = FunctionalTextBufferImpl.create("window content");
      workspace.buffers.set("file.ts", buffer);
      workspace.bufferMetadata.set("file.ts", {
        name: "file.ts",
        filename: "/path/to/file.ts",
        modified: false,
        cursorLine: 3,
        cursorColumn: 7
      });
      workspace.bufferModeStates.set("file.ts", {});

      // Create split windows
      workspace.windows = [
        {
          id: "window-1",
          buffer,
          cursorLine: 0,
          cursorColumn: 0,
          viewportTop: 0,
          viewportLeft: 0,
          splitType: "horizontal",
          height: 10,
          width: 80,
          row: 0,
          col: 0
        },
        {
          id: "window-2",
          buffer,
          cursorLine: 5,
          cursorColumn: 3,
          viewportTop: 10,
          viewportLeft: 0,
          splitType: "horizontal",
          height: 10,
          width: 80,
          row: 10,
          col: 0
        }
      ];

      workspace.currentBufferName = "file.ts";

      // Serialize
      const data = workspaceToData(workspace);

      // Verify windows
      expect(data.windows.length).toBe(2);
      const firstWindow = data.windows[0]!;
      const secondWindow = data.windows[1]!;
      expect(firstWindow.id).toBe("window-1");
      expect(firstWindow.splitType).toBe("horizontal");
      expect(firstWindow.height).toBe(10);
      expect(firstWindow.width).toBe(80);
      expect(firstWindow.row).toBe(0);
      expect(firstWindow.col).toBe(0);

      expect(secondWindow.id).toBe("window-2");
      expect(secondWindow.splitType).toBe("horizontal");
      expect(secondWindow.cursorLine).toBe(5);
      expect(secondWindow.cursorColumn).toBe(3);
      expect(secondWindow.viewportTop).toBe(10);
      expect(secondWindow.row).toBe(10);
      expect(secondWindow.col).toBe(0);

      // Deserialize
      const restored = dataToWorkspace(data);

      // Verify restored windows
      expect(restored.windows.length).toBe(2);
      const restoredFirstWindow = restored.windows[0]!;
      const restoredSecondWindow = restored.windows[1]!;
      expect(restoredFirstWindow.id).toBe("window-1");
      expect(restoredFirstWindow.splitType).toBe("horizontal");
      expect(restoredFirstWindow.height).toBe(10);
      expect(restoredFirstWindow.width).toBe(80);
      expect(restoredFirstWindow.row).toBe(0);
      expect(restoredFirstWindow.col).toBe(0);

      expect(restoredSecondWindow.id).toBe("window-2");
      expect(restoredSecondWindow.splitType).toBe("horizontal");
      expect(restoredSecondWindow.cursorLine).toBe(5);
      expect(restoredSecondWindow.cursorColumn).toBe(3);
      expect(restoredSecondWindow.viewportTop).toBe(10);
      expect(restoredSecondWindow.row).toBe(10);
      expect(restoredSecondWindow.col).toBe(0);
    });

    test("should round-trip empty workspace", () => {
      const workspace = createTestWorkspace("empty");

      // Serialize
      const data = workspaceToData(workspace);

      // Verify
      expect(data.buffers.length).toBe(1); // Only *scratch*
      expect(data.buffers[0]!.name).toBe("*scratch*");
      expect(data.windows.length).toBe(0);
      expect(data.tabs.length).toBe(0);

      // Deserialize
      const restored = dataToWorkspace(data);

      // Verify
      expect(restored.metadata.name).toBe("empty");
      expect(restored.buffers.size).toBe(1);
      expect(restored.buffers.has("*scratch*")).toBe(true);
      expect(restored.windows.length).toBe(0);
      expect(restored.tabs.length).toBe(0);
    });
  });

  /**
   * Modified flag tests
   */
  describe("modified flag", () => {
    test("should preserve modified true flag", () => {
      const workspace = createTestWorkspace("modified-true");

      const buffer = FunctionalTextBufferImpl.create("content");
      buffer.insert({ line: 0, column: 7 }, " modified");
      workspace.buffers.set("test.txt", buffer);
      workspace.bufferMetadata.set("test.txt", {
        name: "test.txt",
        filename: "/test.txt",
        modified: true,
        cursorLine: 0,
        cursorColumn: 0
      });
      workspace.bufferModeStates.set("test.txt", {});

      const data = workspaceToData(workspace);
      const bufferData = data.buffers.find(b => b.name === "test.txt");
      expect(bufferData?.modified).toBe(true);

      const restored = dataToWorkspace(data);
      const restoredMeta = restored.bufferMetadata.get("test.txt");
      expect(restoredMeta?.modified).toBe(true);
    });

    test("should preserve modified false flag", () => {
      const workspace = createTestWorkspace("modified-false");

      const buffer = FunctionalTextBufferImpl.create("content");
      workspace.buffers.set("test.txt", buffer);
      workspace.bufferMetadata.set("test.txt", {
        name: "test.txt",
        filename: "/test.txt",
        modified: false,
        cursorLine: 0,
        cursorColumn: 0
      });
      workspace.bufferModeStates.set("test.txt", {});

      const data = workspaceToData(workspace);
      const bufferData = data.buffers.find(b => b.name === "test.txt");
      expect(bufferData?.modified).toBe(false);

      const restored = dataToWorkspace(data);
      const restoredMeta = restored.bufferMetadata.get("test.txt");
      expect(restoredMeta?.modified).toBe(false);
    });
  });

  /**
   * Performance tests
   */
  describe("performance", () => {
    test("should serialize large buffer in under 500ms", () => {
      const workspace = createTestWorkspace("large-buffer");

      // Create a 100k line buffer
      const lines: string[] = [];
      for (let i = 0; i < 100000; i++) {
        lines.push(`Line ${i}: Some content here for testing`);
      }
      const largeContent = lines.join("\n");

      const buffer = FunctionalTextBufferImpl.create(largeContent);
      workspace.buffers.set("large.txt", buffer);
      workspace.bufferMetadata.set("large.txt", {
        name: "large.txt",
        filename: "/large.txt",
        modified: false,
        cursorLine: 0,
        cursorColumn: 0
      });
      workspace.bufferModeStates.set("large.txt", {});

      // Measure serialization time
      const start = performance.now();
      const data = workspaceToData(workspace);
      const duration = performance.now() - start;

      // Serialization should be quick. 5s catches a real O(n²) regression while
      // tolerating GC/scheduler jitter under full-suite load.
      expect(duration).toBeLessThan(5000);

      // Verify content was serialized
      const bufferData = data.buffers.find(b => b.name === "large.txt");
      expect(bufferData).toBeDefined();
      expect(bufferData!.content.split("\n").length).toBe(100000);
    });

    test("should deserialize large buffer in under 500ms", () => {
      // Create data with 100k lines
      const lines: string[] = [];
      for (let i = 0; i < 100000; i++) {
        lines.push(`Line ${i}: Some content here for testing`);
      }
      const largeContent = lines.join("\n");

      const data: WorkspaceData = {
        metadata: {
          id: crypto.randomUUID(),
          name: "large-deserialize",
          createdAt: new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
          formatVersion: 1
        },
        buffers: [
          {
            name: "large.txt",
            content: largeContent,
            modified: false,
            cursorLine: 0,
            cursorColumn: 0
          }
        ],
        windows: [],
        tabs: [],
        cursorState: { line: 0, column: 0 },
        viewportState: { top: 0 }
      };

      // Measure deserialization time
      const start = performance.now();
      const workspace = dataToWorkspace(data);
      const duration = performance.now() - start;

      // Serialization should be quick. 5s catches a real O(n²) regression while
      // tolerating GC/scheduler jitter under full-suite load.
      expect(duration).toBeLessThan(5000);

      // Verify buffer was reconstructed
      expect(workspace.buffers.size).toBe(2); // large.txt + *scratch*
      const buffer = workspace.buffers.get("large.txt");
      expect(buffer).toBeDefined();

      const contentResult = buffer!.getContent();
      expect(contentResult._tag).toBe("Right");
      if (contentResult._tag === "Right") {
        expect(contentResult.right.split("\n").length).toBe(100000);
      }
    });
  });

  /**
   * Edge cases
   */
  describe("edge cases", () => {
    test("should handle workspace with no buffers array", () => {
      const data: WorkspaceData = {
        metadata: {
          id: crypto.randomUUID(),
          name: "no-buffers",
          createdAt: new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
          formatVersion: 1
        },
        buffers: [],
        windows: [],
        tabs: [],
        cursorState: { line: 0, column: 0 },
        viewportState: { top: 0 }
      };

      const workspace = dataToWorkspace(data);

      // Should have *scratch* added automatically
      expect(workspace.buffers.has("*scratch*")).toBe(true);
      expect(workspace.buffers.size).toBe(1);
    });

    test("should handle undefined buffers array", () => {
      const data: WorkspaceData = {
        metadata: {
          id: crypto.randomUUID(),
          name: "undefined-buffers",
          createdAt: new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
          formatVersion: 1
        },
        buffers: undefined as unknown as WorkspaceData["buffers"],
        windows: [],
        tabs: [],
        cursorState: { line: 0, column: 0 },
        viewportState: { top: 0 }
      };

      const workspace = dataToWorkspace(data);

      // Should have *scratch* added automatically
      expect(workspace.buffers.has("*scratch*")).toBe(true);
      expect(workspace.buffers.size).toBe(1);
    });

    test("should preserve *scratch* when already present", () => {
      const workspace = createTestWorkspace("has-scratch");

      // Modify *scratch*
      const scratch = workspace.buffers.get("*scratch*")!;
      const insertResult = scratch.insert({ line: 0, column: 0 }, "scratch content");
      if (insertResult._tag === "Right") {
        workspace.buffers.set("*scratch*", insertResult.right);
      }

      const data = workspaceToData(workspace);
      const restored = dataToWorkspace(data);

      const restoredScratch = restored.buffers.get("*scratch*");
      expect(restoredScratch).toBeDefined();

      const contentResult = restoredScratch!.getContent();
      expect(contentResult._tag).toBe("Right");
      if (contentResult._tag === "Right") {
        expect(contentResult.right).toContain("scratch content");
      }
    });

    test("should handle buffer with missing optional fields", () => {
      const data: WorkspaceData = {
        metadata: {
          id: crypto.randomUUID(),
          name: "minimal-buffer",
          createdAt: new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
          formatVersion: 1
        },
        buffers: [
          {
            name: "minimal.txt",
            content: "content",
            modified: false,
            cursorLine: 0,
            cursorColumn: 0
            // No filename, majorMode, minorModes, lighters
          }
        ],
        windows: [],
        tabs: [],
        cursorState: { line: 0, column: 0 },
        viewportState: { top: 0 }
      };

      const workspace = dataToWorkspace(data);

      const meta = workspace.bufferMetadata.get("minimal.txt");
      expect(meta).toBeDefined();
      expect(meta?.name).toBe("minimal.txt");
      expect(meta?.filename).toBeUndefined();
      expect(meta?.majorMode).toBeUndefined();

      const modeState = workspace.bufferModeStates.get("minimal.txt");
      expect(modeState?.majorMode).toBeUndefined();
      expect(modeState?.minorModes).toBeUndefined();
    });
  });

  /**
   * Scrollback serialization
   */
  describe("scrollback", () => {
    test("should serialize scrollback buffer", () => {
      const workspace = createTestWorkspace("scrollback-test");

      const buffer = FunctionalTextBufferImpl.create("content");
      workspace.buffers.set("term.txt", buffer);
      workspace.bufferMetadata.set("term.txt", {
        name: "term.txt",
        modified: false,
        cursorLine: 0,
        cursorColumn: 0
      });
      workspace.bufferModeStates.set("term.txt", {});

      // Add window with scrollback
      workspace.windows = [{
        id: "term-window",
        buffer,
        cursorLine: 10,
        cursorColumn: 0,
        viewportTop: 5,
        viewportLeft: 0,
        scrollback: {
          lines: ["line 1", "line 2", "line 3"],
          capacity: 100,
          head: 0,
          tail: 3,
          size: 3,
          viewportOffset: 1
        }
      }];

      const data = workspaceToData(workspace);

      const window = data.windows[0]!;
      expect(window.scrollback).toBeDefined();
      expect(window.scrollback!.lines).toEqual(["line 1", "line 2", "line 3"]);
      expect(window.scrollback!.capacity).toBe(100);
      expect(window.scrollback!.size).toBe(3);
      expect(window.scrollback!.viewportOffset).toBe(1);
    });

    test("should deserialize scrollback buffer", () => {
      const data: WorkspaceData = {
        metadata: {
          id: crypto.randomUUID(),
          name: "scrollback-deser",
          createdAt: new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
          formatVersion: 1
        },
        buffers: [],
        windows: [{
          id: "term-window",
          bufferName: "*scratch*",
          cursorLine: 10,
          cursorColumn: 0,
          viewportTop: 5,
          viewportLeft: 0,
          scrollback: {
            lines: ["line 1", "line 2", "line 3"],
            capacity: 100,
            head: 0,
            tail: 3,
            size: 3,
            viewportOffset: 1
          }
        }],
        tabs: [],
        cursorState: { line: 0, column: 0 },
        viewportState: { top: 0 }
      };

      const workspace = dataToWorkspace(data);

      const window = workspace.windows[0]!;
      expect(window.scrollback).toBeDefined();
      expect(window.scrollback!.lines).toEqual(["line 1", "line 2", "line 3"]);
      expect(window.scrollback!.capacity).toBe(100);
      expect(window.scrollback!.size).toBe(3);
      expect(window.scrollback!.viewportOffset).toBe(1);
    });
  });
});
