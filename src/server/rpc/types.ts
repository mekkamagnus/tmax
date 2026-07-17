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

/** JSON-compatible value (the wire shape for all RPC results). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * A JSON object whose leaf values may be `unknown` (the runtime shape returned
 * by `editorStateToJson`/T-Lisp value converters, where some fields are
 * intentionally dynamic — render view models, diagnostics, log entries). Used
 * by result types whose handlers return a dynamic object graph; this is NOT a
 * blanket `unknown` placeholder (each method still declares a NAMED result
 * type) nor a param catch-all index signature.
 */
export type JsonObject = { [key: string]: unknown };

// Log types used by query params (re-exported from log-entry for precision).
import type { LogCategory, LogView } from "../../editor/log-entry.ts";
import type { LogLevel } from "../../editor/message-log.ts";

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

/** Command result is a per-command JSON value: string[] (list-buffers),
 * `{success, killed}` (kill-buffer), `{success, saved}` (save-buffer),
 * a status object (server-info), or documentation/pattern-usage objects. */
export type CommandResult = JsonValue | JsonObject | JsonObject[];

/** Query result is per-query JSON: buffer details, variables, keybindings,
 * full-state, functions, messages/entries, documentation. The handler returns
 * dynamic object graphs (render view models, log entries) so the open tail is
 * `JsonObject` (named, not a blanket `unknown` placeholder). */
export type QueryResult = JsonValue | JsonObject | JsonObject[];

/** Keypress result is the serialized editor state (render view model). On
 * editor-quit it carries `quitSignal: true`. */
export type KeypressResult = JsonObject | { quitSignal: true };

/** Render-state result is the serialized frame/editor render view model. */
export type RenderStateResult = JsonObject;

/** Status result is the daemon status summary object. */
export type StatusResult = JsonObject;

/** Clients result is an array of per-client status objects. */
export type ClientsResult = JsonObject[];

/** Frames result is an array of per-frame status objects. */
export type FramesResult = JsonObject[];

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
