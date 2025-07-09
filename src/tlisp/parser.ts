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
   * @returns Parsed T-Lisp value
   */
  parse(source: string): TLispValue {
    this.tokens = this.tokenizer.tokenize(source);
    this.pos = 0;

    if (this.tokens.length === 0) {
      return createNil();
    }

    // Check for unmatched closing parentheses before parsing
    let parenCount = 0;
    for (const token of this.tokens) {
      if (token === "(") parenCount++;
      else if (token === ")") parenCount--;
      if (parenCount < 0) {
        throw new Error("Unmatched closing parenthesis");
      }
    }
    if (parenCount > 0) {
      throw new Error("Unmatched opening parenthesis");
    }

    return this.parseExpression();
  }

  /**
   * Tokenize source code into tokens
   * @param source - Source code to tokenize
   * @returns Array of tokens
   */
  tokenize(source: string): string[] {
    return this.tokenizer.tokenize(source);
  }

  /**
   * Parse a single expression
   * @returns Parsed T-Lisp value
   */
  private parseExpression(): TLispValue {
    const token = this.peek();

    if (!token) {
      throw new Error("Unexpected end of input");
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
      throw new Error("Unexpected closing parenthesis");
    }

    // Handle atoms
    return this.parseAtom();
  }

  /**
   * Parse a quoted expression
   * @returns Quoted expression as (quote expr)
   */
  private parseQuote(): TLispValue {
    this.consume("'");
    const expr = this.parseExpression();
    return createList([createSymbol("quote"), expr]);
  }

  /**
   * Parse a quasiquoted expression
   * @returns Quasiquoted expression as (quasiquote expr)
   */
  private parseQuasiquote(): TLispValue {
    this.consume("`");
    const expr = this.parseExpression();
    return createList([createSymbol("quasiquote"), expr]);
  }

  /**
   * Parse an unquoted expression
   * @returns Unquoted expression as (unquote expr)
   */
  private parseUnquote(): TLispValue {
    this.consume(",");
    const expr = this.parseExpression();
    return createList([createSymbol("unquote"), expr]);
  }

  /**
   * Parse an unquote-splicing expression
   * @returns Unquote-splicing expression as (unquote-splicing expr)
   */
  private parseUnquoteSplicing(): TLispValue {
    this.consume(",@");
    const expr = this.parseExpression();
    return createList([createSymbol("unquote-splicing"), expr]);
  }

  /**
   * Parse a list expression
   * @returns List T-Lisp value
   */
  private parseList(): TLispValue {
    this.consume("(");
    const elements: TLispValue[] = [];

    while (this.peek() !== ")" && this.pos < this.tokens.length) {
      elements.push(this.parseExpression());
    }

    if (this.peek() !== ")") {
      throw new Error("Expected ')' to close list");
    }

    this.consume(")");
    return createList(elements);
  }

  /**
   * Parse an atomic expression (number, string, symbol, nil, boolean)
   * @returns Atomic T-Lisp value
   */
  private parseAtom(): TLispValue {
    const token = this.advance();

    if (!token) {
      throw new Error("Unexpected end of input");
    }

    // Handle nil
    if (token === "nil") {
      return createNil();
    }

    // Handle boolean true
    if (token === "t") {
      return createBoolean(true);
    }

    // Handle numbers
    if (this.isNumber(token)) {
      return createNumber(parseFloat(token));
    }

    // Handle strings
    if (this.isString(token)) {
      return createString(this.parseStringLiteral(token));
    }

    // Handle symbols
    return createSymbol(token);
  }

  /**
   * Parse string literal, handling escape sequences
   * @param token - String token including quotes
   * @returns String content without quotes
   */
  private parseStringLiteral(token: string): string {
    if (token.length < 2 || !token.startsWith('"') || !token.endsWith('"')) {
      throw new Error("Invalid string literal");
    }

    // Remove quotes and handle escape sequences
    const content = token.slice(1, -1);
    return content.replace(/\\(.)/g, (match, char) => {
      switch (char) {
        case "n": return "\n";
        case "t": return "\t";
        case "r": return "\r";
        case "\\": return "\\";
        case '"': return '"';
        default: return char;
      }
    });
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
   * Consume expected token, throwing error if not found
   * @param expected - Expected token
   */
  private consume(expected: string): void {
    const token = this.advance();
    if (token !== expected) {
      throw new Error(`Expected '${expected}' but got '${token}'`);
    }
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