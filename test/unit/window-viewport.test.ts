/**
 * @file window-viewport.test.ts
 * @description Multi-window viewport sync (issue #258): focused pane must
 * follow the model cursor (self-healing viewport), unfocused panes render
 * from their own window record.
 */

import { describe, test, expect } from "bun:test";
import { renderBufferLines } from "../../src/frontend/render/buffer-lines.ts";
import { createEditorFixture, type EditorFixture } from "../helpers/editor-fixture.ts";
import { TextBufferImpl } from "../../src/core/buffer.ts";
import type { EditorState, Window } from "../../src/core/contracts/editor.ts";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

const CONFIG = { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: true, relativeLineNumbers: false, wordWrap: false };

function makeWindowState(): { state: EditorState; windows: Window[] } {
  const content = Array.from({ length: 61 }, (_, i) => `TOKEN-${String(i + 1).padStart(2, "0")}`).join("\n");
  const buf = TextBufferImpl.create(content);
  const mkWindow = (id: string, viewportTop: number): Window => ({
    id,
    buffer: buf,
    bufferName: "main",
    cursorLine: 0,
    cursorColumn: 0,
    viewportTop,
    viewportLeft: 0,
    splitType: "horizontal",
    height: 12,
    width: 80,
  });
  const windows = [mkWindow("window-main", 0), mkWindow("window-1", 0)];
  const state: EditorState = {
    currentBuffer: buf,
    cursorPosition: { line: 60, column: 0 },
    mode: "normal",
    statusMessage: "",
    viewportTop: 0,
    viewportLeft: 0,
    windows,
    currentWindowIndex: 0,
    config: CONFIG,
    commandLine: "",
    mxCommand: "",
    currentFilename: "test.txt",
  } as EditorState;
  return { state, windows };
}

/** Build a render-path state with n windows on one shared 61-line buffer. */
function makeNWindowState(n: number, splitType: "horizontal" | "vertical"): EditorState {
  const content = Array.from({ length: 61 }, (_, i) => `TOKEN-${String(i + 1).padStart(2, "0")}`).join("\n");
  const buf = TextBufferImpl.create(content);
  const windows: Window[] = Array.from({ length: n }, (_, i) => ({
    id: `window-${i}`,
    buffer: buf,
    bufferName: "main",
    cursorLine: 0,
    cursorColumn: 0,
    viewportTop: 0,
    viewportLeft: 0,
    splitType,
    height: 24,
    width: 80,
  }));
  return {
    currentBuffer: buf,
    cursorPosition: { line: 60, column: 0 },
    mode: "normal",
    statusMessage: "",
    viewportTop: 0,
    viewportLeft: 0,
    windows,
    currentWindowIndex: 0,
    config: CONFIG,
    commandLine: "",
    mxCommand: "",
    currentFilename: "test.txt",
  } as EditorState;
}

describe("Multi-window viewport (issue #258)", () => {
  test("focused pane scrolls to keep the cursor visible", () => {
    const { state } = makeWindowState();
    const screen = renderBufferLines(state, 80, 24);
    // 61-line buffer, cursor at line 61 (index 60), panes of 11/12 rows with a
    // separator row between: focused cell self-heals to viewportTop 50 →
    // TOKEN-51..TOKEN-61, so the cursor line renders on a content row
    const focusedRows = screen.slice(0, 11).map(stripAnsi).join("\n");
    expect(focusedRows).toContain("TOKEN-51");
    expect(focusedRows).toContain("TOKEN-61");
    expect(focusedRows).not.toContain("TOKEN-01");
    // Separator occupies its own row: drawn there, no pane content under it
    const sepRow = stripAnsi(screen[11]!).trim();
    expect(sepRow).toContain("─");
    expect(sepRow).not.toContain("TOKEN");
  });

  test("unfocused pane renders from its own window record", () => {
    const { state } = makeWindowState();
    const screen = renderBufferLines(state, 80, 24);
    // Unfocused window keeps viewportTop 0 → shows TOKEN-01..TOKEN-12
    const unfocusedRows = screen.slice(12, 24).map(stripAnsi).join("\n");
    expect(unfocusedRows).toContain("TOKEN-01");
    expect(unfocusedRows).not.toContain("TOKEN-50");
  });

  test("three horizontal panes each get a dedicated separator row", () => {
    const state = makeNWindowState(3, "horizontal");
    const screen = renderBufferLines(state, 80, 24);
    // rowHeight = floor((24-2)/3) = 7 → cells at y=0/8/16, separators at 7/15
    for (const sepRowIdx of [7, 15]) {
      const sepRow = stripAnsi(screen[sepRowIdx]!).trim();
      expect(sepRow).toContain("─");
      expect(sepRow).not.toContain("TOKEN");
    }
    // Focused pane (rows 0-6, height 7) self-heals to viewportTop 54:
    // TOKEN-55..TOKEN-61, cursor on a content row
    const focused = screen.slice(0, 7).map(stripAnsi).join("\n");
    expect(focused).toContain("TOKEN-55");
    expect(focused).toContain("TOKEN-61");
    expect(focused).not.toContain("TOKEN-01");
    // Middle pane (rows 8-14) renders from its own record: TOKEN-01..
    const middle = screen.slice(8, 15).map(stripAnsi).join("\n");
    expect(middle).toContain("TOKEN-01");
  });

  test("vertical splits reserve a dedicated separator column", () => {
    const state = makeNWindowState(2, "vertical");
    const screen = renderBufferLines(state, 80, 24);
    // colWidth = floor((80-1)/2) = 39 → pane 0 spans cols 0-38, pane 1
    // starts at col 40, separator column at 39 on every row
    for (let row = 0; row < 24; row++) {
      const line = stripAnsi(screen[row]!);
      expect(line.length).toBe(80);
      expect(line[39]).toBe("│");
    }
    // Focused pane 0 (cols 0-38) self-heals around the cursor: viewportTop
    // clamps to 60 - 24 + 1 = 37 → TOKEN-38..TOKEN-61
    const pane0 = stripAnsi(screen[0]!).slice(0, 39);
    expect(pane0).toContain("TOKEN-38");
    expect(pane0).not.toContain("TOKEN-01");
    // Unfocused pane 1 renders its own record from its own origin (col 40)
    const pane1 = stripAnsi(screen[0]!).slice(40);
    expect(pane1).toContain("TOKEN-01");
    expect(pane1).not.toContain("TOKEN-38");
  });
});

describe("Focus switch viewport sync (issue #258)", () => {
  // CHORE-44 Change 12: the shared fixture is the single Editor
  // construction/cleanup path (AC12.1); initialContent seeds the "main"
  // buffer the same way the old direct construction did.
  const setup = async (): Promise<EditorFixture> => {
    const content = Array.from({ length: 61 }, (_, i) => `line ${i + 1}`).join("\n");
    return createEditorFixture({ initialContent: content, bufferName: "main" });
  };

  test("switching focus records the effective viewport in the leaving window", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute("(cursor-move 60 0)");

      interpreter.execute("(window-next)");
      const state = fixture.editor.getState();
      // Initial window keeps height 22 (terminal 24 - 2): viewport clamps to 60 - 22 + 1
      expect(state.windows?.[0]?.viewportTop).toBe(39);
    } finally {
      fixture.dispose();
    }
  });

  test("switching back restores the target window's viewport into the model", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute("(cursor-move 60 0)");
      interpreter.execute("(window-next)");

      interpreter.execute("(window-prev)");
      const state = fixture.editor.getState();
      expect(state.viewportTop).toBe(39);
      expect(state.currentWindowIndex).toBe(0);
    } finally {
      fixture.dispose();
    }
  });

  test("same-window focus switch is a no-op — model viewport preserved", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      // Single window, scrolled by hand past the record's creation-time
      // viewportTop (0): (window-next) computes nextIndex === currentIndex,
      // which must NOT restore the stale record viewport into the model.
      interpreter.execute("(viewport-top-set 20)");
      interpreter.execute("(window-next)");
      const state = fixture.editor.getState();
      expect(state.viewportTop).toBe(20);
      expect(state.currentWindowIndex).toBe(0);
    } finally {
      fixture.dispose();
    }
  });
});
