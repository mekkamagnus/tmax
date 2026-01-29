/**
 * @file types.ts
 * @description Type definitions for frontend React components and Deno-ink integration
 */

import type { Position } from "../core/types.ts";
import type { FunctionalTextBuffer } from "../core/types.ts";

/**
 * Props for the main Editor component
 */
export interface EditorProps {
  initialEditorState: import("../core/types.ts").EditorState;
  onStateChange?: (newState: import("../core/types.ts").EditorState) => void;
  onError?: (error: Error) => void;
}

/**
 * Props for the BufferView component
 */
export interface BufferViewProps {
  buffer: FunctionalTextBuffer;
  cursorPosition: Position;
  viewportTop: number;
  onViewportChange: (top: number) => void;
}

/**
 * Props for the StatusLine component
 */
export interface StatusLineProps {
  mode: 'normal' | 'insert' | 'visual' | 'command' | 'mx';
  cursorPosition: Position;
  statusMessage: string;
}

/**
 * Props for the CommandInput component
 */
export interface CommandInputProps {
  mode: 'command' | 'mx';
  onExecute: (command: string) => void;
  onCancel: () => void;
}

/**
 * Action types for the useEditorState hook
 */
export type EditorAction =
  | { type: 'SET_MODE'; mode: import("../core/types.ts").EditorState['mode'] }
  | { type: 'SET_CURSOR_POSITION'; position: import("../core/types.ts").EditorState['cursorPosition'] }
  | { type: 'SET_BUFFER'; buffer: import("../core/types.ts").EditorState['currentBuffer'] }
  | { type: 'SET_STATUS_MESSAGE'; message: string }
  | { type: 'SET_VIEWPORT_TOP'; top: number }
  | { type: 'UPDATE_STATE'; newState: Partial<import("../core/types.ts").EditorState> }
  | { type: 'HANDLE_RESIZE'; width: number; height: number };

/**
 * Return type for the useEditorState hook
 */
export interface UseEditorStateReturn {
  state: import("../core/types.ts").EditorState;
  setState: (stateUpdate: ((prevState: import("../core/types.ts").EditorState) => import("../core/types.ts").EditorState) | import("../core/types.ts").EditorState) => void;
  dispatch: (action: EditorAction) => void;
}

/**
 * Type for React component key event handling
 */
export interface KeyEvent {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  return: boolean;
  escape: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  alt: boolean;
  home: boolean;
  end: boolean;
}

/**
 * Type for terminal stdout with resize event support
 */
export interface StdoutWithResize {
  columns: number;
  rows: number;
  addListener?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
}

/**
 * Type for React context that might be used for editor state
 */
export interface EditorContextType {
  state: import("../core/types.ts").EditorState;
  dispatch: (action: EditorAction) => void;
  updateState: (newState: Partial<import("../core/types.ts").EditorState>) => void;
}