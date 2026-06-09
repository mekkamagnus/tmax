/**
 * @file tokenizer.ts
 * @description Generic regex-based syntax tokenizer with stateful cross-line support
 */

import type { SyntaxRule, SyntaxToken } from "../core/types.ts";
import { ParseState, type StateTransitions, cStyleTransitions, pythonTransitions, lispTransitions } from "./parse-state.ts";

export type { ParseState, StateTransitions };

/**
 * Get the state transitions for a language by name.
 */
function getTransitions(language: string): StateTransitions | null {
  if (language === "python") return pythonTransitions;
  if (language === "lisp" || language === "tlisp") return lispTransitions;
  if (language === "markdown") return null;
  // C-style covers typescript, javascript, tsx, jsx, go, c
  return cStyleTransitions;
}

/**
 * Result of tokenizing a single line with state.
 */
export interface TokenizeResult {
  tokens: SyntaxToken[];
  nextState: ParseState;
}

/**
 * Tokenize a line of text using syntax rules.
 * Rules are applied in priority order (higher priority first).
 * Longest match wins at each position. Already-tokenized spans are skipped.
 *
 * When a ParseState is provided, handles multi-line constructs:
 * - If inside a block comment, the entire line is a comment token.
 * - If inside a multi-line string, the line is a string token (or part of one).
 * - After processing, returns the updated state for the next line.
 */
export function tokenize(
  line: string,
  lineNum: number,
  rules: SyntaxRule[],
  state?: ParseState,
  language?: string,
): SyntaxToken[] | TokenizeResult {
  if (!state) {
    // Backward-compatible: stateless mode
    return tokenizeImpl(line, lineNum, rules, new ParseState(), language ?? "").tokens;
  }
  return tokenizeImpl(line, lineNum, rules, state, language ?? "");
}

function tokenizeImpl(
  line: string,
  lineNum: number,
  rules: SyntaxRule[],
  state: ParseState,
  language: string,
): TokenizeResult {
  const transitions = language ? getTransitions(language) : null;

  // Markdown: if inside a fenced code block, check for closing delimiter
  if (state.inCodeFence) {
    const fenceDelim = state.codeFenceDelimiter ?? "```";
    const trimmed = line.trimEnd();
    if (trimmed === fenceDelim || trimmed.startsWith(fenceDelim)) {
      state.inCodeFence = false;
      state.codeFenceDelimiter = null;
      return {
        tokens: [{ type: "code-delimiter", value: line, line: lineNum, startCol: 0, endCol: line.length }],
        nextState: state,
      };
    }
    return {
      tokens: [{ type: "code-block", value: line, line: lineNum, startCol: 0, endCol: line.length }],
      nextState: state,
    };
  }

  // If we're inside a block comment, check if it ends on this line
  if (state.inBlockComment) {
    const exitIdx = transitions ? line.indexOf("*/") : -1;
    const lispExit = transitions === lispTransitions ? line.indexOf("|#") : -1;
    const exitPos = lispExit >= 0 ? lispExit : exitIdx;

    if (exitPos >= 0) {
      // Comment ends on this line
      const commentEnd = lispExit >= 0 ? exitPos + 2 : exitPos + 2;
      const tokens: SyntaxToken[] = [];
      if (commentEnd > 0) {
        tokens.push({
          type: "comment",
          value: line.slice(0, commentEnd),
          line: lineNum,
          startCol: 0,
          endCol: commentEnd,
        });
      }
      state.inBlockComment = false;
      state.blockCommentDepth = 0;
      // Tokenize the rest of the line normally
      const rest = line.slice(commentEnd);
      const restTokens = tokenizeRegexOnly(rest, lineNum, rules, commentEnd);
      return { tokens: [...tokens, ...restTokens], nextState: state };
    }

    // Entire line is inside the comment
    return {
      tokens: [{
        type: "comment",
        value: line,
        line: lineNum,
        startCol: 0,
        endCol: line.length,
      }],
      nextState: state,
    };
  }

  // If we're inside a multi-line string, check if it ends on this line
  if (state.isInString()) {
    const endDelimiter = getStringEndDelimiter(state.stringType);
    const endIdx = line.indexOf(endDelimiter);

    if (endIdx >= 0) {
      const stringEnd = endIdx + endDelimiter.length;
      const tokens: SyntaxToken[] = [{
        type: "string",
        value: line.slice(0, stringEnd),
        line: lineNum,
        startCol: 0,
        endCol: stringEnd,
      }];
      state.stringType = "none";
      const rest = line.slice(stringEnd);
      const restTokens = tokenizeRegexOnly(rest, lineNum, rules, stringEnd);
      return { tokens: [...tokens, ...restTokens], nextState: state };
    }

    // Entire line is inside the string
    return {
      tokens: [{
        type: "string",
        value: line,
        line: lineNum,
        startCol: 0,
        endCol: line.length,
      }],
      nextState: state,
    };
  }

  // Normal tokenization, but detect state transitions
  const tokens = tokenizeRegexOnly(line, lineNum, rules, 0);

  // Check if any token triggers a state transition
  for (const token of tokens) {
    if (token.type === "comment" && transitions) {
      const bc = transitions.checkBlockComment(token.value);
      if (bc === "enter") {
        state.inBlockComment = true;
        state.blockCommentDepth = 1;
      }
    }
    // Markdown: detect fenced code block entry
    if (token.type === "code-delimiter" && language === "markdown") {
      const delim = token.value.trimEnd();
      if (delim.startsWith("```") || delim.startsWith("~~~")) {
        const fenceChar = delim[0]!;
        let fenceLen = 0;
        for (const ch of delim) {
          if (ch === fenceChar) fenceLen++;
          else break;
        }
        state.inCodeFence = true;
        state.codeFenceDelimiter = fenceChar.repeat(fenceLen);
      }
    }
    if (token.type === "string") {
      // Check if the string is unterminated (multi-line)
      const raw = token.value;
      if (raw.startsWith('"""') && !raw.endsWith('"""')) {
        state.stringType = "triple-double";
      } else if (raw.startsWith("'''") && !raw.endsWith("'''")) {
        state.stringType = "triple-single";
      } else if (raw.startsWith("`") && !raw.endsWith("`")) {
        state.stringType = "template";
      }
    }
  }

  return { tokens, nextState: state };
}

/**
 * Original regex-only tokenization (no state tracking).
 */
function tokenizeRegexOnly(
  line: string,
  lineNum: number,
  rules: SyntaxRule[],
  colOffset: number,
): SyntaxToken[] {
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
        startCol: start + colOffset,
        endCol: end + colOffset,
      });
      if (end >= line.length) break;
    }
  }

  tokens.sort((a, b) => a.startCol - b.startCol);
  return tokens;
}

function getStringEndDelimiter(stringType: string): string {
  switch (stringType) {
    case "triple-double": return '"""';
    case "triple-single": return "'''";
    case "template": return "`";
    case "double": return '"';
    case "single": return "'";
    default: return "";
  }
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
