/**
 * @file types.ts
 * @description Core type definitions for tmax editor with functional and backward compatibility interfaces
 */

import { TaskEither, Either } from "../utils/task-either.ts";
import { MAX_UNDO_LEVELS } from "../constants/buffer.ts";

/**
 * Position in a text buffer
 */
export interface Position {
  line: number;
  column: number;
}

/**
 * Range of text in a buffer
 */
export interface Range {
  start: Position;
  end: Position;
}

/**
 * Terminal dimensions
 */
export interface TerminalSize {
  width: number;
  height: number;
}

/**
 * File stats interface
 */
export interface FileStats {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  modified: Date;
}

/**
 * Error type aliases for better type safety
 */
export type FileSystemError = string;
export type TerminalError = string;
export type BufferError = string;

/**
 * Functional text buffer interface using Either for error handling
 */
export interface FunctionalTextBuffer {
  /** Get the entire buffer content */
  getContent(): Either<BufferError, string>;
  
  /** Get content of a specific line */
  getLine(lineNumber: number): Either<BufferError, string>;
  
  /** Get number of lines in buffer */
  getLineCount(): Either<BufferError, number>;
  
  /** Insert text at position (returns new buffer) */
  insert(position: Position, text: string): Either<BufferError, FunctionalTextBuffer>;
  
  /** Delete text in range (returns new buffer) */
  delete(range: Range): Either<BufferError, FunctionalTextBuffer>;
  
  /** Replace text in range (returns new buffer) */
  replace(range: Range, text: string): Either<BufferError, FunctionalTextBuffer>;
  
  /** Get text in range */
  getText(range: Range): Either<BufferError, string>;
  
  /** Get buffer statistics */
  getStats(): Either<BufferError, { lines: number; characters: number; words: number }>;
}

/**
 * Functional terminal I/O interface using TaskEither for async operations
 */
export interface FunctionalTerminalIO {
  /** Get terminal dimensions */
  getSize(): Either<TerminalError, TerminalSize>;
  
  /** Clear the terminal */
  clear(): TaskEither<TerminalError, void>;
  
  /** Clear from cursor to end of line */
  clearToEndOfLine(): TaskEither<TerminalError, void>;
  
  /** Move cursor to position */
  moveCursor(position: Position): TaskEither<TerminalError, void>;
  
  /** Write text at current cursor position */
  write(text: string): TaskEither<TerminalError, void>;
  
  /** Read a single key press */
  readKey(): TaskEither<TerminalError, string>;
  
  /** Enter raw mode */
  enterRawMode(): TaskEither<TerminalError, void>;
  
  /** Exit raw mode */
  exitRawMode(): TaskEither<TerminalError, void>;
  
  /** Enter alternate screen buffer */
  enterAlternateScreen(): TaskEither<TerminalError, void>;
  
  /** Exit alternate screen buffer */
  exitAlternateScreen(): TaskEither<TerminalError, void>;
  
  /** Hide cursor */
  hideCursor(): TaskEither<TerminalError, void>;
  
  /** Show cursor */
  showCursor(): TaskEither<TerminalError, void>;
  
  /** Check if stdin is a TTY */
  isStdinTTY(): Either<TerminalError, boolean>;
}

/**
 * Functional file system operations interface using TaskEither
 */
export interface FunctionalFileSystem {
  /** Read file contents */
  readFile(path: string): TaskEither<FileSystemError, string>;
  
  /** Write file contents */
  writeFile(path: string, content: string): TaskEither<FileSystemError, void>;
  
  /** Check if file exists */
  exists(path: string): TaskEither<FileSystemError, boolean>;
  
  /** Get file stats */
  stat(path: string): TaskEither<FileSystemError, FileStats>;
  
  /** Remove a file */
  remove(path: string): TaskEither<FileSystemError, void>;
  
  /** Create backup of file */
  backup(path: string): TaskEither<FileSystemError, string>;
  
  /** Atomic save operation (backup + write) */
  atomicSave(path: string, content: string): TaskEither<FileSystemError, { saved: boolean; backupPath?: string }>;
}

/**
 * Editor operation result types
 */
export type EditorResult<T> = TaskEither<string, T>;

/**
 * Configuration types
 */
export interface EditorConfig {
  theme: string;
  tabSize: number;
  autoSave: boolean;
  keyBindings: Record<string, string>;
  maxUndoLevels: number;
  showLineNumbers: boolean;
  wordWrap: boolean;
}

/**
 * Which-key binding display information
 */
export interface WhichKeyBinding {
  key: string;
  command: string;
  mode: string;
}

/**
 * Editor state interface
 */
export interface EditorState {
  currentBuffer?: FunctionalTextBuffer;
  cursorPosition: Position;
  mode: 'normal' | 'insert' | 'visual' | 'command' | 'mx';
  statusMessage: string;
  viewportTop: number;
  config: EditorConfig;
  commandLine: string;
  mxCommand: string;
  lastCommand?: string;
  currentFilename?: string;  // Filename associated with current buffer
  buffers?: Map<string, FunctionalTextBuffer>;
  cursorFocus?: 'buffer' | 'command';  // Track where cursor focus should be
  // Which-key popup state (US-1.10.3)
  whichKeyActive?: boolean;  // Whether which-key popup is currently displayed
  whichKeyPrefix?: string;  // Current key prefix being explored
  whichKeyBindings?: WhichKeyBinding[];  // Bindings for current prefix
  whichKeyTimeout?: number;  // Configurable timeout in milliseconds (default 1000)
}

/**
 * Key binding interface
 */
export interface KeyBinding {
  key: string;
  mode: string;
  command: string;
}

/**
 * Editor operations interface using functional patterns
 */
export interface FunctionalEditorOperations {
  /** Load configuration */
  loadConfig(path: string): TaskEither<string, EditorConfig>;
  
  /** Save configuration */
  saveConfig(path: string, config: EditorConfig): TaskEither<string, void>;
  
  /** Load file into buffer */
  loadFile(path: string): TaskEither<string, FunctionalTextBuffer>;
  
  /** Save buffer to file */
  saveFile(path: string, buffer: FunctionalTextBuffer): TaskEither<string, void>;
  
  /** Create new buffer */
  createBuffer(content?: string): Either<string, FunctionalTextBuffer>;
  
  /** Execute command */
  executeCommand(command: string, args: string[]): TaskEither<string, void>;
  
  /** Bind key to command */
  bindKey(key: string, mode: string, command: string): Either<string, KeyBinding>;
  
  /** Get all key bindings for mode */
  getKeyBindings(mode: string): Either<string, KeyBinding[]>;
}

/**
 * Utility type for composing operations
 */
export type OperationComposer<A, B> = (input: A) => TaskEither<string, B>;

/**
 * Functional pipeline for editor operations
 */
export interface EditorPipeline {
  /** Compose multiple operations */
  compose<A, B, C>(
    op1: OperationComposer<A, B>,
    op2: OperationComposer<B, C>
  ): OperationComposer<A, C>;
  
  /** Run operations in parallel */
  parallel<T>(operations: TaskEither<string, T>[]): TaskEither<string, T[]>;
  
  /** Run operations in sequence */
  sequence<T>(operations: TaskEither<string, T>[]): TaskEither<string, T[]>;
  
  /** Retry operation with backoff */
  retry<T>(
    operation: () => TaskEither<string, T>,
    maxAttempts: number,
    delayMs?: number
  ): TaskEither<string, T>;
}

/**
 * Type guards for runtime type checking
 */
export const TypeGuards = {
  isPosition: (obj: unknown): obj is Position =>
    typeof obj === 'object' && obj !== null &&
    typeof (obj as Position).line === 'number' &&
    typeof (obj as Position).column === 'number',

  isRange: (obj: unknown): obj is Range =>
    typeof obj === 'object' && obj !== null &&
    TypeGuards.isPosition((obj as Range).start) &&
    TypeGuards.isPosition((obj as Range).end),

  isTerminalSize: (obj: unknown): obj is TerminalSize =>
    typeof obj === 'object' && obj !== null &&
    typeof (obj as TerminalSize).width === 'number' &&
    typeof (obj as TerminalSize).height === 'number',

  isFileStats: (obj: unknown): obj is FileStats =>
    typeof obj === 'object' && obj !== null &&
    typeof (obj as FileStats).isFile === 'boolean' &&
    typeof (obj as FileStats).isDirectory === 'boolean' &&
    typeof (obj as FileStats).size === 'number' &&
    (obj as FileStats).modified instanceof Date,

  isEditorConfig: (obj: unknown): obj is EditorConfig =>
    typeof obj === 'object' && obj !== null &&
    typeof (obj as EditorConfig).theme === 'string' &&
    typeof (obj as EditorConfig).tabSize === 'number' &&
    typeof (obj as EditorConfig).autoSave === 'boolean' &&
    typeof (obj as EditorConfig).keyBindings === 'object'
};

/**
 * Validation functions using Either
 */
export const Validators = {
  position: (pos: Position): Either<string, Position> => {
    if (pos.line < 0) return Either.left(`Invalid line number: ${pos.line}`);
    if (pos.column < 0) return Either.left(`Invalid column number: ${pos.column}`);
    return Either.right(pos);
  },

  range: (range: Range): Either<string, Range> => {
    const startValid = Validators.position(range.start);
    if (Either.isLeft(startValid)) return startValid;
    
    const endValid = Validators.position(range.end);
    if (Either.isLeft(endValid)) return endValid;
    
    if (range.start.line > range.end.line ||
        (range.start.line === range.end.line && range.start.column > range.end.column)) {
      return Either.left("Range start must come before or equal to end");
    }
    
    return Either.right(range);
  },

  editorConfig: (config: Partial<EditorConfig>): Either<string, EditorConfig> => {
    const defaults: EditorConfig = {
      theme: 'default',
      tabSize: 4,
      autoSave: false,
      keyBindings: {},
      maxUndoLevels: MAX_UNDO_LEVELS,
      showLineNumbers: true,
      wordWrap: false
    };

    const merged = { ...defaults, ...config };

    if (merged.tabSize < 1 || merged.tabSize > 8) {
      return Either.left(`Invalid tab size: ${merged.tabSize} (must be 1-8)`);
    }

    if (merged.maxUndoLevels < 0) {
      return Either.left(`Invalid max undo levels: ${merged.maxUndoLevels} (must be >= 0)`);
    }

    return Either.right(merged);
  }
};

// =============================================================================
// BACKWARD COMPATIBILITY INTERFACES
// =============================================================================

/**
 * Legacy TextBuffer interface for backward compatibility
 * Uses Promise-based methods for compatibility with existing code
 */
export interface TextBuffer {
  /** Get the entire buffer content */
  getContent(): string;
  
  /** Get content of a specific line */
  getLine(lineNumber: number): string;
  
  /** Get number of lines in buffer */
  getLineCount(): number;
  
  /** Insert text at position */
  insert(position: Position, text: string): void;
  
  /** Delete text in range */
  delete(range: Range): void;
  
  /** Replace text in range */
  replace(range: Range, text: string): void;
  
  /** Get text in range */
  getText(range: Range): string;
}

/**
 * Legacy TerminalIO interface for backward compatibility
 * Uses Promise-based methods for compatibility with existing code
 */
export interface TerminalIO {
  /** Get terminal dimensions */
  getSize(): TerminalSize;
  
  /** Clear the terminal */
  clear(): Promise<void>;
  
  /** Clear from cursor to end of line */
  clearToEndOfLine(): Promise<void>;
  
  /** Move cursor to position */
  moveCursor(position: Position): Promise<void>;
  
  /** Write text at current cursor position */
  write(text: string): Promise<void>;
  
  /** Read a single key press */
  readKey(): Promise<string>;
  
  /** Enter raw mode */
  enterRawMode(): Promise<void>;
  
  /** Exit raw mode */
  exitRawMode(): Promise<void>;
  
  /** Enter alternate screen buffer */
  enterAlternateScreen(): Promise<void>;
  
  /** Exit alternate screen buffer */
  exitAlternateScreen(): Promise<void>;
  
  /** Hide cursor */
  hideCursor(): Promise<void>;
  
  /** Show cursor */
  showCursor(): Promise<void>;
}

/**
 * Legacy FileSystem interface for backward compatibility
 * Uses Promise-based methods for compatibility with existing code
 */
export interface FileSystem {
  /** Read file contents */
  readFile(path: string): Promise<string>;
  
  /** Write file contents */
  writeFile(path: string, content: string): Promise<void>;
  
  /** Check if file exists */
  exists(path: string): Promise<boolean>;
  
  /** Get file stats */
  stat(path: string): Promise<FileStats>;

  /** List directory contents */
  readdir?(path: string): Promise<string[]>;
}