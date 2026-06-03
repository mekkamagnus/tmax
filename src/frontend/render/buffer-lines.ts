import type { EditorState, HighlightSpan } from "../../core/types.ts";
import { Either } from "../../utils/task-either.ts";
import { style, type AnsiColor } from "../frontends/steep/style.ts";

function getLineCount(state: EditorState): number {
  const result = state.currentBuffer?.getLineCount();
  return result && Either.isRight(result) ? result.right : 0;
}

function getLine(state: EditorState, lineNumber: number): string {
  const result = state.currentBuffer?.getLine(lineNumber);
  return result && Either.isRight(result) ? result.right : "";
}

function fitToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text.padEnd(width, " ");
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

export function getVisibleViewportTop(state: EditorState, height: number): number {
  const visibleLines = Math.max(1, height);
  const viewportTop = Math.max(0, state.viewportTop);

  if (state.cursorPosition.line < viewportTop) {
    return Math.max(0, state.cursorPosition.line);
  }

  if (state.cursorPosition.line >= viewportTop + visibleLines) {
    return Math.max(0, state.cursorPosition.line - visibleLines + 1);
  }

  return viewportTop;
}

/**
 * Apply highlight spans to a raw line string, returning a string with ANSI escapes.
 * Spans are applied by splitting the line into segments: unstyled gaps between styled spans.
 */
function applyHighlights(rawLine: string, spans: HighlightSpan[]): string {
  if (spans.length === 0) return rawLine;

  // Sort spans by start position
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let pos = 0;

  for (const span of sorted) {
    const start = Math.max(span.start, pos);
    const end = Math.min(span.end, rawLine.length);
    if (start >= end) continue;

    // Unstyled gap before this span
    if (pos < start) {
      parts.push(rawLine.slice(pos, start));
    }

    // Styled segment
    const segment = rawLine.slice(start, end);
    const opts: { fg?: AnsiColor; bg?: AnsiColor; bold?: boolean } = {};
    if (span.style.fg) opts.fg = span.style.fg as AnsiColor;
    if (span.style.bg) opts.bg = span.style.bg as AnsiColor;
    if (span.style.bold) opts.bold = true;
    parts.push(style(segment, opts));

    pos = end;
  }

  // Trailing unstyled portion
  if (pos < rawLine.length) {
    parts.push(rawLine.slice(pos));
  }

  return parts.join("");
}

/**
 * Clamp spans to [0, maxWidth) and merge overlapping spans
 */
function clampSpans(spans: HighlightSpan[], maxWidth: number): HighlightSpan[] {
  return spans
    .map(span => ({
      ...span,
      start: Math.max(0, span.start),
      end: Math.min(span.end, maxWidth),
    }))
    .filter(span => span.start < span.end);
}

/**
 * Pad an ANSI-escaped string to a visible width.
 * Accounts for escape sequences so padding is based on visible character count.
 */
function padAnsiToWidth(text: string, width: number): string {
  // Strip ANSI to measure visible length
  const visible = text.replace(/\x1b\[[0-9;]*m/g, "");
  if (visible.length >= width) return text;
  return text + " ".repeat(width - visible.length);
}

export function renderBufferLines(
  state: EditorState,
  width: number,
  height: number,
  highlightSpans?: HighlightSpan[][]
): string[] {
  const visibleLines = Math.max(1, height);
  const viewportTop = getVisibleViewportTop(state, visibleLines);
  const totalLines = getLineCount(state);
  const lines: string[] = [];

  if (totalLines === 0) {
    const emptyLine = fitToWidth("(empty buffer)", width);
    lines.push(style(emptyLine, { fg: "gray" }));
    for (let i = 1; i < visibleLines; i++) {
      lines.push(fitToWidth("~", width));
    }
    return lines;
  }

  for (let i = 0; i < visibleLines; i++) {
    const lineNumber = viewportTop + i;

    if (lineNumber >= totalLines) {
      lines.push(fitToWidth("~", width));
      continue;
    }

    const rawLine = getLine(state, lineNumber);

    // Apply syntax highlights if available for this line
    const lineSpans = highlightSpans?.[lineNumber];
    if (lineSpans && lineSpans.length > 0) {
      // Clamp spans to line width, then apply highlights to raw line,
      // then pad to width (no truncation needed — spans are already clamped).
      // If the line is longer than width, truncate the raw line first.
      const truncated = rawLine.length > width
        ? (width > 3 ? rawLine.slice(0, width - 3) + "..." : rawLine.slice(0, width))
        : rawLine;
      const clamped = clampSpans(lineSpans, truncated.length);
      const highlighted = applyHighlights(truncated, clamped);
      const padded = padAnsiToWidth(highlighted, width);
      lines.push(
        lineNumber === state.cursorPosition.line
          ? style(padded, { fg: "black", bg: "white" })
          : padded,
      );
    } else {
      const lineContent = fitToWidth(rawLine, width);
      lines.push(
        lineNumber === state.cursorPosition.line
          ? style(lineContent, { fg: "black", bg: "white" })
          : lineContent,
      );
    }
  }

  return lines;
}
