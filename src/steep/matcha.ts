/**
 * @file matcha.ts
 * @description ANSI styling with 24-bit (true-color) support — Steep's Lip Gloss equivalent
 */

export type NamedColor =
  | "black"
  | "white"
  | "gray"
  | "green"
  | "yellow"
  | "magenta"
  | "cyan"
  | "blue";

export type AnsiColor = NamedColor | `#${string}`;

const colorCodes: Record<NamedColor, number> = {
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

export function isHexColor(s: string): s is `#${string}` {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

export function hexToRGB(hex: `#${string}`): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function isNamedColor(c: AnsiColor): c is NamedColor {
  return c in colorCodes;
}

export function fg(text: string, color: AnsiColor): string {
  const seq = isNamedColor(color)
    ? `\x1b[38;5;${colorCodes[color]}m`
    : (() => { const [r, g, b] = hexToRGB(color); return `\x1b[38;2;${r};${g};${b}m`; })();
  return `${seq}${text}${reset}`;
}

export function bg(text: string, color: AnsiColor): string {
  const seq = isNamedColor(color)
    ? `\x1b[48;5;${colorCodes[color]}m`
    : (() => { const [r, g, b] = hexToRGB(color); return `\x1b[48;2;${r};${g};${b}m`; })();
  return `${seq}${text}${reset}`;
}

export function bold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`;
}

export function dim(text: string): string {
  return `\x1b[2m${text}\x1b[22m`;
}

export function italic(text: string): string {
  return `\x1b[3m${text}\x1b[23m`;
}

export function underline(text: string): string {
  return `\x1b[4m${text}\x1b[24m`;
}

export function strikethrough(text: string): string {
  return `\x1b[9m${text}\x1b[29m`;
}

export function inverse(text: string): string {
  return `\x1b[7m${text}\x1b[27m`;
}

export function style(
  text: string,
  options: {
    fg?: AnsiColor;
    bg?: AnsiColor;
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    inverse?: boolean;
  } = {},
): string {
  let prefix = "";
  if (options.bold) prefix += "\x1b[1m";
  if (options.dim) prefix += "\x1b[2m";
  if (options.italic) prefix += "\x1b[3m";
  if (options.underline) prefix += "\x1b[4m";
  if (options.strikethrough) prefix += "\x1b[9m";
  if (options.inverse) prefix += "\x1b[7m";
  if (options.fg) {
    prefix += isNamedColor(options.fg)
      ? `\x1b[38;5;${colorCodes[options.fg]}m`
      : (() => { const [r, g, b] = hexToRGB(options.fg); return `\x1b[38;2;${r};${g};${b}m`; })();
  }
  if (options.bg) {
    prefix += isNamedColor(options.bg)
      ? `\x1b[48;5;${colorCodes[options.bg]}m`
      : (() => { const [r, g, b] = hexToRGB(options.bg); return `\x1b[48;2;${r};${g};${b}m`; })();
  }

  return prefix ? `${prefix}${text}${reset}` : text;
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
