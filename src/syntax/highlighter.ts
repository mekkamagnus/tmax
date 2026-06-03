/**
 * @file highlighter.ts
 * @description Maps syntax tokens to ANSI highlight spans
 */

import type { SyntaxToken, HighlightSpan, HighlightTheme, ANSIStyle } from "../core/types.ts";
import { defaultDarkTheme } from "./types.ts";

/**
 * Convert tokens for a single line into highlight spans using the theme.
 */
export function highlightLine(tokens: SyntaxToken[], theme: HighlightTheme = defaultDarkTheme): HighlightSpan[] {
  return tokens.map(token => {
    const style = resolveStyle(token.type, theme);
    return { start: token.startCol, end: token.endCol, style };
  });
}

function resolveStyle(tokenType: string, theme: HighlightTheme): ANSIStyle {
  return theme[tokenType] ?? theme.default ?? {};
}
