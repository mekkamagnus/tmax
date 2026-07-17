/**
 * @file workspace.ts
 * @description Canonical workspace, frame, and persistence contracts.
 *
 * These were previously interleaved with runtime/IO contracts in the
 * 777-line `src/core/types.ts`. Workspace JSON format and buffer
 * serialization shapes are preserved byte-for-byte (CHORE-44 AC9.5).
 */

import type { Position } from "./primitives.ts";
import type { TextBuffer } from "./buffer.ts";
import type {
  Window,
  Tab,
  JsonValue,
  MinibufferRenderView,
  EditorState,
} from "./editor.ts";

/**
 * Scrollback buffer interface for terminal windows.
 *
 * This is the workspace-serialization shape (a ring buffer of lines with
 * search capabilities) — distinct from the live `ScrollbackBufferState`
 * in `src/core/scrollback.ts`, which is the runtime ring-buffer state.
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
 * Workspace metadata — persisted identification and tracking information.
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
 * Buffer metadata for serialization.
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
 * Per-buffer mode state for serialization.
 */
export interface BufferModeState {
  majorMode?: string;
  minorModes?: string[];
  lighters?: string[];
}

/**
 * Viewport state for serialization.
 */
export interface ViewportState {
  top: number;
  left?: number;
}

/**
 * Complete workspace state — in-memory representation with live buffer objects.
 */
export interface WorkspaceState {
  metadata: WorkspaceMetadata;
  buffers: Map<string, TextBuffer>;  // Buffer name → buffer instance
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
 * Workspace data — JSON-serializable form for persistence.
 * Buffer contents are stored as strings, not `TextBuffer` instances.
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
 * Current workspace data format version.
 * Increment when `WorkspaceData` schema changes incompatibly.
 */
export const CURRENT_WORKSPACE_FORMAT_VERSION = 1;

/**
 * Frame — per-client viewport state (like an Emacs frame).
 * Each TUI client gets its own `Frame`. Frames share buffers, interpreter, config.
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
  currentBuffer?: TextBuffer;
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
