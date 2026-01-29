/**
 * @file useEditorState.ts
 * @description React hook for managing editor state with T-Lisp integration
 * T-Lisp drives ALL state changes - React only renders the current state
 */

import { useState, useEffect, useCallback } from "react";
import { EditorState } from "../../core/types.ts";
import { FunctionalTextBufferImpl } from "../../core/buffer.ts";
import type { Editor } from "../../editor/editor.ts";

interface UseEditorStateReturn {
  state: EditorState;
  setState: (stateUpdate: ((prevState: EditorState) => EditorState) | EditorState) => void;
  executeTlisp: (key: string) => Promise<void>;
}

/**
 * React hook that bridges the UI with the T-Lisp-powered Editor class
 * The Editor class contains ALL business logic - this hook just:
 * 1. Holds the current state for React to render
 * 2. Executes T-Lisp functions via Editor.handleKey()
 * 3. Updates React state when T-Lisp changes state
 */
export const useEditorState = (
  initialState: EditorState,
  editor: Editor
): UseEditorStateReturn => {
  const [state, setState] = useState<EditorState>(() => {
    // Ensure we have a valid initial state
    return {
      currentBuffer: initialState.currentBuffer || FunctionalTextBufferImpl.create(""),
      cursorPosition: initialState.cursorPosition || { line: 0, column: 0 },
      mode: initialState.mode || 'normal',
      statusMessage: initialState.statusMessage || '',
      viewportTop: initialState.viewportTop || 0,
      config: initialState.config || {
        theme: 'default',
        tabSize: 4,
        autoSave: false,
        keyBindings: {},
        maxUndoLevels: 100,
        showLineNumbers: true,
        wordWrap: false
      },
      commandLine: initialState.commandLine || "",
      mxCommand: initialState.mxCommand || "",
      currentFilename: initialState.currentFilename,
      buffers: initialState.buffers,
    };
  });

  /**
   * Execute a T-Lisp function by sending a key to the Editor class
   * This is the ONLY way state should change - T-Lisp drives everything
   */
  const executeTlisp = useCallback(async (key: string): Promise<void> => {
    try {
      // Send key to Editor class, which processes it through T-Lisp
      await editor.handleKey(key);

      // After T-Lisp processes the key, sync the updated state back to React
      // IMPORTANT: Always read fresh state from editor, don't use closure state
      const newState = editor.getEditorState();
      setState(newState);
    } catch (error) {
      // Handle quit signal
      if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
        // Re-throw to let the component handle exit
        throw error;
      }
      // For other errors, update status message but don't crash
      const errorMessage = error instanceof Error ? error.message : String(error);
      setState((prev: EditorState) => ({
        ...prev,
        statusMessage: `Error: ${errorMessage}`
      }));
    }
  }, [editor]);

  return { state, setState, executeTlisp };
};