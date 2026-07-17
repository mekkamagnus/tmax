/**
 * @file rpc/router.ts
 * @description CHORE-44 Change 5 — typed JSON-RPC dispatch replacing the
 * monolithic `switch (request.method)` in server.ts (AC5.2).
 *
 * The daemon builds a `RpcHandlers` record mapping each method (declared in
 * `RpcMethodMap`) to its handler and calls `dispatchRpc`. Unknown methods throw
 * `RpcError(-32601)`; the server maps thrown errors to the existing `-32010`
 * internal-failure contract and preserves request IDs. Handler params/results
 * are typed (no `any`).
 */

import type { RpcMethodMap, RpcMethodName, JsonValue } from "./types.ts";

/** A typed handler for method K. */
export type RpcHandler<K extends RpcMethodName> = (
  params: RpcMethodMap[K]["params"],
) => Promise<RpcMethodMap[K]["result"]> | RpcMethodMap[K]["result"];

/** The exhaustive method → handler table the daemon supplies. */
export type RpcHandlers = { [K in RpcMethodName]: RpcHandler<K> };

/** A JSON-RPC error thrown by the router/handlers (mapped to wire codes by the server). */
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

/**
 * Dispatch `method` against the typed handler table. Throws `RpcError(-32601)`
 * for unrecognized methods; otherwise delegates to the matching handler.
 */
export async function dispatchRpc(handlers: RpcHandlers, method: string, params: unknown): Promise<unknown> {
  const fn = (handlers as Partial<Record<string, (p: unknown) => unknown>>)[method];
  if (!fn) {
    throw new RpcError(-32601, `Method not found: ${method}`, { method });
  }
  const result = await fn(params);
  return result;
}

/** True if `method` is a recognized RPC method name. */
export function isRpcMethod(method: string): method is RpcMethodName {
  return method in HANDLES;
}

const HANDLES: ReadonlySet<string> = new Set<RpcMethodName>([
  "open", "eval", "command", "query", "insert", "keypress", "render-state",
  "client-event", "save-file", "capture", "ping", "status", "clients", "frames",
  "shutdown", "workspace-list", "workspace-new", "workspace-switch", "workspace-save",
  "workspace-kill", "workspace-rename", "workspace-load", "workspace-move-window",
]);
