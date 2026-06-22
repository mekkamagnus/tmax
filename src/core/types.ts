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
  relativeLineNumbers: boolean;
  wordWrap: boolean;
}

/**
 * Which-key binding display information
 */
export interface WhichKeyBinding {
  key: string;
  command: string;
  mode: string;
  documentation?: string;  // Command documentation for preview (US-1.10.4)
}

/**
 * ANSI style for syntax highlighting
 */
export interface ANSIStyle {
  fg?: string;
  bg?: string;
  bold?: boolean;
  underline?: boolean;
  dim?: boolean;
}

/**
 * Highlight span for rendering (character range + style)
 */
export interface HighlightSpan {
  start: number;
  end: number;
  style: ANSIStyle;
}

/**
 * Syntax token from tokenizer
 */
export interface SyntaxToken {
  type: string;
  value: string;
  line: number;
  startCol: number;
  endCol: number;
}

/**
 * Syntax rule for the tokenizer
 */
export interface SyntaxRule {
  pattern: RegExp;
  type: string;
  priority?: number;
}

/**
 * Highlight theme mapping token types to ANSI styles
 */
export type HighlightTheme = Record<string, ANSIStyle>;

/**
 * JSON-safe value used for opaque T-Lisp frame transport.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Styled segment produced by T-Lisp for generic minibuffer rendering.
 */
export interface MinibufferRenderSegment {
  text: string;
  face?: string;
}

/**
 * Render-only row produced by T-Lisp.
 */
export interface MinibufferRenderRow {
  selected: boolean;
  segments: MinibufferRenderSegment[];
}

/**
 * Generic render-only minibuffer view produced by T-Lisp.
 */
export interface MinibufferRenderView {
  prompt: string;
  input: string;
  inputPoint: number;
  rows: MinibufferRenderRow[];
  message: string;
}

/**
 * Fold state for gutter rendering
 */
export type FoldState = "collapsed" | "expandable";

/**
 * Editor state interface
 */
export interface EditorState {
  currentBuffer?: FunctionalTextBuffer;
  cursorPosition: Position;
  mode: 'normal' | 'insert' | 'visual' | 'command' | 'mx' | 'replace';
  statusMessage: string;
  viewportTop: number;
  viewportLeft?: number;
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
  whichKeyPopup?: { prefixLabel: string; rows: { key: string; command: string; description?: string }[][]; height: number } | null;  // Popup overlay data
  // Help system state (US-1.11.1, US-1.11.2, US-1.11.3)
  describeKeyPending?: boolean;  // Waiting for key press to describe
  describeKeyTimeout?: number;  // Timeout for describe-key prompt
  describeFunctionPending?: boolean;  // Waiting for function name to describe
  aproposCommandPending?: boolean;  // Waiting for search pattern for apropos
  // LSP diagnostics state (US-3.1.2)
  lspDiagnostics?: LSPDiagnostic[];  // Diagnostics from language server
  // Window management (US-3.2.1)
  windows?: Window[];  // Array of windows
  currentWindowIndex?: number;  // Index of currently focused window
  // Tabs
  tabs?: Tab[];  // Array of tabs
  currentTabIndex?: number;  // Index of active tab
  // Syntax highlighting
  highlightSpans?: HighlightSpan[][];
  searchMatches?: Range[];
  currentMajorMode?: string;
  activeMinorModes?: string[];
  activeMinorModeLighters?: string[];
  bufferModified?: boolean;
  minibufferState?: JsonValue;
  minibufferView?: MinibufferRenderView;
  // Fold state
  foldRanges?: Map<number, number>;
}

/**
 * LSP Diagnostic interface
 */
export interface LSPDiagnostic {
  range: Range;
  severity: 1 | 2 | 3 | 4;  // 1=Error, 2=Warning, 3=Information, 4=Hint
  message: string;
  source?: string;  // Source of the diagnostic (e.g., "typescript")
  code?: string | number;  // Diagnostic code
}

/**
 * Window interface (US-3.2.1)
 */
export interface Window {
  id: string;  // Unique window identifier
  buffer: FunctionalTextBuffer;  // Buffer displayed in window
  bufferName?: string;  // R3-2: cached buffer name (maintained by editor, avoids identity check)
  cursorLine: number;  // Cursor line position within window
  cursorColumn: number;  // Cursor column position within window
  viewportTop: number;  // First line visible in window viewport
  viewportLeft: number;  // First column visible in window viewport
  splitType?: 'horizontal' | 'vertical';  // How this window was created
  height?: number;  // Window height in rows (for horizontal splits)
  width?: number;  // Window width in columns (for vertical splits)
  row?: number;  // Window starting row (0-indexed)
  col?: number;  // Window starting column (0-indexed)
  scrollback?: ScrollbackBuffer;  // Scrollback buffer for terminal windows (RFC-014)
}

/**
 * Tab interface
 */
export interface Tab {
  id: string;
  label: string;
  buffer: FunctionalTextBuffer;
  bufferName?: string;  // R3-2: cached buffer name
}

// =============================================================================
// WORKSPACE TYPES
// =============================================================================

/**
 * Scrollback buffer interface for terminal windows
 * Stores a ring buffer of lines with search capabilities
 */
export interface ScrollbackBuffer {
  lines: string[];  // Circular buffer of lines
  capacity: number;  // Maximum number of lines (typically 50,000)
  head: number;  // Index of the oldest line
  tail: number;  // Index where next line will be written
  size: number;  // Current number of lines in buffer
  viewportOffset: number;  // Current viewport scroll position
  searchResults?: number[];  // Indices of matching lines from last search
  searchIndex?: number;  // Current position in search results
}

/**
 * Workspace metadata — persisted identification and tracking information
 */
export interface WorkspaceMetadata {
  id: string;  // UUID unique to this workspace
  name: string;  // Human-readable name matching /^[a-zA-Z0-9_-]{1,64}$/
  projectRoot?: string;  // Optional path to project root directory
  createdAt: string;  // ISO 8601 timestamp of workspace creation
  lastAccessed: string;  // ISO 8601 timestamp of last access
  formatVersion: number;  // Workspace data format version (for migration)
}

/**
 * Buffer metadata for serialization
 */
export interface BufferMetadata {
  name: string;  // Buffer name
  filename?: string;  // Associated file path, if any
  modified: boolean;  // Whether buffer has unsaved changes
  majorMode?: string;  // Active major mode
  cursorLine: number;  // Saved cursor line position
  cursorColumn: number;  // Saved cursor column position
}

/**
 * Per-buffer mode state for serialization
 */
export interface BufferModeState {
  majorMode?: string;
  minorModes?: string[];
  lighters?: string[];
}

/**
 * Viewport state for serialization
 */
export interface ViewportState {
  top: number;
  left?: number;
}

/**
 * Complete workspace state — in-memory representation with live buffer objects
 */
export interface WorkspaceState {
  metadata: WorkspaceMetadata;
  buffers: Map<string, FunctionalTextBuffer>;  // Buffer name → buffer instance
  bufferMetadata: Map<string, BufferMetadata>;  // Buffer name → metadata
  bufferModeStates: Map<string, BufferModeState>;  // Buffer name → mode state
  windows: Window[];  // Array of windows in this workspace
  tabs: Tab[];  // Array of tabs (reserved for future use)
  cursorState: Position;  // Current cursor position
  viewportState: ViewportState;  // Current viewport state
  currentBufferName?: string;  // Name of currently active buffer
  currentFilename?: string;  // Filename of currently active buffer
  currentMajorMode?: string;  // Active major mode
  activeMinorModes?: string[];  // Active minor modes
  activeMinorModeLighters?: string[];  // Mode line lighters
  restoreWarnings?: string[];  // Non-fatal warnings produced while loading workspace state
  restoreConflicts?: string[];  // File-backed buffers that changed on disk while workspace content was dirty
}

/**
 * Workspace data — JSON-serializable form for persistence
 * Buffer contents are stored as strings, not FunctionalTextBuffer instances
 */
export interface WorkspaceData {
  metadata: WorkspaceMetadata;
  buffers: Array<{  // Serialized buffer list
    name: string;
    filename?: string;
    content: string;  // Buffer content as plain string
    modified: boolean;
    majorMode?: string;
    cursorLine: number;
    cursorColumn: number;
    minorModes?: string[];
    lighters?: string[];
  }>;
  windows: Array<{  // Serialized window list
    id: string;
    bufferName: string;  // Reference to buffer by name
    cursorLine: number;
    cursorColumn: number;
    viewportTop: number;
    viewportLeft: number;
    splitType?: 'horizontal' | 'vertical';
    height?: number;
    width?: number;
    row?: number;
    col?: number;
    scrollback?: {  // Serialized scrollback state
      capacity: number;
      lines: string[];
      size: number;
      head: number;
      tail: number;
      viewportOffset: number;
    };
  }>;
  tabs: Array<{
    id: string;
    label: string;
    bufferName: string;
  }>;
  cursorState: Position;
  viewportState: ViewportState;
  currentBufferName?: string;
  currentFilename?: string;
  currentMajorMode?: string;
  activeMinorModes?: string[];
  activeMinorModeLighters?: string[];
  searchMatches?: Array<{  // Serialized search ranges
    start: { line: number; column: number };
    end: { line: number; column: number };
  }>;
  foldRanges?: Array<{  // Serialized fold ranges
    startLine: number;
    endLine: number;
  }>;
  dirtyHash?: string;  // Content hash for dirty state detection
  lastSaveHash?: string;  // Last saved content hash
}

/**
 * Current workspace data format version
 * Increment when WorkspaceData schema changes incompatibly
 */
export const CURRENT_WORKSPACE_FORMAT_VERSION = 1;

/**
 * Key binding interface
 */
export interface KeyBinding {
  key: string;
  mode: string;
  command: string;
}

/**
 * Frame — per-client viewport state (like an Emacs frame)
 * Each TUI client gets its own Frame. Frames share buffers, interpreter, config.
 */
export interface Frame {
  id: string;
  cursorPosition: Position;
  viewportTop: number;
  viewportLeft: number;
  mode: EditorState["mode"];
  commandLine: string;
  mxCommand: string;
  currentFilename?: string;
  currentBuffer?: FunctionalTextBuffer;
  currentBufferName?: string;  // Name of the current buffer within the frame workspace
  statusMessage: string;
  cursorFocus: 'buffer' | 'command';
  lastActivity: Date;
  currentMajorMode?: string;
  activeMinorModes?: string[];
  activeMinorModeLighters?: string[];
  minibufferState?: JsonValue;
  minibufferView?: MinibufferRenderView;
  workspaceId?: string;  // ID of the workspace this frame is bound to (RFC-014)
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
      relativeLineNumbers: false,
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

  /** Create directory recursively */
  createDir(path: string): Promise<void>;
}
