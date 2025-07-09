/**
 * @file tokenizer.ts
 * @description T-Lisp tokenizer implementation
 */

/**
 * T-Lisp tokenizer for converting source code into tokens
 */
export class TLispTokenizer {
  private pos: number = 0;
  private source: string = "";

  /**
   * Tokenize T-Lisp source code
   * @param source - Source code to tokenize
   * @returns Array of tokens
   */
  tokenize(source: string): string[] {
    this.source = source;
    this.pos = 0;
    const tokens: string[] = [];

    while (this.pos < this.source.length) {
      this.skipWhitespace();
      
      if (this.pos >= this.source.length) {
        break;
      }

      // Skip comments
      if (this.peek() === ";") {
        this.skipComment();
        continue;
      }

      const token = this.readToken();
      if (token) {
        tokens.push(token);
      }
    }

    return tokens;
  }

  /**
   * Skip whitespace characters
   */
  private skipWhitespace(): void {
    while (this.pos < this.source.length && this.isWhitespace(this.peek())) {
      this.pos++;
    }
  }

  /**
   * Skip comment (from ; to end of line)
   */
  private skipComment(): void {
    while (this.pos < this.source.length && this.peek() !== "\n") {
      this.pos++;
    }
  }

  /**
   * Read the next token
   * @returns Token string or null if no token
   */
  private readToken(): string | null {
    const char = this.peek();

    // Parentheses
    if (char === "(" || char === ")") {
      return this.advance().toString();
    }

    // Quote
    if (char === "'") {
      return this.advance().toString();
    }

    // Quasiquote (backquote)
    if (char === "`") {
      return this.advance().toString();
    }

    // Unquote and unquote-splicing
    if (char === ",") {
      if (this.peek(1) === "@") {
        this.advance(); // consume ','
        this.advance(); // consume '@'
        return ",@";
      }
      return this.advance().toString();
    }

    // String literals
    if (char === '"') {
      return this.readString();
    }

    // Numbers
    if (this.isDigit(char) || (char === "-" && this.isDigit(this.peek(1)))) {
      return this.readNumber();
    }

    // Symbols/atoms
    if (this.isSymbolStart(char)) {
      return this.readSymbol();
    }

    // Unknown character - skip it
    this.pos++;
    return null;
  }

  /**
   * Read a string literal
   * @returns String token including quotes
   */
  private readString(): string {
    let result = "";
    result += this.advance(); // Opening quote

    while (this.pos < this.source.length && this.peek() !== '"') {
      if (this.peek() === "\\") {
        // Handle escape sequences
        this.advance();
        if (this.pos < this.source.length) {
          const escaped = this.advance();
          switch (escaped) {
            case "n":
              result += "\n";
              break;
            case "t":
              result += "\t";
              break;
            case "r":
              result += "\r";
              break;
            case "\\":
              result += "\\";
              break;
            case '"':
              result += '"';
              break;
            default:
              result += escaped;
          }
        }
      } else {
        result += this.advance();
      }
    }

    if (this.pos < this.source.length) {
      result += this.advance(); // Closing quote
    } else {
      throw new Error("Unterminated string literal");
    }

    return result;
  }

  /**
   * Read a number
   * @returns Number token
   */
  private readNumber(): string {
    let result = "";

    if (this.peek() === "-") {
      result += this.advance();
    }

    while (this.pos < this.source.length && this.isDigit(this.peek())) {
      result += this.advance();
    }

    // Handle decimal point
    if (this.peek() === ".") {
      result += this.advance();
      while (this.pos < this.source.length && this.isDigit(this.peek())) {
        result += this.advance();
      }
    }

    return result;
  }

  /**
   * Read a symbol/atom
   * @returns Symbol token
   */
  private readSymbol(): string {
    let result = "";

    while (this.pos < this.source.length && this.isSymbolChar(this.peek())) {
      result += this.advance();
    }

    return result;
  }

  /**
   * Peek at character at current position + offset
   * @param offset - Offset from current position
   * @returns Character or empty string if out of bounds
   */
  private peek(offset = 0): string {
    const pos = this.pos + offset;
    return pos < this.source.length ? this.source[pos]! : "";
  }

  /**
   * Advance position and return current character
   * @returns Current character
   */
  private advance(): string {
    return this.source[this.pos++] || "";
  }

  /**
   * Check if character is whitespace
   * @param char - Character to check
   * @returns True if whitespace
   */
  private isWhitespace(char: string): boolean {
    return /\s/.test(char);
  }

  /**
   * Check if character is a digit
   * @param char - Character to check
   * @returns True if digit
   */
  private isDigit(char: string): boolean {
    return /\d/.test(char);
  }

  /**
   * Check if character can start a symbol
   * @param char - Character to check
   * @returns True if valid symbol start
   */
  private isSymbolStart(char: string): boolean {
    return /[a-zA-Z_+\-*/=<>!?]/.test(char);
  }

  /**
   * Check if character can be part of a symbol
   * @param char - Character to check
   * @returns True if valid symbol character
   */
  private isSymbolChar(char: string): boolean {
    return /[a-zA-Z0-9_+\-*/=<>!?]/.test(char);
  }
}