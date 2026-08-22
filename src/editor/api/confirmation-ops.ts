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

  // (confirmation-token-mint "source" "scope") → token string
  api.set("confirmation-token-mint", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const count = validateArgsCount(args, 2, "confirmation-token-mint");
    if (Either.isLeft(count)) return Either.left(count.left);
    const sourceE = stringArg(args, 0, "confirmation-token-mint");
    if (Either.isLeft(sourceE)) return Either.left(sourceE.left);
    const scopeE = stringArg(args, 1, "confirmation-token-mint");
    if (Either.isLeft(scopeE)) return Either.left(scopeE.left);
    return Either.right(createString(confirmationService.mintToken(sourceE.right, scopeE.right)));
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
