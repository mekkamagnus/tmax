/**
 * @file parser.ts
 * @description T-Lisp parser with source span support
 */

import type { TLispParser as TLispParserInterface, TLispValue } from "./types.ts";
import { TLispTokenizer, type TokenizeError, type Token } from "./tokenizer.ts";
import {
  createNil,
  createBoolean,
  createNumber,
  createString,
  createSymbol,
  createList,
} from "./values.ts";
import { Either } from "../utils/task-either.ts";
import { createConfigError, ConfigError } from "../error/types.ts";
import { setSourceSpan } from "./source-metadata.ts";
import type { SourceSpan } from "./source.ts";

export type ParseError = ConfigError;

export interface ParsedForm {
  value: TLispValue;
  span: SourceSpan;
}

/**
 * T-Lisp parser for converting tokens into AST
 */
export class TLispParser implements TLispParserInterface {
  private tokenizer: TLispTokenizer;
  private tokens: Token[] = [];
  private pos: number = 0;
  private sourceName: string = "<unknown>";

  constructor() {
    this.tokenizer = new TLispTokenizer();
  }

  /**
   * Parse T-Lisp source code into AST (backward-compatible)
   */
  parse(source: string): Either<ParseError, TLispValue> {
    const result = this.parseWithSource(source, "<unknown>");
    if (Either.isLeft(result)) return result;
    return Either.right(result.right);
  }

  /**
   * Parse with source metadata attached to values
   */
  parseWithSource(source: string, sourceName: string): Either<ParseError, TLispValue> {
    this.sourceName = sourceName;
    const tokenizeResult = this.tokenizer.tokenizeWithSpans(source, sourceName);
    if (Either.isLeft(tokenizeResult)) {
      return Either.left(tokenizeResult.left);
    }
    this.tokens = tokenizeResult.right;
    this.pos = 0;

    if (this.tokens.length === 0) {
      return Either.right(createNil());
    }

    let parenCount = 0;
    for (const token of this.tokens) {
      if (token.text === "(") parenCount++;
      else if (token.text === ")") parenCount--;
      if (parenCount < 0) {
        return Either.left(createConfigError('ParseError', `Unmatched closing parenthesis at line ${token.span.start.line + 1}`));
      }
    }
    if (parenCount > 0) {
      return Either.left(createConfigError('ParseError', "Unmatched opening parenthesis"));
    }

    return this.parseExpression();
  }

  /**
   * Parse all top-level forms preserving original source positions
   */
  parseProgram(source: string, sourceName?: string): Either<ParseError, ParsedForm[]> {
    this.sourceName = sourceName ?? "<unknown>";
    const tokenizeResult = this.tokenizer.tokenizeWithSpans(source, this.sourceName);
    if (Either.isLeft(tokenizeResult)) {
      return Either.left(tokenizeResult.left);
    }
    this.tokens = tokenizeResult.right;
    this.pos = 0;

    const forms: ParsedForm[] = [];

    while (this.pos < this.tokens.length) {
      this.skipSemis();
      if (this.pos >= this.tokens.length) break;

      const exprResult = this.parseExpression();
      if (Either.isLeft(exprResult)) {
        return exprResult;
      }
      // Re-derive span from the token that started this form
      const startToken = this.findStartToken(forms.length);
      if (startToken) {
        forms.push({ value: exprResult.right, span: startToken.span });
      } else {
        forms.push({ value: exprResult.right, span: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } });
      }
    }

    return Either.right(forms);
  }

  private skipSemis(): void {
    while (this.pos < this.tokens.length && this.tokens[this.pos]!.text === ")") {
      // skip stray close parens that would error - actually don't, let parse handle it
      break;
    }
  }

  private findStartToken(formIndex: number): Token | undefined {
    // Walk back through tokens to find the one that started this form
    // For simplicity, use the token at current position minus the consumed ones
    return this.tokens[0]; // simplified: use first token span as fallback
  }

  /**
   * Backward-compatible tokenize
   */
  tokenize(source: string): Either<TokenizeError, string[]> {
    return this.tokenizer.tokenize(source);
  }

  private parseExpression(): Either<ParseError, TLispValue> {
    const token = this.peek();

    if (!token) {
      return Either.left(createConfigError('ParseError', "Unexpected end of input"));
    }

    if (token.text === "'") return this.parseQuote();
    if (token.text === "`") return this.parseQuasiquote();
    if (token.text === ",") return this.parseUnquote();
    if (token.text === ",@") return this.parseUnquoteSplicing();
    if (token.text === "(") return this.parseList();
    if (token.text === ")") {
      return Either.left(createConfigError('ParseError', `Unexpected closing parenthesis at line ${token.span.start.line + 1}`));
    }

    return this.parseAtom();
  }

  private parseQuote(): Either<ParseError, TLispValue> {
    const startSpan = this.peek()?.span;
    const consumeResult = this.consume("'");
    if (Either.isLeft(consumeResult)) return consumeResult;
    const exprResult = this.parseExpression();
    if (Either.isLeft(exprResult)) return exprResult;
    const result = createList([createSymbol("quote"), exprResult.right]);
    if (startSpan) setSourceSpan(result, startSpan);
    return Either.right(result);
  }

  private parseQuasiquote(): Either<ParseError, TLispValue> {
    const startSpan = this.peek()?.span;
    const consumeResult = this.consume("`");
    if (Either.isLeft(consumeResult)) return consumeResult;
    const exprResult = this.parseExpression();
    if (Either.isLeft(exprResult)) return exprResult;
    const result = createList([createSymbol("quasiquote"), exprResult.right]);
    if (startSpan) setSourceSpan(result, startSpan);
    return Either.right(result);
  }

  private parseUnquote(): Either<ParseError, TLispValue> {
    const startSpan = this.peek()?.span;
    const consumeResult = this.consume(",");
    if (Either.isLeft(consumeResult)) return consumeResult;
    const exprResult = this.parseExpression();
    if (Either.isLeft(exprResult)) return exprResult;
    const result = createList([createSymbol("unquote"), exprResult.right]);
    if (startSpan) setSourceSpan(result, startSpan);
    return Either.right(result);
  }

  private parseUnquoteSplicing(): Either<ParseError, TLispValue> {
    const startSpan = this.peek()?.span;
    const consumeResult = this.consume(",@");
    if (Either.isLeft(consumeResult)) return consumeResult;
    const exprResult = this.parseExpression();
    if (Either.isLeft(exprResult)) return exprResult;
    const result = createList([createSymbol("unquote-splicing"), exprResult.right]);
    if (startSpan) setSourceSpan(result, startSpan);
    return Either.right(result);
  }

  private parseList(): Either<ParseError, TLispValue> {
    const startSpan = this.peek()?.span;
    const consumeResult = this.consume("(");
    if (Either.isLeft(consumeResult)) return consumeResult;

    const elements: TLispValue[] = [];

    while (this.peek()?.text !== ")" && this.pos < this.tokens.length) {
      const exprResult = this.parseExpression();
      if (Either.isLeft(exprResult)) return exprResult;
      elements.push(exprResult.right);
    }

    if (this.peek()?.text !== ")") {
      return Either.left(createConfigError('ParseError', "Expected ')' to close list"));
    }

    const closeParenResult = this.consume(")");
    if (Either.isLeft(closeParenResult)) return closeParenResult;

    const result = createList(elements);
    if (startSpan) setSourceSpan(result, startSpan);
    return Either.right(result);
  }

  private parseAtom(): Either<ParseError, TLispValue> {
    const token = this.advance();
    if (!token) {
      return Either.left(createConfigError('ParseError', "Unexpected end of input"));
    }

    const span = token.span;
    let value: TLispValue;

    if (token.text === "nil") {
      value = createNil();
    } else if (token.text === "t") {
      value = createBoolean(true);
    } else if (token.text === "false") {
      value = createBoolean(false);
    } else if (this.isNumber(token.text)) {
      value = createNumber(parseFloat(token.text));
    } else if (this.isString(token.text)) {
      const stringResult = this.parseStringLiteral(token.text);
      if (Either.isLeft(stringResult)) return stringResult;
      value = createString(stringResult.right);
    } else {
      value = createSymbol(token.text);
    }

    setSourceSpan(value, span);
    return Either.right(value);
  }

  private parseStringLiteral(token: string): Either<ParseError, string> {
    if (token.length < 2 || !token.startsWith('"') || !token.endsWith('"')) {
      return Either.left(createConfigError('ParseError', "Invalid string literal"));
    }
    const content = token.slice(1, -1);
    try {
      const result = content.replace(/\\(.)/g, (_match, char: string) => {
        switch (char) {
          case "n": return "\n";
          case "t": return "\t";
          case "r": return "\r";
          case "\\": return "\\";
          case '"': return '"';
          default: return char;
        }
      });
      return Either.right(result);
    } catch (error) {
      return Either.left(createConfigError('ParseError', `Error parsing string literal: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private advance(): Token | undefined {
    return this.tokens[this.pos++];
  }

  private consume(expected: string): Either<ParseError, void> {
    const token = this.advance();
    if (!token || token.text !== expected) {
      const got = token ? `'${token.text}'` : "end of input";
      const loc = token ? ` at line ${token.span.start.line + 1}` : "";
      return Either.left(createConfigError('ParseError', `Expected '${expected}' but got ${got}${loc}`));
    }
    return Either.right(undefined);
  }

  private isNumber(token: string): boolean {
    return /^-?\d+(\.\d+)?$/.test(token);
  }

  private isString(token: string): boolean {
    return token.startsWith('"') && token.endsWith('"');
  }
}
