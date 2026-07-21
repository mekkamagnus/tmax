import type { MinibufferRenderSegment, MinibufferRenderView } from "../../core/contracts/editor.ts";
import { style, type AnsiColor } from "../../steep/matcha.ts";

export interface RenderedMinibuffer {
  lines: string[];
  cursorRow: number;
  cursorColumn: number;
}

type MinibufferStyle = {
  fg?: AnsiColor;
  bg?: AnsiColor;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
};

const faceStyle = (face: string | undefined, selected: boolean): MinibufferStyle => {
  const base: MinibufferStyle = selected ? { bg: "blue" } : {};
  switch (face) {
    case "completion-match":
      return { ...base, bold: true, underline: true };
    case "annotation":
      return { ...base, dim: true };
    case "selected":
      return { ...base, bold: true };
    default:
      return base;
  }
};

const renderSegments = (
  segments: MinibufferRenderSegment[],
  selected: boolean,
  width: number,
): string => {
  let remaining = Math.max(0, width);
  let output = "";
  for (const segment of segments) {
    if (remaining === 0) break;
    const text = Array.from(segment.text).slice(0, remaining).join("");
    output += style(text, faceStyle(segment.face, selected));
    remaining -= Array.from(text).length;
  }
  if (remaining > 0) output += style(" ".repeat(remaining), faceStyle(undefined, selected));
  return output;
};

/**
 * Draw a generic render-only minibuffer view produced by T-Lisp.
 */
export const renderMinibuffer = (
  view: MinibufferRenderView,
  width: number,
): RenderedMinibuffer => {
  const safeWidth = Math.max(1, width);
  const promptText = `${view.prompt}${view.input}`;
  const messageSpace = Math.max(1, safeWidth - promptText.length - view.message.length);
  const promptLine = `${promptText}${" ".repeat(messageSpace)}${view.message}`;
  const lines: string[] = [
    style(Array.from(promptLine).slice(0, safeWidth).join("").padEnd(safeWidth, " "), { fg: "white" }),
  ];
  for (const row of view.rows) {
    lines.push(renderSegments(row.segments, row.selected, safeWidth));
  }

  return {
    lines,
    cursorRow: 0,
    cursorColumn: Math.min(safeWidth - 1, view.prompt.length + view.inputPoint),
  };
};
