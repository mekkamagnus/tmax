/**
 * @file messages.ts
 * @description Msg discriminated union — one constructor per current editor
 * state-object mutation site (Elm Architecture "Msg"). Tagged unions give
 * exhaustive `switch` checking in `update`.
 *
 * Messages cover the fields that live in the editor's state object (the
 * EditorModel / public EditorState shape). Editor-internal fields that are
 * separate private members (countPrefix, spacePressed, the mode registries,
 * etc.) are mutated through their own typed accessors and are intentionally
 * not modelled as Msgs here.
 */

import type {
  Position,
  FunctionalTextBuffer,
  WhichKeyBinding,
  LSPDiagnostic,
  Window,
  Tab,
  HighlightSpan,
  Range,
  MinibufferRenderView,
  JsonValue,
  EditorConfig,
} from "../../core/types.ts";
import type { AppError } from "../../error/types.ts";
import type { EditorModel } from "./model.ts";

export type Msg =
  // Mode
  | { readonly type: "SetMode"; readonly mode: EditorModel["mode"] }
  | { readonly type: "SetCurrentMajorMode"; readonly mode: string | undefined }
  | { readonly type: "SetActiveMinorModes"; readonly modes: readonly string[] }
  // Status
  | { readonly type: "SetStatusMessage"; readonly message: string }
  // Command / M-x line
  | { readonly type: "SetCommandLine"; readonly value: string }
  | { readonly type: "AppendCommandLine"; readonly char: string }
  | { readonly type: "ClearCommandLine" }
  | { readonly type: "SetMxCommand"; readonly value: string }
  | { readonly type: "AppendMxCommand"; readonly char: string }
  | { readonly type: "ClearMxCommand" }
  | { readonly type: "SetLastCommand"; readonly command: string | undefined }
  // Cursor / viewport
  | { readonly type: "SetCursorPosition"; readonly position: Position }
  | { readonly type: "SetViewport"; readonly top: number; readonly left: number }
  | { readonly type: "SetViewportTop"; readonly top: number }
  | { readonly type: "SetViewportLeft"; readonly left: number }
  | { readonly type: "SetCursorFocus"; readonly focus: "buffer" | "command" }
  // Buffers
  | { readonly type: "UpsertBuffer"; readonly name: string; readonly buffer: FunctionalTextBuffer }
  | { readonly type: "SetCurrentBuffer"; readonly buffer: FunctionalTextBuffer | undefined }
  | { readonly type: "SetBuffers"; readonly buffers: Map<string, FunctionalTextBuffer> }
  | { readonly type: "SetCurrentFilename"; readonly filename: string | undefined }
  | { readonly type: "SetBufferModified"; readonly modified: boolean | undefined }
  // Which-key
  | { readonly type: "SetWhichKeyActive"; readonly active: boolean }
  | { readonly type: "SetWhichKeyPrefix"; readonly prefix: string }
  | { readonly type: "SetWhichKeyBindings"; readonly bindings: readonly WhichKeyBinding[] }
  | { readonly type: "SetWhichKeyTimeout"; readonly timeout: number }
  // LSP / diagnostics
  | { readonly type: "SetLspDiagnostics"; readonly diagnostics: readonly LSPDiagnostic[] }
  // Windows / tabs
  | { readonly type: "SetWindows"; readonly windows: readonly Window[] }
  | { readonly type: "SetCurrentWindowIndex"; readonly index: number }
  | { readonly type: "SetTabs"; readonly tabs: readonly Tab[] }
  | { readonly type: "SetCurrentTabIndex"; readonly index: number }
  // Syntax / search / folds
  | { readonly type: "SetHighlightSpans"; readonly spans: readonly HighlightSpan[][] }
  | { readonly type: "SetSearchMatches"; readonly matches: readonly Range[] | undefined }
  | { readonly type: "SetFoldRanges"; readonly ranges: Map<number, number> }
  // Help system
  | { readonly type: "SetDescribeKeyPending"; readonly pending: boolean }
  | { readonly type: "SetDescribeFunctionPending"; readonly pending: boolean }
  | { readonly type: "SetAproposCommandPending"; readonly pending: boolean }
  // Minibuffer
  | { readonly type: "SetMinibufferState"; readonly state: JsonValue | undefined }
  | { readonly type: "SetMinibufferView"; readonly view: MinibufferRenderView | undefined }
  // Config
  | { readonly type: "SetConfig"; readonly config: EditorConfig }
  // External (setEditorState)
  | { readonly type: "SetEditorStateExternal"; readonly patch: Partial<EditorModel> }
  // Command failure (dispatched by the command drain)
  | { readonly type: "CmdFailed"; readonly commandTag: string; readonly commandId: string; readonly error: AppError };
