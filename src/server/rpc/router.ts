/**
 * @file rpc/router.ts
 * @description CHORE-44 Change 5 — typed JSON-RPC dispatch (AC5.2/AC5.8).
 *
 * Owns the JSON-RPC protocol boundary: version validation (`-32600`), method
 * lookup (`-32601`), parameter validation (`-32602` with useful `{field,
 * expected}` data), request-ID preservation, and wire error mapping
 * (`RpcError` passthrough + thrown errors → `-32010` with T-Lisp diagnostic
 * data, the existing contract). `TmaxServer.processRequest` is now a thin
 * delegator that calls `routeRequest` (AC5.8).
 *
 * `SYNC_POLICY` is the declarative per-method sync table (AC5.3–AC5.5). It is
 * the single authoritative declaration of which method uses which sync
 * category; `server-frame-sync.test.ts` proves the resulting call patterns.
 */

import type { DiagnosticResult, RpcMethodMap, RpcMethodName, JsonValue } from "./types.ts";
import type { SyncPolicy } from "./handlers/context.ts";

// ── JSON-RPC wire shapes ─────────────────────────────────────────────────

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: RpcMethodMap[RpcMethodName]["result"];
  error?: {
    code: number;
    message: string;
    data?: JsonValue;
  };
}

// ── Handler types ────────────────────────────────────────────────────────

/** A typed handler for method K. */
export type RpcHandler<K extends RpcMethodName> = (
  params: RpcMethodMap[K]["params"],
) => Promise<RpcMethodMap[K]["result"]> | RpcMethodMap[K]["result"];

/** The exhaustive method → handler table the daemon supplies. */
export type RpcHandlers = { [K in RpcMethodName]: RpcHandler<K> };

/** A JSON-RPC error thrown by the router/handlers (mapped to wire codes here). */
export class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: JsonValue,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

// ── Param type guards (AC5.8) ────────────────────────────────────────────
// Runtime type guards for every method's params. Invalid params return
// -32602 with `{ field, expected }` data. No new validation dependency — just
// plain TS type guards. The index-signature-free `FrameTarget`/`*Params`
// interfaces in types.ts are the authoritative field list.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string { return typeof v === 'string'; }
function isOptString(v: unknown): v is string | undefined { return v === undefined || typeof v === 'string'; }
function isOptNumber(v: unknown): v is number | undefined { return v === undefined || typeof v === 'number'; }
function isOptBoolean(v: unknown): v is boolean | undefined { return v === undefined || typeof v === 'boolean'; }
function isOptObject(v: unknown): v is Record<string, unknown> | undefined {
  return v === undefined || isObject(v);
}

/** Strip the well-known FrameTarget extras so each guard reports the right
 *  field. Returns the params object (or undefined) narrowed to a record. */
function asRecord(params: unknown, required: boolean): Record<string, unknown> {
  if (params === undefined || params === null) {
    if (required) throw new ParamError('params', 'object');
    return {};
  }
  if (!isObject(params)) throw new ParamError('params', 'object');
  return params;
}

class ParamError extends RpcError {
  constructor(field: string, expected: string) {
    super(-32602, `Invalid params: field '${field}' expected ${expected}`, { field, expected });
  }
}

// Per-method field validators. Each checks ONLY the fields its handler reads;
// FrameTarget fields (frameId/workspaceId/workspace/clientId) are optional on
// every method and validated collectively by `validateFrameTargetFields`.
function validateFrameTargetFields(p: Record<string, unknown>): void {
  if ('frameId' in p && !isOptString(p.frameId)) throw new ParamError('frameId', 'string');
  if ('workspaceId' in p && !isOptString(p.workspaceId)) throw new ParamError('workspaceId', 'string');
  if ('workspace' in p && !isOptString(p.workspace)) throw new ParamError('workspace', 'string');
  if ('clientId' in p && !isOptString(p.clientId)) throw new ParamError('clientId', 'string');
}

function isUndefinedOr(v: unknown, check: (v: unknown) => boolean): boolean {
  return v === undefined || check(v);
}

// Compile-time mapping: every method has a guard. The router consults this
// table at runtime; the per-method guards below double as TS type guards so
// the dispatch is fully typed.
type ParamGuard = (params: unknown) => void;

const openGuard: ParamGuard = (p) => {
  const r = asRecord(p, true);
  validateFrameTargetFields(r);
  if (!isString(r.filepath)) throw new ParamError('filepath', 'string');
};
const evalGuard: ParamGuard = (p) => {
  const r = asRecord(p, true);
  validateFrameTargetFields(r);
  if (!isString(r.code)) throw new ParamError('code', 'string');
};
const commandGuard: ParamGuard = (p) => {
  const r = asRecord(p, true);
  validateFrameTargetFields(r);
  if (!isString(r.command)) throw new ParamError('command', 'string');
  if ('functionName' in r && !isOptString(r.functionName)) throw new ParamError('functionName', 'string');
  if ('variableName' in r && !isOptString(r.variableName)) throw new ParamError('variableName', 'string');
  if ('pattern' in r && !isOptString(r.pattern)) throw new ParamError('pattern', 'string');
  if ('bufferName' in r && !isOptString(r.bufferName)) throw new ParamError('bufferName', 'string');
};
const queryGuard: ParamGuard = (p) => {
  const r = asRecord(p, true);
  validateFrameTargetFields(r);
  if (!isString(r.query)) throw new ParamError('query', 'string');
  if ('category' in r && !isOptString(r.category)) throw new ParamError('category', 'string');
  if ('level' in r && !isOptString(r.level)) throw new ParamError('level', 'string');
  if ('last' in r && !isOptNumber(r.last)) throw new ParamError('last', 'number');
  if ('view' in r && !isOptString(r.view)) throw new ParamError('view', 'string');
  if ('functionName' in r && !isOptString(r.functionName)) throw new ParamError('functionName', 'string');
};
const insertGuard: ParamGuard = (p) => {
  const r = asRecord(p, true);
  validateFrameTargetFields(r);
  if (!isString(r.text)) throw new ParamError('text', 'string');
  if ('line' in r && !isOptNumber(r.line)) throw new ParamError('line', 'number');
  if ('column' in r && !isOptNumber(r.column)) throw new ParamError('column', 'number');
};
const keypressGuard: ParamGuard = (p) => {
  const r = asRecord(p, true);
  validateFrameTargetFields(r);
  if (!isString(r.key)) throw new ParamError('key', 'string');
};
const renderStateGuard: ParamGuard = (p) => {
  // render-state may be called with no params (stateless) — accept undefined.
  if (p === undefined) return;
  const r = asRecord(p, false);
  validateFrameTargetFields(r);
};
const clientEventGuard: ParamGuard = (p) => {
  const r = asRecord(p, true);
  validateFrameTargetFields(r);
  if (!isString(r.event)) throw new ParamError('event', 'string');
  if ('data' in r && r.data !== undefined) {
    // data is JsonValue — accept any JSON-compatible value.
  }
  if ('terminalSize' in r && !isUndefinedOr(r.terminalSize, (v) => isObject(v) && typeof v.width === 'number' && typeof v.height === 'number')) {
    throw new ParamError('terminalSize', '{width:number,height:number}');
  }
  if ('clientType' in r && !isOptString(r.clientType)) throw new ParamError('clientType', 'string');
  if ('clientName' in r && !isOptString(r.clientName)) throw new ParamError('clientName', 'string');
  if ('pid' in r && !isOptNumber(r.pid)) throw new ParamError('pid', 'number');
  if ('message' in r && !isOptString(r.message)) throw new ParamError('message', 'string');
};
const saveFileGuard: ParamGuard = (p) => {
  const r = asRecord(p, false);
  validateFrameTargetFields(r);
  if ('filename' in r && !isOptString(r.filename)) throw new ParamError('filename', 'string');
};
const captureGuard: ParamGuard = (p) => {
  const r = asRecord(p, false);
  validateFrameTargetFields(r);
  if ('format' in r && !(r.format === undefined || r.format === 'ansi' || r.format === 'text' || r.format === 'html')) {
    throw new ParamError('format', '"ansi" | "text" | "html"');
  }
  if ('width' in r && !isOptNumber(r.width)) throw new ParamError('width', 'number');
  if ('height' in r && !isOptNumber(r.height)) throw new ParamError('height', 'number');
};
const noParamsGuard: ParamGuard = (_p) => { /* methods that take no params */ };

const workspaceNewGuard: ParamGuard = (p) => {
  const r = asRecord(p, false);
  validateFrameTargetFields(r);
  if ('name' in r && !isOptString(r.name)) throw new ParamError('name', 'string');
  if ('projectRoot' in r && !isOptString(r.projectRoot)) throw new ParamError('projectRoot', 'string');
};
const workspaceSwitchGuard: ParamGuard = (p) => {
  const r = asRecord(p, false);
  validateFrameTargetFields(r);
  if ('id' in r && !isOptString(r.id)) throw new ParamError('id', 'string');
  if ('name' in r && !isOptString(r.name)) throw new ParamError('name', 'string');
};
const workspaceSaveGuard: ParamGuard = (p) => {
  const r = asRecord(p, false);
  validateFrameTargetFields(r);
  if ('id' in r && !isOptString(r.id)) throw new ParamError('id', 'string');
  if ('filename' in r && !isOptString(r.filename)) throw new ParamError('filename', 'string');
  if ('name' in r && !isOptString(r.name)) throw new ParamError('name', 'string');
};
const workspaceKillGuard: ParamGuard = (p) => {
  const r = asRecord(p, false);
  validateFrameTargetFields(r);
  if ('id' in r && !isOptString(r.id)) throw new ParamError('id', 'string');
  if ('name' in r && !isOptString(r.name)) throw new ParamError('name', 'string');
  if ('confirm' in r && !isOptBoolean(r.confirm)) throw new ParamError('confirm', 'boolean');
};
const workspaceRenameGuard: ParamGuard = (p) => {
  const r = asRecord(p, false);
  validateFrameTargetFields(r);
  if ('id' in r && !isOptString(r.id)) throw new ParamError('id', 'string');
  if ('name' in r && !isOptString(r.name)) throw new ParamError('name', 'string');
  if ('oldName' in r && !isOptString(r.oldName)) throw new ParamError('oldName', 'string');
  if ('newName' in r && !isOptString(r.newName)) throw new ParamError('newName', 'string');
};
const workspaceLoadGuard: ParamGuard = (p) => {
  const r = asRecord(p, false);
  validateFrameTargetFields(r);
  if ('filename' in r && !isOptString(r.filename)) throw new ParamError('filename', 'string');
  if ('name' in r && !isOptString(r.name)) throw new ParamError('name', 'string');
};
const workspaceMoveWindowGuard: ParamGuard = (p) => {
  const r = asRecord(p, false);
  validateFrameTargetFields(r);
  if ('windowId' in r && !isOptString(r.windowId)) throw new ParamError('windowId', 'string');
  if ('targetId' in r && !isOptString(r.targetId)) throw new ParamError('targetId', 'string');
  if ('target' in r && !isOptString(r.target)) throw new ParamError('target', 'string');
  if ('sourceWorkspaceId' in r && !isOptString(r.sourceWorkspaceId)) throw new ParamError('sourceWorkspaceId', 'string');
};

const PARAM_GUARDS: Readonly<Record<RpcMethodName, ParamGuard>> = {
  open: openGuard,
  eval: evalGuard,
  command: commandGuard,
  query: queryGuard,
  insert: insertGuard,
  keypress: keypressGuard,
  "render-state": renderStateGuard,
  "client-event": clientEventGuard,
  "save-file": saveFileGuard,
  capture: captureGuard,
  ping: noParamsGuard,
  status: noParamsGuard,
  clients: noParamsGuard,
  frames: noParamsGuard,
  shutdown: noParamsGuard,
  "workspace-list": noParamsGuard,
  "workspace-new": workspaceNewGuard,
  "workspace-switch": workspaceSwitchGuard,
  "workspace-save": workspaceSaveGuard,
  "workspace-kill": workspaceKillGuard,
  "workspace-rename": workspaceRenameGuard,
  "workspace-load": workspaceLoadGuard,
  "workspace-move-window": workspaceMoveWindowGuard,
};

// ── Sync policy table (AC5.3–AC5.5 + workspaceOverride exception) ─────────
//
// The authoritative per-method sync declaration. `server-frame-sync.test.ts`
// asserts the resulting call patterns:
//   - `readonly`: NO sync (render-state, status, clients, frames, ping,
//     query, capture). AC5.3 proves render-state never syncs.
//   - `frame-scoped`: pre = `syncFrameToEditor(frame)` once when the frame is
//     present and no workspaceOverride; post = `syncEditorToFrame(frame)` or
//     `syncEditorToAllFrames()` depending on override. AC5.4 proves frame
//     keypress syncs frame→editor exactly once before AND editor→frame
//     exactly once after.
//   - `stateless`: post = `syncEditorToAllFrames()` when no frame, else
//     `syncEditorToFrame(frame)`. Pre varies (open: none; eval/insert/save:
//     same as frame-scoped). AC5.5 proves stateless mutations sync
//     editor→all-frames after handling (the no-frame path).
//   - `workspace-override`: handler manages workspace state directly; the
//     outer wrapper does NOT sync. Workspace ops + client-event.
//
// The sync CALLS themselves live inside each handler body (moved verbatim
// from server.ts — see handlers/*.ts). This table is the single documentation
// + test anchor: ONE place declares every method's policy.
export const SYNC_POLICY: Readonly<Record<RpcMethodName, SyncPolicy>> = {
  open: "stateless",
  eval: "stateless",
  command: "stateless",
  query: "readonly",
  insert: "stateless",
  keypress: "frame-scoped", // with-frame branch; no-frame branch is stateless internally
  "render-state": "readonly",
  "client-event": "workspace-override",
  "save-file": "stateless",
  capture: "readonly",
  ping: "readonly",
  status: "readonly",
  clients: "readonly",
  frames: "readonly",
  shutdown: "readonly",
  "workspace-list": "workspace-override",
  "workspace-new": "workspace-override",
  "workspace-switch": "workspace-override",
  "workspace-save": "workspace-override",
  "workspace-kill": "workspace-override",
  "workspace-rename": "workspace-override",
  "workspace-load": "workspace-override",
  "workspace-move-window": "workspace-override",
};

// ── Method inventory ─────────────────────────────────────────────────────

const HANDLES: ReadonlySet<RpcMethodName> = new Set<RpcMethodName>([
  "open", "eval", "command", "query", "insert", "keypress", "render-state",
  "client-event", "save-file", "capture", "ping", "status", "clients", "frames",
  "shutdown", "workspace-list", "workspace-new", "workspace-switch", "workspace-save",
  "workspace-kill", "workspace-rename", "workspace-load", "workspace-move-window",
]);

/** True if `method` is a recognized RPC method name. */
export function isRpcMethod(method: string): method is RpcMethodName {
  return HANDLES.has(method as RpcMethodName);
}

/**
 * Dispatch `method` against the typed handler table. Throws `RpcError(-32601)`
 * for unrecognized methods; otherwise delegates to the matching handler.
 * (Lower-level than `routeRequest` — exposed for callers that have already
 * validated the request envelope.)
 */
export async function dispatchRpc(handlers: RpcHandlers, method: string, params: unknown): Promise<unknown> {
  if (!isRpcMethod(method)) {
    throw new RpcError(-32601, `Method not found: ${method}`, { method });
  }
  const fn = (handlers as Partial<Record<string, (p: unknown) => unknown>>)[method];
  // `fn` is always defined because `method` is in HANDLES and handlers is
  // exhaustive over the same set — but be defensive.
  if (!fn) {
    throw new RpcError(-32601, `Method not found: ${method}`, { method });
  }
  return await fn(params);
}

/**
 * The full JSON-RPC protocol boundary (AC5.8). Performs:
 *   1. Version validation → `-32600` Invalid Request.
 *   2. Method lookup → `-32601` Method not found.
 *   3. Parameter validation → `-32602` Invalid params (with `{field,expected}`).
 *   4. Dispatch against the typed handler table.
 *   5. Wire error mapping: `RpcError` passthrough; thrown errors (incl.
 *      T-Lisp diagnostics on `Error.diagnostic`) → `-32010` with diagnostic data.
 *   6. Request-ID preservation on every response.
 *
 * `onError` is invoked for every thrown error so the daemon can record it in
 * its observability buffer (the previous `TmaxServer.processRequest` did this
 * inline; the signature preserves that hook without forcing router callers to
 * depend on the daemon's recordError shape).
 */
export async function routeRequest(
  handlers: RpcHandlers,
  request: JSONRPCRequest,
  onError?: (info: {
    method: string;
    error: unknown;
    clientId?: string;
    frameId?: string;
    diagnostic?: DiagnosticResult;
    requestId?: string | number | null;
  }) => void,
): Promise<JSONRPCResponse> {
  // 1. Version validation.
  if (request.jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32600,
        message: 'Invalid Request: JSON-RPC version must be 2.0',
      },
    };
  }

  // 2. Method lookup.
  if (!isRpcMethod(request.method)) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32601,
        message: `Method not found: ${request.method}`,
        data: { method: request.method },
      },
    };
  }

  const method: RpcMethodName = request.method;

  // 3. Parameter validation.
  try {
    PARAM_GUARDS[method](request.params);
  } catch (guardError) {
    if (guardError instanceof RpcError) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: guardError.code,
          message: guardError.message,
          ...(guardError.data !== undefined ? { data: guardError.data } : {}),
        },
      };
    }
    // A guard threw a non-RpcError — surface as -32602 with the message.
    const message = guardError instanceof Error ? guardError.message : String(guardError);
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32602,
        message: `Invalid params: ${message}`,
      },
    };
  }

  // 4. Dispatch + 5. error mapping.
  type RpcParams = RpcMethodMap[RpcMethodName]["params"];
  type RpcResult = RpcMethodMap[RpcMethodName]["result"];
  const fn = (handlers as Record<RpcMethodName, (params: RpcParams) => RpcResult | Promise<RpcResult>>)[method];
  if (!fn) {
    // Defensive: handler table is exhaustive over HANDLES, but a malformed
    // `handlers` object could miss an entry. Surface as -32601.
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32601,
        message: `Method not found: ${request.method}`,
        data: { method: request.method },
      },
    };
  }
  try {
    const result = await fn(request.params as RpcParams);
    return { jsonrpc: '2.0', id: request.id, result };
  } catch (error) {
    // RpcError passthrough (e.g. a handler that throws -32601-equivalent).
    if (error instanceof RpcError) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: error.code,
          message: error.message,
          ...(error.data !== undefined ? { data: error.data } : {}),
        },
      };
    }

    // T-Lisp diagnostic-aware internal error (-32010, the existing contract).
    const rawDiagnostic = (error instanceof Error && (error as Error & { diagnostic?: unknown }).diagnostic)
      ? (error as Error & { diagnostic?: unknown }).diagnostic
      : undefined;
    // The diagnostic object is JSON-serializable (produced by diagnosticToJSON:
    // a record of primitives). Wrap it in the wire envelope the daemon has
    // always sent on -32010.
    const diagnostic: { kind: 'tlisp-diagnostic'; diagnostic: JsonValue } | undefined = rawDiagnostic
      ? { kind: 'tlisp-diagnostic', diagnostic: rawDiagnostic as JsonValue }
      : undefined;

    const paramsRecord = isObject(request.params) ? request.params : {};
    onError?.({
      method: request.method,
      error,
      clientId: typeof paramsRecord.clientId === 'string' ? paramsRecord.clientId : undefined,
      frameId: typeof paramsRecord.frameId === 'string' ? paramsRecord.frameId : undefined,
      diagnostic: rawDiagnostic as DiagnosticResult | undefined,
      requestId: request.id,
    });

    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32010,
        message: error instanceof Error ? error.message : 'Unknown error',
        ...(diagnostic ? { data: diagnostic } : {}),
      },
    };
  }
}
