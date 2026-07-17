/**
 * @file rpc/handlers/frames.ts
 * @description CHORE-44 Change 5 — frame/client/status/render methods (AC5.9).
 *
 * Handler bodies moved verbatim from `TmaxServer`:
 *   handleRenderState, handleCapture, handleClientEvent, handleStatus,
 *   handleClients, handleFrames.
 *
 * `render-state` is READ-ONLY (AC5.3): no frame→editor or editor→frame sync.
 * `status`/`clients`/`frames`/`capture` are also read-only. `client-event`
 * mutates per-frame observability/client metadata only — no editor sync
 * (the handler is workspace-override policy: it manages its own state).
 */

import type { ServerContext, FrameObservability, ClientRecord } from "./context.ts";
import type {
  RenderStateParams, RenderStateResult,
  CaptureParams, CaptureResult,
  ClientEventParams, ClientEventResult,
  StatusResult, ClientsResult, FramesResult,
} from "../types.ts";
import { editorStateToJson } from "../../serialize.ts";
import { captureFrame } from "../../../render/capture-frame.ts";
import { ansiLinesToHtmlDocument } from "../../../render/ansi-to-html.ts";

/** Build the frames-domain handlers bound to a `ServerContext`. */
export function createFramesHandlers(ctx: ServerContext): {
  "render-state": (params: RenderStateParams) => Promise<RenderStateResult>;
  capture: (params: CaptureParams) => CaptureResult;
  "client-event": (params: ClientEventParams) => Promise<ClientEventResult>;
  status: () => Promise<StatusResult>;
  clients: () => Promise<ClientsResult>;
  frames: () => Promise<FramesResult>;
} {
  // ── render-state (READ-ONLY: AC5.3 — never syncs) ───────────────────────
  const renderState = async (params: RenderStateParams): Promise<RenderStateResult> => {
    if (params?.frameId) {
      const frame = ctx.getFrame(params.frameId);
      // Read-only: return frame's own state directly, no workspace activation (C2)
      return editorStateToJson(ctx.frameToEditorState(frame));
    }
    return editorStateToJson(ctx.editor.getEditorState());
  };

  // ── capture (READ-ONLY) ─────────────────────────────────────────────────
  const capture = (params: CaptureParams): CaptureResult => {
    const format = params?.format ?? "ansi";

    // Validate explicit dimensions if the caller provided them.
    const explicitWidth = params?.width;
    const explicitHeight = params?.height;
    const isPositiveInt = (v: unknown): v is number =>
      typeof v === "number" && Number.isInteger(v) && v > 0;
    if (explicitWidth !== undefined && !isPositiveInt(explicitWidth)) {
      throw new Error(
        `capture: width must be a positive integer (got ${JSON.stringify(explicitWidth)})`,
      );
    }
    if (explicitHeight !== undefined && !isPositiveInt(explicitHeight)) {
      throw new Error(
        `capture: height must be a positive integer (got ${JSON.stringify(explicitHeight)})`,
      );
    }

    // Final fallback: 80x24.
    let width = 80;
    let height = 24;

    const frame = ctx.resolveFrameOptional(params);
    if (frame) {
      const obs = ctx.frameObservability.get(frame.id);
      if (obs?.terminalSize) {
        width = obs.terminalSize.width;
        height = obs.terminalSize.height;
      }
    }

    // Explicit params win over everything else.
    if (explicitWidth !== undefined) width = explicitWidth;
    if (explicitHeight !== undefined) height = explicitHeight;

    const state = frame
      ? ctx.frameToEditorState(frame)
      : ctx.editor.getEditorState();

    const lines = captureFrame(state, width, height);

    if (format === "html") {
      return { html: ansiLinesToHtmlDocument(lines, width), width, height };
    }
    return { lines, width, height };
  };

  // ── client-event (workspace-override policy: no editor sync) ────────────
  const clientEvent = async (params: ClientEventParams): Promise<ClientEventResult> => {
    const event = params.event;
    const clientId = params.clientId;
    const frameId = params.frameId;
    const now = new Date();

    if (!event) {
      throw new Error('Client event name is required');
    }

    const frame: FrameObservability | undefined = frameId ? ctx.frameObservability.get(frameId) : undefined;
    const client: ClientRecord | undefined = clientId ? ctx.clients.get(clientId) : undefined;

    if (client) {
      client.lastRequestAt = now;
      if (params.clientType) client.clientType = params.clientType;
      if (params.clientName) client.clientName = params.clientName;
    }

    if (event === 'error') {
      const message = params.message ?? 'Unknown client error';
      ctx.recordError('client-event', message, clientId, frameId);
      return { ok: true };
    }

    if (frame) {
      if (event === 'tui-started') {
        frame.clientType = params.clientType ?? frame.clientType;
      } else if (event === 'first-render') {
        frame.firstRenderAt = frame.firstRenderAt ?? now;
        frame.lastRenderAt = now;
        frame.renderCount++;
        frame.terminalSize = params.terminalSize ?? frame.terminalSize;
      } else if (event === 'raw-mode-ready') {
        frame.rawModeReady = true;
        frame.ready = Boolean(frame.firstRenderAt);
      } else if (event === 'render') {
        frame.lastRenderAt = now;
        frame.renderCount++;
        frame.terminalSize = params.terminalSize ?? frame.terminalSize;
        frame.ready = frame.ready || (frame.rawModeReady && Boolean(frame.firstRenderAt));
      } else if (event === 'resize') {
        frame.terminalSize = params.terminalSize ?? frame.terminalSize;
      } else if (event === 'shutdown') {
        frame.ready = false;
      }

      if (frame.rawModeReady && frame.firstRenderAt) {
        frame.ready = true;
      }
    }

    return { ok: true };
  };

  // ── status / clients / frames (READ-ONLY) ───────────────────────────────
  const status = async (): Promise<StatusResult> => ctx.buildStatus();
  const clients = async (): Promise<ClientsResult> =>
    Array.from(ctx.clients.values()).map(client => ctx.clientStatus(client));
  const frames = async (): Promise<FramesResult> =>
    Array.from(ctx.frames.values()).map(frame => ctx.frameStatus(frame));

  return {
    "render-state": renderState,
    capture,
    "client-event": clientEvent,
    status,
    clients,
    frames,
  };
}
