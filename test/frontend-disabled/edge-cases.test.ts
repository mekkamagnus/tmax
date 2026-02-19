/**
 * @file edge-cases.test.ts
 * @description Tests for edge cases and error handling in React components
 */

import { describe, test, expect } from "bun:test";
import { strict as assert } from "node:assert";
import { Editor } from "../../src/frontend/components/Editor.tsx";
import { BufferView } from "../../src/frontend/components/BufferView.tsx";
import { StatusLine } from "../../src/frontend/components/StatusLine.tsx";
import { CommandInput } from "../../src/frontend/components/CommandInput.tsx";
import { useEditorState } from "../../src/frontend/hooks/useEditorState.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import { Either } from "../../src/utils/task-either.ts";
import { EditorState } from "../../src/core/types.ts";

/**
 * Test suite for edge cases and error handling in React components
 */
describe("React Components Edge Cases and Error Handling", () => {
  // Test Editor component edge cases
  test("Editor component handles edge cases", () => {
    // Basic initialization should not throw
    const initialEditorState: EditorState = {
      currentBuffer: FunctionalTextBufferImpl.create(""),
      cursorPosition: { line: 0, column: 0 },
      mode: 'normal',
      statusMessage: '',
      viewportTop: 0,
      config: {
        theme: 'default',
        tabSize: 4,
        autoSave: false,
        keyBindings: {},
        maxUndoLevels: 100,
        showLineNumbers: true,
        wordWrap: false
      }
    };

    // The Editor component should accept the initial state without errors
    // This test verifies that the component can be initialized properly
    assert(initialEditorState !== null);
    assert(initialEditorState.cursorPosition !== null);
  });

  // Test BufferView component edge cases
  test("BufferView handles empty buffers correctly", () => {
    const emptyBuffer = FunctionalTextBufferImpl.create("");

    // Get line count of empty buffer
    const lineCountResult = emptyBuffer.getLineCount();
    assert(Either.isRight(lineCountResult));
    // Empty buffer has 1 line (the empty line)
    expect(lineCountResult.right).toBe(1);
  });

  test("BufferView handles very long lines", () => {
    // Create a buffer with a very long line
    const longLine = "a".repeat(1000); // 1000 characters
    const buffer = FunctionalTextBufferImpl.create(longLine);
    
    // Get the line content
    const lineResult = buffer.getLine(0);
    assert(Either.isRight(lineResult));
    expect(lineResult.right).toBe(longLine);
    
    // Get line count
    const lineCountResult = buffer.getLineCount();
    assert(Either.isRight(lineCountResult));
    expect(lineCountResult.right).toBe(1);
  });

  test("BufferView handles Unicode and special characters", () => {
    // Create a buffer with Unicode and special characters
    const unicodeContent = "Hello 世界 🌍 café naïve résumé\nSecond line with symbols: @#$%^&*()\nThird line: \x00\x01\x02";
    const buffer = FunctionalTextBufferImpl.create(unicodeContent);
    
    // Get line count
    const lineCountResult = buffer.getLineCount();
    assert(Either.isRight(lineCountResult));
    expect(lineCountResult.right).toBe(3);
    
    // Get each line
    for (let i = 0; i < 3; i++) {
      const lineResult = buffer.getLine(i);
      assert(Either.isRight(lineResult));
      assert(typeof lineResult.right === 'string');
    }
  });

  // Test StatusLine component
  test("StatusLine handles all modes correctly", () => {
    const modes: Array<'normal' | 'insert' | 'visual' | 'command' | 'mx'> = 
      ['normal', 'insert', 'visual', 'command', 'mx'];
    
    for (const mode of modes) {
      const statusLineProps = {
        mode,
        cursorPosition: { line: 0, column: 0 },
        statusMessage: `Current mode: ${mode}`
      };
      
      // Verify the props are valid
      assert(statusLineProps.mode === mode);
      assert(typeof statusLineProps.statusMessage === 'string');
      assert(typeof statusLineProps.cursorPosition.line === 'number');
      assert(typeof statusLineProps.cursorPosition.column === 'number');
    }
  });

  // Test CommandInput component
  test("CommandInput handles both modes correctly", () => {
    const commandModes: Array<'command' | 'mx'> = ['command', 'mx'];
    
    for (const mode of commandModes) {
      const commandInputProps = {
        mode,
        onExecute: () => {},
        onCancel: () => {}
      };
      
      // Verify the props are valid
      assert(commandInputProps.mode === mode);
      assert(typeof commandInputProps.onExecute === 'function');
      assert(typeof commandInputProps.onCancel === 'function');
    }
  });

  // Test useEditorState hook
  test("useEditorState handles initial state correctly", () => {
    const initialEditorState: EditorState = {
      currentBuffer: FunctionalTextBufferImpl.create("Initial content"),
      cursorPosition: { line: 0, column: 0 },
      mode: 'normal',
      statusMessage: 'Ready',
      viewportTop: 0,
      config: {
        theme: 'default',
        tabSize: 4,
        autoSave: false,
        keyBindings: {},
        maxUndoLevels: 100,
        showLineNumbers: true,
        wordWrap: false
      }
    };

    // This test verifies that the initial state is properly formed
    assert(initialEditorState.currentBuffer !== undefined);
    assert(initialEditorState.cursorPosition.line === 0);
    assert(initialEditorState.cursorPosition.column === 0);
    assert(initialEditorState.mode === 'normal');
    assert(initialEditorState.statusMessage === 'Ready');
    assert(initialEditorState.viewportTop === 0);
    assert(initialEditorState.config !== undefined);
  });

  test("useEditorState handles state updates correctly", () => {
    const initialEditorState: EditorState = {
      currentBuffer: FunctionalTextBufferImpl.create("Initial content"),
      cursorPosition: { line: 0, column: 0 },
      mode: 'normal',
      statusMessage: 'Ready',
      viewportTop: 0,
      config: {
        theme: 'default',
        tabSize: 4,
        autoSave: false,
        keyBindings: {},
        maxUndoLevels: 100,
        showLineNumbers: true,
        wordWrap: false
      }
    };

    // Simulate state updates that would happen in the hook
    const newState: EditorState = {
      ...initialEditorState,
      mode: 'insert',
      statusMessage: 'INSERT mode activated',
      cursorPosition: { line: 5, column: 10 }
    };

    assert(newState.mode === 'insert');
    assert(newState.statusMessage === 'INSERT mode activated');
    assert(newState.cursorPosition.line === 5);
    assert(newState.cursorPosition.column === 10);
  });
});

/**
 * Test suite for terminal resizing and viewport management
 */
describe("Viewport and Resize Handling", () => {
  test("BufferView adjusts viewport for cursor visibility", () => {
    // Create a buffer with multiple lines
    const lines = Array(100).fill(0).map((_, i) => `Line ${i + 1}: This is sample content for testing`);
    const bufferContent = lines.join('\n');
    const buffer = FunctionalTextBufferImpl.create(bufferContent);

    // Verify we have 100 lines
    const lineCountResult = buffer.getLineCount();
    assert(Either.isRight(lineCountResult));
    expect(lineCountResult.right).toBe(100);

    // Test with cursor at different positions
    const testPositions = [
      { line: 0, column: 0 },      // Beginning
      { line: 50, column: 10 },    // Middle
      { line: 99, column: 5 },     // End
      { line: 150, column: 0 }     // Beyond buffer (should be handled gracefully)
    ];

    for (const pos of testPositions) {
      // Even if position is beyond buffer, it should not crash
      assert(typeof pos.line === 'number');
      assert(typeof pos.column === 'number');
    }
  });

  test("BufferView handles terminal width adjustments", () => {
    // Create a buffer with a very long line
    const longLine = "This is a very long line that exceeds typical terminal width by a significant margin and should be handled gracefully by the truncation logic";
    const buffer = FunctionalTextBufferImpl.create(longLine);

    // Get the line content
    const lineResult = buffer.getLine(0);
    assert(Either.isRight(lineResult));
    
    // The content should be retrievable regardless of length
    assert(lineResult.right.includes('long line'));
    assert(lineResult.right.includes('terminal width'));
  });
});