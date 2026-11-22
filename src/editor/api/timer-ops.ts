/**
 * @file timer-ops.ts
 * @description #311 — one-shot idle timers exposed to T-Lisp:
 *   `run-with-idle-timer <ms> <callback>` → a timer id (number);
 *   `cancel-idle-timer <id>` → t (idempotent — an unknown or
 *   already-fired id no-ops). Callbacks eval through the same
 *   Either-aware boundary as the watcher (Left logged, not thrown).
 *   One timer table per API context (daemon/client isolation).
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNumber, createBoolean } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { createValidationError, type AppError } from "../../error/types.ts";

type LogCategory = "shell" | "process" | "test" | "autosave";
type Eitherish = { _tag?: string };

export function createTimerOps(
  evalTlisp: ((expr: string) => unknown) | undefined,
  logProgram?: (category: LogCategory, entry: { level: string; text: string; [k: string]: unknown }) => void,
): Map<string, TLispFunctionImpl> {
  const ops = new Map<string, TLispFunctionImpl>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let nextTimerId = 1;

  ops.set("run-with-idle-timer", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 2 || args[0]!.type !== "number" || args[1]!.type !== "string") {
      return Either.left(createValidationError(
        "TypeError",
        "run-with-idle-timer requires 2 arguments: the delay (ms, number) and the callback name",
      ));
    }
    if (!evalTlisp) {
      return Either.left(createValidationError(
        "FormatError",
        "run-with-idle-timer requires an eval context (no interpreter attached)",
      ));
    }
    const ms = Math.max(0, Number(args[0]!.value));
    const callback = String(args[1]!.value);
    const id = nextTimerId++;
    const handle = setTimeout(() => {
      timers.delete(id);
      // A CANCEL between fire-queueing and execution: the delete
      // above ran first only if cancel(id) precedes; the map delete
      // here is the fired-mark. If cancel already removed it, this
      // is a no-op delete.
      const expr = `(${callback})`;
      try {
        const result = evalTlisp(expr);
        if (result && typeof result === "object" && (result as Eitherish)._tag === "Left") {
          logProgram?.("process", {
            level: "error",
            text: `idle timer callback failed (T-Lisp error): ${expr.slice(0, 80)}`,
          });
        }
      } catch (e: unknown) {
        logProgram?.("process", {
          level: "error",
          text: `idle timer callback failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }, ms);
    timers.set(id, handle);
    return Either.right(createNumber(id));
  });

  ops.set("cancel-idle-timer", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1 || args[0]!.type !== "number") {
      return Either.left(createValidationError(
        "TypeError",
        "cancel-idle-timer requires 1 argument: the timer id (number)",
      ));
    }
    const id = Number(args[0]!.value);
    const handle = timers.get(id);
    if (handle) {
      timers.delete(id);
      clearTimeout(handle);
    }
    // Idempotent: unknown/fired ids no-op (the T-Lisp side cancels
    // unconditionally on every exit path).
    return Either.right(createBoolean(true));
  });

  // Test/inspection seam: the live timer count (0 = no orphans).
  ops.set("idle-timer-count", (): Either<AppError, TLispValue> =>
    Either.right(createNumber(timers.size)));

  return ops;
}
