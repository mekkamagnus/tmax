import type { EditorState } from "../../core/types.ts";
import { style, stripAnsi, type AnsiColor } from "../../steep/matcha.ts";

export const modeDisplay: Record<EditorState["mode"], { text: string; color: AnsiColor }> = {
  normal: { text: "--NORMAL--", color: "green" },
  insert: { text: "--INSERT--", color: "yellow" },
  visual: { text: "--VISUAL--", color: "magenta" },
  command: { text: "--COMMAND--", color: "cyan" },
  mx: { text: "--M-X--", color: "blue" },
};

function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

function basename(path: string | undefined): string {
  if (!path) return "*scratch*";
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function renderStatusLine(state: EditorState, width: number): string {
  const mode = modeDisplay[state.mode];
  const left = style(mode.text, { fg: mode.color, bold: true });

  const majorModeRaw = state.currentMajorMode ?? "fundamental";
  const majorModeShort = majorModeRaw.replace(/-mode$/, "");
  const right = style(
    `L${state.cursorPosition.line + 1} C${state.cursorPosition.column + 1}`,
    { fg: "white" },
  ) + style(` [${majorModeShort}]`, { fg: "cyan" });

  const leftLen = visibleLength(left);
  const rightLen = visibleLength(right);
  const centerSpace = Math.max(0, width - leftLen - rightLen);

  const filename = basename(state.currentFilename);
  const filenameLen = filename.length;

  let center: string;
  if (filenameLen <= centerSpace) {
    const padLeft = Math.floor((centerSpace - filenameLen) / 2);
    const padRight = centerSpace - filenameLen - padLeft;
    center = " ".repeat(padLeft) + style(filename, { fg: "white" }) + " ".repeat(padRight);
  } else if (centerSpace > 3) {
    const truncated = filename.slice(0, centerSpace - 3) + "...";
    center = style(truncated, { fg: "white" });
  } else {
    center = " ".repeat(centerSpace);
  }

  const line = `${left}${center}${right}`;
  return style(line, { bg: "blue" });
}
