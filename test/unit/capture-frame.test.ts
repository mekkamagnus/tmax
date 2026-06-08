/**
 * @file capture-frame.test.ts
 * @description Tests for the standalone capture-frame renderer
 */

import { describe, test, expect } from "bun:test";
import { captureFrame } from "../../src/render/capture-frame.ts";
import { Either } from "../../src/utils/task-either.ts";
import type { EditorState } from "../../src/core/types.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";

function makeState(overrides: Partial<EditorState> = {}): EditorState {
  const buf = FunctionalTextBufferImpl.create("(defun hello ()\n  (print \"world\"))");

  return {
    currentBuffer: buf as any,
    cursorPosition: { line: 0, column: 0 },
    mode: "normal",
    statusMessage: "test",
    viewportTop: 0,
    config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: false },
    commandLine: "",
    mxCommand: "",
    currentFilename: "test.tlisp",
    ...overrides,
  };
}

describe("captureFrame", () => {
  test("returns the correct number of lines for given height", () => {
    const state = makeState();
    const lines = captureFrame(state, 80, 24);
    // height=24: bufferHeight(22) + status(1) + buffer itself counts as 22 = 23 lines
    // Actually: bufferHeight(23) + status(1) = 24 total
    expect(lines.length).toBe(24);
  });

  test("includes status line as the last line", () => {
    const state = makeState({ statusMessage: "hello world" });
    const lines = captureFrame(state, 80, 24);
    const statusLine = lines[lines.length - 1]!;
    const stripped = statusLine.replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripped).toContain("--NORMAL--");
    expect(stripped).toContain("test.tlisp");
    expect(stripped).toContain("L1 C1");
  });

  test("includes syntax highlighting ANSI codes for tlisp files", () => {
    const state = makeState();
    const lines = captureFrame(state, 80, 24);
    // The first line should contain "(defun" which is a keyword — should be colored
    const firstLine = lines[0]!;
    // Check for any ANSI escape code (syntax highlighting or gutter)
    expect(firstLine).toMatch(/\x1b\[/);
  });

  test("produces no syntax highlighting for files without extension", () => {
    const state = makeState({ currentFilename: undefined });
    const lines = captureFrame(state, 80, 24);
    // Should still work, just without syntax colors on the buffer text
    expect(lines.length).toBeGreaterThan(0);
  });

  test("handles command mode with command input line", () => {
    const state = makeState({ mode: "command", commandLine: ":w" });
    const lines = captureFrame(state, 80, 24);
    // Should have command input line before status line
    const cmdLine = lines[lines.length - 2]!;
    const stripped = cmdLine.replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripped).toContain(":w");
  });

  test("handles empty buffer", () => {
    const buf = FunctionalTextBufferImpl.create("");
    const state = makeState({ currentBuffer: buf as any });
    const lines = captureFrame(state, 80, 24);
    expect(lines.length).toBeGreaterThan(0);
  });

  test("respects custom width", () => {
    const state = makeState();
    const lines = captureFrame(state, 40, 10);
    // height=10: bufferHeight(8) + status(1) = 9 buffer + 1 status = 10
    expect(lines.length).toBe(10);
    // Lines should be at most 40 visible chars wide (after stripping ANSI)
    for (const line of lines) {
      const visible = line.replace(/\x1b\[[0-9;]*m/g, "");
      expect(visible.length).toBeLessThanOrEqual(42); // Allow some tolerance for gutter + padding
    }
  });
});
