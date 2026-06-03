import type { EditorState } from "../../core/types.ts";
import { style, stripAnsi, type AnsiColor } from "../frontends/steep/style.ts";

export const modeDisplay: Record<EditorState["mode"], { text: string; color: AnsiColor }> = {
  normal: { text: "NORMAL", color: "green" },
  insert: { text: "INSERT", color: "yellow" },
  visual: { text: "VISUAL", color: "magenta" },
  command: { text: "COMMAND", color: "cyan" },
  mx: { text: "M-X", color: "blue" },
};

function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

export function renderStatusLine(state: EditorState, width: number): string {
  const mode = modeDisplay[state.mode];
  const majorMode = state.currentMajorMode ? ` [${state.currentMajorMode}]` : "";
  const minorModes = state.activeMinorModeLighters && state.activeMinorModeLighters.length > 0
    ? ` (${state.activeMinorModeLighters.join(" ")})`
    : "";
  const left = `${style(mode.text, { fg: mode.color, bold: true })}${style(majorMode, { fg: "cyan" })}${style(minorModes, { fg: "white", dim: true })} ${style(
    `Line: ${state.cursorPosition.line + 1}, Col: ${state.cursorPosition.column + 1}`,
    { fg: "white" },
  )}`;
  const status = style(state.statusMessage ?? "", { fg: "white" });
  const gap = Math.max(1, width - visibleLength(left) - visibleLength(status));
  const line = `${left}${" ".repeat(gap)}${status}`;

  return style(line, { bg: "blue" });
}
