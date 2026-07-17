/**
 * @file mod.ts
 * @description Core module exports for tmax editor.
 *
 * CHORE-44 Change 9: re-exports the canonical contracts. The prior
 * parallel `Functional*` interfaces and the `TextBuffer`/`TerminalIO`/
 * `FileSystem` legacy variants have been consolidated — see
 * `./contracts/` for the canonical homes.
 */

export type {
  Position,
  Range,
  TerminalSize,
  FileStats,
} from "./contracts/primitives.ts";

export type { TextBuffer } from "./contracts/buffer.ts";
export type { TerminalIO } from "./contracts/terminal.ts";
export type { FileSystem } from "./contracts/filesystem.ts";

export type {
  EditorConfig,
  WhichKeyBinding,
  ANSIStyle,
  HighlightSpan,
  EditorState,
  LSPDiagnostic,
  Window,
  Tab,
  KeyBinding,
} from "./contracts/editor.ts";

export type { Frame } from "./contracts/workspace.ts";

export {
  TypeGuards,
  Validators,
} from "./contracts/editor.ts";

export * from "./terminal.ts";
export * from "./filesystem.ts";
export * from "./buffer.ts";
