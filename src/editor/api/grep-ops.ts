/**
 * @file grep-ops.ts
 * @description #308 — the rg search backend's TS primitives:
 *   `rg-event->hit` (one rg --json event → the structured hit + a
 *   diagnostic flag) and `exec-lookup` (Bun.which; no shell).
 *
 * RFC-031 §2.2's output protocol, implemented as PURE functions:
 * the column is a UTF-8 CODE-POINT count +1 (1-based editor
 * columns); base64 `bytes` fields decode with undecodable PATHS
 * excluded (flagged) and undecodable LINES degraded (the hit still
 * appends — the file is openable); malformed JSON flags + counts.
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createList, createString, createNumber, createBoolean, createNil, createHashmap } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { createValidationError, type AppError } from "../../error/types.ts";

const str = createString;
const num = createNumber;
const bool = createBoolean;
const nilv = createNil;

/** A T-Lisp hashmap from string keys (T-Lisp side reads alists via
 *  hashmap-get on the JSON-decoded shape — we return an ALIST whose
 *  keys the reader handles: pairs of [key, value]). */
function result(hit: TLispValue | null, flag: string | null): TLispValue {
  return createHashmap([
    ["hit", hit ?? createNil()],
    ["flag", flag ? str(flag) : createNil()],
  ]) as unknown as TLispValue;
}

function decodeBase64Utf8(b64: string): { ok: true; text: string } | { ok: false } {
  try {
    const buf = Buffer.from(b64, "base64");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return { ok: true, text };
  } catch {
    return { ok: false };
  }
}

function replacementCharDecode(b64: string): string {
  // Non-fatal decode: invalid sequences become U+FFFD.
  const buf = Buffer.from(b64, "base64");
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

/** UTF-8 code-point column +1 (editor columns are 1-based). An
 *  offset is INVALID (col 1 + degraded) when non-integer, out of
 *  range, or landing INSIDE a multi-byte sequence (a continuation
 *  byte at the boundary — the subarray cut would decode a partial
 *  char as one column). */
function columnOf(lineText: string, byteOffset: number): { col: number; valid: boolean } {
  const bytes = Buffer.from(lineText, "utf-8");
  if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset > bytes.length) {
    return { col: 1, valid: false };
  }
  if (byteOffset < bytes.length && (bytes[byteOffset]! & 0xc0) === 0x80) {
    return { col: 1, valid: false };
  }
  const slice = bytes.subarray(0, byteOffset).toString("utf-8");
  return { col: Array.from(slice).length + 1, valid: true };
}

/** The event fields (rg --json): data.path.{text,bytes},
 *  data.lines.{text,bytes}, data.submatches[{start,end,text?}],
 *  data.offset? — plus the top-level type. */
function getField(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function createGrepOps(): Map<string, TLispFunctionImpl> {
  const ops = new Map<string, TLispFunctionImpl>();

  // (rg-event->hit <json-line>) → alist (("hit" . <hit-alist|nil>)
  //                                    ("flag" . <nil|symbol-string>))
  ops.set("rg-event->hit", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1 || args[0]!.type !== "string") {
      return Either.left(createValidationError(
        "ConstraintViolation",
        "rg-event->hit requires 1 argument: the rg --json event line",
        "args", args.length, "1 string",
      ));
    }
    const line = args[0]!.value as string;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return Either.right(result(null, "malformed") as unknown as TLispValue);
    }
    const type = getField(ev, "type");
    if (type !== "match") {
      return Either.right(result(null, null) as unknown as TLispValue);
    }
    // The path: text or base64 bytes (undecodable → EXCLUDED).
    const pathText = getField(ev, "data.path.text");
    const pathBytes = getField(ev, "data.path.bytes");
    let path: string | null = null;
    if (typeof pathText === "string") {
      path = pathText;
    } else if (typeof pathBytes === "string") {
      const d = decodeBase64Utf8(pathBytes);
      if (!d.ok) {
        return Either.right(result(null, "undecodable-path") as unknown as TLispValue);
      }
      path = d.text;
    } else {
      return Either.right(result(null, "malformed") as unknown as TLispValue);
    }
    // The line text: text or base64 bytes (undecodable → degraded).
    const linesText = getField(ev, "data.lines.text");
    const linesBytes = getField(ev, "data.lines.bytes");
    let text: string;
    let degraded = false;
    if (typeof linesText === "string") {
      text = linesText;
    } else if (typeof linesBytes === "string") {
      const d = decodeBase64Utf8(linesBytes);
      if (d.ok) {
        text = d.text;
      } else {
        text = replacementCharDecode(linesBytes);
        degraded = true;
      }
    } else {
      return Either.right(result(null, "malformed") as unknown as TLispValue);
    }
    // The line number (rg data.line_number is 1-based already).
    const lineNumber = getField(ev, "data.line_number");
    const line1 = typeof lineNumber === "number" && Number.isInteger(lineNumber) && lineNumber >= 1
      ? lineNumber
      : 1;
    // The column: the FIRST submatch's byte start (code points +1);
    // empty/absent submatches or an invalid offset → column 1
    // (invalid ⇒ degraded).
    const submatches = getField(ev, "data.submatches");
    let col = 1;
    if (Array.isArray(submatches) && submatches.length > 0) {
      const start = getField(submatches[0] as Record<string, unknown>, "start");
      if (typeof start === "number") {
        const c = columnOf(text, start);
        col = c.col;
        if (!c.valid) degraded = true;
      } else {
        // A nonnumeric start (string/null/absent) IS an invalid
        // offset — col 1 + degraded-text (valve r3: it used to pass
        // through unflagged).
        degraded = true;
      }
    }
    const hit = createHashmap([
      ["file", str(path)],
      ["line", num(line1)],
      ["col", num(col)],
      ["text", str(text.replace(/\n$/, ""))],
    ]);
    return Either.right(result(hit as unknown as TLispValue, degraded ? "degraded-text" : null));
  });

  // (exec-lookup <name>) → t | nil (Bun.which; no shell).
  ops.set("exec-lookup", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1 || args[0]!.type !== "string") {
      return Either.left(createValidationError(
        "ConstraintViolation",
        "exec-lookup requires 1 argument: the executable name",
        "args", args.length, "1 string",
      ));
    }
    const found = typeof Bun.which(args[0]!.value as string) === "string";
    return Either.right(bool(found));
  });

  return ops;
}
