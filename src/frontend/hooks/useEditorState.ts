/**
 * @file useEditorState.ts
 * @description React hook for managing editor state with T-Lisp integration
 * Handles state synchronization between React and T-Lisp interpreter
 */

import { useState, useEffect, useCallback } from "https://deno.land/x/ink@1.3/vendor/react/index.ts";
import { EditorState, Position } from "../../core/types.ts";
import { FunctionalTextBufferImpl } from "../../core/buffer.ts";

interface UseEditorStateReturn {
  state: EditorState;
  setState: (stateUpdate: ((prevState: EditorState) => EditorState) | EditorState) => void;
  dispatch: (action: EditorAction) => void;
}

// Define editor actions for state management
type EditorAction =
  | { type: 'SET_MODE'; mode: EditorState['mode'] }
  | { type: 'SET_CURSOR_POSITION'; position: EditorState['cursorPosition'] }
  | { type: 'SET_BUFFER'; buffer: EditorState['currentBuffer'] }
  | { type: 'SET_STATUS_MESSAGE'; message: string }
  | { type: 'SET_VIEWPORT_TOP'; top: number }
  | { type: 'UPDATE_STATE'; newState: Partial<EditorState> }
  | { type: 'HANDLE_RESIZE'; width: number; height: number };

export const useEditorState = (initialState: EditorState): UseEditorStateReturn => {
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
      }
    };
  });

  // Dispatch function to handle actions
  const dispatch = useCallback((action: EditorAction) => {
    setState((prevState: EditorState) => {
      switch (action.type) {
        case 'SET_MODE':
          return { ...prevState, mode: action.mode };

        case 'SET_CURSOR_POSITION':
          return { ...prevState, cursorPosition: action.position };

        case 'SET_BUFFER':
          return { ...prevState, currentBuffer: action.buffer };

        case 'SET_STATUS_MESSAGE':
          return { ...prevState, statusMessage: action.message };

        case 'SET_VIEWPORT_TOP':
          return { ...prevState, viewportTop: action.top };

        case 'UPDATE_STATE':
          return { ...prevState, ...action.newState };

        case 'HANDLE_RESIZE':
          // Handle terminal resize - adjust viewport if needed
          let newViewportTop = prevState.viewportTop;

          // If cursor is now beyond the visible area due to resize, adjust viewport
          const visibleLines = Math.max(1, action.height - 2); // Leave space for status line
          if (prevState.cursorPosition.line >= newViewportTop + visibleLines) {
            newViewportTop = Math.max(0, prevState.cursorPosition.line - visibleLines + 1);
          }

          // If cursor is above viewport, adjust viewport
          if (prevState.cursorPosition.line < newViewportTop) {
            newViewportTop = Math.max(0, prevState.cursorPosition.line);
          }

          return {
            ...prevState,
            viewportTop: newViewportTop,
            statusMessage: `Terminal resized to ${action.width}x${action.height}`
          };

        default:
          console.warn(`Unknown action type: ${(action as any).type}`);
          return prevState;
      }
    });
  }, []);

  return { state, setState, dispatch };
};