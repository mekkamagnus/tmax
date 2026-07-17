/**
 * @file rpc/handlers/lifecycle.ts
 * @description CHORE-44 Change 5 — ping + shutdown handlers (AC5.9).
 *
 * Bodies moved verbatim from `TmaxServer.handlePing`/the inline shutdown handler
 * in `rpcHandlers()`. They operate purely on `ServerContext` — no import of the
 * concrete `TmaxServer` class.
 */

import type { ServerContext } from "./context.ts";
import type { PingResult, ShutdownResult } from "../types.ts";

/** Build the lifecycle-domain handlers bound to a `ServerContext`. */
export function createLifecycleHandlers(ctx: ServerContext): {
  ping: () => Promise<PingResult>;
  shutdown: () => ShutdownResult;
} {
  return {
    ping: async (): Promise<PingResult> => ({
      status: "running",
      server: "tmax",
      frames: ctx.frames.size,
    }),
    shutdown: (): ShutdownResult => {
      // AC5.6: schedule shutdown AFTER the response is written. The connection
      // handler in server.ts writes the response synchronously before the
      // timer fires (50ms delay), preserving response-before-close ordering.
      ctx.scheduleShutdown(50);
      return { ok: true };
    },
  };
}
