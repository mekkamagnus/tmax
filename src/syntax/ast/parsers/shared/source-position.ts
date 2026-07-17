/**
 * @file source-position.ts
 * @description CHORE-44 Change 11 AC11.4 — shared offset↔(line,column) mechanics
 * for the native recursive-descent parsers (C, Go, Python, TypeScript).
 *
 * Each language parser was carrying its own copy of "build a line-offset map then
 * binary-search it to convert a byte offset into a `{line, column, offset}`".
 * This module is that mechanic, extracted verbatim. It does NOT introduce a
 * grammar abstraction, a token contract, or a parser framework — it is a
 * pure position-arithmetic helper (AC11.6).
 *
 * Behavior preserved byte-for-byte from the prior per-parser copies:
 *   - `buildLineMap("")` → `[0]`
 *   - line indexing is 0-based; `column` is bytes (not codepoints) from the
 *     last newline, matching the original c-parser/typescript-parser impls.
 *   - `positionAt(off, map)` binary-searchs for the greatest line-start
 *     `<= off`, exactly as the original helpers did.
 */
import type { SourcePosition, SourceSpan } from "../../../../tlisp/source.ts";

/**
 * Build the line-start offset map used by `positionAt`. Index `i` holds the
 * byte offset of the first character on line `i` (line 0 starts at offset 0;
 * each subsequent entry is the offset just past a `\n`).
 */
export function buildLineMap(source: string): number[] {
  const map = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") map.push(i + 1);
  }
  return map;
}

/**
 * Convert a byte offset into a `SourcePosition` using a precomputed line map.
 * Binary search finds the largest line-start `<= offset`. Returns the same
 * shape every prior parser produced: `{ line, column, offset }`.
 */
export function positionAt(offset: number, lineMap: number[]): SourcePosition {
  let lo = 0;
  let hi = lineMap.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineMap[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, column: offset - lineMap[lo]!, offset };
}

/**
 * Build a `SourceSpan` from two byte offsets. Mirrors the prior `span`/`spanFrom`
 * helpers byte-for-byte.
 */
export function spanFrom(startOffset: number, endOffset: number, lineMap: number[]): SourceSpan {
  return {
    start: positionAt(startOffset, lineMap),
    end: positionAt(endOffset, lineMap),
  };
}

/**
 * A zero-length span anchored at `offset`. Used by every parser for empty /
 * synthetic nodes (e.g. missing tokens, inserted trivia).
 */
export function emptySpanAt(offset: number, lineMap: number[]): SourceSpan {
  return {
    start: positionAt(offset, lineMap),
    end: positionAt(offset, lineMap),
  };
}
