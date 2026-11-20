import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createString } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import type { AppError } from "../../error/types.ts";
import { createValidationError } from "../../error/types.ts";
import type { Msg } from "../functional/messages.ts";

/**
 * @file ghost-ops.ts
 * @description RFC-029 §8.8 ghost text — the dim inline completion at the
 * cursor. T-Lisp sets/clears it; the render pipeline carries it to the
 * client (the completion SOURCES live in tlisp/core/fikra/ghost.tlisp).
 */
export function createGhostOps(write: (msg: Msg) => void): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  api.set("ghost-text-set", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const text = args[0];
    if (!text || text.type !== "string") {
      write({ type: "SetGhostText", text: undefined });
      return Either.right(createNil());
    }
    // Single line only (round 1 scope): a newline in the suggestion ends it.
    const firstLine = (text.value as string).split("\n")[0] ?? "";
    write({ type: "SetGhostText", text: firstLine.length > 0 ? firstLine : undefined });
    return Either.right(createString(firstLine));
  });

  // §8.8 r39: the RENDER anchor — the ghost draws only while the cursor
  // sits at its origin (movement hides it instantly, before any T-Lisp
  // hook could react).
  api.set("ghost-anchor-set", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const [line, col] = args;
    if (line?.type !== "number" || col?.type !== "number") {
      return Either.left(createValidationError("ConstraintViolation", "ghost-anchor-set requires (line, column)", "args", args));
    }
    write({ type: "SetGhostAnchor", line: line.value as number, column: col.value as number });
    return Either.right(createNil());
  });

  api.set("ghost-text-clear", (): Either<AppError, TLispValue> => {
    write({ type: "SetGhostText", text: undefined });
    return Either.right(createNil());
  });

  return api;
}
