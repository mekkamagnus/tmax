/**
 * @file parse-state.ts
 * @description Cross-line parse state for the stateful tokenizer
 */

export type StringType =
  | "none"
  | "single"
  | "double"
  | "template"
  | "triple-single"
  | "triple-double"
  | "raw";

export class ParseState {
  inBlockComment = false;
  blockCommentDepth = 0;
  stringType: StringType = "none";
  heredocDelimiter: string | null = null;
  rawStringDelimiter: string | null = null;
  bracketDepth = 0;
  inCodeFence = false;
  codeFenceDelimiter: string | null = null;

  clone(): ParseState {
    const s = new ParseState();
    s.inBlockComment = this.inBlockComment;
    s.blockCommentDepth = this.blockCommentDepth;
    s.stringType = this.stringType;
    s.heredocDelimiter = this.heredocDelimiter;
    s.rawStringDelimiter = this.rawStringDelimiter;
    s.bracketDepth = this.bracketDepth;
    s.inCodeFence = this.inCodeFence;
    s.codeFenceDelimiter = this.codeFenceDelimiter;
    return s;
  }

  isInString(): boolean {
    return this.stringType !== "none";
  }

  isInComment(): boolean {
    return this.inBlockComment;
  }

  update(token: string): void {
    for (const ch of token) {
      if (ch === "(" || ch === "[" || ch === "{") this.bracketDepth++;
      else if (ch === ")" || ch === "]" || ch === "}") this.bracketDepth--;
    }
  }
}

/**
 * Per-language state transition rules.
 * Keyed by language name. Each entry provides functions to check state
 * transitions based on token text.
 */
export interface StateTransitions {
  /** Check if a token starts/ends a block comment */
  checkBlockComment: (token: string) => "enter" | "exit" | null;
  /** Check if a token starts a string and what type */
  checkStringStart: (char: string, line: string, col: number) => StringType;
  /** Check if the current string should end at this position */
  checkStringEnd: (
    char: string,
    line: string,
    col: number,
    stringType: StringType,
  ) => boolean;
}

/**
 * C-style state transitions (TypeScript, C, Go)
 */
export const cStyleTransitions: StateTransitions = {
  checkBlockComment(token: string): "enter" | "exit" | null {
    if (token.startsWith("/*")) return "enter";
    if (token.endsWith("*/")) return "exit";
    return null;
  },
  checkStringStart(char: string, _line: string, _col: number): StringType {
    if (char === '"') return "double";
    if (char === "'") return "single";
    if (char === "`") return "template";
    return "none";
  },
  checkStringEnd(
    char: string,
    _line: string,
    _col: number,
    stringType: StringType,
  ): boolean {
    if (stringType === "double" && char === '"') return true;
    if (stringType === "single" && char === "'") return true;
    if (stringType === "template" && char === "`") return true;
    return false;
  },
};

/**
 * Python state transitions (triple-quoted strings)
 */
export const pythonTransitions: StateTransitions = {
  checkBlockComment(): "enter" | "exit" | null {
    return null;
  },
  checkStringStart(char: string, line: string, col: number): StringType {
    if (char === "'" && line.slice(col, col + 3) === "'''") return "triple-single";
    if (char === '"' && line.slice(col, col + 3) === '"""') return "triple-double";
    if (char === "'") return "single";
    if (char === '"') return "double";
    return "none";
  },
  checkStringEnd(
    char: string,
    line: string,
    col: number,
    stringType: StringType,
  ): boolean {
    if (stringType === "triple-single" && line.slice(col, col + 3) === "'''") return true;
    if (stringType === "triple-double" && line.slice(col, col + 3) === '"""') return true;
    if (stringType === "single" && char === "'") return true;
    if (stringType === "double" && char === '"') return true;
    return false;
  },
};

/**
 * Lisp state transitions (#| |# block comments)
 */
export const lispTransitions: StateTransitions = {
  checkBlockComment(token: string): "enter" | "exit" | null {
    if (token.startsWith("#|")) return "enter";
    if (token.endsWith("|#")) return "exit";
    return null;
  },
  checkStringStart(char: string): StringType {
    if (char === '"') return "double";
    return "none";
  },
  checkStringEnd(
    char: string,
    _line: string,
    _col: number,
    stringType: StringType,
  ): boolean {
    if (stringType === "double" && char === '"') return true;
    return false;
  },
};

