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
      // #329 valve r3: ATOMIC SAVES (write-temp + rename) swap the
      // inode — fs.watch keeps following the OLD one and later
      // changes go silent. On a rename event the watcher is
      // RE-ESTABLISHED on the same path (self-referencing closure
      // through the table entry).
      const idHolder = { value: -1 };
      const emit = (_eventType: string): void => {
        // The event payload: the WATCHED path (fs.watch's filename is
        // basename-only/unreliable — the registered path is the
        // stable identity) + the fs event word.
        // #224's boundary rule: the path crosses as HEX (the reader
        // strips backslash escapes in literals).
        const hex = Buffer.from(path, "utf8").toString("hex");
        const expr = `(${callback} (hex-decode "${hex}") "${_eventType}")`;
        try {
          const result = evalTlisp(expr);
          // Production evalTlisp returns Either — a T-Lisp error is
          // a LEFT, not a throw (gate r1: the catch alone never fired;
          // gate r2: the old result.type check was DEAD CODE — the
          // utils Either's shape is {_tag:'Left'}).
          if (Either.isLeft(result as ReturnType<typeof Either.left>) as boolean) {
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
      };
      const establish = (): { close: () => void } => {
        const w = watch(path, {}, (ev: string, _filename: string | null) => {
          if (ev === "rename") {
            // Re-establish: the old watcher is exhausted after the
            // rename; a fresh one follows the new inode. The event
            // still fires so the T-Lisp side can react.
            try { w.close(); } catch { /* gone */ }
            try {
              const fresh = establish();
              const entry = watches.get(idHolder.value);
              if (entry) entry.stop = () => fresh.close();
            } catch { /* path gone — the old behavior */ }
          }
          emit(ev);
        });
        return w;
      };
      const watcher = establish();
      const id = nextWatchId++;
      watches.set(id, { stop: () => watcher.close(), path, callback });
      // The rename branch needs the id to update the entry — bind it
      // via a mutable holder the closure reads.
      idHolder.value = id;
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
