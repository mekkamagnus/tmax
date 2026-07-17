/**
 * @file c-parser.ts
 * @description Recursive-descent parser for C, producing ASTNode trees
 */

import { Either } from "../../../utils/task-either.ts";
import { createConfigError } from "../../../error/types.ts";
import type { SourceSpan } from "../../../tlisp/source.ts";
import type { ASTNode, ParseError, EditDescriptor, LanguageParser } from "../types.ts";
// CHORE-44 Change 11 AC11.4 — shared parser mechanics (position math only).
import {
  positionAt,
  spanFrom,
  emptySpanAt as sharedEmptySpanAt,
} from "./shared/source-position.ts";
import { bindNodeFactory } from "./shared/node-factory.ts";
import { TokenStream } from "./shared/token-stream.ts";

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

type TokenKind =
  | "identifier"
  | "number"
  | "string"
  | "char"
  | "punctuation"
  | "preprocessor"
  | "comment"
  | "eof";

interface Token {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Helpers — source offset → SourcePosition.
// CHORE-44 Change 11 AC11.4: the offset→(line,column) math now lives in
// `shared/source-position.ts`; local `pos`/`span`/`emptySpanAt` are thin
// curried wrappers so existing call sites stay byte-for-byte unchanged.
// ---------------------------------------------------------------------------

const pos = (offset: number, lineMap: number[]) => positionAt(offset, lineMap);
const span = (s: number, e: number, lm: number[]) => spanFrom(s, e, lm);
const emptySpanAt = (offset: number, lm: number[]) => sharedEmptySpanAt(offset, lm);

// CHORE-44 Change 11 AC11.4: language-bound node factory (bakes in "c").
const C_FACTORY = bindNodeFactory("c");

// ---------------------------------------------------------------------------
// C type-system keywords (for type-annotation parsing)
// ---------------------------------------------------------------------------

const TYPE_SPECIFIERS = new Set([
  "void", "char", "short", "int", "long", "float", "double",
  "signed", "unsigned", "_Bool", "_Complex", "_Imaginary",
  "size_t", "ssize_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t",
  "int8_t", "int16_t", "int32_t", "int64_t", "bool",
]);

const STORAGE_CLASSES = new Set([
  "typedef", "extern", "static", "_Thread_local", "register", "inline",
]);

const TYPE_QUALIFIERS = new Set(["const", "volatile", "restrict", "_Atomic"]);

const STATEMENT_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "default",
  "return", "break", "continue", "goto",
]);

const STRUCT_UNION_ENUM = new Set(["struct", "union", "enum"]);

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

const isIdentStart = (ch: string): boolean =>
  (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";

const isIdentPart = (ch: string): boolean =>
  isIdentStart(ch) || (ch >= "0" && ch <= "9");

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";

const isHexDigit = (ch: string): boolean =>
  isDigit(ch) || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = source.length;

  const push = (kind: TokenKind, start: number, end: number) => {
    tokens.push({ kind, text: source.slice(start, end), start, end });
  };

  while (i < len) {
    const ch = source[i]!;

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }

    // Preprocessor directive — entire line (including continuation lines)
    if (ch === "#") {
      const start = i;
      while (i < len) {
        if (source[i] === "\n") {
          // Check for line continuation
          if (i > 0 && source[i - 1] === "\\") {
            i++;
            continue;
          }
          break;
        }
        i++;
      }
      push("preprocessor", start, i);
      continue;
    }

    // Line comment
    if (ch === "/" && i + 1 < len && source[i + 1] === "/") {
      const start = i;
      while (i < len && source[i] !== "\n") i++;
      push("comment", start, i);
      continue;
    }

    // Block comment
    if (ch === "/" && i + 1 < len && source[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i + 1 < len && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2; // skip */
      push("comment", start, i);
      continue;
    }

    // String literal
    if (ch === '"') {
      const start = i;
      i++;
      while (i < len && source[i] !== '"') {
        if (source[i] === "\\") i++;
        i++;
      }
      i++; // closing "
      push("string", start, i);
      continue;
    }

    // Char literal
    if (ch === "'") {
      const start = i;
      i++;
      while (i < len && source[i] !== "'") {
        if (source[i] === "\\") i++;
        i++;
      }
      i++; // closing '
      push("char", start, i);
      continue;
    }

    // Number (decimal, hex, octal, float)
    if (isDigit(ch)) {
      const start = i;
      if (ch === "0" && i + 1 < len && (source[i + 1] === "x" || source[i + 1] === "X")) {
        i += 2;
        while (i < len && isHexDigit(source[i]!)) i++;
      } else {
        while (i < len && isDigit(source[i]!)) i++;
      }
      // Fractional part
      if (i < len && source[i] === ".") {
        i++;
        while (i < len && isDigit(source[i]!)) i++;
      }
      // Exponent
      if (i < len && (source[i] === "e" || source[i] === "E")) {
        i++;
        if (i < len && (source[i] === "+" || source[i] === "-")) i++;
        while (i < len && isDigit(source[i]!)) i++;
      }
      // Suffixes
      while (i < len && (source[i] === "f" || source[i] === "F" || source[i] === "l" || source[i] === "L"
        || source[i] === "u" || source[i] === "U")) i++;
      push("number", start, i);
      continue;
    }

    // Identifier / keyword
    if (isIdentStart(ch)) {
      const start = i;
      while (i < len && isIdentPart(source[i]!)) i++;
      push("identifier", start, i);
      continue;
    }

    // Multi-character punctuation: ->, ++, --, <<, >>, <=, >=, ==, !=, &&, ||, +=, -=, *=, /=, %=, &=, |=, ^=, ...
    const twoChar = i + 1 < len ? source.slice(i, i + 2) : "";
    const threeChar = i + 2 < len ? source.slice(i, i + 3) : "";

    const THREE_CHAR_OPS = ["<<=", ">>="];
    if (THREE_CHAR_OPS.includes(threeChar)) {
      push("punctuation", i, i + 3);
      i += 3;
      continue;
    }

    const TWO_CHAR_OPS = ["->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||",
      "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^="];
    if (TWO_CHAR_OPS.includes(twoChar)) {
      push("punctuation", i, i + 2);
      i += 2;
      continue;
    }

    // Single-character punctuation
    push("punctuation", i, i + 1);
    i++;
  }

  tokens.push({ kind: "eof", text: "", start: len, end: len });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser state
// ---------------------------------------------------------------------------

class CParser {
  private source: string;
  private name: string;
  private tokens: Token[];
  private pos: number = 0;
  private lineMap: number[];
  /**
   * Shared lookahead/advance/match mechanics (CHORE-44 Change 11 AC11.4).
   * The private `peek/advance/at/match/expect/atKind/isEof` methods below
   * delegate to this stream so behavior is unchanged; only the mechanic
   * moved to `shared/token-stream.ts`. `this.pos` is mirrored from the
   * stream's cursor after each advancing call so existing lookahead sites
   * (`this.tokens[this.pos + 1]`) continue to work identically.
   */
  private stream: TokenStream<Token>;

  constructor(source: string, name: string) {
    this.source = source;
    this.name = name;
    this.tokens = tokenize(source);

    // Build line offset map
    const lm = [0];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "\n") lm.push(i + 1);
    }
    this.lineMap = lm;

    this.stream = new TokenStream<Token>(this.tokens, {
      isEof: (t) => t.kind === "eof",
    });
  }

  // -- Token accessors (delegate to shared TokenStream) ---------------------

  private peek(): Token {
    return this.stream.peek();
  }

  private peekText(): string {
    return this.stream.peekText();
  }

  private advance(): Token {
    const tok = this.stream.advance();
    this.pos = this.stream.position;
    return tok;
  }

  private expect(text: string): Token {
    return this.stream.expect(
      text,
      (actual) => new Error(`Expected '${text}' but got '${actual.text}' at offset ${actual.start}`),
    );
  }

  private match(text: string): Token | null {
    const m = this.stream.match(text);
    if (m) this.pos = this.stream.position;
    return m;
  }

  private at(text: string): boolean {
    return this.stream.at(text);
  }

  private atKind(kind: TokenKind): boolean {
    return this.stream.atKind(kind);
  }

  private isEof(): boolean {
    return this.stream.atEnd();
  }

  // -- Node helpers --------------------------------------------------------

  private s(startOff: number, endOff: number): SourceSpan {
    return span(startOff, endOff, this.lineMap);
  }

  private emptyS(off: number): SourceSpan {
    return emptySpanAt(off, this.lineMap);
  }

  private node(kind: string, startOff: number, endOff: number, children: ASTNode[] = [], label?: string): ASTNode {
    return C_FACTORY.node(kind, this.s(startOff, endOff), children, label);
  }

  // -- Error recovery ------------------------------------------------------

  /** Skip to the next `;` or `}` at the same or lower brace depth. */
  private recoverToSync(): void {
    let depth = 0;
    while (!this.isEof()) {
      const t = this.peekText();
      if (t === "{") depth++;
      if (t === "}") {
        if (depth === 0) return; // let the caller handle it
        depth--;
      }
      if (t === ";" && depth === 0) return;
      this.advance();
    }
  }

  /** Skip to end of line (for preprocessor error recovery). */
  private recoverToEndOfLine(): void {
    while (!this.isEof() && this.peek().kind !== "preprocessor") {
      if (this.peek().start > 0) {
        // Check if we've advanced past a newline
        const off = this.peek().start;
        if (off > 0 && this.source[off - 1] === "\n") return;
      }
      this.advance();
    }
  }

  // -- Type parsing --------------------------------------------------------

  private isTypeName(): boolean {
    const tok = this.peek();
    if (tok.kind === "identifier") {
      // Could be a user-defined type via typedef — accept it
      // Heuristic: if next-next token is an identifier or * it's a type
      if (TYPE_SPECIFIERS.has(tok.text) || TYPE_QUALIFIERS.has(tok.text)
        || STORAGE_CLASSES.has(tok.text) || STRUCT_UNION_ENUM.has(tok.text)) {
        return true;
      }
      // Check if followed by an identifier (possibly with pointer stars)
      const lookahead = this.tokens[this.pos + 1];
      if (lookahead && (lookahead.text === "*" || lookahead.kind === "identifier")) {
        return true;
      }
      return false;
    }
    return false;
  }

  private parseTypeAnnotation(endOff?: { value: number }): ASTNode {
    const start = this.peek().start;
    const parts: ASTNode[] = [];

    // Storage class
    while (!this.isEof() && STORAGE_CLASSES.has(this.peekText())) {
      const tok = this.advance();
      parts.push(this.node("identifier", tok.start, tok.end));
    }

    // Type qualifiers
    while (!this.isEof() && TYPE_QUALIFIERS.has(this.peekText())) {
      const tok = this.advance();
      parts.push(this.node("identifier", tok.start, tok.end));
    }

    // struct/union/enum
    if (STRUCT_UNION_ENUM.has(this.peekText())) {
      const kindTok = this.advance();
      const kind = kindTok.text as "struct" | "union" | "enum";

      // Optional tag name
      let tagLabel: string | undefined;
      if (this.atKind("identifier")) {
        tagLabel = this.advance().text;
      }

      // Body { ... } — consume members inside the type annotation
      if (this.at("{")) {
        this.advance(); // skip {
        const members: ASTNode[] = [];

        while (!this.isEof() && !this.at("}")) {
          if (this.atKind("comment")) { this.advance(); continue; }
          if (this.atKind("preprocessor")) { members.push(this.parsePreprocessor()); continue; }
          try {
            const member = this.parseVariableDecl();
            if (member) members.push(member);
          } catch {
            this.recoverToSync();
            if (this.at(";")) this.advance();
          }
        }

        if (this.at("}")) this.advance();
      }

      // Pointer stars after struct/union/enum type
      while (!this.isEof() && this.at("*")) {
        const tok = this.advance();
        parts.push(this.node("identifier", tok.start, tok.end, [], "*"));
      }

      const end = this.peek().start;
      if (endOff) endOff.value = end;
      return this.node(kind, kindTok.start, end, parts, tagLabel);
    }

    // Base type specifier(s)
    while (!this.isEof()) {
      const t = this.peek();
      if (t.kind === "identifier" && (TYPE_SPECIFIERS.has(t.text) || TYPE_QUALIFIERS.has(t.text))) {
        const tok = this.advance();
        parts.push(this.node("identifier", tok.start, tok.end));
      } else if (t.kind === "identifier") {
        // User-defined type name — only consume if followed by another identifier or *
        // (indicating this is a typedef name like MyType or MyType*)
        const nextTok = this.tokens[this.pos + 1];
        if (nextTok && (nextTok.kind === "identifier" || nextTok.text === "*")) {
          const tok = this.advance();
          parts.push(this.node("identifier", tok.start, tok.end, [], tok.text));
          break;
        }
        // Otherwise it's the variable/function name — stop
        break;
      } else {
        break;
      }
    }

    // Pointer stars
    while (!this.isEof() && this.at("*")) {
      const tok = this.advance();
      parts.push(this.node("identifier", tok.start, tok.end, [], "*"));
    }

    const end = parts.length > 0 ? parts[parts.length - 1]!.span.end.offset : start;
    if (endOff) endOff.value = end;
    return this.node("type-annotation", start, end, parts);
  }

  // -- Declaration / definition parsing ------------------------------------

  private parseTopLevelDecl(): ASTNode | null {
    // Skip comments
    while (this.atKind("comment")) this.advance();
    if (this.isEof()) return null;

    const tok = this.peek();

    // Preprocessor directive
    if (tok.kind === "preprocessor") {
      return this.parsePreprocessor();
    }

    // struct/union/enum definition
    if (STRUCT_UNION_ENUM.has(tok.text)) {
      return this.parseStructUnionEnum();
    }

    // Type definition or function definition or variable declaration
    if (this.isTypeName()) {
      return this.parseDeclOrFunction();
    }

    // Unknown top-level construct — skip to sync
    const start = tok.start;
    this.recoverToSync();
    if (!this.isEof() && this.at(";")) this.advance();
    return this.node("error", start, this.peek().start);
  }

  private parsePreprocessor(): ASTNode {
    const tok = this.advance();
    return this.node("preprocessor", tok.start, tok.end, [], tok.text.trim());
  }

  private parseStructUnionEnum(): ASTNode {
    const kindTok = this.advance();
    const kind = kindTok.text as "struct" | "union" | "enum";

    // Optional name
    let label: string | undefined;
    if (this.atKind("identifier")) {
      label = this.advance().text;
    }

    // Body { ... }
    if (this.at("{")) {
      const bodyStart = this.advance().start; // skip {
      const members: ASTNode[] = [];

      while (!this.isEof() && !this.at("}")) {
        if (this.atKind("comment")) { this.advance(); continue; }
        if (this.atKind("preprocessor")) { members.push(this.parsePreprocessor()); continue; }

        try {
          const member = this.parseVariableDecl();
          if (member) members.push(member);
        } catch {
          this.recoverToSync();
          if (this.at(";")) this.advance();
        }
      }

      if (this.at("}")) this.advance();

      // Determine end — include trailing name if present
      let endOff = this.peek().start;
      if (this.atKind("identifier")) endOff = this.advance().end;
      if (this.at(";")) { endOff = this.advance().end; }

      return this.node(kind, kindTok.start, endOff, members, label);
    }

    // Just a type reference, e.g. struct Foo *x;
    let endOff = this.peek().start;
    if (this.at(";")) endOff = this.advance().end;
    return this.node(kind, kindTok.start, endOff, [], label);
  }

  private parseDeclOrFunction(): ASTNode | null {
    const start = this.peek().start;

    const typeNode = this.parseTypeAnnotation();
    let typeEnd = typeNode.span.end.offset;

    // Name
    if (!this.atKind("identifier")) {
      // Malformed — maybe just a type spec with semicolon
      if (this.at(";")) { this.advance(); }
      return this.node("error", start, this.peek().start);
    }

    const nameTok = this.advance();
    const label = nameTok.text;

    // Function definition: name(...)
    if (this.at("(")) {
      return this.parseFunctionDef(start, typeNode, nameTok, label);
    }

    // Variable declaration (possibly with array brackets or initializer)
    return this.parseVarDeclRest(start, typeNode, nameTok, label);
  }

  private parseFunctionDef(startOff: number, typeNode: ASTNode, nameTok: Token, label: string): ASTNode {
    // Parameters
    const params = this.parseParamList();

    // Body
    let body: ASTNode | null = null;
    if (this.at("{")) {
      body = this.parseBlock();
    }

    const endOff = body ? body.span.end.offset : this.peek().start;
    const children = [typeNode, ...params];
    if (body) children.push(body);
    return this.node("function", startOff, endOff, children, label);
  }

  private parseParamList(): ASTNode[] {
    const params: ASTNode[] = [];
    this.expect("(");

    while (!this.isEof() && !this.at(")")) {
      if (this.atKind("comment")) { this.advance(); continue; }

      // void parameter list
      if (this.at("void") && this.tokens[this.pos + 1]?.text === ")") {
        this.advance();
        break;
      }

      // ... variadic
      if (this.at("...")) {
        const tok = this.advance();
        params.push(this.node("parameter", tok.start, tok.end, [], "..."));
        break;
      }

      try {
        const param = this.parseParamDecl();
        if (param) params.push(param);
      } catch {
        // Recovery: skip to next , or )
        while (!this.isEof() && !this.at(",") && !this.at(")")) this.advance();
      }

      if (this.at(",")) this.advance();
    }

    if (this.at(")")) this.advance();
    return params;
  }

  private parseParamDecl(): ASTNode | null {
    if (this.at(")")) return null;
    const start = this.peek().start;

    const typeNode = this.parseTypeAnnotation();

    // Parameter name
    let label: string | undefined;
    let endOff = typeNode.span.end.offset;

    if (this.atKind("identifier")) {
      const nameTok = this.advance();
      label = nameTok.text;
      endOff = nameTok.end;
    }

    // Array brackets in parameter: int x[]
    while (this.at("[")) {
      const bracketStart = this.advance().start;
      while (!this.isEof() && !this.at("]")) this.advance();
      if (this.at("]")) endOff = this.advance().end;
    }

    return this.node("parameter", start, endOff, [typeNode], label);
  }

  private parseVarDeclRest(startOff: number, typeNode: ASTNode, nameTok: Token, label: string): ASTNode {
    let endOff = nameTok.end;
    const children: ASTNode[] = [typeNode];

    // Array dimensions: int x[10]
    while (this.at("[")) {
      this.advance();
      if (!this.at("]")) {
        children.push(this.parseExpression());
      }
      if (this.at("]")) endOff = this.advance().end;
    }

    // Initializer: = expr
    if (this.match("=")) {
      children.push(this.parseInitializer());
      endOff = children[children.length - 1]!.span.end.offset;
    }

    // Handle comma-separated declarations: int a, b, c;
    // We parse the first one; subsequent ones become siblings at the call site
    if (this.at(";")) endOff = this.advance().end;

    return this.node("variable", startOff, endOff, children, label);
  }

  private parseInitializer(): ASTNode {
    // Brace initializer list
    if (this.at("{")) {
      return this.parseInitializerList();
    }
    return this.parseAssignmentExpr();
  }

  private parseInitializerList(): ASTNode {
    const start = this.peek().start;
    this.expect("{");
    const items: ASTNode[] = [];

    while (!this.isEof() && !this.at("}")) {
      // Designated initializer: .field = value or [index] = value
      if (this.at(".") || this.at("[")) {
        items.push(this.parseDesignator());
        if (this.match("=")) {
          items.push(this.parseInitializer());
        }
      } else {
        items.push(this.parseInitializer());
      }
      if (this.at(",")) this.advance();
    }

    const end = this.at("}") ? this.advance().end : this.peek().start;
    return this.node("block", start, end, items);
  }

  private parseDesignator(): ASTNode {
    const start = this.peek().start;
    if (this.at(".")) {
      this.advance();
      const name = this.advance();
      return this.node("identifier", start, name.end, [], name.text);
    }
    if (this.at("[")) {
      this.advance();
      const expr = this.parseExpression();
      const end = this.at("]") ? this.advance().end : this.peek().start;
      return this.node("index-expr", start, end, [expr]);
    }
    // Fallback
    const tok = this.advance();
    return this.node("identifier", tok.start, tok.end, [], tok.text);
  }

  // -- Statement parsing ---------------------------------------------------

  private parseBlock(): ASTNode {
    const start = this.peek().start;
    this.expect("{");
    const stmts: ASTNode[] = [];

    while (!this.isEof() && !this.at("}")) {
      if (this.atKind("comment")) { this.advance(); continue; }
      if (this.atKind("preprocessor")) { stmts.push(this.parsePreprocessor()); continue; }

      try {
        const stmt = this.parseStatement();
        if (stmt) stmts.push(stmt);
      } catch {
        this.recoverToSync();
        if (this.at(";")) this.advance();
      }
    }

    const end = this.at("}") ? this.advance().end : this.peek().start;
    return this.node("block", start, end, stmts);
  }

  private parseStatement(): ASTNode | null {
    if (this.isEof()) return null;

    const tok = this.peek();

    // Comments
    if (tok.kind === "comment") {
      const ct = this.advance();
      return this.node("comment", ct.start, ct.end);
    }

    // Preprocessor
    if (tok.kind === "preprocessor") {
      return this.parsePreprocessor();
    }

    // Block
    if (tok.text === "{") {
      return this.parseBlock();
    }

    // If
    if (tok.text === "if") {
      return this.parseIf();
    }

    // For
    if (tok.text === "for") {
      return this.parseFor();
    }

    // While
    if (tok.text === "while") {
      return this.parseWhile();
    }

    // Do-while
    if (tok.text === "do") {
      return this.parseDoWhile();
    }

    // Switch
    if (tok.text === "switch") {
      return this.parseSwitch();
    }

    // Return
    if (tok.text === "return") {
      return this.parseReturn();
    }

    // Break
    if (tok.text === "break") {
      const t = this.advance();
      if (this.at(";")) this.advance();
      return this.node("break-stmt", t.start, this.peek().start);
    }

    // Continue
    if (tok.text === "continue") {
      const t = this.advance();
      if (this.at(";")) this.advance();
      return this.node("continue-stmt", t.start, this.peek().start);
    }

    // Goto
    if (tok.text === "goto") {
      const start = this.advance().start;
      const label = this.atKind("identifier") ? this.advance() : null;
      if (this.at(";")) this.advance();
      return this.node("identifier", start, this.peek().start, [], `goto ${label?.text ?? ""}`);
    }

    // Case / default
    if (tok.text === "case") {
      return this.parseCaseLabel();
    }
    if (tok.text === "default") {
      const start = this.advance().start;
      this.expect(":");
      return this.node("case", start, this.peek().start, [], "default");
    }

    // Label:
    if (tok.kind === "identifier" && this.tokens[this.pos + 1]?.text === ":") {
      const name = this.advance();
      this.advance(); // skip :
      return this.node("identifier", name.start, name.end, [], name.text);
    }

    // Type name → variable declaration
    if (this.isTypeName()) {
      return this.parseLocalVarDecl();
    }

    // Expression statement
    return this.parseExprStatement();
  }

  private parseLocalVarDecl(): ASTNode {
    const start = this.peek().start;
    const typeNode = this.parseTypeAnnotation();

    // Name
    if (!this.atKind("identifier")) {
      if (this.at(";")) this.advance();
      return this.node("error", start, this.peek().start);
    }

    const nameTok = this.advance();
    const label = nameTok.text;
    let endOff = nameTok.end;
    const children: ASTNode[] = [typeNode];

    // Array dimensions
    while (this.at("[")) {
      this.advance();
      if (!this.at("]")) children.push(this.parseExpression());
      if (this.at("]")) { endOff = this.advance().end; }
    }

    // Initializer
    if (this.match("=")) {
      children.push(this.parseInitializer());
      endOff = children[children.length - 1]!.span.end.offset;
    }

    // Handle multiple declarators: int a, b;
    while (this.at(",")) {
      this.advance();
      // We skip subsequent declarators — they'll be part of a sibling parse
      // Just consume up to the next , or ; or =
      while (!this.isEof() && !this.at(",") && !this.at(";") && !this.at("=")) this.advance();
      if (this.at("=")) {
        this.advance();
        this.parseInitializer();
      }
    }

    if (this.at(";")) endOff = this.advance().end;
    return this.node("variable", start, endOff, children, label);
  }

  private parseVariableDecl(): ASTNode | null {
    // Same as parseLocalVarDecl but used inside struct/union bodies
    return this.parseLocalVarDecl();
  }

  private parseIf(): ASTNode {
    const start = this.advance().start; // skip 'if'
    this.expect("(");
    const cond = this.parseExpression();
    this.expect(")");
    const thenBranch = this.parseStatement();

    const children: ASTNode[] = [cond];
    if (thenBranch) children.push(thenBranch);

    if (this.atKind("identifier") && this.peekText() === "else") {
      this.advance();
      const elseBranch = this.parseStatement();
      if (elseBranch) children.push(elseBranch);
    }

    const end = children.length > 0 ? children[children.length - 1]!.span.end.offset : this.peek().start;
    return this.node("if-stmt", start, end, children);
  }

  private parseFor(): ASTNode {
    const start = this.advance().start; // skip 'for'
    this.expect("(");

    const children: ASTNode[] = [];

    // Init
    if (!this.at(";")) {
      if (this.isTypeName()) {
        children.push(this.parseLocalVarDecl());
      } else {
        children.push(this.parseExpression());
        if (this.at(";")) this.advance();
      }
    } else {
      this.advance();
    }

    // Condition
    if (!this.at(";")) {
      children.push(this.parseExpression());
    }
    if (this.at(";")) this.advance();

    // Update
    if (!this.at(")")) {
      children.push(this.parseExpression());
    }
    this.expect(")");

    // Body
    const body = this.parseStatement();
    if (body) children.push(body);

    const end = children.length > 0 ? children[children.length - 1]!.span.end.offset : this.peek().start;
    return this.node("for-stmt", start, end, children);
  }

  private parseWhile(): ASTNode {
    const start = this.advance().start; // skip 'while'
    this.expect("(");
    const cond = this.parseExpression();
    this.expect(")");
    const body = this.parseStatement();

    const children = [cond];
    if (body) children.push(body);
    const end = children[children.length - 1]!.span.end.offset;
    return this.node("while-stmt", start, end, children);
  }

  private parseDoWhile(): ASTNode {
    const start = this.advance().start; // skip 'do'
    const body = this.parseStatement();
    this.expect("while"); // Note: 'while' is an identifier token
    this.expect("(");
    const cond = this.parseExpression();
    this.expect(")");
    if (this.at(";")) this.advance();

    const children: ASTNode[] = [];
    if (body) children.push(body);
    children.push(cond);
    const end = children[children.length - 1]!.span.end.offset;
    return this.node("do-while-stmt", start, end, children);
  }

  private parseSwitch(): ASTNode {
    const start = this.advance().start; // skip 'switch'
    this.expect("(");
    const expr = this.parseExpression();
    this.expect(")");
    const body = this.parseBlock();

    const end = body.span.end.offset;
    return this.node("switch-stmt", start, end, [expr, body]);
  }

  private parseCaseLabel(): ASTNode {
    const start = this.advance().start; // skip 'case'
    const expr = this.parseExpression();
    this.expect(":");
    return this.node("case", start, this.peek().start, [expr]);
  }

  private parseReturn(): ASTNode {
    const start = this.advance().start; // skip 'return'
    const children: ASTNode[] = [];

    if (!this.at(";")) {
      children.push(this.parseExpression());
    }

    if (this.at(";")) this.advance();
    const end = children.length > 0 ? children[children.length - 1]!.span.end.offset : this.peek().start;
    return this.node("return-stmt", start, end, children);
  }

  private parseExprStatement(): ASTNode {
    const start = this.peek().start;
    const expr = this.parseExpression();
    if (this.at(";")) this.advance();
    const end = this.peek().start;
    // If the expression was an assignment, promote it
    if (expr.kind === "assignment") return expr;
    // Wrap in a statement-like node only if needed
    return expr;
  }

  // -- Expression parsing (precedence climbing) ----------------------------

  private parseExpression(): ASTNode {
    return this.parseCommaExpr();
  }

  private parseCommaExpr(): ASTNode {
    let left = this.parseAssignmentExpr();
    while (this.at(",")) {
      const opStart = this.advance().start;
      const right = this.parseAssignmentExpr();
      left = this.node("binary-expr", left.span.start.offset, right.span.end.offset, [left, right], ",");
    }
    return left;
  }

  private parseAssignmentExpr(): ASTNode {
    const left = this.parseTernaryExpr();

    const ASSIGN_OPS = ["=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "|=", "^="];
    if (ASSIGN_OPS.includes(this.peekText())) {
      const op = this.advance().text;
      const right = this.parseAssignmentExpr();
      return this.node("assignment", left.span.start.offset, right.span.end.offset, [left, right], op);
    }

    return left;
  }

  private parseTernaryExpr(): ASTNode {
    let cond = this.parseOrExpr();

    if (this.at("?")) {
      this.advance();
      const thenExpr = this.parseExpression();
      this.expect(":");
      const elseExpr = this.parseTernaryExpr();
      return this.node("ternary-expr", cond.span.start.offset, elseExpr.span.end.offset, [cond, thenExpr, elseExpr]);
    }

    return cond;
  }

  private parseOrExpr(): ASTNode {
    let left = this.parseAndExpr();
    while (this.at("||")) {
      this.advance();
      const right = this.parseAndExpr();
      left = this.node("binary-expr", left.span.start.offset, right.span.end.offset, [left, right], "||");
    }
    return left;
  }

  private parseAndExpr(): ASTNode {
    let left = this.parseBitOrExpr();
    while (this.at("&&")) {
      this.advance();
      const right = this.parseBitOrExpr();
      left = this.node("binary-expr", left.span.start.offset, right.span.end.offset, [left, right], "&&");
    }
    return left;
  }

  private parseBitOrExpr(): ASTNode {
    let left = this.parseBitXorExpr();
    while (this.at("|")) {
      this.advance();
      const right = this.parseBitXorExpr();
      left = this.node("binary-expr", left.span.start.offset, right.span.end.offset, [left, right], "|");
    }
    return left;
  }

  private parseBitXorExpr(): ASTNode {
    let left = this.parseBitAndExpr();
    while (this.at("^")) {
      this.advance();
      const right = this.parseBitAndExpr();
      left = this.node("binary-expr", left.span.start.offset, right.span.end.offset, [left, right], "^");
    }
    return left;
  }

  private parseBitAndExpr(): ASTNode {
    let left = this.parseEqualityExpr();
    while (this.at("&")) {
      this.advance();
      const right = this.parseEqualityExpr();
      left = this.node("binary-expr", left.span.start.offset, right.span.end.offset, [left, right], "&");
    }
    return left;
  }

  private parseEqualityExpr(): ASTNode {
    let left = this.parseRelationalExpr();
    while (this.at("==") || this.at("!=")) {
      const op = this.advance().text;
      const right = this.parseRelationalExpr();
      left = this.node("binary-expr", left.span.start.offset, right.span.end.offset, [left, right], op);
    }
    return left;
  }

  private parseRelationalExpr(): ASTNode {
    let left = this.parseShiftExpr();
    while (this.at("<") || this.at(">") || this.at("<=") || this.at(">=")) {
      const op = this.advance().text;
      const right = this.parseShiftExpr();
      left = this.node("binary-expr", left.span.start.offset, right.span.end.offset, [left, right], op);
    }
    return left;
  }

  private parseShiftExpr(): ASTNode {
    let left = this.parseAdditiveExpr();
    while (this.at("<<") || this.at(">>")) {
      const op = this.advance().text;
      const right = this.parseAdditiveExpr();
      left = this.node("binary-expr", left.span.start.offset, right.span.end.offset, [left, right], op);
    }
    return left;
  }

  private parseAdditiveExpr(): ASTNode {
    let left = this.parseMultiplicativeExpr();
    while (this.at("+") || this.at("-")) {
      const op = this.advance().text;
      const right = this.parseMultiplicativeExpr();
      left = this.node("binary-expr", left.span.start.offset, right.span.end.offset, [left, right], op);
    }
    return left;
  }

  private parseMultiplicativeExpr(): ASTNode {
    let left = this.parseCastExpr();
    while (this.at("*") || this.at("/") || this.at("%")) {
      const op = this.advance().text;
      const right = this.parseCastExpr();
      left = this.node("binary-expr", left.span.start.offset, right.span.end.offset, [left, right], op);
    }
    return left;
  }

  private parseCastExpr(): ASTNode {
    // (type)expr — cast vs parenthesized expression
    if (this.at("(")) {
      // Lookahead to determine if this is a cast
      if (this.isCastLookahead()) {
        return this.parseCastExprInner();
      }
    }
    return this.parseUnaryExpr();
  }

  private isCastLookahead(): boolean {
    // Check if ( is followed by a type name
    const openParen = this.pos;
    // Temporarily skip past (
    let idx = this.pos + 1;

    // Skip qualifiers
    while (idx < this.tokens.length) {
      const t = this.tokens[idx]!;
      if (t.kind === "identifier" && (TYPE_QUALIFIERS.has(t.text) || STORAGE_CLASSES.has(t.text))) {
        idx++;
        continue;
      }
      break;
    }

    // Check for struct/union/enum
    if (idx < this.tokens.length && STRUCT_UNION_ENUM.has(this.tokens[idx]!.text)) {
      idx++;
      // Optional name
      if (idx < this.tokens.length && this.tokens[idx]!.kind === "identifier") idx++;
      // Closing paren
      if (idx < this.tokens.length && this.tokens[idx]!.text === ")") return true;
      return false;
    }

    // Check for basic type
    if (idx < this.tokens.length && this.tokens[idx]!.kind === "identifier"
      && TYPE_SPECIFIERS.has(this.tokens[idx]!.text)) {
      idx++;
      // Could be long long etc
      while (idx < this.tokens.length && this.tokens[idx]!.kind === "identifier"
        && (TYPE_SPECIFIERS.has(this.tokens[idx]!.text) || TYPE_QUALIFIERS.has(this.tokens[idx]!.text))) {
        idx++;
      }
      // Optional pointer stars
      while (idx < this.tokens.length && this.tokens[idx]!.text === "*") idx++;
      // Closing paren
      if (idx < this.tokens.length && this.tokens[idx]!.text === ")") return true;
      return false;
    }

    return false;
  }

  private parseCastExprInner(): ASTNode {
    const start = this.peek().start;
    this.expect("(");
    const typeNode = this.parseTypeAnnotation();
    this.expect(")");
    const expr = this.parseCastExpr();
    return this.node("cast-expr", start, expr.span.end.offset, [typeNode, expr]);
  }

  private parseUnaryExpr(): ASTNode {
    const tok = this.peek();

    // Prefix operators
    if (tok.text === "++" || tok.text === "--") {
      const start = this.advance().start;
      const operand = this.parseUnaryExpr();
      return this.node("unary-expr", start, operand.span.end.offset, [operand], tok.text);
    }

    if (tok.text === "&" || tok.text === "*" || tok.text === "+" || tok.text === "-" || tok.text === "~" || tok.text === "!") {
      const start = this.advance().start;
      const op = tok.text;
      const operand = this.parseCastExpr();
      return this.node("unary-expr", start, operand.span.end.offset, [operand], op);
    }

    // sizeof
    if (tok.text === "sizeof") {
      return this.parseSizeof();
    }

    return this.parsePostfixExpr();
  }

  private parseSizeof(): ASTNode {
    const start = this.advance().start; // skip 'sizeof'
    if (this.at("(")) {
      // Could be sizeof(type) or sizeof(expr)
      if (this.isCastLookahead()) {
        this.expect("(");
        const typeNode = this.parseTypeAnnotation();
        this.expect(")");
        return this.node("sizeof-expr", start, this.peek().start, [typeNode]);
      }
      // sizeof(expr)
      this.expect("(");
      const expr = this.parseExpression();
      const end = this.peek().start;
      this.expect(")");
      return this.node("sizeof-expr", start, end, [expr]);
    }
    // sizeof expr (no parens)
    const expr = this.parseUnaryExpr();
    return this.node("sizeof-expr", start, expr.span.end.offset, [expr]);
  }

  private parsePostfixExpr(): ASTNode {
    let expr = this.parsePrimaryExpr();

    while (!this.isEof()) {
      // Function call
      if (this.at("(")) {
        const args = this.parseArgList();
        expr = this.node("call", expr.span.start.offset, args.span.end.offset, [expr, ...args.children]);
        continue;
      }

      // Index
      if (this.at("[")) {
        const start = this.advance().start;
        const index = this.parseExpression();
        const end = this.at("]") ? this.advance().end : this.peek().start;
        expr = this.node("index-expr", expr.span.start.offset, end, [expr, index]);
        continue;
      }

      // Member access: . or ->
      if (this.at(".") || this.at("->")) {
        const op = this.advance().text;
        const member = this.expectKind("identifier");
        expr = this.node("member-expr", expr.span.start.offset, member.end, [expr], member.text);
        continue;
      }

      // Postfix ++ / --
      if (this.at("++") || this.at("--")) {
        const op = this.advance().text;
        expr = this.node("unary-expr", expr.span.start.offset, this.peek().start, [expr], op);
        continue;
      }

      break;
    }

    return expr;
  }

  private parseArgList(): ASTNode {
    const start = this.advance().start; // skip (
    const args: ASTNode[] = [];

    while (!this.isEof() && !this.at(")")) {
      args.push(this.parseAssignmentExpr());
      if (this.at(",")) this.advance();
    }

    const end = this.at(")") ? this.advance().end : this.peek().start;
    return this.node("block", start, end, args);
  }

  private expectKind(kind: TokenKind): Token {
    const tok = this.peek();
    if (tok.kind !== kind) {
      throw new Error(`Expected ${kind} but got ${tok.kind} ('${tok.text}') at offset ${tok.start}`);
    }
    return this.advance();
  }

  private parsePrimaryExpr(): ASTNode {
    const tok = this.peek();

    // Number literal
    if (tok.kind === "number") {
      this.advance();
      return this.node("number", tok.start, tok.end, [], tok.text);
    }

    // String literal (concatenated adjacent strings)
    if (tok.kind === "string") {
      const start = tok.start;
      let end = tok.end;
      this.advance();
      while (this.atKind("string")) {
        end = this.peek().end;
        this.advance();
      }
      return this.node("string", start, end, [], this.source.slice(start, end));
    }

    // Char literal
    if (tok.kind === "char") {
      this.advance();
      return this.node("number", tok.start, tok.end, [], tok.text);
    }

    // Parenthesized expression
    if (tok.text === "(") {
      this.advance();
      const expr = this.parseExpression();
      this.expect(")");
      return expr;
    }

    // Identifier
    if (tok.kind === "identifier") {
      this.advance();
      return this.node("identifier", tok.start, tok.end, [], tok.text);
    }

    // Fallback — consume one token and return an error node
    this.advance();
    return this.node("error", tok.start, tok.end);
  }

  // -- Top-level entry point -----------------------------------------------

  parse(): ASTNode {
    const children: ASTNode[] = [];

    while (!this.isEof()) {
      if (this.atKind("comment")) {
        const ct = this.advance();
        children.push(this.node("comment", ct.start, ct.end));
        continue;
      }
      if (this.atKind("preprocessor")) {
        children.push(this.parsePreprocessor());
        continue;
      }

      const decl = this.parseTopLevelDecl();
      if (decl) children.push(decl);
    }

    const startOff = children.length > 0 ? children[0]!.span.start.offset : 0;
    const endOff = children.length > 0 ? children[children.length - 1]!.span.end.offset : 0;

    return this.node("file", startOff, endOff, children, this.name);
  }
}

// ---------------------------------------------------------------------------
// Exported parser implementing LanguageParser
// ---------------------------------------------------------------------------

export const cParser: LanguageParser = {
  /**
   * Parse a C source file into an AST.
   */
  parse(source: string, name: string): Either<ParseError, ASTNode> {
    try {
      const parser = new CParser(source, name);
      const ast = parser.parse();
      return Either.right(ast);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Either.left(createConfigError("ParseError", `C parse error: ${message}`, name));
    }
  },

  /**
   * Incremental parse — delegates to full reparse for now.
   */
  parseIncremental(
    source: string,
    name: string,
    _previous: ASTNode,
    _edit: EditDescriptor,
  ): Either<ParseError, ASTNode> {
    return cParser.parse(source, name);
  },
};
