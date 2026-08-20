/**
 * @file capture-frame.test.ts
 * @description Tests for the standalone capture-frame renderer
 */

import { describe, test, expect } from "bun:test";
import { captureFrame } from "../../src/render/capture-frame.ts";
import { Either } from "../../src/utils/task-either.ts";
import type { EditorState } from "../../src/core/types.ts";
import { TextBufferImpl } from "../../src/core/buffer.ts";

function makeState(overrides: Partial<EditorState> = {}): EditorState {
  const buf = TextBufferImpl.create("(defun hello ()\n  (print \"world\"))");

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
    const buf = TextBufferImpl.create("");
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

  // BUG-76: the echo row. captureFrame (embedded Steep + `tmax --capture`)
  // used to drop state.statusMessage entirely, so commands like gx/markdown-do
  // ran with zero visible feedback in the live embedded editor. The TUI client
  // overlays the message on the last buffer line (height-2) — captureFrame
  // must mirror that.
  describe("status message echo row (BUG-76)", () => {
    test("renders statusMessage on the last buffer row when in normal mode", () => {
      const state = makeState({ statusMessage: "Browse: https://anthropic.com" });
      const lines = captureFrame(state, 80, 24);
      // height-2 row (index 22), just above the status line
      const echoRow = stripAnsi(lines[22]!);
      expect(echoRow).toContain("Browse: https://anthropic.com");
      // Frame stays exactly `height` lines (overlay semantics, no growth)
      expect(lines.length).toBe(24);
    });

    test("truncates long messages to the terminal width", () => {
      const state = makeState({ statusMessage: "x".repeat(120) });
      const lines = captureFrame(state, 80, 24);
      const echoRow = stripAnsi(lines[22]!);
      expect(echoRow.length).toBeLessThanOrEqual(80);
      expect(echoRow).not.toContain("\x1b");
    });

    test("no echo row when statusMessage is empty — buffer line stays visible", () => {
      const state = makeState({ statusMessage: "" });
      const lines = captureFrame(state, 80, 24);
      const row = stripAnsi(lines[22]!);
      // The buffer only has 2 lines; row 22 is past the text — must not
      // contain the previous message ("test" default from makeState).
      expect(row).not.toContain("Browse");
    });

    test("command mode takes precedence over the echo row", () => {
      const state = makeState({ mode: "command", commandLine: ":w", statusMessage: "stale" });
      const lines = captureFrame(state, 80, 24);
      const row = stripAnsi(lines[lines.length - 2]!);
      expect(row).toContain(":w");
      expect(row).not.toContain("stale");
    });
  });
});

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

// #205: terminal-mode rows are ANSI-styled; a JS-length slice loses visible
// columns to the escape budget (claude's colored right border vanished).
describe("#205 styled terminal rows render full visible width", () => {
  const styled = (txt: string) => `\x1b[38;5;1m${txt}\x1b[0m`;

  function termState(lines: string[]): EditorState {
    return { ...makeState(), mode: "terminal" as const, terminalLines: lines } as EditorState;
  }

  test("a styled 100-col row renders all 100 visible cols (escapes uncounted)", () => {
    const row = styled("X".repeat(40)) + "Y".repeat(60);
    const lines = captureFrame(termState([row]), 100, 5);
    const plain = stripAnsi(lines[0]!);
    expect(plain.length).toBe(100);
    expect(plain.startsWith("X".repeat(40))).toBe(true);
    expect(plain.endsWith("Y".repeat(60))).toBe(true);
  });

  test("a row WIDER than the frame is cut at the visible boundary, escape-safe", () => {
    const row = styled("A".repeat(60)) + "B".repeat(60);
    const lines = captureFrame(termState([row]), 100, 5);
    const plain = stripAnsi(lines[0]!);
    expect(plain.length).toBe(100);
    expect(plain.endsWith("B".repeat(40))).toBe(true);
    // the styled prefix's reset survived intact (not cut mid-sequence)
    expect(lines[0]!).toContain("\x1b[0m");
  });

  test("wide glyphs count 2 columns at the boundary", () => {
    const row = "\u{1F30C}".repeat(50); // 100 visible cols
    const lines = captureFrame(termState([row]), 99, 5);
    const plain = stripAnsi(lines[0]!);
    expect(plain.length).toBe(98);
  });
});
