/**
 * @file types.ts
 * @description Syntax highlighting type definitions
 */

export type { SyntaxRule, SyntaxToken, HighlightTheme, ANSIStyle, HighlightSpan } from "../core/types.ts";

/**
 * Default dark theme mapping token types to ANSI colors
 */
export const defaultDarkTheme: HighlightTheme = {
  keyword: { fg: "magenta", bold: true },
  type: { fg: "cyan" },
  string: { fg: "green" },
  comment: { fg: "black", dim: true },
  number: { fg: "yellow" },
  function: { fg: "blue" },
  operator: { fg: "red" },
  punctuation: { fg: "white" },
  decorator: { fg: "yellow", bold: true },
  regexp: { fg: "red" },
  variable: { fg: "white" },
  constant: { fg: "cyan", bold: true },
  special: { fg: "magenta" },
  character: { fg: "green" },
  property: { fg: "cyan" },
  boolean: { fg: "yellow" },
  builtin: { fg: "cyan" },
  symbol: { fg: "white" },
  default: {},
};
