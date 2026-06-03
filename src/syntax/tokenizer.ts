/**
 * @file tokenizer.ts
 * @description Generic regex-based syntax tokenizer
 */

import type { SyntaxRule, SyntaxToken } from "../core/types.ts";

/**
 * Tokenize a line of text using syntax rules.
 * Rules are applied in priority order (higher priority first).
 * Longest match wins at each position. Already-tokenized spans are skipped.
 */
export function tokenize(line: string, lineNum: number, rules: SyntaxRule[]): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  const covered: boolean[] = new Array(line.length).fill(false);
  const sorted = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const rule of sorted) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(line)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (end === start) { rule.pattern.lastIndex++; continue; }
      if (isCovered(covered, start, end)) continue;
      markCovered(covered, start, end);
      tokens.push({
        type: rule.type,
        value: match[0],
        line: lineNum,
        startCol: start,
        endCol: end,
      });
      if (end >= line.length) break;
    }
  }

  tokens.sort((a, b) => a.startCol - b.startCol);
  return tokens;
}

function isCovered(covered: boolean[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if (covered[i]) return true;
  }
  return false;
}

function markCovered(covered: boolean[], start: number, end: number): void {
  for (let i = start; i < end; i++) {
    covered[i] = true;
  }
}
