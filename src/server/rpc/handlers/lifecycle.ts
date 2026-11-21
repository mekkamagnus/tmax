/**
 * @file rpc/handlers/lifecycle.ts
 * @description CHORE-44 Change 5 — ping + shutdown handlers (AC5.9).
 *
 * Bodies moved verbatim from `TmaxServer.handlePing`/the inline shutdown handler
 * in `rpcHandlers()`. They operate purely on `ServerContext` — no import of the
 * concrete `TmaxServer` class.
 */

import type { ServerContext } from "./context.ts";
import type { PingResult, ShutdownResult, ServerIdentityResult } from "../types.ts";

/** Build the lifecycle-domain handlers bound to a `ServerContext`. */
export function createLifecycleHandlers(ctx: ServerContext): {
  ping: () => Promise<PingResult>;
  shutdown: () => ShutdownResult;
  "server-identity": () => ServerIdentityResult;
} {
  return {
    ping: async (): Promise<PingResult> => ({
      status: "running",
      server: "tmax",
      frames: ctx.frames.size,
    }),
    // #276: the identity RPC — {mode, pid}. `--stop` asks this BEFORE any
    // signal: an embedded session answers 'embedded' and is NEVER
    // signaled; the daemon answers 'daemon' + its pid for verification.
    "server-identity": (): ServerIdentityResult => ({
      mode: ctx.getServerMode(),
      pid: process.pid,
    }),
    shutdown: (): ShutdownResult => {
      // #276 (verify-gate r1): the shutdown RPC is REFUSED for an
      // EMBEDDED server — the issue's design decision, enforced at the
      // RPC itself (any direct client, not just the CLIs' gated
      // sequences). The refusal is a normal response (not an RPC error):
      // callers check `ok`.
      if (ctx.getServerMode() === "embedded") {
        return { ok: false, reason: "embedded" };
      }
      // AC5.6: schedule shutdown AFTER the response is written. The connection
      // handler in server.ts writes the response synchronously before the
      // timer fires (50ms delay), preserving response-before-close ordering.
      ctx.scheduleShutdown(50);
      return { ok: true };
    },
  };
}
