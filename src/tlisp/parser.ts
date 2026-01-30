/**
 * @file parser.ts
 * @description T-Lisp parser implementation
 */

import type { TLispParser as TLispParserInterface, TLispValue } from "./types.ts";
import { TLispTokenizer } from "./tokenizer.ts";
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

/**
 * Parse error type for T-Lisp parsing errors
 */
export type ParseError = ConfigError;

/**
 * T-Lisp parser for converting tokens into AST
 */
export class TLispParser implements TLispParserInterface {
  private tokenizer: TLispTokenizer;
  private tokens: string[] = [];
  private pos: number = 0;

  /**
   * Create a new T-Lisp parser
   */
  constructor() {
    this.tokenizer = new TLispTokenizer();
  }

  /**
   * Parse T-Lisp source code into AST
   * @param source - Source code to parse
   * @returns Either with ParseError or Parsed T-Lisp value
   */
  parse(source: string): Either<ParseError, TLispValue> {
    const tokenizeResult = this.tokenizer.tokenize(source);
    if (Either.isLeft(tokenizeResult)) {
      return Either.left(tokenizeResult.left);
    }
    this.tokens = tokenizeResult.right;
    this.pos = 0;

    if (this.tokens.length === 0) {
      return Either.right(createNil());
    }

    // Check for unmatched closing parentheses before parsing
    let parenCount = 0;
    for (const token of this.tokens) {
      if (token === "(") parenCount++;
      else if (token === ")") parenCount--;
      if (parenCount < 0) {
        return Either.left(createConfigError('ParseError', "Unmatched closing parenthesis"));
      }
    }
    if (parenCount > 0) {
      return Either.left(createConfigError('ParseError', "Unmatched opening parenthesis"));
    }

    return this.parseExpression();
  }

  /**
   * Tokenize source code into tokens
   * @param source - Source code to tokenize
   * @returns Array of tokens
   */
  tokenize(source: string): Either<TokenizeError, string[]> {
    return this.tokenizer.tokenize(source);
  }

  /**
   * Parse a single expression
   * @returns Either with ParseError or Parsed T-Lisp value
   */
  private parseExpression(): Either<ParseError, TLispValue> {
    const token = this.peek();

    if (!token) {
      return Either.left(createConfigError('ParseError', "Unexpected end of input"));
    }

    // Handle quote
    if (token === "'") {
      return this.parseQuote();
    }

    // Handle quasiquote
    if (token === "`") {
      return this.parseQuasiquote();
    }

    // Handle unquote
    if (token === ",") {
      return this.parseUnquote();
    }

    // Handle unquote-splicing
    if (token === ",@") {
      return this.parseUnquoteSplicing();
    }

    // Handle lists
    if (token === "(") {
      return this.parseList();
    }

    // Handle unexpected closing parenthesis
    if (token === ")") {
      return Either.left(createConfigError('ParseError', "Unexpected closing parenthesis"));
    }

    // Handle atoms
    return this.parseAtom();
  }

  /**
   * Parse a quoted expression
   * @returns Either with ParseError or Quoted expression as (quote expr)
   */
  private parseQuote(): Either<ParseError, TLispValue> {
    const consumeResult = this.consume("'");
    if (Either.isLeft(consumeResult)) {
      return consumeResult;
    }
    const exprResult = this.parseExpression();
    if (Either.isLeft(exprResult)) {
      return exprResult;
    }
    return Either.right(createList([createSymbol("quote"), exprResult.right]));
  }

  /**
   * Parse a quasiquoted expression
   * @returns Either with ParseError or Quasiquoted expression as (quasiquote expr)
   */
  private parseQuasiquote(): Either<ParseError, TLispValue> {
    const consumeResult = this.consume("`");
    if (Either.isLeft(consumeResult)) {
      return consumeResult;
    }
    const exprResult = this.parseExpression();
    if (Either.isLeft(exprResult)) {
      return exprResult;
    }
    return Either.right(createList([createSymbol("quasiquote"), exprResult.right]));
  }

  /**
   * Parse an unquoted expression
   * @returns Either with ParseError or Unquoted expression as (unquote expr)
   */
  private parseUnquote(): Either<ParseError, TLispValue> {
    const consumeResult = this.consume(",");
    if (Either.isLeft(consumeResult)) {
      return consumeResult;
    }
    const exprResult = this.parseExpression();
    if (Either.isLeft(exprResult)) {
      return exprResult;
    }
    return Either.right(createList([createSymbol("unquote"), exprResult.right]));
  }

  /**
   * Parse an unquote-splicing expression
   * @returns Either with ParseError or Unquote-splicing expression as (unquote-splicing expr)
   */
  private parseUnquoteSplicing(): Either<ParseError, TLispValue> {
    const consumeResult = this.consume(",@");
    if (Either.isLeft(consumeResult)) {
      return consumeResult;
    }
    const exprResult = this.parseExpression();
    if (Either.isLeft(exprResult)) {
      return exprResult;
    }
    return Either.right(createList([createSymbol("unquote-splicing"), exprResult.right]));
  }

  /**
   * Parse a list expression
   * @returns Either with ParseError or List T-Lisp value
   */
  private parseList(): Either<ParseError, TLispValue> {
    const consumeResult = this.consume("(");
    if (Either.isLeft(consumeResult)) {
      return consumeResult;
    }

    const elements: TLispValue[] = [];

    while (this.peek() !== ")" && this.pos < this.tokens.length) {
      const exprResult = this.parseExpression();
      if (Either.isLeft(exprResult)) {
        return exprResult;
      }
      elements.push(exprResult.right);
    }

    if (this.peek() !== ")") {
      return Either.left(createConfigError('ParseError', "Expected ')' to close list"));
    }

    const closeParenResult = this.consume(")");
    if (Either.isLeft(closeParenResult)) {
      return closeParenResult;
    }

    return Either.right(createList(elements));
  }

  /**
   * Parse an atomic expression (number, string, symbol, nil, boolean)
   * @returns Either with ParseError or Atomic T-Lisp value
   */
  private parseAtom(): Either<ParseError, TLispValue> {
    const token = this.advance();

    if (!token) {
      return Either.left(createConfigError('ParseError', "Unexpected end of input"));
    }

    // Handle nil
    if (token === "nil") {
      return Either.right(createNil());
    }

    // Handle boolean true
    if (token === "t") {
      return Either.right(createBoolean(true));
    }

    // Handle numbers
    if (this.isNumber(token)) {
      return Either.right(createNumber(parseFloat(token)));
    }

    // Handle strings
    if (this.isString(token)) {
      const stringResult = this.parseStringLiteral(token);
      if (Either.isLeft(stringResult)) {
        return stringResult;
      }
      return Either.right(createString(stringResult.right));
    }

    // Handle symbols
    return Either.right(createSymbol(token));
  }

  /**
   * Parse string literal, handling escape sequences
   * @param token - String token including quotes
   * @returns Either with ParseError or String content without quotes
   */
  private parseStringLiteral(token: string): Either<ParseError, string> {
    if (token.length < 2 || !token.startsWith('"') || !token.endsWith('"')) {
      return Either.left(createConfigError('ParseError', "Invalid string literal"));
    }

    // Remove quotes and handle escape sequences
    const content = token.slice(1, -1);
    try {
      const result = content.replace(/\\(.)/g, (match, char) => {
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

  /**
   * Peek at current token without consuming it
   * @returns Current token or undefined
   */
  private peek(): string | undefined {
    return this.tokens[this.pos];
  }

  /**
   * Advance to next token and return current token
   * @returns Current token
   */
  private advance(): string {
    return this.tokens[this.pos++] || "";
  }

  /**
   * Consume expected token, returning error if not found
   * @param expected - Expected token
   * @returns Either with ParseError if token doesn't match, or void if successful
   */
  private consume(expected: string): Either<ParseError, void> {
    const token = this.advance();
    if (token !== expected) {
      return Either.left(createConfigError('ParseError', `Expected '${expected}' but got '${token}'`));
    }
    return Either.right(undefined);
  }

  /**
   * Check if token is a number
   * @param token - Token to check
   * @returns True if token is a number
   */
  private isNumber(token: string): boolean {
    return /^-?\d+(\.\d+)?$/.test(token);
  }

  /**
   * Check if token is a string literal
   * @param token - Token to check
   * @returns True if token is a string literal
   */
  private isString(token: string): boolean {
    return token.startsWith('"') && token.endsWith('"');
  }
}