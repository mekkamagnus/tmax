/**
 * @file wiki-display.ts
 * @description SPEC-119 (#194): display-only transform that renders
 *   `[[target]]` as `target` with the link face (Obsidian-style). The BUFFER
 *   is never modified — only the rendered text, the highlight spans, and the
 *   cursor column mapping.
 *
 * Column mapping (documented per the spec): the `[[`/`]]` delimiters (and an
 * alias form's `target|` prefix) are ZERO-WIDTH in display terms — cursor
 * columns on a delimiter map onto the adjacent edge of the visible span, and
 * the visible text maps 1:1 (non-alias links: raw inner width − 4 === display
 * width, so the mapping is exactly 1:1 over the target). Cursor motion and
 * copy therefore behave predictably: every visible column has one stable
 * cursor position.
 */

import type { EditorState, HighlightSpan } from "../../core/contracts/editor.ts";
import { defaultDarkTheme } from "../../syntax/types.ts";

const WIKI_LINK_RE = /\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g;

/** The minor mode that toggles the transform (registered in T-Lisp,
 *  wiki-link-display-mode.tlisp; default ON globally, applied only to
 *  markdown buffers by `wikiDisplayActive`). */
export const WIKI_DISPLAY_MINOR = "wiki-link-display";

export function wikiDisplayActive(state: EditorState): boolean {
  return state.currentMajorMode === "markdown"
    && (state.activeMinorModes ?? []).includes(WIKI_DISPLAY_MINOR);
}

export interface WikiDisplayLine {
  /** Display text (delimiters hidden). === raw when nothing transformed. */
  text: string;
  /** Spans re-mapped into display columns (same order, empties dropped). */
  spans: HighlightSpan[];
  /** Map a raw column (0..raw.length) to a display column. */
  mapCol: (rawCol: number) => number;
  /** False when the line had no transformable wiki-link. */
  changed: boolean;
}

/** Inline-code (and code-block) spans suppress the transform — a `[[` inside
 *  backticks must render raw (spec regression criterion). Span styles are the
 *  theme entry objects themselves (resolveStyle returns them by reference),
 *  so identity comparison identifies code reliably. */
function codeRanges(rawLine: string, spans: HighlightSpan[] | undefined): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  if (spans) {
    const codeColors = new Set(
      [defaultDarkTheme.code?.fg, defaultDarkTheme["code-block"]?.fg].filter(Boolean) as string[],
    );
    for (const s of spans) {
      const isCode = s.style === defaultDarkTheme.code
        || s.style === defaultDarkTheme["code-block"]
        || (s.style.fg !== undefined && codeColors.has(s.style.fg));
      if (isCode) ranges.push([s.start, s.end]);
    }
  }
  // Textual backtick scan — REQUIRED, not a fallback: the tokenizer gives
  // wiki-link (priority 62) precedence over inline code (55), so a
  // `[[link]]` inside backticks emits a wiki-link span and NO code span.
  // Pairing backticks on the raw line protects code content regardless of
  // token priorities (and works in the spans-less cursor-offset path).
  let open = -1;
  for (let i = 0; i < rawLine.length; i++) {
    if (rawLine[i] !== "`") continue;
    if (open === -1) open = i + 1;
    else { ranges.push([open, i]); open = -1; }
  }
  return ranges;
}

/**
 * Transform one line for display. Pure: no buffer mutation, no I/O.
 */
export function transformWikiLine(rawLine: string, spans?: HighlightSpan[]): WikiDisplayLine {
  const protectedRanges = codeRanges(rawLine, spans);
  // `displayStart`/`displayEnd` are RAW columns of the visible sub-region
  // (the alias's display text, or the whole target) — needed for exact 1:1
  // cursor mapping over the visible glyphs.
  const matches: Array<{ start: number; end: number; display: string; displayStart: number; displayEnd: number }> = [];
  WIKI_LINK_RE.lastIndex = 0;
  for (let m = WIKI_LINK_RE.exec(rawLine); m !== null; m = WIKI_LINK_RE.exec(rawLine)) {
    const start = m.index;
    const end = start + m[0]!.length;
    if (protectedRanges.some(([s, e]) => start < e && end > s)) continue; // inside code
    // [[target|display]] renders the display part; [[target]] renders target.
    const display = (m[2] ?? m[1])!.trim();
    if (display.length === 0) continue; // [[ ]] / [[a| ]]: nothing to show — render raw
    // Position of the VISIBLE (trimmed) text in raw coordinates.
    const rawVisible = (m[2] ?? m[1])!;
    const lead = rawVisible.length - rawVisible.trimStart().length;
    const displayStart = (m[2] !== undefined
      ? start + 2 + m[1]!.length + 1 // skip "[[", target, "|"
      : start + 2) + lead;           // skip leading trim whitespace
    const displayEnd = displayStart + display.length;
    matches.push({ start, end, display, displayStart, displayEnd });
  }

  if (matches.length === 0) {
    return { text: rawLine, spans: spans ?? [], mapCol: (c) => c, changed: false };
  }

  let text = "";
  const colMap: number[] = []; // index = raw column, value = display column
  let prev = 0;

  for (const match of matches) {
    // Identity region before this link.
    const before = rawLine.slice(prev, match.start);
    for (let i = 0; i < before.length; i++) colMap[prev + i] = text.length + i;
    text += before;

    // Delimiters (and an alias's hidden target+pipe) are zero-width: raw
    // columns at/before the visible region clamp to the span start; columns
    // in the visible region map EXACTLY 1:1; columns after ("]]") clamp to
    // the span end.
    const L = match.display.length;
    for (let r = match.start; r < match.end; r++) {
      const d = r < match.displayStart ? 0
        : r < match.displayEnd ? r - match.displayStart
        : L;
      colMap[r] = text.length + d;
    }
    text += match.display;
    colMap[match.end] = text.length;
    prev = match.end;
  }

  // Tail: identity.
  const tail = rawLine.slice(prev);
  for (let i = 0; i < tail.length; i++) colMap[prev + i] = text.length + i;
  text += tail;
  colMap[rawLine.length] = text.length;

  // Re-map spans through the column map (identity regions unchanged, link
  // spans collapse onto the visible target, empty spans drop).
  const maxIdx = colMap.length - 1;
  const mappedSpans = (spans ?? [])
    .map((s) => ({
      ...s,
      start: colMap[Math.max(0, Math.min(s.start, maxIdx))]!,
      end: colMap[Math.max(0, Math.min(s.end, maxIdx))]!,
    }))
    .filter((s) => s.end > s.start);

  const mapCol = (c: number): number => colMap[Math.max(0, Math.min(c, maxIdx))]!;

  return { text, spans: mappedSpans, mapCol, changed: true };
}
