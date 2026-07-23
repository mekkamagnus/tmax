/**
 * @file rpc/types.ts
 * @description CHORE-44 Change 5 — typed JSON-RPC request/result map for the
 * tmax daemon (AC5.1/AC5.2/AC5.7). Every method the daemon accepts is declared
 * here with its EXACT params + result types; the router (rpc/router.ts)
 * dispatches against this map so handler params/results contain no `any`, no
 * `unknown` result placeholder, and no catch-all index signature.
 *
 * Param shapes are derived from the existing handler bodies (every field the
 * legacy untyped `params` ever read is named explicitly). Result shapes are
 * derived from the value each handler returns (AC5.7). Open/dynamic shapes
 * (render-state, query, status, …) use named interfaces with `JsonValue` for
 * the genuinely-open tail instead of a blanket `unknown`.
 *
 * Adding a method = add an entry here + a handler in the router. There is no
 * escape hatch (`any`/`unknown`/index signature) — every method declares its
 * exact contract.
 */

// Log types used by query params (re-exported from log-entry for precision).
import type { LogCategory, LogEntry, LogView } from "../../editor/log-entry.ts";
import type { LogLevel, MessageEntry } from "../../editor/message-log.ts";
import type {
  EditorConfig,
  EditorState,
  JsonValue,
  MinibufferRenderView,
  WhichKeyBinding,
  Window,
  Tab,
} from "../../core/contracts/editor.ts";
import type { Position, TerminalSize } from "../../core/contracts/primitives.ts";

export type { JsonValue } from "../../core/contracts/editor.ts";

/**
 * The daemon/client wire-protocol version (RFC-025 change #1 / SPEC-070).
 * Bump ONLY on a breaking wire-protocol change. Clients declare this on every
 * request envelope (`protocolVersion`); the daemon refuses a mismatch with a
 * machine-readable `protocol_mismatch` error (-32600) before dispatch.
 * Single source of truth — import this everywhere; never hardcode `1`.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Transition gate (RFC-025 #1). While `false`, clients that OMIT
 * `protocolVersion` are tolerated (protects an old client binary against a
 * new daemon across a binary swap). A DECLARED-but-wrong version is ALWAYS
 * refused. Flip to `true` next release to enforce the field on all clients.
 */
export const ENFORCE_PROTOCOL_VERSION = false;

export interface DiagnosticResult {
  severity?: JsonValue;
  code?: JsonValue;
  message?: JsonValue;
  source?: JsonValue;
  primarySpan?: JsonValue;
  expected?: JsonValue;
  actual?: JsonValue;
  help?: JsonValue;
  stack?: JsonValue;
}

/**
 * Frame/client targeting prefix shared by many methods. AC5.7 forbids a
 * catch-all `[key: string]: unknown` index signature — every field a handler
 * actually reads is declared explicitly below (on this base or on the
 * per-method param interface).
 */
export interface FrameTarget {
  frameId?: string;
  workspaceId?: string;
  workspace?: string; // legacy alias used by some callers (treated as workspaceId)
  clientId?: string;
}

// ── Editing methods ──────────────────────────────────────────────────────
export interface OpenParams extends FrameTarget { filepath: string; }
export interface EvalParams extends FrameTarget { code: string; }
export interface CommandParams extends FrameTarget {
  command: string;
  functionName?: string;
  variableName?: string;
  pattern?: string;
  bufferName?: string;
}
export interface QueryParams extends FrameTarget {
  query: string;
  category?: LogCategory;
  level?: LogLevel;
  last?: number;
  view?: LogView;
  functionName?: string;
}
export interface InsertParams extends FrameTarget { text: string; line?: number; column?: number; }
export interface KeypressParams extends FrameTarget { key: string; }
export interface RenderStateParams extends FrameTarget {}
export interface ClientEventParams extends FrameTarget {
  event: string;
  data?: JsonValue;
  terminalSize?: { width: number; height: number };
  clientType?: string;
  clientName?: string;
  pid?: number;
  message?: string;
}
export interface SaveFileParams extends FrameTarget { filename?: string; }
export interface CaptureParams extends FrameTarget {
  format?: "ansi" | "text" | "html";
  width?: number;
  height?: number;
}

// ── Workspace methods (fields optional — handlers resolve id/name/target) ─
export interface WorkspaceNewParams extends FrameTarget { name?: string; projectRoot?: string; }
export interface WorkspaceSwitchParams extends FrameTarget { id?: string; name?: string; }
export interface WorkspaceSaveParams extends FrameTarget { id?: string; filename?: string; name?: string; }
export interface WorkspaceKillParams extends FrameTarget { id?: string; name?: string; confirm?: boolean; }
export interface WorkspaceRenameParams extends FrameTarget { id?: string; name?: string; oldName?: string; newName?: string; }
export interface WorkspaceLoadParams extends FrameTarget { filename?: string; name?: string; }
export interface WorkspaceMoveWindowParams extends FrameTarget { windowId?: string; targetId?: string; target?: string; sourceWorkspaceId?: string; }

/** Absent params (methods that take none) represented as `undefined`. */
export type NoParams = undefined;

// ── Exact result shapes (AC5.7) ──────────────────────────────────────────
// Every result is a named JSON-compatible interface — no `unknown` placeholder.

export interface OpenResult {
  buffer: string;
  line: number;
  column: number;
  opened: boolean;
}

/**
 * Eval result. Normally the JSON form of the T-Lisp value (`JsonValue`); on
 * the editor-quit signal the handler returns `{ quitSignal: true }` after
 * scheduling shutdown. Both shapes are JSON-compatible.
 */
export type EvalResult = JsonValue | { quitSignal: true };

/** Insert result is the JSON form of the `(buffer-insert …)` T-Lisp value. */
export type InsertResult = JsonValue;

/** Save-file acknowledgement. */
export interface SaveFileResult { success: true; saved: string; }

/** Capture result: ANSI/text lines OR an HTML document. */
export type CaptureResult =
  | { lines: string[]; width: number; height: number }
  | { html: string; width: number; height: number };

/** Ping acknowledgement. */
export interface PingResult { status: "running"; server: "tmax"; frames: number }

/** Shutdown acknowledgement (returned before the socket closes — AC5.6). */
export interface ShutdownResult { ok: true }

/** Client-event acknowledgement. */
export interface ClientEventResult { ok: true }

export type SerializedWindow = Omit<Window, "buffer"> & { bufferContent: string };
export type SerializedTab = Omit<Tab, "buffer"> & { bufferContent: string };

/** Exact renderer-facing editor state emitted by `editorStateToJson`. */
export interface SerializedEditorState {
  cursorPosition: Position;
  mode: EditorState["mode"];
  statusMessage: string;
  viewportTop: number;
  viewportLeft?: number;
  config: EditorConfig;
  commandLine: string;
  mxCommand: string;
  currentFilename?: string;
  currentMajorMode: string;
  activeMinorModes: string[];
  activeMinorModeLighters: string[];
  minibufferState?: JsonValue;
  minibufferView?: MinibufferRenderView;
  cursorFocus: "buffer" | "command";
  bufferContent: string;
  windows: SerializedWindow[];
  currentWindowIndex: number;
  tabs: SerializedTab[];
  currentTabIndex: number;
  whichKeyActive: boolean;
  whichKeyPrefix: string;
  whichKeyBindings: WhichKeyBinding[];
  whichKeyPopup: NonNullable<EditorState["whichKeyPopup"]> | null;
}

export interface BufferDetails {
  name: string;
  content: string;
  filename?: string;
  majorMode: string;
  modified: boolean;
  characters: number;
  lines: number;
  current: boolean;
  special: boolean;
  recency: number;
}

export interface FunctionDocumentation {
  name: string;
  signature: string;
  documentation: string;
  file: string;
  line: number;
  examples: string[];
  relatedFunctions: string[];
}

export interface VariableDocumentation {
  name: string;
  value: JsonValue;
  type: string;
  documentation: string;
  file: string;
  line: number;
  customizable: boolean;
  defaultValue: JsonValue;
}

export interface AproposCommandResult {
  matches: Array<{ name: string; binding: string; documentation: string }>;
}

export interface FunctionUsagesResult {
  function: string;
  usages: Array<{ file: string; line: number; column: number }>;
}

export interface KillBufferResult {
  success: boolean;
  killed?: string;
  error?: string;
}

export type CommandResult =
  | string[]
  | KillBufferResult
  | SaveFileResult
  | StatusResult
  | FunctionDocumentation
  | VariableDocumentation
  | AproposCommandResult
  | FunctionUsagesResult;

/** Dynamic symbol/key names are the only open part of query results. */
export type NamedJsonValues = Record<string, JsonValue>;

export interface FullStateQueryResult {
  buffers: BufferDetails[];
  currentBuffer: string | null;
  mode: EditorState["mode"];
  variables: NamedJsonValues;
  keybindings: Record<string, string>;
  cursorPosition: Position;
  viewportTop: number;
  config: EditorConfig;
}

export type QueryResult =
  | BufferDetails[]
  | NamedJsonValues
  | Record<string, string>
  | FullStateQueryResult
  | string[]
  | { messages: Array<LogEntry | MessageEntry> }
  | { entries: LogEntry[] }
  | FunctionDocumentation;

/** Keypress result is the serialized editor state, optionally carrying quit. */
export type KeypressResult = SerializedEditorState & { quitSignal?: true };

/** Render-state result is the serialized frame/editor render view model. */
export type RenderStateResult = SerializedEditorState;

export interface FrameStatusResult {
  id: string;
  clientId?: string;
  clientType: string;
  ready: boolean;
  mode: EditorState["mode"];
  currentFilename: string | null;
  bufferName: string | null;
  workspaceId: string;
  cursorPosition: Position;
  statusMessage: string;
  currentMajorMode: string;
  activeMinorModes: string[];
  activeMinorModeLighters: string[];
  firstRenderAt: string | null;
  lastRenderAt: string | null;
  renderCount: number;
  rawModeReady: boolean;
  terminalSize: TerminalSize | null;
  lastSyncDirection: "frame-to-editor" | "editor-to-frame" | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface ClientStatusResult {
  id: string;
  clientType: string;
  clientName: string | null;
  connectedAt: string;
  lastRequestAt: string | null;
  requestCount: number;
  lastError: string | null;
  frameId: string | null;
  metadata: Record<string, JsonValue>;
}

export interface ObservabilityErrorResult {
  timestamp: string;
  source: string;
  message: string;
  clientId?: string;
  frameId?: string;
  requestId?: string | number | null;
  diagnostic?: DiagnosticResult;
}

export interface StatusResult {
  daemonReady: boolean;
  status: "running" | "starting";
  server: "tmax";
  /** Daemon wire-protocol version (RFC-025 #1 / SPEC-070). Clients/`--status`
   *  consumers read this to detect a daemon/client version skew. */
  protocolVersion: number;
  uptimeMs: number;
  startedAt: string;
  socketPath: string;
  clientCount: number;
  frameCount: number;
  activeFrameId: string | null;
  activeWorkspaceId: string;
  workspaceCount: number;
  editor: {
    mode: EditorState["mode"];
    currentFilename: string | null;
    bufferName: string | null;
    cursorPosition: Position;
    statusMessage: string;
    currentMajorMode: string;
    activeMinorModes: string[];
    activeMinorModeLighters: string[];
  };
  clients: ClientStatusResult[];
  frames: FrameStatusResult[];
  recentErrors: ObservabilityErrorResult[];
}

export type ClientsResult = ClientStatusResult[];
export type FramesResult = FrameStatusResult[];

/** Workspace-list result row. */
export interface WorkspaceListRow {
  name: string;
  id: string;
  active: boolean;
  loaded: boolean;
  lastAccessed: string;
  projectRoot: string | null;
  windowCount: number;
}
export type WorkspaceListResult = WorkspaceListRow[];

export interface WorkspaceNewResult { success: true; name: string; id: string; }
export interface WorkspaceSwitchResult { success: true; activeWorkspaceId: string; }
export interface WorkspaceSaveResult { success: true; name: string; }
export interface WorkspaceKillResult {
  success: boolean;
  name?: string;
  confirmationRequired?: boolean;
  dirtyBuffers?: string[];
  message?: string;
}
export interface WorkspaceRenameResult { success: true; oldName: string; newName: string; }
export interface WorkspaceLoadResult { success: true; name: string; id: string; }
export interface WorkspaceMoveWindowResult {
  success: boolean;
  source?: string;
  target?: string;
  moved?: string;
  noop?: boolean;
}

/**
 * The exhaustive map of daemon RPC methods → { params, result }. Adding a
 * method here is the single place a new route is declared (AC5.1). Every
 * result is an exact JSON-compatible type — no `unknown`, no catch-all.
 */
export interface RpcMethodMap {
  open: { params: OpenParams; result: OpenResult };
  eval: { params: EvalParams; result: EvalResult };
  command: { params: CommandParams; result: CommandResult };
  query: { params: QueryParams; result: QueryResult };
  insert: { params: InsertParams; result: InsertResult };
  keypress: { params: KeypressParams; result: KeypressResult };
  "render-state": { params: RenderStateParams; result: RenderStateResult };
  "client-event": { params: ClientEventParams; result: ClientEventResult };
  "save-file": { params: SaveFileParams; result: SaveFileResult };
  capture: { params: CaptureParams; result: CaptureResult };
  ping: { params: NoParams; result: PingResult };
  status: { params: NoParams; result: StatusResult };
  clients: { params: NoParams; result: ClientsResult };
  frames: { params: NoParams; result: FramesResult };
  shutdown: { params: NoParams; result: ShutdownResult };
  "workspace-list": { params: NoParams; result: WorkspaceListResult };
  "workspace-new": { params: WorkspaceNewParams; result: WorkspaceNewResult };
  "workspace-switch": { params: WorkspaceSwitchParams; result: WorkspaceSwitchResult };
  "workspace-save": { params: WorkspaceSaveParams; result: WorkspaceSaveResult };
  "workspace-kill": { params: WorkspaceKillParams; result: WorkspaceKillResult };
  "workspace-rename": { params: WorkspaceRenameParams; result: WorkspaceRenameResult };
  "workspace-load": { params: WorkspaceLoadParams; result: WorkspaceLoadResult };
  "workspace-move-window": { params: WorkspaceMoveWindowParams; result: WorkspaceMoveWindowResult };
}

/** Every recognized method name (the authoritative route inventory). */
export type RpcMethodName = keyof RpcMethodMap;
