/**
 * @file rpc/handlers/confirmation.ts
 * @description #210 (RFC-027 §D5 L2, Phase 0) — the generic deferred-RPC
 * confirmation method. The router awaits handler promises, so `mediate`
 * parking the response is native: the response resolves when the T-Lisp
 * side resolves it, or auto-rejects on timeout/cancel/sweep. Mechanism
 * only — no Fikra policy.
 */

import type { ServerContext } from "./context.ts";
import type { ConfirmationMediateParams, ConfirmationMediateResult } from "../types.ts";
import { confirmationService } from "../../../editor/api/confirmation-service.ts";

export function createConfirmationHandlers(_ctx: ServerContext): {
  "confirmation/mediate": (params: ConfirmationMediateParams) => Promise<ConfirmationMediateResult>;
} {
  void _ctx; // Mechanism only: no editor/frame state needed; the service is shared.
  return {
    "confirmation/mediate": async (params: ConfirmationMediateParams) => {
      const result = await confirmationService.mediate({
        source: params.source,
        token: params.token,
        kind: params.kind,
        detail: params.detail,
        timeoutMs: params.timeoutMs,
      });
      return result;
    },
  };
}
