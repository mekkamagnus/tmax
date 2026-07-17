/**
 * @file types.ts
 * @description COMPATIBILITY BARREL — re-exports the canonical core contracts.
 *
 * CHORE-44 Change 9 split the prior 777-line central type file into
 * domain-specific contract files under `./contracts/`:
 *
 *   - `contracts/primitives.ts` — Position, Range, TerminalSize, FileStats,
 *     string error aliases.
 *   - `contracts/buffer.ts` — canonical Either-returning `TextBuffer`.
 *   - `contracts/terminal.ts` — canonical promise-based `TerminalIO`.
 *   - `contracts/filesystem.ts` — canonical promise-based `FileSystem`.
 *   - `contracts/editor.ts` — editor config, public state, keys, windows,
 *     tabs, rendering-facing contracts, TypeGuards, Validators.
 *   - `contracts/workspace.ts` — workspace/frame/persistence contracts.
 *
 * The parallel functional-prefixed interfaces (buffer/terminal/filesystem)
 * and their wrapper classes have been removed. This barrel preserves the
 * import path `../core/types.ts` for any consumer that has not yet been
 * migrated to import contract files directly; new code should import from
 * the specific contract file (e.g. `../core/contracts/buffer.ts`).
 *
 * This file MUST NOT introduce new contracts; it only re-exports.
 */

export type {
  Position,
  Range,
  TerminalSize,
  FileStats,
  FileSystemError,
  TerminalError,
  BufferError,
} from "./contracts/primitives.ts";

export type { TextBuffer } from "./contracts/buffer.ts";
export type { TerminalIO } from "./contracts/terminal.ts";
export type { FileSystem } from "./contracts/filesystem.ts";

export type {
  EditorResult,
  EditorConfig,
  WhichKeyBinding,
  ANSIStyle,
  HighlightSpan,
  SyntaxToken,
  SyntaxRule,
  HighlightTheme,
  JsonValue,
  MinibufferRenderSegment,
  MinibufferRenderRow,
  MinibufferRenderView,
  FoldState,
  LSPDiagnostic,
  Window,
  Tab,
  KeyBinding,
  EditorState,
} from "./contracts/editor.ts";

export {
  TypeGuards,
  Validators,
} from "./contracts/editor.ts";

export type {
  ScrollbackBuffer,
  WorkspaceMetadata,
  BufferMetadata,
  BufferModeState,
  ViewportState,
  WorkspaceState,
  WorkspaceData,
  Frame,
} from "./contracts/workspace.ts";

export {
  CURRENT_WORKSPACE_FORMAT_VERSION,
} from "./contracts/workspace.ts";
