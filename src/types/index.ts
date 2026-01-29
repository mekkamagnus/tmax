/**
 * @file index.ts
 * @description Centralized type definitions for the tmax editor
 */

/**
 * Editor mode types
 */
export type EditorMode = 'normal' | 'insert' | 'visual' | 'command' | 'mx';

/**
 * Key sequence type for keyboard input handling
 */
export type KeySequence = string;

/**
 * Command result type for editor operations
 */
export type CommandResult = {
  success: boolean;
  message?: string;
  data?: any;
};

/**
 * Buffer state type for tracking buffer properties
 */
export type BufferState = {
  content: string;
  cursorPosition: { line: number; column: number };
  lineCount: number;
  isModified: boolean;
  filename?: string;
};

/**
 * Viewport state type for tracking view properties
 */
export type ViewportState = {
  topLine: number;
  bottomLine: number;
  width: number;
  height: number;
  scrollPosition: number;
};

/**
 * Event types as discriminated unions
 */
export type KeyEvent = {
  type: 'key';
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
};

export type MouseEvent = {
  type: 'mouse';
  x: number;
  y: number;
  button: 'left' | 'right' | 'middle';
  action: 'click' | 'double-click' | 'drag' | 'release';
};

export type ResizeEvent = {
  type: 'resize';
  width: number;
  height: number;
};

export type Event = KeyEvent | MouseEvent | ResizeEvent;

/**
 * Configuration options for the editor
 */
export interface EditorConfig {
  theme: 'light' | 'dark' | 'auto';
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  showLineNumbers: boolean;
  wordWrap: boolean;
  autoIndent: boolean;
  highlightActiveLine: boolean;
  minimap: boolean;
}

/**
 * Core editor state interface
 */
export interface EditorState {
  currentBuffer?: BufferState;
  buffers: Map<string, BufferState>;
  mode: EditorMode;
  cursorPosition: { line: number; column: number };
  viewport: ViewportState;
  statusMessage: string;
  config: EditorConfig;
  commandLine: string;
  mxCommand: string;
  lastCommand?: string;
  isRunning: boolean;
}

/**
 * Text change operations
 */
export type TextOperation = 
  | { type: 'insert'; position: { line: number; column: number }; text: string }
  | { type: 'delete'; start: { line: number; column: number }; end: { line: number; column: number } }
  | { type: 'replace'; start: { line: number; column: number }; end: { line: number; column: number }; text: string };

/**
 * Undo/redo stack item
 */
export type HistoryItem = {
  operation: TextOperation;
  previousState: BufferState;
  nextState: BufferState;
};

/**
 * Search and replace options
 */
export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  wrapAround: boolean;
}

/**
 * File system operations result
 */
export type FileOperationResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Terminal capabilities
 */
export interface TerminalCapabilities {
  supportsColors: boolean;
  supportsMouse: boolean;
  supportsFocus: boolean;
  isTTY: boolean;
}