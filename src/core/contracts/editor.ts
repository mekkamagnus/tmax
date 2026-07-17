/**
 * @file editor.ts
 * @description Canonical editor-facing contracts: configuration, public state,
 * keys, windows, tabs, and rendering-facing view models.
 *
 * These were previously interleaved with runtime/IO contracts in the
 * 777-line `src/core/types.ts`. They depend only on `TextBuffer` (the
 * canonical Either-returning buffer contract) and `primitives`.
 */

import type { TaskEither } from "../../utils/task-either.ts";
import { MAX_UNDO_LEVELS } from "../../constants/buffer.ts";
import { Either } from "../../utils/task-either.ts";
import type { Position, Range, TerminalError, BufferError } from "./primitives.ts";
import type { TextBuffer } from "./buffer.ts";

/**
 * Editor operation result type alias used at effect-composition boundaries.
 */
export type EditorResult<T> = TaskEither<string, T>;

/**
 * Editor configuration. Serialized into workspace JSON.
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
 * Which-key binding display information.
 */
export interface WhichKeyBinding {
  key: string;
  command: string;
  mode: string;
  documentation?: string;  // Command documentation for preview (US-1.10.4)
}

/**
 * ANSI style for syntax highlighting.
 */
export interface ANSIStyle {
  fg?: string;
  bg?: string;
  bold?: boolean;
  underline?: boolean;
  dim?: boolean;
}

/**
 * Highlight span for rendering (character range + style).
 */
export interface HighlightSpan {
  start: number;
  end: number;
  style: ANSIStyle;
}

/**
 * Syntax token from tokenizer.
 */
export interface SyntaxToken {
  type: string;
  value: string;
  line: number;
  startCol: number;
  endCol: number;
}

/**
 * Syntax rule for the tokenizer.
 */
export interface SyntaxRule {
  pattern: RegExp;
  type: string;
  priority?: number;
}

/**
 * Highlight theme mapping token types to ANSI styles.
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
 * Fold state for gutter rendering.
 */
export type FoldState = "collapsed" | "expandable";

/**
 * LSP Diagnostic interface.
 */
export interface LSPDiagnostic {
  range: Range;
  severity: 1 | 2 | 3 | 4;  // 1=Error, 2=Warning, 3=Information, 4=Hint
  message: string;
  source?: string;  // Source of the diagnostic (e.g., "typescript")
  code?: string | number;  // Diagnostic code
}

/**
 * Window interface (US-3.2.1).
 */
export interface Window {
  id: string;  // Unique window identifier
  buffer: TextBuffer;  // Buffer displayed in window
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
  scrollback?: import("./workspace.ts").ScrollbackBuffer;  // Scrollback buffer for terminal windows (RFC-014)
}

/**
 * Tab interface.
 */
export interface Tab {
  id: string;
  label: string;
  buffer: TextBuffer;
  bufferName?: string;  // R3-2: cached buffer name
}

/**
 * Key binding interface.
 */
export interface KeyBinding {
  key: string;
  mode: string;
  command: string;
}

/**
 * Editor state interface — the public projection consumed by renderers,
 * frames, and tests. Not the full Elm-style `EditorModel` (which lives in
 * `src/editor/functional/model.ts`).
 */
export interface EditorState {
  currentBuffer?: TextBuffer;
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
  buffers?: Map<string, TextBuffer>;
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

// ---------------------------------------------------------------------------
// Validators and type guards — kept near the editor contract they validate.
// ---------------------------------------------------------------------------

/**
 * Runtime type guards for primitive and editor contracts.
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

  isTerminalSize: (obj: unknown): obj is import("./primitives.ts").TerminalSize =>
    typeof obj === 'object' && obj !== null &&
    typeof (obj as import("./primitives.ts").TerminalSize).width === 'number' &&
    typeof (obj as import("./primitives.ts").TerminalSize).height === 'number',

  isFileStats: (obj: unknown): obj is import("./primitives.ts").FileStats =>
    typeof obj === 'object' && obj !== null &&
    typeof (obj as import("./primitives.ts").FileStats).isFile === 'boolean' &&
    typeof (obj as import("./primitives.ts").FileStats).isDirectory === 'boolean' &&
    typeof (obj as import("./primitives.ts").FileStats).size === 'number' &&
    (obj as import("./primitives.ts").FileStats).modified instanceof Date,

  isEditorConfig: (obj: unknown): obj is EditorConfig =>
    typeof obj === 'object' && obj !== null &&
    typeof (obj as EditorConfig).theme === 'string' &&
    typeof (obj as EditorConfig).tabSize === 'number' &&
    typeof (obj as EditorConfig).autoSave === 'boolean' &&
    typeof (obj as EditorConfig).keyBindings === 'object'
};

/**
 * Validation functions using Either.
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
