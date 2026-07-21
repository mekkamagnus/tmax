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

import type { Position, Range } from "../../core/contracts/primitives.ts";
import type { TextBuffer } from "../../core/contracts/buffer.ts";
import type { WhichKeyBinding, LSPDiagnostic, Window, Tab, HighlightSpan, MinibufferRenderView, JsonValue, EditorConfig } from "../../core/contracts/editor.ts";
import type { AppError } from "../../error/types.ts";
import type { TLispValue } from "../../tlisp/types.ts";
import type { EditorModel } from "./model.ts";

/**
 * Correlation owner for an enqueued {@link Cmd}. The drain settles the
 * awaiting owner per command id so a failed background log write can never
 * reject an unrelated `openFile`/`saveFile`. Defined here (not in `cmd.ts`)
 * so `messages.ts` and `cmd.ts` share one owner union without an import cycle
 * (`cmd.ts` already imports `Msg` from here).
 */
export type CommandOwner = "openFile" | "saveFile" | "handler" | "background";

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
  | { readonly type: "UpsertBuffer"; readonly name: string; readonly buffer: TextBuffer }
  | { readonly type: "SetCurrentBuffer"; readonly buffer: TextBuffer | undefined }
  | { readonly type: "SetBuffers"; readonly buffers: Map<string, TextBuffer> }
  | { readonly type: "SetCurrentFilename"; readonly filename: string | undefined }
  | { readonly type: "SetBufferModified"; readonly modified: boolean | undefined }
  // Which-key
  | { readonly type: "SetWhichKeyActive"; readonly active: boolean }
  | { readonly type: "SetWhichKeyPrefix"; readonly prefix: string }
  | { readonly type: "SetWhichKeyBindings"; readonly bindings: readonly WhichKeyBinding[] }
  | { readonly type: "SetWhichKeyTimeout"; readonly timeout: number }
  | { readonly type: "SetWhichKeyPopup"; readonly popup: EditorModel["whichKeyPopup"] }
  // LSP / diagnostics
  | { readonly type: "SetLspDiagnostics"; readonly diagnostics: readonly LSPDiagnostic[] }
  // Windows / tabs
  | { readonly type: "SetWindows"; readonly windows: readonly Window[] }
  | { readonly type: "SetCurrentWindowIndex"; readonly index: number }
  | { readonly type: "SetTabs"; readonly tabs: readonly Tab[] }
  | { readonly type: "SetCurrentTabIndex"; readonly index: number }
  // Syntax / search / folds
  | { readonly type: "SetHighlightSpans"; readonly spans: readonly HighlightSpan[][] | undefined }
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
  // ── Effect layer (CHORE-42) ──────────────────────────────────────────
  // Initiating Msgs: the reducer returns a real Cmd for each of these (the
  // drain runs it via `runCmd`). Each carries a stable `commandId` + `owner`
  // so the awaiting public method can correlate on completion.
  | { readonly type: "OpenFile"; readonly commandId: string; readonly owner: CommandOwner; readonly filename: string }
  | { readonly type: "SaveFile"; readonly commandId: string; readonly owner: CommandOwner; readonly filename: string; readonly content: string }
  | { readonly type: "EvalTlisp"; readonly commandId: string; readonly owner: CommandOwner; readonly expr: string }
  | { readonly type: "EvalTlispAsync"; readonly commandId: string; readonly owner: CommandOwner; readonly expr: string }
  | { readonly type: "LogMessage"; readonly commandId: string; readonly owner: CommandOwner; readonly message: string; readonly level?: "info" | "warn" | "error" }
  | { readonly type: "LogProgram"; readonly commandId: string; readonly owner: CommandOwner; readonly category: string; readonly entry: { readonly text: string; readonly stream?: "stdout" | "stderr" } }
  // Follow-up Msgs: dispatched by the drain after `runCmd` settles. These are
  // pure model commits (the IO already happened in the Cmd). `Left(error)` is
  // reserved for drain-level failures; an effect-level failure is a Msg.
  | { readonly type: "OpenFileSucceeded"; readonly commandId: string; readonly filename: string; readonly content: string }
  | { readonly type: "OpenFileFailed"; readonly commandId: string; readonly filename: string; readonly error: AppError }
  | { readonly type: "SaveFileSucceeded"; readonly commandId: string; readonly filename: string }
  | { readonly type: "SaveFileFailed"; readonly commandId: string; readonly filename: string; readonly error: AppError }
  | { readonly type: "EvalTlispSucceeded"; readonly commandId: string; readonly result: TLispValue }
  | { readonly type: "EvalTlispFailed"; readonly commandId: string; readonly expr: string; readonly error: AppError }
  | { readonly type: "BackgroundCommandFailed"; readonly commandId: string; readonly error: AppError }
  // Command failure (dispatched by the command drain for drain-level Left)
  | { readonly type: "CmdFailed"; readonly commandTag: string; readonly commandId: string; readonly error: AppError };
