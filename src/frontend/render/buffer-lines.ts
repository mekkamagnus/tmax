import type { EditorState, FoldState, HighlightSpan, Window } from "../../core/contracts/editor.ts";
import { Either } from "../../utils/task-either.ts";
import { style, type AnsiColor } from "../../steep/matcha.ts";
import {
  renderGutterLine,
  renderEmptyGutter,
  gutterDisplayWidth,
  gutterConfigFromState,
  type GutterConfig,
} from "./gutter.ts";
import { computeLayout, renderSeparators, type WindowCell } from "./window-layout.ts";

function getLineCount(state: EditorState): number {
  const result = state.currentBuffer?.getLineCount();
  return result && Either.isRight(result) ? result.right : 0;
}

function getLineCountForBuffer(buffer: Window["buffer"]): number {
  const result = buffer.getLineCount();
  return result && Either.isRight(result) ? result.right : 0;
}

function getLine(state: EditorState, lineNumber: number): string {
  const result = state.currentBuffer?.getLine(lineNumber);
  return result && Either.isRight(result) ? result.right : "";
}

function getLineForBuffer(buffer: Window["buffer"], lineNumber: number): string {
  const result = buffer.getLine(lineNumber);
  return result && Either.isRight(result) ? result.right : "";
}

function charWidth(ch: string): number {
  return ch.charCodeAt(0) > 127 ? 2 : 1;
}

function stringWidth(str: string): number {
  let w = 0;
  for (const ch of str) w += charWidth(ch);
  return w;
}

function sliceToVisualWidth(text: string, maxCols: number): string {
  let cols = 0;
  let i = 0;
  for (const ch of text) {
    const cw = charWidth(ch);
    if (cols + cw > maxCols) break;
    cols += cw;
    i += ch.length;
  }
  return text.slice(0, i);
}

function fitToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  const sw = stringWidth(text);
  if (sw <= width) return text + " ".repeat(width - sw);
  if (width <= 3) return sliceToVisualWidth(text, width);
  return sliceToVisualWidth(text, width - 3) + "...";
}

function sliceFromVisualOffset(text: string, offset: number): string {
  let cols = 0;
  let i = 0;
  while (i < text.length) {
    if (cols >= offset) break;
    const cw = charWidth(text[i]!);
    if (cols + cw > offset) break;
    cols += cw;
    i += text[i]!.length;
  }
  return text.slice(i);
}

function fitToWidthWithScroll(rawLine: string, cw: number, viewportLeft: number): { content: string; continuesRight: boolean } {
  if (viewportLeft <= 0) {
    const truncated = fitToWidth(rawLine, cw);
    const continues = stringWidth(rawLine) > cw;
    return { content: truncated, continuesRight: continues };
  }

  const sliced = sliceFromVisualOffset(rawLine, viewportLeft);
  const sw = stringWidth(sliced);
  const continuesLeft = true;
  const continuesRight = sw > cw - 1;

  let displayContent: string;
  if (sw <= cw - 1) {
    displayContent = sliced + " ".repeat(cw - 1 - sw);
  } else {
    displayContent = sliceToVisualWidth(sliced, cw - 1);
  }

  return { content: "\u00AB" + displayContent, continuesRight };
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

export function getVisibleViewportLeft(state: EditorState, contentWidth: number): number {
  const cursorColumn = state.cursorPosition.column;
  const viewportLeft = state.viewportLeft ?? 0;

  if (cursorColumn < viewportLeft) {
    return Math.max(0, cursorColumn);
  }

  if (cursorColumn >= viewportLeft + contentWidth) {
    return Math.max(0, cursorColumn - contentWidth + 1);
  }

  return viewportLeft;
}

export function getCursorScreenOffset(state: EditorState, bufferHeight: number, contentWidth: number): { row: number; col: number } {
  const viewportTop = getVisibleViewportTop(state, bufferHeight);
  const viewportLeft = getVisibleViewportLeft(state, contentWidth);
  const row = Math.max(0, Math.min(bufferHeight - 1, state.cursorPosition.line - viewportTop));
  const col = Math.max(0, state.cursorPosition.column - viewportLeft);
  return { row, col };
}

function applyHighlights(rawLine: string, spans: HighlightSpan[]): string {
  if (spans.length === 0) return rawLine;

  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let pos = 0;

  for (const span of sorted) {
    const start = Math.max(span.start, pos);
    const end = Math.min(span.end, rawLine.length);
    if (start >= end) continue;

    if (pos < start) {
      parts.push(rawLine.slice(pos, start));
    }

    const segment = rawLine.slice(start, end);
    const opts: { fg?: AnsiColor; bg?: AnsiColor; bold?: boolean; dim?: boolean } = {};
    if (span.style.fg) opts.fg = span.style.fg as AnsiColor;
    if (span.style.bg) opts.bg = span.style.bg as AnsiColor;
    if (span.style.bold) opts.bold = true;
    if (span.style.dim) opts.dim = true;
    parts.push(style(segment, opts));

    pos = end;
  }

  if (pos < rawLine.length) {
    parts.push(rawLine.slice(pos));
  }

  return parts.join("");
}

function clampSpans(spans: HighlightSpan[], maxWidth: number): HighlightSpan[] {
  return spans
    .map(span => ({
      ...span,
      start: Math.max(0, span.start),
      end: Math.min(span.end, maxWidth),
    }))
    .filter(span => span.start < span.end);
}

function padAnsiToWidth(text: string, width: number): string {
  const visible = text.replace(/\x1b\[[0-9;]*m/g, "");
  const sw = stringWidth(visible);
  if (sw >= width) return text;
  return text + " ".repeat(width - sw);
}

function isMarkdownHeading(line: string): boolean {
  let count = 0;
  for (let i = 0; i < 7 && i < line.length; i++) {
    if (line[i] === "#") count++;
    else break;
  }
  return count >= 1 && count <= 6 && line[count] === " ";
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function renderWithBlockCursor(text: string, cursorCol: number): string {
  if (cursorCol < 0) return text;
  if (cursorCol >= stringWidth(text)) {
    return text + style(" ", { fg: "black", bg: "white" });
  }
  let visiblePos = 0;
  let i = 0;
  while (i < text.length) {
    if (visiblePos === cursorCol) break;
    visiblePos += charWidth(text[i]!);
    i++;
  }
  const before = text.slice(0, i);
  const ch = text[i]!;
  const after = text.slice(i + 1);
  return before + style(ch, { fg: "black", bg: "white" }) + after;
}

function renderWithBlockCursorAnsi(text: string, cursorCol: number): string {
  if (cursorCol < 0) return text;
  const stripped = text.replace(ANSI_RE, "");
  if (cursorCol >= stringWidth(stripped)) {
    return text + style(" ", { fg: "black", bg: "white" });
  }
  // Walk through text tracking visual column position
  let visiblePos = 0;
  let i = 0;
  let splitPoint = 0;
  while (i < text.length) {
    if (text[i] === "\x1b") {
      const end = text.indexOf("m", i);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (visiblePos === cursorCol) {
      splitPoint = i;
      break;
    }
    visiblePos += charWidth(text[i]!);
    i++;
  }
  if (visiblePos < cursorCol) {
    return text + style(" ", { fg: "black", bg: "white" });
  }
  const before = text.slice(0, splitPoint);
  const ch = text[splitPoint]!;
  const after = text.slice(splitPoint + 1);
  return before + style(ch, { fg: "black", bg: "white" }) + after;
}

function renderSingleWindow(
  buffer: Window["buffer"],
  cursorLine: number,
  cursorColumn: number,
  totalLines: number,
  viewportTop: number,
  viewportLeft: number,
  contentWidth: number,
  visibleLines: number,
  gutterCfg: GutterConfig,
  isFocused: boolean,
  highlightSpans?: HighlightSpan[][],
  foldRanges?: Map<number, number>,
): string[] {
  const gw = gutterDisplayWidth(totalLines, gutterCfg);
  const cw = Math.max(1, contentWidth - gw);
  const lines: string[] = [];

  if (totalLines === 0) {
    const emptyLine = fitToWidth("(empty buffer)", cw);
    const gutter = renderEmptyGutter(0, gutterCfg);
    lines.push(gutter + style(emptyLine, { fg: "gray" }));
    for (let i = 1; i < visibleLines; i++) {
      lines.push(renderEmptyGutter(0, gutterCfg) + fitToWidth("~", cw));
    }
    return lines;
  }

  // Build hidden-line set once before the render loop (Task 4a)
  const hiddenLines = new Set<number>();
  if (foldRanges) {
    for (const [foldStart, foldEnd] of foldRanges) {
      for (let ln = foldStart + 1; ln <= foldEnd; ln++) {
        hiddenLines.add(ln);
      }
    }
  }

  for (let i = 0; i < visibleLines; i++) {
    const lineNumber = viewportTop + i;

    if (lineNumber >= totalLines) {
      lines.push(renderEmptyGutter(totalLines, gutterCfg) + fitToWidth("~", cw));
      continue;
    }

    // O(1) fold check using pre-built set
    if (hiddenLines.has(lineNumber)) continue;

    const isCurrentLine = isFocused && lineNumber === cursorLine;
    const rawLine = getLineForBuffer(buffer, lineNumber);

    // Check if this line is the start of a fold
    const foldEnd = foldRanges?.get(lineNumber);
    if (foldEnd !== undefined) {
      const hiddenCount = foldEnd - lineNumber;
      const gutter = renderGutterLine(lineNumber, cursorLine, totalLines, gutterCfg, isCurrentLine, "collapsed");
      const foldIndicator = `... [${hiddenCount} lines]`;
      const padded = fitToWidth(foldIndicator, cw);
      lines.push(gutter + style(padded, { dim: true }));
      continue;
    }

    // Check if this heading line is expandable (manual check, no regex)
    const isHeading = isMarkdownHeading(rawLine);
    const foldState: FoldState | undefined = isHeading && foldRanges ? "expandable" : undefined;

    const gutter = renderGutterLine(lineNumber, cursorLine, totalLines, gutterCfg, isCurrentLine, foldState);

    const effectiveCursorCol = isCurrentLine ? Math.max(0, cursorColumn - viewportLeft) : -1;

    const lineSpans = highlightSpans?.[lineNumber];
    if (lineSpans && lineSpans.length > 0) {
      if (viewportLeft > 0) {
        const sliced = sliceFromVisualOffset(rawLine, viewportLeft);
        const sw = stringWidth(sliced);
        const continuesRight = sw > cw - 1;
        const truncated = continuesRight
          ? sliceToVisualWidth(sliced, cw - 2) + "\u00BB"
          : (sw <= cw - 1 ? sliced + " ".repeat(cw - 1 - sw) : sliceToVisualWidth(sliced, cw - 1));
        const display = "\u00AB" + truncated;
        const clamped = clampSpans(lineSpans, rawLine.length);
        const offset = viewportLeft;
        const shifted = clamped
          .map(s => ({ ...s, start: s.start - offset, end: s.end - offset }))
          .filter(s => s.end > 0 && s.start < display.length)
          .map(s => ({ ...s, start: Math.max(0, s.start), end: Math.min(s.end, display.length) }));
        const highlighted = applyHighlights(display, shifted);
        const padded = padAnsiToWidth(highlighted, cw);
        const rendered = isCurrentLine ? renderWithBlockCursorAnsi(padded, effectiveCursorCol) : padded;
        lines.push(gutter + rendered);
      } else {
        const truncated = stringWidth(rawLine) > cw
          ? (cw > 3 ? sliceToVisualWidth(rawLine, cw - 3) + "..." : sliceToVisualWidth(rawLine, cw))
          : rawLine;
        const clamped = clampSpans(lineSpans, truncated.length);
        const highlighted = applyHighlights(truncated, clamped);
        const padded = padAnsiToWidth(highlighted, cw);
        const rendered = isCurrentLine ? renderWithBlockCursorAnsi(padded, effectiveCursorCol) : padded;
        lines.push(gutter + rendered);
      }
    } else {
      if (viewportLeft > 0) {
        const sliced = sliceFromVisualOffset(rawLine, viewportLeft);
        const sw = stringWidth(sliced);
        const continuesRight = sw > cw - 1;
        let display: string;
        if (continuesRight) {
          display = "\u00AB" + sliceToVisualWidth(sliced, cw - 2) + "\u00BB";
        } else {
          display = fitToWidth("\u00AB" + sliced, cw);
        }
        const rendered = isCurrentLine ? renderWithBlockCursor(display, effectiveCursorCol) : display;
        lines.push(gutter + rendered);
      } else {
        const lineContent = fitToWidth(rawLine, cw);
        const rendered = isCurrentLine ? renderWithBlockCursor(lineContent, effectiveCursorCol) : lineContent;
        lines.push(gutter + rendered);
      }
    }
  }

  return lines;
}

function wrapLine(rawLine: string, width: number): string[] {
  if (width <= 0) return [""];
  if (stringWidth(rawLine) <= width) return [rawLine];
  const rows: string[] = [];
  let remaining = rawLine;
  while (stringWidth(remaining) > width) {
    const chunk = sliceToVisualWidth(remaining, width);
    rows.push(chunk);
    remaining = sliceFromVisualOffset(remaining, stringWidth(chunk));
  }
  if (remaining.length > 0) rows.push(remaining);
  return rows.length > 0 ? rows : [""];
}

function renderSingleWindowWrapped(
  buffer: Window["buffer"],
  cursorLine: number,
  cursorColumn: number,
  totalLines: number,
  viewportTop: number,
  contentWidth: number,
  visibleLines: number,
  gutterCfg: GutterConfig,
  isFocused: boolean,
  highlightSpans?: HighlightSpan[][],
  foldRanges?: Map<number, number>,
): string[] {
  const gw = gutterDisplayWidth(totalLines, gutterCfg);
  const cw = Math.max(1, contentWidth - gw);
  const lines: string[] = [];
  let screenRow = 0;

  const hiddenLines = new Set<number>();
  if (foldRanges) {
    for (const [foldStart, foldEnd] of foldRanges) {
      for (let ln = foldStart + 1; ln <= foldEnd; ln++) {
        hiddenLines.add(ln);
      }
    }
  }

  let logicalLine = viewportTop;
  while (screenRow < visibleLines && logicalLine < totalLines) {
    if (hiddenLines.has(logicalLine)) { logicalLine++; continue; }

    const isCurrentLine = isFocused && logicalLine === cursorLine;
    const rawLine = getLineForBuffer(buffer, logicalLine);

    const foldEnd = foldRanges?.get(logicalLine);
    if (foldEnd !== undefined) {
      const hiddenCount = foldEnd - logicalLine;
      const gutter = renderGutterLine(logicalLine, cursorLine, totalLines, gutterCfg, isCurrentLine, "collapsed");
      const foldIndicator = `... [${hiddenCount} lines]`;
      const padded = fitToWidth(foldIndicator, cw);
      lines.push(gutter + style(padded, { dim: true }));
      screenRow++;
      logicalLine++;
      continue;
    }

    const isHeading = isMarkdownHeading(rawLine);
    const foldState: FoldState | undefined = isHeading && foldRanges ? "expandable" : undefined;

    const wrappedRows = wrapLine(rawLine, cw);

    // Find which wrapped row the cursor is on
    let cursorWrapRow = 0;
    if (isCurrentLine) {
      let accumWidth = 0;
      for (let wr = 0; wr < wrappedRows.length; wr++) {
        const rowWidth = stringWidth(wrappedRows[wr]!);
        if (cursorColumn < accumWidth + rowWidth) {
          cursorWrapRow = wr;
          break;
        }
        accumWidth += rowWidth;
        if (wr === wrappedRows.length - 1) cursorWrapRow = wr;
      }
    }
    const cursorWrapCol = isCurrentLine
      ? cursorColumn - (cursorWrapRow > 0 ? wrappedRows.slice(0, cursorWrapRow).reduce((s, r) => s + stringWidth(r), 0) : 0)
      : -1;

    for (let wr = 0; wr < wrappedRows.length && screenRow < visibleLines; wr++) {
      const gutter = (wr === 0)
        ? renderGutterLine(logicalLine, cursorLine, totalLines, gutterCfg, isCurrentLine, foldState)
        : renderEmptyGutter(totalLines, gutterCfg);
      const rowText = fitToWidth(wrappedRows[wr]!, cw);
      const onCursorRow = isCurrentLine && wr === cursorWrapRow;
      const rendered = onCursorRow ? renderWithBlockCursor(rowText, cursorWrapCol) : rowText;
      lines.push(gutter + rendered);
      screenRow++;
    }
    logicalLine++;
  }

  while (screenRow < visibleLines) {
    lines.push(renderEmptyGutter(totalLines, gutterCfg) + fitToWidth("~", cw));
    screenRow++;
  }

  return lines;
}

export function renderBufferLines(
  state: EditorState,
  width: number,
  height: number,
  highlightSpans?: HighlightSpan[][]
): string[] {
  const windows = state.windows;
  const currentWindowIndex = state.currentWindowIndex ?? 0;
  const wordWrap = state.config.wordWrap;
  const viewportLeft = wordWrap ? 0 : (state.viewportLeft ?? 0);

  // Single-window path (default, most common)
  if (!windows || windows.length <= 1) {
    const gutterCfg = gutterConfigFromState(state.activeMinorModes, state.config);
    const gw = gutterDisplayWidth(getLineCount(state), gutterCfg);
    const cw = Math.max(1, width - gw);

    if (wordWrap) {
      return renderSingleWindowWrapped(
        state.currentBuffer!,
        state.cursorPosition.line,
        state.cursorPosition.column,
        getLineCount(state),
        getVisibleViewportTop(state, height),
        width,
        height,
        gutterCfg,
        true,
        highlightSpans,
        state.foldRanges,
      );
    }

    return renderSingleWindow(
      state.currentBuffer!,
      state.cursorPosition.line,
      state.cursorPosition.column,
      getLineCount(state),
      getVisibleViewportTop(state, height),
      viewportLeft,
      width,
      height,
      gutterCfg,
      true,
      highlightSpans,
      state.foldRanges,
    );
  }

  // Multi-window path
  const cells = computeLayout(windows, width, height);
  const seps = renderSeparators(cells, width, height);
  const gutterCfg = gutterConfigFromState(state.activeMinorModes, state.config);

  // Build a screen-sized output, one string per terminal row
  const screen: string[] = Array.from({ length: height }, () => " ".repeat(width));

  for (let ci = 0; ci < cells.length; ci++) {
    const cell = cells[ci]!;
    const win = windows.find(w => w.id === cell.windowId);
    if (!win) continue;

    const isFocused = ci === currentWindowIndex;
    const buf = win.buffer;
    const totalLines = getLineCountForBuffer(buf);
    const cursorLine = isFocused ? state.cursorPosition.line : win.cursorLine;
    const cursorColumn = isFocused ? state.cursorPosition.column : 0;
    const viewportTop = win.viewportTop;
    const winViewportLeft = wordWrap ? 0 : (win.viewportLeft ?? 0);

    const cellLines = wordWrap
      ? renderSingleWindowWrapped(
          buf, cursorLine, cursorColumn, totalLines, viewportTop,
          cell.width, cell.height, gutterCfg, isFocused, highlightSpans,
        )
      : renderSingleWindow(
          buf, cursorLine, cursorColumn, totalLines, viewportTop,
          winViewportLeft, cell.width, cell.height, gutterCfg, isFocused, highlightSpans,
        );

    for (let row = 0; row < cell.height && row < cellLines.length; row++) {
      const screenRow = cell.y + row;
      if (screenRow >= height) break;
      // Place cell content at the right screen position
      const line = cellLines[row]!;
      const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");
      const padded = line + " ".repeat(Math.max(0, cell.width - stringWidth(stripped)));
      screen[screenRow] = padded.slice(0, cell.width);
    }
  }

  // Overlay separators
  for (let y = 0; y < height; y++) {
    if (seps[y] && seps[y]!.trim().length > 0) {
      // Merge separator characters into the screen row
      let row = screen[y]!;
      for (let x = 0; x < width; x++) {
        const ch = seps[y]![x];
        if (ch && ch !== " ") {
          row = row.slice(0, x) + ch + row.slice(x + 1);
        }
      }
      screen[y] = row;
    }
  }

  return screen;
}
