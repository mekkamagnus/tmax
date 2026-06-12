/**
 * @file test-core-bindings-split.test.ts
 * @description Test that core binding files are loaded correctly and key bindings work as expected
 */

import { describe, test, beforeEach, afterEach } from "bun:test";
import { expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Core Binding Files Loading", () => {
  let editor: Editor;
  let mockTerminal: MockTerminal;
  let mockFileSystem: MockFileSystem;

  beforeEach(() => {
    mockTerminal = new MockTerminal();
    mockFileSystem = new MockFileSystem();
    editor = new Editor(mockTerminal, mockFileSystem);
  });

  afterEach(() => {
    editor.stop();
  });

  test("should load normal mode bindings from normal.tlisp", async () => {
    await editor.start();

    const keyMappings = editor.getKeyMappings();
    const hMappings = keyMappings.get("h");

    // Real normal.tlisp registers h for normal mode; visual.tlisp also registers h for visual mode
    const normalH = hMappings?.find(m => m.mode === "normal");
    expect(normalH).toBeDefined();
    expect(normalH!.command).toBe("(cursor-move (cursor-line) (- (cursor-column) (vim-count-consume 1)))");
    expect(normalH!.mode).toBe("normal");
  });

  test("should load insert mode bindings from insert.tlisp", async () => {
    await editor.start();

    const keyMappings = editor.getKeyMappings();
    const escapeMappings = keyMappings.get("Escape");

    const insertEscapeMapping = escapeMappings?.find(m => m.mode === "insert");
    expect(insertEscapeMapping).toBeDefined();
    expect(insertEscapeMapping!.command).toBe("(editor-set-mode \"normal\")");
    expect(insertEscapeMapping!.mode).toBe("insert");
  });

  test("should load visual mode bindings from visual.tlisp", async () => {
    await editor.start();

    const keyMappings = editor.getKeyMappings();
    const escapeMappings = keyMappings.get("Escape");

    const visualEscapeMapping = escapeMappings?.find(m => m.mode === "visual");
    expect(visualEscapeMapping).toBeDefined();
    // Real visual.tlisp uses visual-exit
    expect(visualEscapeMapping!.mode).toBe("visual");
  });

  test("should load command mode bindings from command.tlisp", async () => {
    await editor.start();

    const keyMappings = editor.getKeyMappings();
    const escapeMappings = keyMappings.get("Escape");

    const commandEscapeMapping = escapeMappings?.find(m => m.mode === "command");
    expect(commandEscapeMapping).toBeDefined();
    expect(commandEscapeMapping!.command).toBe("(editor-exit-command-mode)");
    expect(commandEscapeMapping!.mode).toBe("command");
  });

  test("should load all four binding modes", async () => {
    await editor.start();

    const keyMappings = editor.getKeyMappings();

    const hMappings = keyMappings.get("h"); // From normal.tlisp
    const escapeInsertMappings = keyMappings.get("Escape")?.find(m => m.mode === "insert");
    const escapeVisualMappings = keyMappings.get("Escape")?.find(m => m.mode === "visual");
    const escapeCommandMappings = keyMappings.get("Escape")?.find(m => m.mode === "command");

    expect(hMappings).toBeDefined();
    expect(escapeInsertMappings).toBeDefined();
    expect(escapeVisualMappings).toBeDefined();
    expect(escapeCommandMappings).toBeDefined();
  });

  test("should handle missing binding files gracefully", async () => {
    const mockFileSystemMissing = new MockFileSystem();
    const editorMissing = new Editor(mockTerminal, mockFileSystemMissing);

    await editorMissing.start();

    expect(editorMissing.isRunning()).toBe(true);

    editorMissing.stop();
  });
});
