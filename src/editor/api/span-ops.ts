/**
 * @file span-ops.ts
 * @description #296 — the persistent span/overlay API: `span-make` /
 *   `span-remove`.
 *
 * Marks buffer regions with PERSISTENT face spans (unlike #231's
 * transient flash-region: no TTL — the consumer owns the lifetime).
 * The registry lives in this closure (per-editor, the flash-ops
 * precedent); the MERGED per-line grid + the buffer's shape identity
 * are written to EditorState via SetBufferSpans so every
 * capture-frame consumer renders it — and captureFrame re-probes the
 * identity, SKIPPING a stale grid (SPEC-289's conservative v1: any
 * mutation path invalidates, no edit hooks; consumers re-apply).
 *
 * Coordinates: 0-based line/column, END-EXCLUSIVE (#232) — the same
 * convention as cursor-line/cursor-column and the buffer API.
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { createValidationError, type AppError } from "../../error/types.ts";
import type { HighlightSpan } from "../../core/contracts/editor.ts";
import type { Msg } from "../functional/messages.ts";

/** Named faces → ANSIStyle (v1: a small fixed table — spans are a
 * programmatic surface, not user theming). */
const FACES: Record<string, { fg?: string; bg?: string; bold?: boolean; underline?: boolean; dim?: boolean }> = {
  blame: { bg: "#3a3226" },
  region: { bg: "#264f78" },
  match: { bg: "#5a3a5a" },
  highlight: { bg: "#665c26" },
  dim: { dim: true },
};

interface SpanRecord {
  id: number;
  buffer: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  style: HighlightSpan["style"];
  /** The buffer object at registration (kill+recreate detection). */
  token: unknown;
}

/** The buffer shape a merged grid was built against (the lazy
 * invalidation identity — captureFrame re-probes and skips on
 * mismatch). */
export interface BufferShape {
  lineCount: number;
  /** A cheap whole-text checksum (gate r1: shape-only identity let
   * same-length substitutions escape — SPEC-289 says text CHANGE
   * invalidates). */
  checksum: number;
  /** The buffer OBJECT (identity): a killed-and-recreated buffer is
   * a different token — its stale records drop (gate r1). */
  token: unknown;
}

/** Span-end sentinel for "to end of line" (clamped at render — the
 * flash-ops precedent). */
const TO_EOL = 1_000_000;

export function createSpanOps(
  write: (msg: Msg) => void,
  probeShape: (bufferName: string) => BufferShape | undefined,
): Map<string, TLispFunctionImpl> {
  let nextId = 1;
  const records = new Map<number, SpanRecord>();
  const api = new Map<string, TLispFunctionImpl>();

  /** Rebuild + publish the merged grid for one buffer (registration
   * order; later-registered spans render later → win per cell).
   * Records whose buffer is GONE (or replaced — token mismatch)
   * drop first (gate r1: the kill-cleanup contract). */
  const publish = (buffer: string): void => {
    const shapes = new Map<string, ReturnType<typeof probeShape>>();
    for (const r of [...records.values()]) {
      if (!shapes.has(r.buffer)) shapes.set(r.buffer, probeShape(r.buffer));
      const live = shapes.get(r.buffer);
      const recToken = r.token;
      if (!live || live.token !== recToken) records.delete(r.id);
    }
    const perLine = new Map<number, HighlightSpan[]>();
    let maxLine = -1;
    for (const r of records.values()) {
      if (r.buffer !== buffer) continue;
      for (let line = r.startLine; line <= r.endLine && line >= 0; line++) {
        const start = line === r.startLine ? r.startCol : 0;
        const end = line === r.endLine ? r.endCol : TO_EOL;
        if (end <= start) continue;
        const list = perLine.get(line) ?? [];
        list.push({ start, end, style: r.style });
        perLine.set(line, list);
        if (line > maxLine) maxLine = line;
      }
    }
    const shape = probeShape(buffer);
    if (maxLine < 0 || !shape) {
      write({ type: "SetBufferSpans", buffer, spans: undefined, shape: undefined });
      return;
    }
    const spans: HighlightSpan[][] = [];
    for (let line = 0; line <= maxLine; line++) spans.push(perLine.get(line) ?? []);
    write({ type: "SetBufferSpans", buffer, spans, shape });
  };

  api.set("span-make", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 6) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        "span-make requires 6 arguments: buffer-name start-line start-col end-line end-col face",
        "args", args.length, "6 arguments",
      ));
    }
    const [bufArg, slArg, scArg, elArg, ecArg, faceArg] = args;
    if (bufArg?.type !== "string") return argType("span-make", "buffer-name", 0, "string", bufArg);
    if (faceArg?.type !== "string") return argType("span-make", "face", 5, "string", faceArg);
    const nums = [slArg, scArg, elArg, ecArg];
    const names = ["start-line", "start-col", "end-line", "end-col"];
    for (let i = 0; i < nums.length; i++) {
      if (nums[i]?.type !== "number") return argType("span-make", names[i]!, i + 1, "number", nums[i]);
    }
    const face = FACES[faceArg.value as string];
    if (!face) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        `span-make: unknown face '${String(faceArg.value)}' (known: ${Object.keys(FACES).join(", ")})`,
        "face", faceArg.value, Object.keys(FACES).join(" | "),
      ));
    }
    const sl = slArg!.value as number, sc = scArg!.value as number;
    const el = elArg!.value as number, ec = ecArg!.value as number;
    if (sl < 0 || sc < 0 || el < 0 || ec < 0) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        "span-make: negative coordinates are invalid",
        "range", `[${sl},${sc})..[${el},${ec})`, "non-negative",
      ));
    }
    if (el < sl || (el === sl && ec <= sc)) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        "span-make: end must be after start (end-exclusive coordinates)",
        "range", `[${sl},${sc})..[${el},${ec})`, "end > start",
      ));
    }
    const shapeNow = probeShape(bufArg.value as string);
    if (shapeNow && el > shapeNow.lineCount - 1) {
      // Clamp the end LINE to the buffer (gate r2: an unclamped
      // 999999 materialized a million-entry grid).
      return Either.left(createValidationError(
        "ConstraintViolation",
        `span-make: end-line ${el} is beyond the buffer (${shapeNow.lineCount} lines)`,
        "end-line", el, `< ${shapeNow.lineCount}`,
      ));
    }
    if (!shapeNow) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        `span-make: no such buffer '${String(bufArg.value)}'`,
        "buffer-name", bufArg.value, "an existing buffer",
      ));
    }
    const id = nextId++;
    records.set(id, { id, buffer: bufArg.value as string, startLine: sl, startCol: sc, endLine: el, endCol: ec, style: { ...face }, token: shapeNow.token });
    publish(bufArg.value as string);
    return Either.right(createNumber(id));
  });

  api.set("span-remove", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1 || args[0]?.type !== "number") {
      return Either.left(createValidationError(
        "ConstraintViolation",
        "span-remove requires 1 argument: the span id returned by span-make",
        "args", args.length, "1 number",
      ));
    }
    const rec = records.get(args[0].value as number);
    if (rec) {
      records.delete(rec.id);
      publish(rec.buffer);
    }
    return Either.right(createNil());
  });

  function argType(fn: string, name: string, pos: number, want: string, got: TLispValue | undefined): Either<AppError, TLispValue> {
    return Either.left(createValidationError(
      "ConstraintViolation",
      `${fn}: ${name} (arg ${pos}) must be a ${want}`,
      name, got?.type ?? "nil", want,
    ));
  }

  return api;
}
