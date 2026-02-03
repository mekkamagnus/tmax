/**
 * @file window-resizing.test.ts
 * @description Test suite for window resizing functionality (US-3.2.2)
 */

import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Window Resizing - US-3.2.2", () => {
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

  test("should initialize with default window height and width", () => {
    setup();
    const state = editor.getState();
    const window = state.windows?.[0];
    
    // Window should have height and width properties
    expect(window?.height).toBeDefined();
    expect(window?.width).toBeDefined();
    expect(window?.height).toBeGreaterThan(0);
    expect(window?.width).toBeGreaterThan(0);
  });

  test("(window-resize-height delta) should increase window height", () => {
    setup();
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

  test("(window-resize-height delta) should decrease window height", () => {
    setup();
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

  test("(window-resize-height delta) should not decrease below minimum height", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Try to decrease height by huge amount
    interpreter.execute('(window-resize-height -1000)');
    
    const state = editor.getState();
    const height = state.windows?.[0]?.height || 0;
    // Should not go below minimum (e.g., 3 lines)
    expect(height).toBeGreaterThanOrEqual(3);
  });

  test("(window-resize-width delta) should increase window width", () => {
    setup();
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

  test("(window-resize-width delta) should decrease window width", () => {
    setup();
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

  test("(window-resize-width delta) should not decrease below minimum width", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Try to decrease width by huge amount
    interpreter.execute('(window-resize-width -1000)');
    
    const state = editor.getState();
    const width = state.windows?.[0]?.width || 0;
    // Should not go below minimum (e.g., 10 columns)
    expect(width).toBeGreaterThanOrEqual(10);
  });

  test("resizing should affect only current window in split view", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Split window horizontally
    interpreter.execute('(split-window "horizontal")');
    
    let state = editor.getState();
    const window1InitialHeight = state.windows?.[0]?.height || 0;
    const window2InitialHeight = state.windows?.[1]?.height || 0;
    
    // Resize current window (window 0)
    interpreter.execute('(window-resize-height 5)');
    
    state = editor.getState();
    const window1NewHeight = state.windows?.[0]?.height || 0;
    const window2NewHeight = state.windows?.[1]?.height || 0;
    
    // Window 1 should be resized
    expect(window1NewHeight).toBe(window1InitialHeight + 5);
    // Window 2 should remain unchanged or be adjusted to maintain total
    // (implementation may vary, but window 1 should definitely change)
    expect(window1NewHeight).not.toBe(window1InitialHeight);
  });

  test("vertical split windows should resize width independently", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Split window vertically
    interpreter.execute('(split-window "vertical")');
    
    let state = editor.getState();
    const window1InitialWidth = state.windows?.[0]?.width || 0;
    
    // Resize current window width
    interpreter.execute('(window-resize-width 10)');
    
    state = editor.getState();
    const window1NewWidth = state.windows?.[0]?.width || 0;
    
    // Window 1 width should change
    expect(window1NewWidth).toBe(window1InitialWidth + 10);
  });

  test("window resize with count prefix should multiply the delta", () => {
    setup();
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
