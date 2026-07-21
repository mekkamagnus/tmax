/**
 * @file rpc/handlers/context.ts
 * @description CHORE-44 Change 5 — the typed handler context (AC5.9).
 *
 * Domain handlers (`handlers/{editing,frames,workspaces,lifecycle}.ts`) depend
 * on this narrow interface, NOT on the concrete `TmaxServer` class. `TmaxServer`
 * implements this interface and supplies itself (or a thin adapter) to the
 * handler builders. This keeps the handler modules free of a circular import
 * on `server.ts` while preserving every behavior the ad-hoc private methods
 * provided.
 *
 * The interface is intentionally a bag of the editor + frame/workspace state
 * and the shared helpers every domain handler calls (sync helpers, workspace
 * lifecycle, frame resolution, error recording, serialization, shutdown).
 * Handler bodies are moved verbatim out of `server.ts` and operate purely on
 * this context.
 */

import type { Editor } from "../../../editor/editor.ts";
import type { EditorState } from "../../../core/contracts/editor.ts";
import type { Frame, WorkspaceState } from "../../../core/contracts/workspace.ts";
import type { WorkspaceManager } from "../../../core/workspace.ts";
import type {
  AproposCommandResult,
  BufferDetails,
  ClientStatusResult,
  DiagnosticResult,
  FrameStatusResult,
  FunctionDocumentation,
  FunctionUsagesResult,
  JsonValue,
  NamedJsonValues,
  StatusResult,
  VariableDocumentation,
} from "../types.ts";
import type { TLispValue } from "../../../tlisp/types.ts";

/** A connected client (the slice handlers touch). */
export interface ClientRecord {
  id: string;
  clientType: string;
  clientName?: string;
  lastRequestAt?: Date;
  requestCount: number;
  lastError?: string;
  frameId?: string;
  metadata?: Record<string, JsonValue>;
}

/** Per-frame observability (the slice handlers touch). */
export interface FrameObservability {
  id: string;
  clientId?: string;
  clientType: string;
  ready: boolean;
  firstRenderAt?: Date;
  lastRenderAt?: Date;
  renderCount: number;
  rawModeReady: boolean;
  terminalSize?: { width: number; height: number };
  lastSyncDirection?: 'frame-to-editor' | 'editor-to-frame';
  lastSyncAt?: Date;
  lastError?: string;
}

/**
 * `ServerContext` is the narrow, typed surface the four domain handler
 * modules see. Every member corresponds to a real call site in the original
 * `TmaxServer` private helpers. Implementations live on `TmaxServer`.
 *
 * NOTE: members are grouped by responsibility for readability, but this is a
 * single flat interface — no service locator, no runtime DI framework.
 */
export interface ServerContext {
  // ── Shared daemon/editor state ──────────────────────────────────────────
  readonly editor: Editor;
  readonly frames: Map<string, Frame>;
  readonly workspaces: Map<string, WorkspaceState>;
  readonly frameObservability: Map<string, FrameObservability>;
  readonly clients: Map<string, ClientRecord>;
  /** Invoked to read/mutate `activeWorkspaceId`/`activeFrameId`. */
  getActiveWorkspaceId(): string;
  setActiveWorkspaceId(id: string): void;
  getActiveFrameId(): string | null;
  setActiveFrameId(id: string | null): void;
  readonly workspaceManager: WorkspaceManager;
  /** True once start() has marked the daemon as running. */
  isDaemonRunning(): boolean;
  /** Daemon start time (for uptime). */
  getStartedAt(): Date;
  /** Socket path (for status output). */
  getSocketPath(): string;

  // ── Frame resolution + sync helpers (the centralized sync surface) ──────
  getFrame(id: string): Frame;
  resolveFrameOptional(params: { frameId?: string }): Frame | undefined;
  syncFrameToEditor(frame: Frame): void;
  syncEditorToFrame(frame: Frame): void;
  syncEditorToAllFrames(): void;

  // ── Workspace lifecycle helpers ─────────────────────────────────────────
  isWorkspaceOverride(frame: Frame | undefined, requestedWorkspaceId: unknown): boolean;
  activateFrameWorkspace(frame: Frame | undefined, requestedWorkspaceId?: string): Promise<void>;
  activateWorkspace(workspaceId: string): Promise<void>;
  restoreWorkspaceAfterOverride(override: boolean, workspaceId: string, frameId: string | null): Promise<void>;
  captureActiveWorkspace(): void;
  loadWorkspace(name: string): Promise<WorkspaceState>;
  saveWorkspace(name: string): Promise<void>;
  saveWorkspaceSnapshot(workspace: WorkspaceState): Promise<void>;
  cloneWorkspace(workspace: WorkspaceState): WorkspaceState;
  scheduleDirtyWorkspaceSave(name: string): void;
  updateLastWorkspace(name: string): Promise<void>;
  workspaceDirtyBuffers(workspace: WorkspaceState): string[];
  clearWorkspaceModifiedFlags(workspace: WorkspaceState): void;

  // ── Serialization + render helpers ──────────────────────────────────────
  frameToEditorState(frame: Frame): EditorState;
  currentBufferName(state: EditorState): string | null;
  frameStatus(frame: Frame): FrameStatusResult;
  clientStatus(client: ClientRecord): ClientStatusResult;
  buildStatus(): StatusResult;
  bufferDetailsForWorkspace(workspace: WorkspaceState, currentBufferName?: string): BufferDetails[];

  // ── T-Lisp bridge helpers ───────────────────────────────────────────────
  tlispValueToJson(value: TLispValue | null | undefined): JsonValue;
  diagnosticToJSON(d: unknown): DiagnosticResult;
  getTlispFunctions(): string[];
  getTlispVariables(): NamedJsonValues;
  getFunctionDocumentation(name: string): FunctionDocumentation;
  getVariableDocumentation(name: string): VariableDocumentation;
  findCommandsByPattern(pattern: string): AproposCommandResult;
  findFunctionUsages(name: string): FunctionUsagesResult;

  // ── Observability ───────────────────────────────────────────────────────
  recordError(
    source: string,
    error: unknown,
    clientId?: string,
    frameId?: string,
    diagnostic?: DiagnosticResult,
    requestId?: string | number,
  ): void;
  logMessage(message: string, level?: 'info' | 'warn' | 'error', namespace?: string, frameId?: string): void;

  // ── Lifecycle ───────────────────────────────────────────────────────────
  /** Schedule graceful shutdown after the shutdown RPC response is sent. */
  scheduleShutdown(delayMs?: number): void;
}

/**
 * Sync policy categories (AC5.3–AC5.5 + the workspaceOverride exception).
 * Declared per-method in `routeTable.ts`; applied by ONE wrapper in the router.
 *
 * - `readonly`: NO sync. Handler reads frame/editor state without mutating.
 *   AC5.3: `render-state`, also `status`, `clients`, `frames`, `ping`,
 *   `query`, `capture`.
 * - `frame-scoped`: sync frame→editor BEFORE, editor→frame AFTER. The handler
 *   mutates frame-local state. AC5.4: `keypress` (with frameId).
 * - `stateless`: sync editor→ALL frames AFTER. The handler mutates shared
 *   editor state. AC5.5: `open`, `eval`, `command`, `insert`, `save-file`.
 * - `workspace-override`: handler manages workspace activation/restore itself
 *   (the legacy `workspaceOverride` exception). The wrapper does NOT sync;
 *   the handler does the right thing internally. Workspace ops + frame
 *   `client-event` (frame metadata only).
 */
export type SyncPolicy = "readonly" | "frame-scoped" | "stateless" | "workspace-override";
