/**
 * @file types.ts
 * @description Syntax highlighting type definitions with 24-bit color theme
 */

export type { SyntaxRule, SyntaxToken, HighlightTheme, ANSIStyle, HighlightSpan } from "../core/contracts/editor.ts";
import type { HighlightTheme } from "../core/contracts/editor.ts";

/**
 * Default dark theme (One Dark palette) mapping token types to ANSI styles.
 * Uses 24-bit hex colors for accurate rendering on modern terminals.
 * Falls back gracefully on terminals without true-color support.
 */
export const defaultDarkTheme: HighlightTheme = {
  keyword: { fg: "#c678dd", bold: true },
  type: { fg: "#e5c07b" },
  string: { fg: "#98c379" },
  comment: { fg: "#5c6370", dim: true },
  number: { fg: "#d19a66" },
  function: { fg: "#61afef" },
  operator: { fg: "#56b6c2" },
  punctuation: { fg: "#abb2bf" },
  decorator: { fg: "#d19a66", bold: true },
  regexp: { fg: "#e06c75" },
  variable: { fg: "#e06c75" },
  constant: { fg: "#d19a66", bold: true },
  special: { fg: "#c678dd" },
  character: { fg: "#98c379" },
  property: { fg: "#e06c75" },
  boolean: { fg: "#d19a66" },
  builtin: { fg: "#e5c07b" },
  symbol: { fg: "#abb2bf" },
  // Markdown token types (One Dark palette)
  heading: { fg: "#e06c75", bold: true },
  bold: { fg: "#d19a66", bold: true },
  italic: { fg: "#c678dd" },
  link: { fg: "#61afef", underline: true },
  image: { fg: "#61afef" },
  code: { fg: "#98c379" },
  "code-delimiter": { fg: "#5c6370" },
  "code-block": { fg: "#abb2bf", dim: true },
  blockquote: { fg: "#c678dd" },
  strikethrough: { fg: "#f85149", dim: true },
  hr: { fg: "#5c6370" },
  "list-item": { fg: "#56b6c2" },
  "task-item": { fg: "#98c379", bold: true },
  "table-separator": { fg: "#5c6370" },
  meta: { fg: "#5c6370", dim: true },
  default: {},
};
