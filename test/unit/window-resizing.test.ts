/**
 * @file window-resizing.test.ts
 * @description Test suite for window resizing functionality (US-3.2.2)
 */

import { describe, test, expect, afterEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { createEditorFixture, type EditorFixture } from "../helpers/editor-fixture.ts";

describe("Window Resizing - US-3.2.2", () => {
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;
  let editor: Editor;
  let fixture: EditorFixture;

  const setup = async (): Promise<void> => {
    fixture = await createEditorFixture({ start: false, initialContent: "line 1\nline 2\nline 3", bufferName: "main" });
    editor = fixture.editor;
    terminal = fixture.terminal as MockTerminal;
    filesystem = fixture.filesystem as MockFileSystem;
  };

  afterEach(() => {
    fixture?.dispose();
  });

  test("should initialize with default window height and width", async () => {
    await setup();
    const state = editor.getState();
    const window = state.windows?.[0];
    
    // Window should have height and width properties
    expect(window?.height).toBeDefined();
    expect(window?.width).toBeDefined();
    expect(window?.height).toBeGreaterThan(0);
    expect(window?.width).toBeGreaterThan(0);
  });

  test("(window-resize-height delta) should increase window height", async () => {
    await setup();
    const interpreter = editor.getInterpreter();
    
    // Get initial height
    let state = editor.getState();
    const initialHeight = state.windows?.[0]?.height || 0;
    
    // Increase height by 5
    interpreter.execute('(window-resize-height 5)');
    
    state = editor.getState();
    const newHeight = state.windows?.[0]?.height || 0;
    expect(newHeight).toBe(initialHeight + 5);
  });

  test("(window-resize-height delta) should decrease window height", async () => {
    await setup();
    const interpreter = editor.getInterpreter();
    
    // First increase height to have room to decrease
    interpreter.execute('(window-resize-height 10)');
    
    let state = editor.getState();
    const initialHeight = state.windows?.[0]?.height || 0;
    
    // Decrease height by 3
    interpreter.execute('(window-resize-height -3)');
    
    state = editor.getState();
    const newHeight = state.windows?.[0]?.height || 0;
    expect(newHeight).toBe(initialHeight - 3);
  });

  test("(window-resize-height delta) should not decrease below minimum height", async () => {
    await setup();
    const interpreter = editor.getInterpreter();
    
    // Try to decrease height by huge amount
    interpreter.execute('(window-resize-height -1000)');
    
    const state = editor.getState();
    const height = state.windows?.[0]?.height || 0;
    // Should not go below minimum (e.g., 3 lines)
    expect(height).toBeGreaterThanOrEqual(3);
  });

  test("(window-resize-width delta) should increase window width", async () => {
    await setup();
    const interpreter = editor.getInterpreter();
    
    // Get initial width
    let state = editor.getState();
    const initialWidth = state.windows?.[0]?.width || 0;
    
    // Increase width by 10
    interpreter.execute('(window-resize-width 10)');
    
    state = editor.getState();
    const newWidth = state.windows?.[0]?.width || 0;
    expect(newWidth).toBe(initialWidth + 10);
  });

  test("(window-resize-width delta) should decrease window width", async () => {
    await setup();
    const interpreter = editor.getInterpreter();
    
    // First increase width to have room to decrease
    interpreter.execute('(window-resize-width 20)');
    
    let state = editor.getState();
    const initialWidth = state.windows?.[0]?.width || 0;
    
    // Decrease width by 5
    interpreter.execute('(window-resize-width -5)');
    
    state = editor.getState();
    const newWidth = state.windows?.[0]?.width || 0;
    expect(newWidth).toBe(initialWidth - 5);
  });

  test("(window-resize-width delta) should not decrease below minimum width", async () => {
    await setup();
    const interpreter = editor.getInterpreter();
    
    // Try to decrease width by huge amount
    interpreter.execute('(window-resize-width -1000)');
    
    const state = editor.getState();
    const width = state.windows?.[0]?.width || 0;
    // Should not go below minimum (e.g., 10 columns)
    expect(width).toBeGreaterThanOrEqual(10);
  });

  test("resizing should affect only current window in split view", async () => {
    await setup();
    const interpreter = editor.getInterpreter();
    
    // Split window horizontally
    interpreter.execute('(split-window "horizontal")');
    
    // #260 tree semantics: resize trades space between siblings — the
    // focused pane's CELL grows (ratio on the enclosing split), the sibling
    // shrinks, and the pair still tiles the terminal exactly.
    const h = (i: number) => {
      const r = interpreter.execute(`(window-height ${i})`);
      return r._tag === "Right" ? (r.right.value as number) : -1;
    };
    const before0 = h(0);
    const before1 = h(1);
    expect(before0).toBe(11); // fresh split cells on 24 rows: 11 + sep + 12
    expect(before1).toBe(12);

    interpreter.execute('(window-resize-height 5)');

    const after0 = h(0);
    const after1 = h(1);
    expect(after0).toBeGreaterThan(before0); // the resized pane grew
    expect(after1).toBeLessThan(before1);    // the sibling ceded the space
    expect(after0 + after1).toBe(23);        // tiles the 23 content rows exactly
  });

  test("vertical split windows should resize width independently", async () => {
    await setup();
    const interpreter = editor.getInterpreter();
    
    // Split window vertically
    interpreter.execute('(split-window "vertical")');
    
    // #260 tree semantics: the focused pane's CELL width grows by the ratio
    // adjustment; the pair still tiles the content columns exactly.
    const w = (i: number) => {
      const r = interpreter.execute(`(window-width ${i})`);
      return r._tag === "Right" ? (r.right.value as number) : -1;
    };
    const before0 = w(0);
    expect(before0).toBe(39); // fresh vertical split on 80 cols: 39 + sep + 40

    interpreter.execute('(window-resize-width 10)');

    const after0 = w(0);
    const after1 = w(1);
    expect(after0).toBeGreaterThan(before0);
    expect(after0 + after1).toBe(79); // tiles the 79 content columns exactly
  });

  test("window resize with count prefix should multiply the delta", async () => {
    await setup();
    const interpreter = editor.getInterpreter();
    
    // Get initial height
    let state = editor.getState();
    const initialHeight = state.windows?.[0]?.height || 0;
    
    // Increase height by 5, 3 times (simulating count prefix)
    interpreter.execute('(window-resize-height 5)');
    interpreter.execute('(window-resize-height 5)');
    interpreter.execute('(window-resize-height 5)');
    
    state = editor.getState();
    const newHeight = state.windows?.[0]?.height || 0;
    expect(newHeight).toBe(initialHeight + 15);
  });
});
