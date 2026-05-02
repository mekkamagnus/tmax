/**
 * @file window-splitting.test.ts
 * @description Test suite for window splitting functionality (US-3.2.1)
 */

import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Window Splitting - US-3.2.1", () => {
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;
  let editor: Editor;

  const setup = () => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
    // Create initial buffer
    editor.createBuffer("main", "line 1\nline 2\nline 3");
  };

  test("should have single window initially", () => {
    setup();
    const state = editor.getState();
    
    // Initially there should be one window
    expect(state.windows).toBeDefined();
    expect(state.windows?.length).toBe(1);
    expect(state.currentWindowIndex).toBe(0);
  });

  test(":split should split window horizontally", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Execute split command
    interpreter.execute('(split-window "horizontal")');
    
    const state = editor.getState();
    expect(state.windows?.length).toBe(2);
    
    // Both windows should have same buffer
    const window1 = state.windows?.[0];
    const window2 = state.windows?.[1];
    expect(window1?.buffer).toBeDefined();
    expect(window2?.buffer).toBeDefined();
  });

  test(":vsplit should split window vertically", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Execute vsplit command
    interpreter.execute('(split-window "vertical")');
    
    const state = editor.getState();
    expect(state.windows?.length).toBe(2);
  });

  test("C-w w should switch focus to next window", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Split window
    interpreter.execute('(split-window "horizontal")');
    
    let state = editor.getState();
    expect(state.currentWindowIndex).toBe(0);
    
    // Switch to next window
    interpreter.execute('(window-next)');
    
    state = editor.getState();
    expect(state.currentWindowIndex).toBe(1);
    
    // Switch again (should wrap around)
    interpreter.execute('(window-next)');
    
    state = editor.getState();
    expect(state.currentWindowIndex).toBe(0);
  });

  test("C-w q should close current window", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Split window
    interpreter.execute('(split-window "horizontal")');
    
    let state = editor.getState();
    expect(state.windows?.length).toBe(2);
    expect(state.currentWindowIndex).toBe(0);
    
    // Close current window
    interpreter.execute('(window-close)');
    
    state = editor.getState();
    expect(state.windows?.length).toBe(1);
    expect(state.currentWindowIndex).toBe(0);
  });

  test("closing last window should not close editor", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Try to close the only window
    interpreter.execute('(window-close)');
    
    const state = editor.getState();
    // Should still have one window
    expect(state.windows?.length).toBe(1);
    expect(state.currentWindowIndex).toBe(0);
  });

  test("windows should maintain independent cursor positions", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Split window
    interpreter.execute('(split-window "horizontal")');
    
    let state = editor.getState();
    const window1 = state.windows?.[0];
    const window2 = state.windows?.[1];
    
    // Both should start at same position
    expect(window1?.cursorLine).toBe(0);
    expect(window2?.cursorLine).toBe(0);
    
    // Move cursor in window 1
    interpreter.execute('(cursor-move 1 5)');
    
    state = editor.getState();
    const window1After = state.windows?.[0];
    const window2After = state.windows?.[1];
    
    // Window 1 cursor should have moved
    expect(window1After?.cursorLine).toBe(1);
    // Window 2 cursor should still be at original position
    expect(window2After?.cursorLine).toBe(0);
  });

  test("split should create window with same buffer", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Split window
    interpreter.execute('(split-window "horizontal")');
    
    const state = editor.getState();
    const window1 = state.windows?.[0];
    const window2 = state.windows?.[1];
    
    // Both windows should reference the same buffer
    expect(window1?.buffer).toBe(window2?.buffer);
  });
});
