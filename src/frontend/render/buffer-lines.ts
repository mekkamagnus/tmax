import type { EditorState, FoldState, HighlightSpan, Window } from "../../core/contracts/editor.ts";
import { getVisibleViewportTop } from "../../core/viewport.ts";
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
import { wikiDisplayActive, transformWikiLine } from "./wiki-display.ts";
import { computeHighlightSpans } from "../../syntax/highlight-buffer.ts";
import { makeWikiLinkResolver } from "../../syntax/wiki-link-faces.ts";
import { charWidth, stringWidth, sliceToVisualWidth, fitToWidth, sliceFromVisualOffset, padAnsiToWidth } from "./width.ts";

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

export { getVisibleViewportTop };

/**
 * #321: the ONE wrap-aware top-advance (verify-gate: it existed twice and
 * would desync — the exact bug class this fix removes). Advances `top`
 * until the cursor's wrapped rows fit `visibleLines`, counting wrapped
 * rows per logical line at wrap column `cw`. `rowsOfOverride` lets the
 * fold-aware renderer count fold-hidden lines as zero rows (hidden lines
 * never render); absent it counts every line (an over-advance that only
 * pins the cursor higher — harmless for span precomputation).
 */
export function makeFoldAwareRowsOf(
  getRawLine: (ln: number) => string,
  cw: number,
  foldRanges?: Map<number, number>,
): (ln: number) => number {
  const hidden = new Set<number>();
  const starts = new Set<number>();
  if (foldRanges) {
    for (const [foldStart, foldEnd] of foldRanges) {
      starts.add(foldStart);
      for (let ln = foldStart + 1; ln <= foldEnd; ln++) hidden.add(ln);
    }
  }
  return (ln: number) =>
    hidden.has(ln) ? 0
    : starts.has(ln) ? 1 // the renderer emits ONE "... [N lines]" row
    : Math.max(1, wrapLine(getRawLine(ln), cw).length);
}

export function advanceWrappedTop(
  getRawLine: (ln: number) => string,
  top: number,
  cursorLine: number,
  totalLines: number,
  visibleLines: number,
  cw: number,
  rowsOfOverride?: (ln: number) => number,
): number {
  if (cursorLine <= top) return top;
  const rowsOf = rowsOfOverride ?? ((ln: number) => Math.max(1, wrapLine(getRawLine(ln), cw).length));
  let span = 0;
  for (let ln = top; ln <= cursorLine && ln < totalLines; ln++) span += rowsOf(ln);
  while (span > visibleLines && top < cursorLine) {
    span -= rowsOf(top);
    top++;
  }
  return top;
}

/**
 * #321: the wrap-aware viewport top for the FOCUSED single-window view —
 * what renderSingleWindowWrapped actually renders from when word wrap is
 * on (the logical clamp otherwise leaves the cursor's wrapped row below
 * the fold). Frontends use this to precompute syntax spans over the REAL
 * rendered range. Returns the logical clamp when wrap is off.
 */
export function getWrappedViewportTop(state: EditorState, visibleLines: number, width: number): number {
  if (!state.config?.wordWrap) return getVisibleViewportTop(state, visibleLines);
  const totalLines = getLineCount(state);
  const gutterCfg = gutterConfigFromState(state.activeMinorModes, state.config);
  const gw = gutterDisplayWidth(totalLines, gutterCfg);
  const cw = Math.max(1, width - gw);
  return advanceWrappedTop(
    (ln) => getLine(state, ln),
    getVisibleViewportTop(state, visibleLines),
    state.cursorPosition.line,
    totalLines,
    visibleLines,
    cw,
    makeFoldAwareRowsOf((ln) => getLine(state, ln), cw, state.foldRanges),
  );
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
  // #248: the rendered frame prefixes every buffer line with the gutter
  // (` N │`), and the drawn block cursor sits at gutter + content column.
  // Mirror the render path: clamp against the gutter-reduced content width
  // (renderBufferLines fits content to `width - gw`) and return the ABSOLUTE
  // screen column so the hardware cursor the frontends position via moveTo()
  // lands on the same cell the frame painted. Gutter off → gw = 0 →
  // byte-identical to the old behavior.
  const gutterCfg = gutterConfigFromState(state.activeMinorModes, state.config);
  const gw = gutterDisplayWidth(getLineCount(state), gutterCfg);
  const viewportLeft = getVisibleViewportLeft(state, Math.max(1, contentWidth - gw));
  const row = Math.max(0, Math.min(bufferHeight - 1, state.cursorPosition.line - viewportTop));
  let cursorColumn = state.cursorPosition.column;
  // SPEC-119: when the wiki-link display transform is active, the rendered
  // line is shorter than the buffer line — map the cursor column into
  // display coordinates (delimiters are zero-width; visible text maps 1:1).
  // The SAME spans the render path uses are recomputed for this line, so
  // code-span protection applies identically and the terminal cursor never
  // desyncs from the rendered block cursor.
  if (viewportLeft === 0 && wikiDisplayActive(state)) {
    const buffer = state.currentBuffer;
    const line = buffer?.getLine(state.cursorPosition.line);
    if (buffer && line && Either.isRight(line)) {
      const spans = computeHighlightSpans(
        (ln) => {
          const r = buffer.getLine(ln);
          return r && Either.isRight(r) ? r.right : "";
        },
        state.cursorPosition.line,
        state.cursorPosition.line + 1,
        state.currentFilename,
        makeWikiLinkResolver(buffer, state.currentFilename),
      );
      const t = transformWikiLine(line.right, spans[state.cursorPosition.line]);
      if (t.changed) cursorColumn = t.mapCol(cursorColumn);
    }
  }
  const col = gw + Math.max(0, cursorColumn - viewportLeft);
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
  wikiDisplay?: boolean,
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

    const lineSpans = highlightSpans?.[lineNumber];

    // SPEC-119: display-only [[wiki-link]] transform. Skipped when
    // horizontally scrolled (the viewportLeft slicing operates on raw
    // columns) — a scrolled line renders raw.
    let displayLine = rawLine;
    let displaySpans: HighlightSpan[] | undefined = lineSpans;
    let displayCursor = cursorColumn;
    if (wikiDisplay && viewportLeft === 0) {
      const t = transformWikiLine(rawLine, lineSpans);
      if (t.changed) {
        displayLine = t.text;
        displaySpans = lineSpans ? t.spans : undefined;
        displayCursor = t.mapCol(cursorColumn);
      }
    }

    const effectiveCursorCol = isCurrentLine ? Math.max(0, displayCursor - viewportLeft) : -1;

    if (displaySpans && displaySpans.length > 0) {
      if (viewportLeft > 0) {
        const sliced = sliceFromVisualOffset(rawLine, viewportLeft);
        const sw = stringWidth(sliced);
        const continuesRight = sw > cw - 1;
        const truncated = continuesRight
          ? sliceToVisualWidth(sliced, cw - 2) + "\u00BB"
          : (sw <= cw - 1 ? sliced + " ".repeat(cw - 1 - sw) : sliceToVisualWidth(sliced, cw - 1));
        const display = "\u00AB" + truncated;
        const clamped = clampSpans(displaySpans, rawLine.length);
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
        const truncated = stringWidth(displayLine) > cw
          ? (cw > 3 ? sliceToVisualWidth(displayLine, cw - 3) + "..." : sliceToVisualWidth(displayLine, cw))
          : displayLine;
        const clamped = clampSpans(displaySpans, truncated.length);
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
        const rendered = isCurrentLine ? renderWithBlockCursorAnsi(display, effectiveCursorCol) : display;
        lines.push(gutter + rendered);
      } else {
        const lineContent = fitToWidth(displayLine, cw);
        const rendered = isCurrentLine ? renderWithBlockCursorAnsi(lineContent, effectiveCursorCol) : lineContent;
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
    let chunk = sliceToVisualWidth(remaining, width);
    // Word-boundary preference (codex round 7: hard splits break words
    // mid-token): when the row cuts inside a word AND a space exists
    // earlier in the row, break at the LAST space instead. Long unbroken
    // tokens still hard-split (paths, URLs).
    if (chunk.length > 0 && !/\s$/.test(chunk)) {
      const lastSpace = chunk.lastIndexOf(" ");
      if (lastSpace > 0) {
        chunk = chunk.slice(0, lastSpace + 1);
      }
    }
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
  wikiDisplay?: boolean,
): string[] {
  const gw = gutterDisplayWidth(totalLines, gutterCfg);
  const cw = Math.max(1, contentWidth - gw);
  const lines: string[] = [];
  let screenRow = 0;

  // Fold-hidden lines are decided BEFORE the top advance so the advance
  // can count them as ZERO rows (they never render — a fold-blind advance
  // over-advances and pins the cursor higher than needed; verify-gate r1).
  const hiddenLines = new Set<number>();
  if (foldRanges) {
    for (const [foldStart, foldEnd] of foldRanges) {
      for (let ln = foldStart + 1; ln <= foldEnd; ln++) {
        hiddenLines.add(ln);
      }
    }
  }

  // #321 (capture-matrix catch): WRAP-AWARE top — the OPERATIVE fix. The
  // logical clamp can leave the cursor's wrapped row below the screen
  // (every line may occupy multiple rows, so [top, cursorLine] can consume
  // far more than `visibleLines` rows — the cursor + tail render below the
  // fold: the blank/frozen tail). Shared helper, fold-aware here.
  const top = isFocused
    ? advanceWrappedTop(
        (ln) => getLineForBuffer(buffer, ln),
        viewportTop,
        cursorLine,
        totalLines,
        visibleLines,
        cw,
        makeFoldAwareRowsOf((ln) => getLineForBuffer(buffer, ln), cw, foldRanges),
      )
    : viewportTop;

  let logicalLine = top;
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

    // SPEC-119: display-only [[wiki-link]] transform, then wrap the DISPLAY
    // text; the cursor column is mapped into display coordinates first.
    let displayLine = rawLine;
    let displayCursorCol = cursorColumn;
    if (wikiDisplay) {
      const t = transformWikiLine(rawLine, highlightSpans?.[logicalLine]);
      if (t.changed) {
        displayLine = t.text;
        displayCursorCol = t.mapCol(cursorColumn);
      }
    }

    const wrappedRows = wrapLine(displayLine, cw);

    // Find which wrapped row the cursor is on
    let cursorWrapRow = 0;
    if (isCurrentLine) {
      let accumWidth = 0;
      for (let wr = 0; wr < wrappedRows.length; wr++) {
        const rowWidth = stringWidth(wrappedRows[wr]!);
        if (displayCursorCol < accumWidth + rowWidth) {
          cursorWrapRow = wr;
          break;
        }
        accumWidth += rowWidth;
        if (wr === wrappedRows.length - 1) cursorWrapRow = wr;
      }
    }
    const cursorWrapCol = isCurrentLine
      ? displayCursorCol - (cursorWrapRow > 0 ? wrappedRows.slice(0, cursorWrapRow).reduce((s, r) => s + stringWidth(r), 0) : 0)
      : -1;

    for (let wr = 0; wr < wrappedRows.length && screenRow < visibleLines; wr++) {
      const gutter = (wr === 0)
        ? renderGutterLine(logicalLine, cursorLine, totalLines, gutterCfg, isCurrentLine, foldState)
        : renderEmptyGutter(totalLines, gutterCfg);
      const rowText = fitToWidth(wrappedRows[wr]!, cw);
      const onCursorRow = isCurrentLine && wr === cursorWrapRow;
      // ANSI variant: chat rows carry SGR faces; the naive walker split
      // inside escape sequences and crashed the client on live-appended
      // colored lines (2026-11-20, wrap-iteration catch).
      const rendered = onCursorRow ? renderWithBlockCursorAnsi(rowText, cursorWrapCol) : rowText;
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

  // SPEC-119: the [[wiki-link]] display transform applies to the focused
  // buffer's windows when the minor mode is on (markdown buffers only).
  const wikiDisp = wikiDisplayActive(state);

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
        wikiDisp,
      );
    }

    const rows = renderSingleWindow(
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
      wikiDisp,
    );
    // RFC-029 §8.8: the ghost renders AT THE CURSOR — splice the row at the
    // cursor's screen column (gutter + column minus horizontal scroll),
    // dim italic, width-clipped to the content width. (Appending after the
    // row's padding pushed it off-screen at wide terminals — live catch.)
    // §8.8: the ghost renders ONLY while the cursor sits at its recorded
    // anchor (r39: movement otherwise displayed the suggestion at a spot it
    // was not computed for). col is a SCREEN column (gutter included) and
    // the clip budgets use the TOTAL width against it (mixing cw —
    // gutter-excluded — clipped the ghost too early under a gutter).
    if (state.ghostText
        && state.ghostAnchor
        && state.ghostAnchor.line === state.cursorPosition.line
        && state.ghostAnchor.column === state.cursorPosition.column) {
      const cursorRow = state.cursorPosition.line - getVisibleViewportTop(state, height);
      if (cursorRow >= 0 && cursorRow < rows.length) {
        const gw = gutterDisplayWidth(getLineCount(state), gutterCfg);
        const col = gw + Math.max(0, state.cursorPosition.column - viewportLeft);
        const row = rows[cursorRow]!;
        const head = sliceToVisualWidth(row, col);
        const ghost = sliceToVisualWidth(style(state.ghostText, { dim: true, italic: true }), Math.max(0, width - col));
        // Keep the text after the cursor visible (r38), TOTAL-width budget.
        const afterGhost = col + stringWidth(state.ghostText);
        const suffix = afterGhost < width ? sliceToVisualWidth(sliceFromVisualOffset(row, col), width - afterGhost) : "";
        rows[cursorRow] = head + ghost + suffix;
      }
    }
    return rows;
  }

  // Multi-window path (#260: cells come from the split tree when present —
  // nested mixed-axis panes; legacy states fall back to the flat layout).
  const cells = computeLayout(windows, width, height, state.windowLayout);
  const seps = renderSeparators(cells, width, height, state.windowLayout);
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
    // Unfocused panes pass through their stored per-window column (#263 —
    // was hardcoded 0). Cosmetic symmetry: unfocused cursors never render,
    // but consumers of the render shapes see consistent data.
    const cursorColumn = isFocused ? state.cursorPosition.column : win.cursorColumn;
    // Focused pane follows the model viewport (self-healing, same as the
    // single-window path); unfocused panes render from their own record.
    const viewportTop = isFocused ? getVisibleViewportTop(state, cell.height) : win.viewportTop;
    const winViewportLeft = isFocused ? viewportLeft : (wordWrap ? 0 : (win.viewportLeft ?? 0));

    const cellLines = wordWrap
      ? renderSingleWindowWrapped(
          buf, cursorLine, cursorColumn, totalLines, viewportTop,
          cell.width, cell.height, gutterCfg, isFocused, highlightSpans,
          undefined, isFocused && wikiDisp,
        )
      : renderSingleWindow(
          buf, cursorLine, cursorColumn, totalLines, viewportTop,
          winViewportLeft, cell.width, cell.height, gutterCfg, isFocused, highlightSpans,
          undefined, isFocused && wikiDisp,
        );

    for (let row = 0; row < cell.height && row < cellLines.length; row++) {
      const screenRow = cell.y + row;
      if (screenRow >= height) break;
      // Place the cell's row at cell.x, ANSI-aware: clamp to the cell's
      // exact visual width, then compose with what is already on the row
      // to the left/right (cells never overlap — computeLayout reserves
      // separator gaps — so a plain raw slice would both ignore cell.x
      // and cut into ANSI escapes).
      const line = cellLines[row]!;
      const padded = padAnsiToWidth(sliceToVisualWidth(line, cell.width), cell.width);
      const before = screen[screenRow]!;
      screen[screenRow] =
        sliceToVisualWidth(before, cell.x) +
        padded +
        sliceFromVisualOffset(before, cell.x + cell.width);
    }
  }

  // Overlay separators (ANSI-aware overwrite: rows carry SGR escapes, so a
  // raw splice at index x would cut into them — compose by visual column)
  for (let y = 0; y < height; y++) {
    const sepRow = seps[y];
    if (sepRow && sepRow.trim().length > 0) {
      let row = screen[y]!;
      for (let x = 0; x < width; x++) {
        const ch = sepRow[x];
        if (ch && ch !== " ") {
          row = sliceToVisualWidth(row, x) + ch + sliceFromVisualOffset(row, x + 1);
        }
      }
      screen[y] = row;
    }
  }

  return screen;
}
