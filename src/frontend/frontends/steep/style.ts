export type AnsiColor =
  | "black"
  | "white"
  | "gray"
  | "green"
  | "yellow"
  | "magenta"
  | "cyan"
  | "blue";

const colorCodes: Record<AnsiColor, number> = {
  black: 16,
  white: 231,
  gray: 245,
  green: 46,
  yellow: 226,
  magenta: 201,
  cyan: 51,
  blue: 21,
};

export const reset = "\x1b[0m";

export function fg(text: string, color: AnsiColor): string {
  return `\x1b[38;5;${colorCodes[color]}m${text}${reset}`;
}

export function bg(text: string, color: AnsiColor): string {
  return `\x1b[48;5;${colorCodes[color]}m${text}${reset}`;
}

export function bold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`;
}

export function style(
  text: string,
  options: { fg?: AnsiColor; bg?: AnsiColor; bold?: boolean } = {},
): string {
  let prefix = "";
  if (options.bold) prefix += "\x1b[1m";
  if (options.fg) prefix += `\x1b[38;5;${colorCodes[options.fg]}m`;
  if (options.bg) prefix += `\x1b[48;5;${colorCodes[options.bg]}m`;

  return prefix ? `${prefix}${text}${reset}` : text;
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
