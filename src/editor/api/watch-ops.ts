/**
 * @file watch-ops.ts
 * @description #329 — filesystem watching exposed to T-Lisp:
 *   `file-watch-start <path> <callback>` → a watch id (number);
 *   `file-watch-stop <id>` → t. Built on node:fs.watch (Bun 1.4.4
 *   has NO Bun.watch — the issue's sketch assumed it; fs.watch is
 *   the verified-available primitive); events eval the
 *   callback as `(name <path> <event-type>)` — the path HEX-ENCODED
 *   (the reader strips backslash escapes; the #224 boundary rule).
 *   One watch table per API context (daemon/client isolation).
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createList, createString, createNumber, createBoolean } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { createValidationError, type AppError } from "../../error/types.ts";
import { watch } from "node:fs";
import type { LogCategory } from "../log-entry.ts";

type Eitherish = { type?: string } | undefined | null;

export function createWatchOps(
  evalTlisp: ((expr: string) => unknown) | undefined,
  logProgram?: (category: LogCategory, entry: { level: string; text: string; [k: string]: unknown }) => void,
): Map<string, TLispFunctionImpl> {
  const ops = new Map<string, TLispFunctionImpl>();
  const watches = new Map<number, { stop: () => void; path: string; callback: string }>();
  let nextWatchId = 1;

  const asString = (v: TLispValue): string | null => {
    if (v.type !== "string") return null;
    return String(v.value);
  };

  ops.set("file-watch-start", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 2) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        "file-watch-start requires 2 arguments: the path and the callback name",
        "args", args.length, "2",
      ));
    }
    const path = asString(args[0]!);
    const callback = asString(args[1]!);
    if (path === null || callback === null) {
      return Either.left(createValidationError(
        "TypeError",
        "file-watch-start requires string arguments: the path and the callback name",
      ));
    }
    if (!evalTlisp) {
      return Either.left(createValidationError(
        "FormatError",
        "file-watch-start requires an eval context (no interpreter attached)",
      ));
    }
    try {
      const watcher = watch(path, {}, (_eventType: string, filename: string | null) => {
        // The event payload: the WATCHED path (fs.watch's filename is
        // basename-only/unreliable across platforms — the registered
        // path is the stable identity) + the fs event word.
        // #224's boundary rule: the path crosses as HEX (the reader
        // strips backslash escapes in literals).
        const hex = Buffer.from(path, "utf8").toString("hex");
        const expr = `(${callback} (hex-decode "${hex}") "${_eventType}")`;
        try {
          const result = evalTlisp(expr) as Eitherish;
          // Production evalTlisp returns Either — a T-Lisp error is
          // a LEFT, not a throw (gate r1: the catch alone never fired;
          // undefined callbacks were silent).
          if (result && typeof result === "object" && "type" in result && (result as { type: string }).type === "Left") {
            logProgram?.("watch", {
              level: "error",
              text: `watch callback eval failed (T-Lisp error): ${expr.slice(0, 80)}`,
              path,
            });
          }
        } catch (e: unknown) {
          logProgram?.("watch", {
            level: "error",
            text: `watch callback eval failed: ${e instanceof Error ? e.message : String(e)}`,
            path,
          });
        }
      });
      const id = nextWatchId++;
      watches.set(id, { stop: () => watcher.close(), path, callback });
      logProgram?.("watch", { level: "info", text: `▶ watch ${id} started: ${path}`, id, path });
      return Either.right(createNumber(id));
    } catch (e: unknown) {
      return Either.left(createValidationError(
        "FormatError",
        `file-watch-start failed: ${e instanceof Error ? e.message : String(e)}`,
      ));
    }
  });

  ops.set("file-watch-stop", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1 || args[0]!.type !== "number") {
      return Either.left(createValidationError(
        "TypeError",
        "file-watch-stop requires 1 argument: the watch id (number)",
      ));
    }
    const id = Number(args[0]!.value);
    const entry = watches.get(id);
    if (!entry) {
      // Idempotent: stopping an unknown/already-stopped watch is a
      // no-op (the T-Lisp side clears its registry unconditionally).
      return Either.right(createBoolean(true));
    }
    watches.delete(id);
    try {
      entry.stop();
    } catch { /* already closed */ }
    logProgram?.("watch", { level: "info", text: `◀ watch ${id} stopped: ${entry.path}`, id });
    return Either.right(createBoolean(true));
  });

  // Test/inspection seam: the live watch table (path list).
  ops.set("file-watch-list", (): Either<AppError, TLispValue> => {
    const out: TLispValue[] = [];
    for (const [, w] of watches) out.push(createString(w.path));
    return Either.right(createList(out));
  });

  return ops;
}
