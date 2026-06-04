import { style } from "../frontends/steep/style.ts";

export interface GutterConfig {
  showLineNumbers: boolean;
  relativeLineNumbers: boolean;
}

export function gutterWidth(totalLines: number): number {
  if (totalLines < 1) return 3;
  return Math.max(3, totalLines.toString().length + 1);
}

export function gutterConfigFromState(modes: string[] | undefined, fallback: { showLineNumbers: boolean; relativeLineNumbers: boolean }): GutterConfig {
  const active = modes ?? [];
  const showLineNumbers = active.includes("line-numbers") || fallback.showLineNumbers;
  const relativeLineNumbers = active.includes("relative-line-numbers") || fallback.relativeLineNumbers;
  return { showLineNumbers, relativeLineNumbers };
}

export function renderGutterLine(
  lineNumber: number,
  cursorLine: number,
  totalLines: number,
  config: GutterConfig,
  isCurrentLine: boolean,
): string {
  const width = gutterWidth(totalLines);

  if (!config.showLineNumbers) {
    return "";
  }

  let text: string;

  if (config.relativeLineNumbers) {
    if (lineNumber === cursorLine) {
      text = (lineNumber + 1).toString();
    } else {
      text = Math.abs(lineNumber - cursorLine).toString();
    }
  } else {
    text = (lineNumber + 1).toString();
  }

  const padded = text.padStart(width - 1) + " ";
  const separator = "\u2502";

  if (isCurrentLine) {
    return style(padded, { fg: "white", bold: true }) + separator;
  }
  return style(padded, { fg: "gray", dim: true }) + separator;
}

export function renderEmptyGutter(totalLines: number, config: GutterConfig): string {
  if (!config.showLineNumbers) return "";
  const width = gutterWidth(totalLines);
  return style(" ".repeat(width - 1) + "~", { fg: "gray", dim: true }) + " ";
}

export function gutterDisplayWidth(totalLines: number, config: GutterConfig): number {
  if (!config.showLineNumbers) return 0;
  return gutterWidth(totalLines) + 1;
}
