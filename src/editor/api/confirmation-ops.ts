/**
 * @file confirmation-ops.ts
 * @description #210 (RFC-027 §D5 L2, Phase 0) — T-Lisp bridge to the
 * confirmation service. Mechanism only, zero Fikra policy.
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createString, createNumber, createList, createNil, createBoolean } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { validateArgsCount, validateArgType } from "../../utils/validation.ts";
import { createValidationError, AppError } from "../../error/types.ts";
import { confirmationService, type ConfirmationDecision } from "./confirmation-service.ts";

export interface ConfirmationOpsDeps {
  /** Runs a T-Lisp expression string (e.g. `(handler-fn id "detail")`). */
  evalTlisp: (code: string) => unknown;
}

const DECISIONS: ConfirmationDecision[] = ["allow", "reject", "always"];

export function createConfirmationOps(deps: ConfirmationOpsDeps): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  const stringArg = (args: TLispValue[], i: number, op: string): Either<AppError, string> => {
    const v = validateArgType(args[i]!, "string", i, op);
    return Either.isLeft(v) ? v : Either.right(String(args[i]!.value));
  };

  // (confirmation-handler-register "source" "handler-fn-name")
  api.set("confirmation-handler-register", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const count = validateArgsCount(args, 2, "confirmation-handler-register");
    if (Either.isLeft(count)) return Either.left(count.left);
    const sourceE = stringArg(args, 0, "confirmation-handler-register");
    if (Either.isLeft(sourceE)) return Either.left(sourceE.left);
    const fnE = stringArg(args, 1, "confirmation-handler-register");
    if (Either.isLeft(fnE)) return Either.left(fnE.left);
    const fnName = fnE.right;
    confirmationService.registerHandler(sourceE.right, (id, detail, kind, scope) => {
      deps.evalTlisp(`(${fnName} ${id} ${JSON.stringify(detail)} ${JSON.stringify(kind)} ${JSON.stringify(scope)})`);
    });
    return Either.right(createNil());
  });

  // (confirmation-resolver-kind) → "interactive" | "headless" | "unknown".
  // READ-ONLY fact for #220's resolve guard. There is deliberately NO
  // setter on the T-Lisp surface: the daemon stamps the kind at dispatch
  // (server.ts processRequest); an eval-reachable client must not be able
  // to mark itself interactive.
  api.set("confirmation-resolver-kind", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const count = validateArgsCount(args, 0, "confirmation-resolver-kind");
    if (Either.isLeft(count)) return Either.left(count.left);
    return Either.right(createString(confirmationService.resolverHint));
  });

  // (confirmation-set-resolve-policy "permissive"|"interactive-only").
  // The DELIBERATE act that re-enables headless resolution (RFC-027
  // §Security). PROVENANCE-CHECKED: refuses a headless caller — an agent
  // that can reach eval must not be able to unlock its own approvals.
  // init.tlisp (startup, "unknown") and interactive M-x users pass.
  api.set("confirmation-set-resolve-policy", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const count = validateArgsCount(args, 1, "confirmation-set-resolve-policy");
    if (Either.isLeft(count)) return Either.left(count.left);
    const policyE = stringArg(args, 0, "confirmation-set-resolve-policy");
    if (Either.isLeft(policyE)) return Either.left(policyE.left);
    const policy = policyE.right;
    if (policy !== "permissive" && policy !== "interactive-only") {
      return Either.left(createValidationError(
        "ConstraintViolation",
        "confirmation-set-resolve-policy: policy must be permissive or interactive-only",
        "policy",
        policy,
        "permissive | interactive-only",
      ));
    }
    if (confirmationService.resolverHint === "headless") {
      // Refusal is an expected OUTCOME (not a type error) — return nil so
      // T-Lisp callers can branch on it; the policy is unchanged.
      return Either.right(createNil());
    }
    confirmationService.resolvePolicy = policy;
    return Either.right(createString(policy));
  });

  // (confirmation-token-mint "source" "scope") → token string
  api.set("confirmation-token-mint", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const count = validateArgsCount(args, 2, "confirmation-token-mint");
    if (Either.isLeft(count)) return Either.left(count.left);
    const sourceE = stringArg(args, 0, "confirmation-token-mint");
    if (Either.isLeft(sourceE)) return Either.left(sourceE.left);
    const scopeE = stringArg(args, 1, "confirmation-token-mint");
    if (Either.isLeft(scopeE)) return Either.left(scopeE.left);
    // r86/r87 hardening (codex r85/r86 P1s): (1) once-per-scope — first
    // mint wins, a repeat yields NIL; (2) MINT-TIME SCOPE-LIVENESS — the
    // scope's thread+turn must be LIVE (running) at mint time, so a token
    // minted for a not-yet-started turn is refused and cannot be held for
    // the live turn later. The adapter mints inside start-turn, after
    // turn-begin — always live; a pre-mint from any other caller is not.
    const liveness = deps.evalTlisp(
      `(condition-case nil (progn (require-module fikra/approvals)` +
      ` (if (fikra/approvals/fikra-approval-scope-live-p "${scopeE.right.replace(/"/g, '')}") t nil))` +
      ` (error () nil))`);
    // evalTlisp returns Either<EvalError, TLispValue>: live ONLY on a
    // Right whose value is boolean-true (anything else — Left, nil, an
    // unloaded module — declines the mint).
    const lv = liveness as { _tag?: string; right?: { type?: string; value?: unknown } };
    const live = lv?._tag === "Right"
      && ((lv.right?.type === "boolean" && lv.right?.value === true)
        || (lv.right?.type === "string" && lv.right?.value === "true"));
    if (!live) {
      return Either.right(createNil());
    }
    const token = confirmationService.mintToken(sourceE.right, scopeE.right);
    return token === null
      ? Either.right(createNil())
      : Either.right(createString(token));
  });

  // (confirmation-resolve id "allow"|"reject"|"always") → t if this call
  // settled it; nil if already settled (first-resolver-wins idempotence).
  api.set("confirmation-resolve", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const count = validateArgsCount(args, 2, "confirmation-resolve");
    if (Either.isLeft(count)) return Either.left(count.left);
    if (args[0]!.type !== "number") {
      return Either.left(createValidationError("TypeError", "confirmation-resolve: id must be a number"));
    }
    const decisionE = stringArg(args, 1, "confirmation-resolve");
    if (Either.isLeft(decisionE)) return Either.left(decisionE.left);
    if (!DECISIONS.includes(decisionE.right as ConfirmationDecision)) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        `confirmation-resolve: decision must be one of ${DECISIONS.join(", ")}`,
      ));
    }
    const record = confirmationService.resolve(Number(args[0]!.value), decisionE.right as ConfirmationDecision);
    return Either.right(createBoolean(record !== null));
  });

  // (confirmation-token-revoke "token") → t when the token was removed
  // (r87: the turn ENDED — the bridge's token dies with it; later
  // arrivals are unknown-token).
  api.set("confirmation-token-revoke", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const count = validateArgsCount(args, 1, "confirmation-token-revoke");
    if (Either.isLeft(count)) return Either.left(count.left);
    const tokenE = stringArg(args, 0, "confirmation-token-revoke");
    if (Either.isLeft(tokenE)) return Either.left(tokenE.left);
    return Either.right(createBoolean(confirmationService.revokeToken(tokenE.right)));
  });

  // (confirmation-cancel id) → t if a pending request was cancelled
  api.set("confirmation-cancel", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const count = validateArgsCount(args, 1, "confirmation-cancel");
    if (Either.isLeft(count)) return Either.left(count.left);
    if (args[0]!.type !== "number") {
      return Either.left(createValidationError("TypeError", "confirmation-cancel: id must be a number"));
    }
    return Either.right(createBoolean(confirmationService.cancel(Number(args[0]!.value))));
  });

  // (confirmation-pending) → list of pending request ids
  api.set("confirmation-pending", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const count = validateArgsCount(args, 0, "confirmation-pending");
    if (Either.isLeft(count)) return Either.left(count.left);
    return Either.right(createList(confirmationService.pendingList().map((p) => createNumber(p.id))));
  });

  return api;
}
