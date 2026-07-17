/**
 * @file rpc/types.ts
 * @description CHORE-44 Change 5 — typed JSON-RPC request/result map for the
 * tmax daemon (AC5.1/AC5.2). Every method the daemon accepts is declared here
 * with its exact params + result types; the router (rpc/router.ts) dispatches
 * against this map so handler params/results contain no `any`.
 *
 * Param shapes are derived from the existing handler bodies.
 * Results are `JsonValue` (the daemon serializes editor state / acknowledgements
 * to JSON); methods with a known narrow result declare it.
 */

/** JSON-compatible value (the wire shape for all RPC results). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// Log types used by query params (re-exported from log-entry for precision).
import type { LogCategory, LogView } from "../../editor/log-entry.ts";
import type { LogLevel } from "../../editor/message-log.ts";

/** Frame/client targeting prefix shared by many methods. The index signature
 *  lets handlers read additional ad-hoc fields the legacy untyped params exposed
 *  (e.g. query/category/level, client-event payloads) without re-introducing `any`. */
export interface FrameTarget {
  frameId?: string;
  workspaceId?: string;
  clientId?: string;
  bufferName?: string;
  [key: string]: unknown;
}

// ── Editing methods ──────────────────────────────────────────────────────
export interface OpenParams extends FrameTarget { filepath: string; }
export interface EvalParams extends FrameTarget { code: string; }
export interface CommandParams extends FrameTarget {
  command: string;
  functionName?: string;
  variableName?: string;
  pattern?: string;
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
export interface WorkspaceKillParams extends FrameTarget { id?: string; name?: string; }
export interface WorkspaceRenameParams extends FrameTarget { id?: string; name?: string; oldName?: string; newName?: string; }
export interface WorkspaceLoadParams extends FrameTarget { filename?: string; name?: string; }
export interface WorkspaceMoveWindowParams extends FrameTarget { windowId?: string; targetId?: string; target?: string; sourceWorkspaceId?: string; }

/** Absent params (methods that take none) represented as `undefined`. */
export type NoParams = undefined;

/**
 * The exhaustive map of daemon RPC methods → { params, result }. Adding a
 * method here is the single place a new route is declared (AC5.1).
 */
export interface RpcMethodMap {
  open: { params: OpenParams; result: unknown };
  eval: { params: EvalParams; result: unknown };
  command: { params: CommandParams; result: unknown };
  query: { params: QueryParams; result: unknown };
  insert: { params: InsertParams; result: unknown };
  keypress: { params: KeypressParams; result: unknown };
  "render-state": { params: RenderStateParams; result: unknown };
  "client-event": { params: ClientEventParams; result: unknown };
  "save-file": { params: SaveFileParams; result: unknown };
  capture: { params: CaptureParams; result: unknown };
  ping: { params: NoParams; result: unknown };
  status: { params: NoParams; result: unknown };
  clients: { params: NoParams; result: unknown };
  frames: { params: NoParams; result: unknown };
  shutdown: { params: NoParams; result: unknown };
  "workspace-list": { params: NoParams; result: unknown };
  "workspace-new": { params: WorkspaceNewParams; result: unknown };
  "workspace-switch": { params: WorkspaceSwitchParams; result: unknown };
  "workspace-save": { params: WorkspaceSaveParams; result: unknown };
  "workspace-kill": { params: WorkspaceKillParams; result: unknown };
  "workspace-rename": { params: WorkspaceRenameParams; result: unknown };
  "workspace-load": { params: WorkspaceLoadParams; result: unknown };
  "workspace-move-window": { params: WorkspaceMoveWindowParams; result: unknown };
}

/** Every recognized method name (the authoritative route inventory). */
export type RpcMethodName = keyof RpcMethodMap;
