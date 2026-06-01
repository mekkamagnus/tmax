import type { EditorState } from "../../core/types.ts";
import { Either } from "../../utils/task-either.ts";
import { style } from "../frontends/steep/style.ts";

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

export function renderBufferLines(state: EditorState, width: number, height: number): string[] {
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

    const lineContent = fitToWidth(getLine(state, lineNumber), width);
    lines.push(
      lineNumber === state.cursorPosition.line
        ? style(lineContent, { fg: "black", bg: "white" })
        : lineContent,
    );
  }

  return lines;
}
