/**
 * @file viewport-scroll-wrap.test.ts
 * @description Tests for horizontal scrolling and word wrap display (SPEC-037)
 */

import { describe, test, expect } from "bun:test";
import { captureFrame } from "../../src/render/capture-frame.ts";
import {
  renderBufferLines,
  getVisibleViewportTop,
  getVisibleViewportLeft,
  getCursorScreenOffset,
} from "../../src/frontend/render/buffer-lines.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import type { EditorState } from "../../src/core/types.ts";

function makeState(content: string, opts?: Partial<EditorState>): EditorState {
  const buf = FunctionalTextBufferImpl.create(content);
  return {
    currentBuffer: buf as any,
    cursorPosition: { line: 0, column: 0 },
    mode: "normal",
    statusMessage: "",
    viewportTop: 0,
    viewportLeft: 0,
    config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: false },
    commandLine: "",
    mxCommand: "",
    currentFilename: "test.txt",
    ...opts,
  };
}

// Helper to strip ANSI escape sequences for assertions
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("Horizontal scroll: rendering", () => {
  test("viewportLeft=0 renders identically to before (no regression)", () => {
    const longLine = "a".repeat(200);
    const state = makeState(longLine, { viewportLeft: 0 });
    const lines = renderBufferLines(state, 80, 24);
    expect(lines.length).toBe(24);
    const first = stripAnsi(lines[0]!);
    // Should end with "..." since the line is truncated
    expect(first.endsWith("...") || first.length <= 80).toBe(true);
  });

  test("viewportLeft > 0 slices line from offset", () => {
    const longLine = "abcdefghij".repeat(20); // 200 chars
    const state = makeState(longLine, { viewportLeft: 10 });
    const lines = renderBufferLines(state, 80, 24);
    const first = stripAnsi(lines[0]!);
    // Should start with « indicator
    expect(first.startsWith("\u00AB")).toBe(true);
    // Offset 10 should skip first "abcdefghij" and show from second repetition
    expect(first).toContain("abcdefghijabcdefgh");
  });

  test("« indicator appears when viewportLeft > 0", () => {
    const longLine = "x".repeat(200);
    const state = makeState(longLine, { viewportLeft: 40 });
    const lines = renderBufferLines(state, 80, 24);
    const first = stripAnsi(lines[0]!);
    expect(first).toContain("\u00AB");
  });

  test("» indicator appears when line extends past visible area", () => {
    const longLine = "a".repeat(200);
    const state = makeState(longLine, { viewportLeft: 10 });
    const lines = renderBufferLines(state, 80, 24);
    const first = stripAnsi(lines[0]!);
    expect(first).toContain("\u00BB");
  });

  test("CJK characters offset correctly with viewportLeft", () => {
    // CJK chars are width 2
    const line = "你好世界" + "a".repeat(100);
    const state = makeState(line, { viewportLeft: 4 }); // skip "你好" (2 chars * 2 width = 4)
    const lines = renderBufferLines(state, 80, 24);
    const first = stripAnsi(lines[0]!);
    expect(first).toContain("\u00AB");
    // Should show "世界" which starts at visual offset 4
    expect(first).toContain("世界");
  });

  test("short line with viewportLeft shows « and empty content", () => {
    const shortLine = "hi";
    const state = makeState(shortLine, { viewportLeft: 50 });
    const lines = renderBufferLines(state, 80, 24);
    const first = stripAnsi(lines[0]!);
    expect(first).toContain("\u00AB");
  });
});

describe("Horizontal scroll: auto-scroll", () => {
  test("getVisibleViewportLeft clamps when cursor is left of viewport", () => {
    const state = makeState("test", {
      cursorPosition: { line: 0, column: 0 },
      viewportLeft: 20,
    });
    const result = getVisibleViewportLeft(state, 80);
    expect(result).toBe(0);
  });

  test("getVisibleViewportLeft clamps when cursor is right of viewport", () => {
    const state = makeState("test", {
      cursorPosition: { line: 0, column: 100 },
      viewportLeft: 0,
    });
    const result = getVisibleViewportLeft(state, 80);
    expect(result).toBe(21); // 100 - 80 + 1
  });

  test("getVisibleViewportLeft returns unchanged when cursor is visible", () => {
    const state = makeState("test", {
      cursorPosition: { line: 0, column: 40 },
      viewportLeft: 10,
    });
    const result = getVisibleViewportLeft(state, 80);
    expect(result).toBe(10);
  });
});

describe("Horizontal scroll: cursor screen offset", () => {
  test("getCursorScreenOffset accounts for viewportLeft", () => {
    const state = makeState("test", {
      cursorPosition: { line: 0, column: 25 },
      viewportLeft: 20,
    });
    const offset = getCursorScreenOffset(state, 24, 80);
    expect(offset.col).toBe(5);
    expect(offset.row).toBe(0);
  });

  test("getCursorScreenOffset clamps negative col to 0", () => {
    const state = makeState("test", {
      cursorPosition: { line: 0, column: 5 },
      viewportLeft: 20,
    });
    const offset = getCursorScreenOffset(state, 24, 80);
    expect(offset.col).toBe(0);
  });
});

describe("Word wrap: rendering", () => {
  test("long line wraps across multiple screen rows", () => {
    const longLine = "a".repeat(200);
    const state = makeState(longLine, {
      config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: true },
    });
    const lines = renderBufferLines(state, 80, 24);
    // 200 chars in 80-wide terminal = 3 rows (80+80+40)
    const first3 = [stripAnsi(lines[0]!), stripAnsi(lines[1]!), stripAnsi(lines[2]!)];
    // All three should be 'a' characters (possibly with padding)
    expect(first3[0]!.trim().length).toBeGreaterThan(0);
    expect(first3[1]!.trim().length).toBeGreaterThan(0);
    expect(first3[2]!.trim().length).toBeGreaterThan(0);
  });

  test("short line does not wrap", () => {
    const shortLine = "hello";
    const state = makeState(shortLine, {
      config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: true },
    });
    const lines = renderBufferLines(state, 80, 24);
    const first = stripAnsi(lines[0]!);
    expect(first.trim()).toContain("hello");
  });

  test("word wrap forces viewportLeft to 0", () => {
    const longLine = "a".repeat(200);
    const state = makeState(longLine, {
      viewportLeft: 50,
      config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: true },
    });
    const lines = renderBufferLines(state, 80, 24);
    const first = stripAnsi(lines[0]!);
    // Should NOT have « indicator — wrap mode ignores viewportLeft
    expect(first).not.toContain("\u00AB");
  });

  test("CJK characters wrap correctly without splitting", () => {
    // 40 CJK chars = 80 visual width, fills exactly one row
    const line = "你".repeat(41); // 41 * 2 = 82 visual width
    const state = makeState(line, {
      config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: true },
    });
    const lines = renderBufferLines(state, 80, 24);
    const first = stripAnsi(lines[0]!);
    const second = stripAnsi(lines[1]!);
    expect(first).toContain("你");
    expect(second.trim()).toContain("你");
  });

  test("toggling wordWrap off restores truncation behavior", () => {
    const longLine = "a".repeat(200);
    const state = makeState(longLine, {
      config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: false },
    });
    const lines = renderBufferLines(state, 80, 24);
    const first = stripAnsi(lines[0]!);
    // Truncation mode: should have "..." at end
    expect(first.endsWith("...")).toBe(true);
    // Should only occupy one screen row for this line
    const second = stripAnsi(lines[1]!);
    expect(second.trim()).toBe("~");
  });
});

describe("Word wrap: cursor placement", () => {
  test("cursor on wrapped line appears at correct screen row", () => {
    const longLine = "a".repeat(200);
    // Cursor at column 100 (second wrapped row)
    const state = makeState(longLine, {
      cursorPosition: { line: 0, column: 100 },
      config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: true },
    });
    const lines = renderBufferLines(state, 80, 24);
    // The block cursor should be on the second screen row (lines[1])
    const secondRow = lines[1]!;
    // Block cursor adds ANSI escapes, so check for the inverted character
    expect(secondRow).toContain("\x1b[");
  });

  test("getCursorScreenOffset with wrap mode uses no horizontal offset", () => {
    const longLine = "a".repeat(200);
    const state = makeState(longLine, {
      cursorPosition: { line: 0, column: 40 },
      config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: true },
    });
    const offset = getCursorScreenOffset(state, 24, 80);
    expect(offset.row).toBe(0);
    // cursor column 40, viewportLeft 0 → screen col 40
    expect(offset.col).toBe(40);
  });
});

describe("captureFrame integration", () => {
  test("captureFrame with viewportLeft produces output", () => {
    const longLine = "a".repeat(200);
    const state = makeState(longLine, { viewportLeft: 40 });
    const frame = captureFrame(state, 80, 24);
    expect(frame.length).toBeGreaterThan(0);
  });

  test("captureFrame with wordWrap produces output", () => {
    const longLine = "a".repeat(200);
    const state = makeState(longLine, {
      config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: true },
    });
    const frame = captureFrame(state, 80, 24);
    expect(frame.length).toBeGreaterThan(0);
  });
});
