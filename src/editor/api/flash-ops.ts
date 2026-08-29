/**
 * @file flash-ops.ts
 * @description #231 — vim-goggles flash feedback: the `flash-region` primitive.
 *
 * Marks a buffer region with transient inverse-ish highlight spans
 * (EditorState.flashSpans) and clears them after a TTL via a TypeScript
 * timer — the which-key-state precedent. T-Lisp timer primitives are
 * architecturally off-limits, so the TTL lives here; T-Lisp owns the
 * when/where decisions (operator and binding call sites).
 *
 * The TTL defaults to 300 ms because the TUI client polls at 200 ms — a
 * shorter flash can fall between polls and never render. The optional 5th
 * argument overrides the TTL (tests inject short values).
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { createValidationError, type AppError } from "../../error/types.ts";
import type { HighlightSpan } from "../../core/contracts/editor.ts";
import type { Msg } from "../functional/messages.ts";

/** Default flash lifetime — comfortably above the TUI client's 200 ms poll. */
export const FLASH_TTL_MS = 300;

/** Subtle, terminal-agnostic flash style: a neutral gray block. */
const FLASH_STYLE = { bg: "#555555" };

/** Span-end sentinel for "to end of line" (clamped at render). */
const TO_EOL = 1_000_000;

export function createFlashOps(write: (msg: Msg) => void): Map<string, TLispFunctionImpl> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const api = new Map<string, TLispFunctionImpl>();

  // (flash-region START-LINE START-COL END-LINE END-COL [TTL-MS])
  api.set("flash-region", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 4 || args.length > 5) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'flash-region requires 4 or 5 arguments: start-line start-col end-line end-col [ttl-ms]',
        'args',
        args.length,
        '4 or 5 arguments',
      ));
    }
    for (let i = 0; i < args.length; i++) {
      if (args[i]?.type !== "number") {
        return Either.left(createValidationError(
          'ConstraintViolation',
          `flash-region argument ${i} must be a number`,
          'args',
          args[i]?.type,
          'number',
        ));
      }
    }
    const sl = args[0]!.value as number;
    const sc = args[1]!.value as number;
    const el = args[2]!.value as number;
    const ec = args[3]!.value as number;
    const ttl = args.length === 5 ? Math.max(0, args[4]!.value as number) : FLASH_TTL_MS;

    const top = Math.min(sl, el);
    const bottom = Math.max(sl, el);
    const left = Math.min(sc, ec);
    const right = Math.max(sc, ec);

    // One span per line: the region's column slice on that line. The array
    // is indexed ABSOLUTELY by buffer line (consumers do
    // `flashSpans[lineNumber]`), so pad [0, top) with empty entries — a
    // dense-from-top array would flash the wrong line (verify-gate BUG A).
    const spans: HighlightSpan[][] = [];
    for (let i = 0; i < top; i++) spans.push([]);
    for (let line = top; line <= bottom; line++) {
      const start = line === top ? left : 0;
      const end = line === bottom ? Math.max(right + 1, start) : TO_EOL;
      spans.push([{ start, end, style: { ...FLASH_STYLE } }]);
    }

    // A new flash supersedes an in-flight one (single timer, which-key style).
    if (timer !== null) clearTimeout(timer);
    write({ type: "SetFlashSpans", spans });
    timer = setTimeout(() => {
      timer = null;
      write({ type: "SetFlashSpans", spans: undefined });
    }, ttl);

    return Either.right(createNil());
  });

  return api;
}
