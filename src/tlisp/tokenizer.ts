/**
 * @file tokenizer.ts
 * @description T-Lisp tokenizer with source span support
 */

import { Either } from "../utils/task-either.ts";
import { createConfigError, ConfigError } from "../error/types.ts";
import type { SourceSpan, SourcePosition } from "./source.ts";

export type TokenizeError = ConfigError;

export interface Token {
  text: string;
  span: SourceSpan;
}

/**
 * T-Lisp tokenizer for converting source code into tokens
 */
export class TLispTokenizer {
  private pos: number = 0;
  private source: string = "";
  private line: number = 0;
  private column: number = 0;
  private lineStart: number = 0;

  /**
   * Tokenize T-Lisp source code (backward-compatible string API)
   */
  tokenize(source: string): Either<TokenizeError, string[]> {
    const result = this.tokenizeWithSpans(source, "<unknown>");
    if (Either.isLeft(result)) return result;
    return Either.right(result.right.map(t => t.text));
  }

  /**
   * Tokenize with source spans for each token
   */
  tokenizeWithSpans(source: string, sourceName: string): Either<TokenizeError, Token[]> {
    this.source = source;
    this.pos = 0;
    this.line = 0;
    this.column = 0;
    this.lineStart = 0;
    const tokens: Token[] = [];

    while (this.pos < this.source.length) {
      this.skipWhitespace();

      if (this.pos >= this.source.length) {
        break;
      }

      if (this.peek() === ";") {
        this.skipComment();
        continue;
      }

      const tokenResult = this.readToken();
      if (Either.isLeft(tokenResult)) {
        return tokenResult;
      }

      const token = tokenResult.right;
      if (token) {
        tokens.push(token);
      }
    }

    return Either.right(tokens);
  }

  private currentPos(): SourcePosition {
    return { line: this.line, column: this.column, offset: this.pos };
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length && this.isWhitespace(this.peek())) {
      if (this.peek() === "\n") {
        this.line++;
        this.lineStart = this.pos + 1;
        this.column = 0;
      } else {
        this.column++;
      }
      this.pos++;
    }
  }

  private skipComment(): void {
    while (this.pos < this.source.length && this.peek() !== "\n") {
      this.pos++;
      this.column++;
    }
  }

  private readToken(): Either<TokenizeError, Token | null> {
    const char = this.peek();
    const start = this.currentPos();

    if (char === "(" || char === ")") {
      const text = this.advance().toString();
      return Either.right({ text, span: { start, end: this.currentPos() } });
    }

    if (char === "'") {
      const text = this.advance().toString();
      return Either.right({ text, span: { start, end: this.currentPos() } });
    }

    if (char === "`") {
      const text = this.advance().toString();
      return Either.right({ text, span: { start, end: this.currentPos() } });
    }

    if (char === ",") {
      if (this.peek(1) === "@") {
        this.advance();
        this.advance();
        this.column += 2;
        return Either.right({ text: ",@", span: { start, end: this.currentPos() } });
      }
      const text = this.advance().toString();
      return Either.right({ text, span: { start, end: this.currentPos() } });
    }

    if (char === '"') {
      return this.readString(start);
    }

    if (this.isDigit(char) || (char === "-" && this.isDigit(this.peek(1)))) {
      const text = this.readNumber();
      return Either.right({ text, span: { start, end: this.currentPos() } });
    }

    if (this.isSymbolStart(char)) {
      const text = this.readSymbol();
      return Either.right({ text, span: { start, end: this.currentPos() } });
    }

    this.pos++;
    this.column++;
    return Either.left(createConfigError('ParseError',
      `Unexpected character '${char}' at line ${start.line + 1}, column ${start.column + 1}`));
  }

  private readString(start: SourcePosition): Either<TokenizeError, Token> {
    let result = "";
    result += this.advance();
    this.column++;

    while (this.pos < this.source.length && this.peek() !== '"') {
      if (this.peek() === "\\") {
        this.advance();
        this.column++;
        if (this.pos < this.source.length) {
          const escaped = this.advance();
          this.column++;
          switch (escaped) {
            case "n": result += "\n"; break;
            case "t": result += "\t"; break;
            case "r": result += "\r"; break;
            case "\\": result += "\\"; break;
            case '"': result += '"'; break;
            default: result += escaped;
          }
        }
      } else {
        const ch = this.advance();
        if (ch === "\n") {
          this.line++;
          this.lineStart = this.pos;
          this.column = 0;
        } else {
          this.column++;
        }
        result += ch;
      }
    }

    if (this.pos < this.source.length) {
      result += this.advance();
      this.column++;
      return Either.right({ text: result, span: { start, end: this.currentPos() } });
    }

    return Either.left(createConfigError('ParseError',
      `Unterminated string literal starting at line ${start.line + 1}, column ${start.column + 1}`));
  }

  private readNumber(): string {
    let result = "";
    if (this.peek() === "-") {
      result += this.advance();
      this.column++;
    }
    while (this.pos < this.source.length && this.isDigit(this.peek())) {
      result += this.advance();
      this.column++;
    }
    if (this.peek() === ".") {
      result += this.advance();
      this.column++;
      while (this.pos < this.source.length && this.isDigit(this.peek())) {
        result += this.advance();
        this.column++;
      }
    }
    return result;
  }

  private readSymbol(): string {
    let result = "";
    while (this.pos < this.source.length && this.isSymbolChar(this.peek())) {
      result += this.advance();
      this.column++;
    }
    return result;
  }

  private peek(offset = 0): string {
    const pos = this.pos + offset;
    return pos < this.source.length ? this.source[pos]! : "";
  }

  private advance(): string {
    return this.source[this.pos++] || "";
  }

  private isWhitespace(char: string): boolean {
    return /\s/.test(char);
  }

  private isDigit(char: string): boolean {
    return /\d/.test(char);
  }

  private isSymbolStart(char: string): boolean {
    return /[a-zA-Z_+\-*/=<>!?&#:]/.test(char);
  }

  private isSymbolChar(char: string): boolean {
    return /[a-zA-Z0-9_+\-*/=<>!?&#:]/.test(char);
  }
}
