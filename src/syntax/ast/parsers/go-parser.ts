/**
 * @file go-parser.ts
 * @description Recursive-descent parser for Go source files.
 *              Produces ASTNode trees for the native AST engine.
 */

import type { Either } from "../../../utils/task-either.ts";
import { Either as E } from "../../../utils/task-either.ts";
import { createConfigError, type ConfigError } from "../../../error/types.ts";
import type { SourceSpan, SourcePosition } from "../../../tlisp/source.ts";
import type { ASTNode, ParseError, EditDescriptor, LanguageParser } from "../types.ts";
import { createNode } from "../types.ts";

// -- Span helpers -----------------------------------------------------------

const pos = (offset: number, line: number, col: number): SourcePosition =>
  ({ offset, line, column: col });
const span = (start: SourcePosition, end: SourcePosition): SourceSpan => ({ start, end });
const zeroSpan: SourceSpan = span(pos(0, 0, 0), pos(0, 0, 0));

// -- Token types ------------------------------------------------------------

type TokenType = "keyword" | "identifier" | "string" | "char" | "number"
  | "operator" | "punctuation" | "comment" | "eof";

interface Token {
  type: TokenType;
  value: string;
  start: SourcePosition;
  end: SourcePosition;
}

const GO_KEYWORDS = new Set([
  "break", "case", "chan", "const", "continue", "default", "defer", "else",
  "fallthrough", "for", "func", "go", "goto", "if", "import", "interface",
  "map", "package", "range", "return", "select", "struct", "switch", "type",
  "var",
]);

const isPunct = (tok: Token, v: string) => tok.type === "punctuation" && tok.value === v;
const isOp = (tok: Token, v: string) => tok.type === "operator" && tok.value === v;
const isKw = (tok: Token, v: string) => tok.type === "keyword" && tok.value === v;
const ASSIGN_OPS = new Set(["=", ":=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", "&^="]);

// -- Lexer ------------------------------------------------------------------

class GoLexer {
  private src: string;
  private offset = 0;
  private line = 0;
  private col = 0;
  private tokens: Token[] = [];
  private idx = 0;

  constructor(source: string) { this.src = source; this.tokenize(); }

  peek(): Token { return this.tokens[this.idx] ?? this.eofToken(); }
  advance(): Token { const t = this.peek(); if (this.idx < this.tokens.length) this.idx++; return t; }
  atEnd(): boolean { return this.peek().type === "eof"; }

  private tokenize(): void {
    while (this.offset < this.src.length) {
      this.skipWs();
      if (this.offset >= this.src.length) break;
      const ch = this.src[this.offset]!;
      if (ch === "/" && this.src[this.offset + 1] === "/") { this.readLineComment(); continue; }
      if (ch === "/" && this.src[this.offset + 1] === "*") { this.readBlockComment(); continue; }
      if (ch === '"' || ch === "`") { this.readString(ch); continue; }
      if (ch === "'") { this.readRune(); continue; }
      if (this.isDigit(ch)) { this.readNumber(); continue; }
      if (this.isIdentStart(ch)) { this.readIdent(); continue; }
      this.readOpOrPunct();
    }
  }

  private skipWs(): void {
    while (this.offset < this.src.length && " \t\r\n".includes(this.src[this.offset]!)) {
      this.adv(this.src[this.offset]!);
    }
  }

  private readLineComment(): void {
    const start = this.cur(); this.adv("/"); this.adv("/");
    let v = "//";
    while (this.offset < this.src.length && this.src[this.offset] !== "\n") {
      v += this.src[this.offset]!; this.adv(this.src[this.offset]!);
    }
    this.tokens.push({ type: "comment", value: v, start, end: this.cur() });
  }

  private readBlockComment(): void {
    const start = this.cur(); this.adv("/"); this.adv("*"); let v = "/*";
    while (this.offset < this.src.length) {
      if (this.src[this.offset] === "*" && this.src[this.offset + 1] === "/") {
        this.adv("*"); this.adv("/"); v += "*/"; break;
      }
      v += this.src[this.offset]!; this.adv(this.src[this.offset]!);
    }
    this.tokens.push({ type: "comment", value: v, start, end: this.cur() });
  }

  private readString(q: string): void {
    const start = this.cur(); this.adv(q); let v = q;
    if (q === "`") {
      while (this.offset < this.src.length && this.src[this.offset] !== "`") {
        v += this.src[this.offset]!; this.adv(this.src[this.offset]!);
      }
    } else {
      while (this.offset < this.src.length && this.src[this.offset] !== q) {
        if (this.src[this.offset] === "\\") {
          v += this.src[this.offset]!; this.adv(this.src[this.offset]!);
          if (this.offset < this.src.length) { v += this.src[this.offset]!; this.adv(this.src[this.offset]!); }
          continue;
        }
        v += this.src[this.offset]!; this.adv(this.src[this.offset]!);
      }
    }
    if (this.offset < this.src.length) { v += this.src[this.offset]!; this.adv(this.src[this.offset]!); }
    this.tokens.push({ type: "string", value: v, start, end: this.cur() });
  }

  private readRune(): void {
    const start = this.cur(); this.adv("'"); let v = "'";
    while (this.offset < this.src.length && this.src[this.offset] !== "'") {
      if (this.src[this.offset] === "\\") {
        v += this.src[this.offset]!; this.adv(this.src[this.offset]!);
        if (this.offset < this.src.length) { v += this.src[this.offset]!; this.adv(this.src[this.offset]!); }
        continue;
      }
      v += this.src[this.offset]!; this.adv(this.src[this.offset]!);
    }
    if (this.offset < this.src.length) { v += this.src[this.offset]!; this.adv(this.src[this.offset]!); }
    this.tokens.push({ type: "char", value: v, start, end: this.cur() });
  }

  private readNumber(): void {
    const start = this.cur(); let v = "";
    if (this.src[this.offset] === "0" && this.offset + 1 < this.src.length) {
      const n = this.src[this.offset + 1]!.toLowerCase();
      if (n === "x" || n === "o" || n === "b") {
        v += this.adv(this.src[this.offset]!); v += this.adv(this.src[this.offset]!);
        while (this.offset < this.src.length && this.isHex(this.src[this.offset]!)) v += this.adv(this.src[this.offset]!);
        this.tokens.push({ type: "number", value: v, start, end: this.cur() }); return;
      }
    }
    while (this.offset < this.src.length && (this.isDigit(this.src[this.offset]!) || ".eE+-".includes(this.src[this.offset]!))) {
      v += this.adv(this.src[this.offset]!);
    }
    if (this.offset < this.src.length && this.src[this.offset] === "i") v += this.adv("i");
    this.tokens.push({ type: "number", value: v, start, end: this.cur() });
  }

  private readIdent(): void {
    const start = this.cur(); let v = "";
    while (this.offset < this.src.length && this.isIdCont(this.src[this.offset]!)) v += this.adv(this.src[this.offset]!);
    this.tokens.push({ type: GO_KEYWORDS.has(v) ? "keyword" : "identifier", value: v, start, end: this.cur() });
  }

  private readOpOrPunct(): void {
    const start = this.cur(); const ch = this.src[this.offset]!;
    if (this.offset + 1 < this.src.length) {
      const two = ch + this.src[this.offset + 1];
      if ([":=", "++", "--", "==", "!=", "<=", ">=", "&&", "||", "<<", ">>", "&^", "<-"].includes(two)) {
        this.adv(ch); this.adv(this.src[this.offset]!);
        this.tokens.push({ type: "operator", value: two, start, end: this.cur() }); return;
      }
    }
    this.adv(ch);
    this.tokens.push({ type: "(){}[];,.:".includes(ch) ? "punctuation" : "operator", value: ch, start, end: this.cur() });
  }

  private cur(): SourcePosition { return pos(this.offset, this.line, this.col); }
  private adv(ch: string): string {
    if (ch === "\n") { this.line++; this.col = 0; } else { this.col++; }
    this.offset++; return ch;
  }
  private eofToken(): Token { const p = this.cur(); return { type: "eof", value: "", start: p, end: p }; }
  private isDigit(c: string): boolean { return c >= "0" && c <= "9"; }
  private isHex(c: string): boolean { return this.isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F") || c === "_"; }
  private isIdentStart(c: string): boolean { return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_"; }
  private isIdCont(c: string): boolean { return this.isIdentStart(c) || this.isDigit(c); }
}

// -- Recursive-descent parser -----------------------------------------------

const LANG = "go";

class GoParser {
  private lex: GoLexer;
  private src: string;

  constructor(source: string) { this.src = source; this.lex = new GoLexer(source); }

  parse(name: string): Either<ParseError, ASTNode> {
    const start = this.lex.peek().start;
    const children: ASTNode[] = [];
    const pkg = this.parsePackage();
    if (E.isLeft(pkg)) return pkg;
    children.push(pkg.right);
    while (!this.lex.atEnd()) {
      const tok = this.lex.peek();
      if (tok.type === "comment") { children.push(this.tokNode(this.lex.advance())); continue; }
      const decl = this.parseTopLevel();
      if (E.isLeft(decl)) return decl;
      if (decl.right) children.push(decl.right);
    }
    const end = children.length > 0 ? children[children.length - 1]!.span.end : this.lex.peek().end;
    return E.right(createNode("file", span(start, end), LANG, children, name));
  }

  private parsePackage(): Either<ParseError, ASTNode> {
    const start = this.lex.peek().start;
    this.expectKw("package");
    const t = this.lex.peek();
    if (t.type !== "identifier") return E.left(createConfigError("ParseError", "Expected identifier after package", ""));
    this.lex.advance();
    return E.right(createNode("identifier", span(start, t.end), LANG, [], t.value));
  }

  // -- top-level declarations ------------------------------------------------

  private parseTopLevel(): Either<ParseError, ASTNode | null> {
    const v = this.lex.peek().value;
    if (this.lex.peek().type === "eof") return E.right(null);
    if (v === "import") return this.parseImport();
    if (v === "func") return this.parseFuncDecl();
    if (v === "type") return this.parseTypeDecl();
    if (v === "var") return this.parseVarDecl();
    if (v === "const") return this.parseConstDecl();
    return E.right(this.recoverSkip());
  }

  // -- imports ---------------------------------------------------------------

  private parseImport(): Either<ParseError, ASTNode> {
    const start = this.lex.peek().start; this.lex.advance();
    if (isPunct(this.lex.peek(), "(")) {
      this.lex.advance();
      const ch: ASTNode[] = [];
      while (!this.lex.atEnd() && !isPunct(this.lex.peek(), ")")) {
        if (this.lex.peek().type === "comment") { ch.push(this.tokNode(this.lex.advance())); continue; }
        ch.push(this.parseImportSpec());
      }
      this.lex.advance();
      return E.right(createNode("import", span(start, this.lex.peek().end), LANG, ch));
    }
    const spec = this.parseImportSpec();
    return E.right(createNode("import", span(start, spec.span.end), LANG, [spec]));
  }

  private parseImportSpec(): ASTNode {
    const start = this.lex.peek().start;
    let label: string | undefined;
    if (isOp(this.lex.peek(), ".")) { label = "."; this.lex.advance(); }
    else if (this.lex.peek().type === "identifier") {
      const saved = this.lex.advance();
      if (this.lex.peek().type === "string") label = saved.value;
      else label = saved.value;
    }
    const path = this.lex.advance();
    return createNode("import", span(start, path.end), LANG, [this.tokNode(path)], label);
  }

  // -- function / method declarations ----------------------------------------

  private parseFuncDecl(): Either<ParseError, ASTNode> {
    const start = this.lex.peek().start; this.lex.advance();
    let typeParams: ASTNode[] = [];
    if (isPunct(this.lex.peek(), "[")) typeParams = this.parseTypeParams();

    let receiver: ASTNode | null = null;
    if (isPunct(this.lex.peek(), "(")) receiver = this.tryParseReceiver();

    const nameTok = this.lex.peek();
    const funcName = nameTok.type === "identifier" ? nameTok.value : "";
    if (nameTok.type === "identifier") this.lex.advance();

    if (isPunct(this.lex.peek(), "[")) typeParams = this.parseTypeParams();

    const params = this.parseParamList();
    const children: ASTNode[] = [];
    if (receiver) children.push(receiver);
    if (typeParams.length > 0) children.push(...typeParams);
    children.push(params);

    if (isPunct(this.lex.peek(), "(")) children.push(...this.parseNamedReturns());
    else { const r = this.tryParseType(); if (r) children.push(r); }

    const body = this.parseBlock();
    if (body) children.push(body);
    const end = body ? body.span.end : this.lex.peek().end;
    return E.right(createNode(receiver ? "method" : "function", span(start, end), LANG, children, funcName));
  }

  private tryParseReceiver(): ASTNode | null {
    if (!isPunct(this.lex.peek(), "(")) return null;
    const start = this.lex.peek().start; this.lex.advance();
    const first = this.lex.peek();
    if (isPunct(first, ")")) { this.lex.advance(); return null; }

    let label: string | undefined;
    const ch: ASTNode[] = [];

    if (isOp(first, "*")) {
      ch.push(this.tokNode(this.lex.advance()));
      if (this.lex.peek().type === "identifier") ch.push(this.tokNode(this.lex.advance()));
    } else if (first.type === "identifier") {
      const ident = this.lex.advance();
      if (isOp(this.lex.peek(), "*") || this.lex.peek().type === "identifier") {
        label = ident.value;
        ch.push(createNode("identifier", span(ident.start, ident.end), LANG, [], ident.value));
        if (isOp(this.lex.peek(), "*")) ch.push(this.tokNode(this.lex.advance()));
        if (this.lex.peek().type === "identifier") ch.push(this.tokNode(this.lex.advance()));
      } else { return null; }
    } else { return null; }

    if (isPunct(this.lex.peek(), ")")) this.lex.advance();
    if (this.lex.peek().type !== "identifier") return null;
    return createNode("parameter", span(start, this.lex.peek().start), LANG, ch, label);
  }

  private parseParamList(): ASTNode {
    if (!isPunct(this.lex.peek(), "(")) return createNode("parameter", zeroSpan, LANG);
    const start = this.lex.peek().start; this.lex.advance();
    const ch: ASTNode[] = [];
    while (!this.lex.atEnd() && !isPunct(this.lex.peek(), ")")) {
      if (this.lex.peek().type === "comment") { ch.push(this.tokNode(this.lex.advance())); continue; }
      ch.push(this.parseParam());
    }
    if (isPunct(this.lex.peek(), ")")) this.lex.advance();
    return createNode("parameter", span(start, this.lex.peek().start), LANG, ch);
  }

  private parseParam(): ASTNode {
    const start = this.lex.peek().start;
    const ch: ASTNode[] = []; let label: string | undefined;

    if (this.lex.peek().value === "...") {
      ch.push(this.tokNode(this.lex.advance()));
      const t = this.tryParseType(); if (t) ch.push(t);
      return createNode("parameter", span(start, this.lex.peek().start), LANG, ch);
    }

    const first = this.lex.peek();
    if (first.type === "identifier") {
      const ident = this.lex.advance(); const next = this.lex.peek();
      if (next.type === "identifier" || isOp(next, "*") || isPunct(next, "[") || isPunct(next, "{") || next.value === "...") {
        label = ident.value;
        ch.push(createNode("identifier", span(ident.start, ident.end), LANG, [], ident.value));
        const t = this.tryParseType(); if (t) ch.push(t);
      } else { ch.push(createNode("identifier", span(ident.start, ident.end), LANG, [], ident.value)); }
    } else { const t = this.tryParseType(); if (t) ch.push(t); }

    if (isPunct(this.lex.peek(), ",")) this.lex.advance();
    return createNode("parameter", span(start, this.lex.peek().start), LANG, ch, label);
  }

  private parseNamedReturns(): ASTNode[] {
    if (!isPunct(this.lex.peek(), "(")) return [];
    this.lex.advance();
    const rets: ASTNode[] = [];
    while (!this.lex.atEnd() && !isPunct(this.lex.peek(), ")")) {
      if (this.lex.peek().type === "comment") { this.lex.advance(); continue; }
      rets.push(this.parseParam());
    }
    if (isPunct(this.lex.peek(), ")")) this.lex.advance();
    return rets;
  }

  // -- type declarations -----------------------------------------------------

  private parseTypeDecl(): Either<ParseError, ASTNode> {
    const start = this.lex.peek().start; this.lex.advance();
    let tp: ASTNode[] = [];
    const nameTok = this.lex.advance();
    const name = nameTok.type === "identifier" ? nameTok.value : "";
    if (isPunct(this.lex.peek(), "[")) tp = this.parseTypeParams();

    const next = this.lex.peek();
    if (isKw(next, "struct")) return this.parseStructBody(start, name, tp);
    if (isKw(next, "interface")) return this.parseInterfaceBody(start, name, tp);

    const alias = this.tryParseType();
    const ch = [...tp]; if (alias) ch.push(alias);
    return E.right(createNode(tp.length > 0 ? "struct" : "type-alias", span(start, this.lex.peek().start), LANG, ch, name));
  }

  private parseStructBody(start: SourcePosition, name: string, tp: ASTNode[]): Either<ParseError, ASTNode> {
    this.lex.advance(); // 'struct'
    const ch: ASTNode[] = [...tp];
    if (isPunct(this.lex.peek(), "{")) {
      this.lex.advance();
      while (!this.lex.atEnd() && !isPunct(this.lex.peek(), "}")) {
        if (this.lex.peek().type === "comment") { ch.push(this.tokNode(this.lex.advance())); continue; }
        ch.push(this.parseFieldDecl());
      }
      if (isPunct(this.lex.peek(), "}")) this.lex.advance();
    }
    return E.right(createNode("struct", span(start, this.lex.peek().start), LANG, ch, name));
  }

  private parseFieldDecl(): ASTNode {
    const start = this.lex.peek().start;
    const ch: ASTNode[] = []; let label: string | undefined;
    const first = this.lex.peek();
    if (first.type === "identifier") {
      const ident = this.lex.advance(); const next = this.lex.peek();
      if (next.type === "identifier" || isOp(next, "*") || isPunct(next, "[") || next.value === "...") {
        label = ident.value;
        ch.push(createNode("identifier", span(ident.start, ident.end), LANG, [], ident.value));
        const t = this.tryParseType(); if (t) ch.push(t);
      } else if (isPunct(next, ",")) {
        label = ident.value;
        ch.push(createNode("identifier", span(ident.start, ident.end), LANG, [], ident.value));
        this.lex.advance();
        while (this.lex.peek().type === "identifier") {
          ch.push(this.tokNode(this.lex.advance()));
          if (isPunct(this.lex.peek(), ",")) this.lex.advance(); else break;
        }
        const t = this.tryParseType(); if (t) ch.push(t);
      } else {
        ch.push(createNode("type-annotation", span(ident.start, ident.end), LANG, [], ident.value));
      }
    } else if (isOp(first, "*")) {
      ch.push(this.tokNode(this.lex.advance()));
      const t = this.tryParseType(); if (t) ch.push(t);
    }
    if (this.lex.peek().type === "string") ch.push(this.tokNode(this.lex.advance()));
    return createNode("variable", span(start, this.lex.peek().start), LANG, ch, label);
  }

  private parseInterfaceBody(start: SourcePosition, name: string, tp: ASTNode[]): Either<ParseError, ASTNode> {
    this.lex.advance(); // 'interface'
    const ch: ASTNode[] = [...tp];
    if (isPunct(this.lex.peek(), "{")) {
      this.lex.advance();
      while (!this.lex.atEnd() && !isPunct(this.lex.peek(), "}")) {
        if (this.lex.peek().type === "comment") { ch.push(this.tokNode(this.lex.advance())); continue; }
        ch.push(this.parseIfaceMethod());
      }
      if (isPunct(this.lex.peek(), "}")) this.lex.advance();
    }
    return E.right(createNode("interface", span(start, this.lex.peek().start), LANG, ch, name));
  }

  private parseIfaceMethod(): ASTNode {
    const start = this.lex.peek().start;
    const ch: ASTNode[] = []; let label: string | undefined;
    const first = this.lex.peek();
    if (first.type === "identifier") {
      label = first.value; ch.push(this.tokNode(this.lex.advance()));
      if (isPunct(this.lex.peek(), "(")) { ch.push(this.parseParamList()); const r = this.tryParseType(); if (r) ch.push(r); }
    } else if (isOp(first, "*")) { ch.push(this.tokNode(this.lex.advance())); const t = this.tryParseType(); if (t) ch.push(t); }
    return createNode("method", span(start, this.lex.peek().start), LANG, ch, label);
  }

  // -- var / const -----------------------------------------------------------

  private parseVarDecl(): Either<ParseError, ASTNode> {
    const start = this.lex.peek().start; this.lex.advance();
    if (isPunct(this.lex.peek(), "(")) return this.parseVarGroup(start);
    const nameTok = this.lex.advance();
    const label = nameTok.type === "identifier" ? nameTok.value : "";
    const ch: ASTNode[] = [];
    const t = this.tryParseType(); if (t) ch.push(t);
    if (isOp(this.lex.peek(), "=")) { this.lex.advance(); ch.push(...this.parseExprList()); }
    return E.right(createNode("variable", span(start, this.lex.peek().start), LANG, ch, label));
  }

  private parseVarGroup(start: SourcePosition): Either<ParseError, ASTNode> {
    this.lex.advance();
    const ch: ASTNode[] = [];
    while (!this.lex.atEnd() && !isPunct(this.lex.peek(), ")")) {
      if (this.lex.peek().type === "comment") { ch.push(this.tokNode(this.lex.advance())); continue; }
      ch.push(this.parseVarSpec());
    }
    if (isPunct(this.lex.peek(), ")")) this.lex.advance();
    return E.right(createNode("variable", span(start, this.lex.peek().start), LANG, ch));
  }

  private parseVarSpec(): ASTNode {
    const start = this.lex.peek().start;
    const names: ASTNode[] = [];
    while (this.lex.peek().type === "identifier") {
      names.push(this.tokNode(this.lex.advance()));
      if (isPunct(this.lex.peek(), ",")) this.lex.advance(); else break;
    }
    const ch: ASTNode[] = [...names];
    let label: string | undefined;
    if (names.length === 1 && names[0]!.label) label = names[0]!.label;
    const t = this.tryParseType(); if (t) ch.push(t);
    if (isOp(this.lex.peek(), "=")) { this.lex.advance(); ch.push(...this.parseExprList()); }
    return createNode("variable", span(start, this.lex.peek().start), LANG, ch, label);
  }

  private parseConstDecl(): Either<ParseError, ASTNode> {
    const start = this.lex.peek().start; this.lex.advance();
    if (isPunct(this.lex.peek(), "(")) {
      this.lex.advance(); const ch: ASTNode[] = [];
      while (!this.lex.atEnd() && !isPunct(this.lex.peek(), ")")) ch.push(this.parseVarSpec());
      if (isPunct(this.lex.peek(), ")")) this.lex.advance();
      return E.right(createNode("variable", span(start, this.lex.peek().start), LANG, ch));
    }
    const nameTok = this.lex.advance();
    const label = nameTok.type === "identifier" ? nameTok.value : "";
    const ch: ASTNode[] = [];
    const t = this.tryParseType(); if (t) ch.push(t);
    if (isOp(this.lex.peek(), "=")) { this.lex.advance(); ch.push(...this.parseExprList()); }
    return E.right(createNode("variable", span(start, this.lex.peek().start), LANG, ch, label));
  }

  // -- statements ------------------------------------------------------------

  private parseBlock(): ASTNode | null {
    if (!isPunct(this.lex.peek(), "{")) return null;
    const start = this.lex.peek().start; this.lex.advance();
    const ch: ASTNode[] = [];
    while (!this.lex.atEnd() && !isPunct(this.lex.peek(), "}")) {
      if (this.lex.peek().type === "comment") { ch.push(this.tokNode(this.lex.advance())); continue; }
      const s = this.parseStmt(); if (s) ch.push(s);
    }
    if (isPunct(this.lex.peek(), "}")) this.lex.advance();
    return createNode("block", span(start, this.lex.peek().start), LANG, ch);
  }

  private parseStmt(): ASTNode | null {
    const tok = this.lex.peek();
    if (tok.type === "eof") return null;
    switch (tok.value) {
      case "if": return this.parseIf();
      case "for": return this.parseFor();
      case "switch": return this.parseSwitch();
      case "select": return this.parseSelect();
      case "return": return this.parseReturn();
      case "break": return this.parseKwStmt("break-stmt");
      case "continue": return this.parseKwStmt("continue-stmt");
      case "defer": return this.parseDefer();
      case "go": return this.parseGo();
      case "var": return this.ok(this.parseVarDecl());
      case "const": return this.ok(this.parseConstDecl());
      case "type": return this.ok(this.parseTypeDecl());
      default: return this.parseSimpleOrExpr();
    }
  }

  private ok(e: Either<ParseError, ASTNode | null>): ASTNode | null {
    return E.isLeft(e) ? this.recoverSkip() : e.right;
  }

  private parseIf(): ASTNode {
    const start = this.lex.peek().start; this.lex.advance();
    const ch: ASTNode[] = [];
    if (this.hasSemiAhead()) {
      const init = this.parseSimpleStmtRaw(); if (init) ch.push(init);
      if (isPunct(this.lex.peek(), ";")) this.lex.advance();
    }
    const cond = this.parseExpr(); if (cond) ch.push(cond);
    const body = this.parseBlock(); if (body) ch.push(body);
    if (isKw(this.lex.peek(), "else")) {
      this.lex.advance();
      if (isKw(this.lex.peek(), "if")) ch.push(this.parseIf());
      else { const eb = this.parseBlock(); if (eb) ch.push(eb); }
    }
    return createNode("if-stmt", span(start, this.lex.peek().start), LANG, ch);
  }

  private parseFor(): ASTNode {
    const start = this.lex.peek().start; this.lex.advance();
    const tok = this.lex.peek();
    if (isPunct(tok, "{")) {
      const b = this.parseBlock();
      return createNode("for-stmt", span(start, b ? b.span.end : this.lex.peek().start), LANG, b ? [b] : []);
    }
    if (isKw(tok, "range")) {
      this.lex.advance(); const e = this.parseExpr(); const b = this.parseBlock();
      const ch: ASTNode[] = []; if (e) ch.push(e); if (b) ch.push(b);
      return createNode("range-stmt", span(start, this.lex.peek().start), LANG, ch);
    }
    const ch: ASTNode[] = [];
    const init = this.parseSimpleStmtRaw(); if (init) ch.push(init);
    if (isPunct(this.lex.peek(), ";")) this.lex.advance();
    if (isKw(this.lex.peek(), "range")) {
      this.lex.advance();
      const e = this.parseExpr(); if (e) ch.push(e);
      const b = this.parseBlock(); if (b) ch.push(b);
      return createNode("range-stmt", span(start, this.lex.peek().start), LANG, ch);
    }
    const cond = this.parseExpr(); if (cond) ch.push(cond);
    if (isPunct(this.lex.peek(), ";")) this.lex.advance();
    const post = this.parseSimpleStmtRaw(); if (post) ch.push(post);
    const b = this.parseBlock(); if (b) ch.push(b);
    return createNode("for-stmt", span(start, this.lex.peek().start), LANG, ch);
  }

  private parseSwitch(): ASTNode {
    const start = this.lex.peek().start; this.lex.advance();
    const ch: ASTNode[] = [];
    if (this.hasSemiAhead()) {
      const init = this.parseSimpleStmtRaw(); if (init) ch.push(init);
      if (isPunct(this.lex.peek(), ";")) this.lex.advance();
    }
    const expr = this.parseExpr(); if (expr) ch.push(expr);
    if (isPunct(this.lex.peek(), "{")) {
      this.lex.advance();
      while (!this.lex.atEnd() && !isPunct(this.lex.peek(), "}")) {
        if (this.lex.peek().type === "comment") { ch.push(this.tokNode(this.lex.advance())); continue; }
        ch.push(this.parseCase());
      }
      if (isPunct(this.lex.peek(), "}")) this.lex.advance();
    }
    return createNode("switch-stmt", span(start, this.lex.peek().start), LANG, ch);
  }

  private parseSelect(): ASTNode {
    const start = this.lex.peek().start; this.lex.advance();
    const ch: ASTNode[] = [];
    if (isPunct(this.lex.peek(), "{")) {
      this.lex.advance();
      while (!this.lex.atEnd() && !isPunct(this.lex.peek(), "}")) {
        if (this.lex.peek().type === "comment") { ch.push(this.tokNode(this.lex.advance())); continue; }
        ch.push(this.parseCase());
      }
      if (isPunct(this.lex.peek(), "}")) this.lex.advance();
    }
    return createNode("select-stmt", span(start, this.lex.peek().start), LANG, ch);
  }

  private parseCase(): ASTNode {
    const start = this.lex.peek().start;
    const ch: ASTNode[] = [];
    if (isKw(this.lex.peek(), "case")) {
      this.lex.advance();
      while (!this.lex.atEnd() && !isPunct(this.lex.peek(), ":")) {
        if (isPunct(this.lex.peek(), ",")) { this.lex.advance(); continue; }
        const e = this.parseExpr(); if (e) ch.push(e);
        if (isPunct(this.lex.peek(), ",")) this.lex.advance();
      }
    } else if (isKw(this.lex.peek(), "default")) { this.lex.advance(); }
    if (isPunct(this.lex.peek(), ":")) this.lex.advance();
    while (!this.lex.atEnd()) {
      const n = this.lex.peek();
      if (isPunct(n, "}")) break;
      if (n.type === "keyword" && (n.value === "case" || n.value === "default")) break;
      if (n.type === "comment") { ch.push(this.tokNode(this.lex.advance())); continue; }
      const s = this.parseStmt(); if (s) ch.push(s);
    }
    return createNode("case", span(start, this.lex.peek().start), LANG, ch);
  }

  private parseReturn(): ASTNode {
    const start = this.lex.peek().start; this.lex.advance();
    const ch: ASTNode[] = [];
    const t = this.lex.peek();
    if (t.type !== "punctuation" || (t.value !== "}" && t.value !== ")")) {
      if (t.type !== "eof") ch.push(...this.parseExprList());
    }
    return createNode("return-stmt", span(start, this.lex.peek().start), LANG, ch);
  }

  private parseKwStmt(kind: string): ASTNode {
    const start = this.lex.peek().start; this.lex.advance();
    let label: string | undefined;
    if (this.lex.peek().type === "identifier") label = this.lex.advance().value;
    return createNode(kind, span(start, this.lex.peek().start), LANG, [], label);
  }

  private parseDefer(): ASTNode {
    const start = this.lex.peek().start; this.lex.advance();
    const e = this.parseExpr();
    return createNode("defer-stmt", span(start, e ? e.span.end : this.lex.peek().start), LANG, e ? [e] : []);
  }

  private parseGo(): ASTNode {
    const start = this.lex.peek().start; this.lex.advance();
    const e = this.parseExpr();
    return createNode("go-stmt", span(start, e ? e.span.end : this.lex.peek().start), LANG, e ? [e] : []);
  }

  // -- simple statement (for init/post, before ;) ----------------------------

  private parseSimpleStmtRaw(): ASTNode | null {
    const tok = this.lex.peek();
    if (tok.type === "eof" || isPunct(tok, "{")) return null;
    const start = tok.start;
    const exprs = this.parseExprList();
    if (exprs.length === 0) return null;
    const next = this.lex.peek();
    if (next.type === "operator" && (next.value === ":=" || next.value === "=")) {
      this.lex.advance();
      return createNode("assignment", span(start, this.lex.peek().start), LANG, [...exprs, ...this.parseExprList()]);
    }
    return exprs.length === 1 ? exprs[0]! : createNode("block", span(start, exprs[exprs.length - 1]!.span.end), LANG, exprs);
  }

  private parseSimpleOrExpr(): ASTNode {
    const start = this.lex.peek().start;
    const exprs = this.parseExprList();
    if (exprs.length === 0) return this.recoverSkip();
    const next = this.lex.peek();
    if (next.type === "operator" && ASSIGN_OPS.has(next.value)) {
      this.lex.advance();
      return createNode("assignment", span(start, this.lex.peek().start), LANG, [...exprs, ...this.parseExprList()]);
    }
    if (next.type === "operator" && (next.value === "++" || next.value === "--")) {
      this.lex.advance();
      return createNode("assignment", span(start, this.lex.peek().start), LANG, exprs);
    }
    return exprs.length === 1 ? exprs[0]! : createNode("block", span(start, exprs[exprs.length - 1]!.span.end), LANG, exprs);
  }

  // -- expressions -----------------------------------------------------------

  private parseExpr(): ASTNode | null { return this.parseBinary(0); }

  private parseExprList(): ASTNode[] {
    const r: ASTNode[] = []; const e = this.parseExpr(); if (!e) return r; r.push(e);
    while (isPunct(this.lex.peek(), ",")) { this.lex.advance(); const n = this.parseExpr(); if (n) r.push(n); else break; }
    return r;
  }

  private static readonly PREC: Record<string, number> = {
    "||": 1, "&&": 2,
    "==": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3,
    "+": 4, "-": 4, "|": 4, "^": 4,
    "*": 5, "/": 5, "%": 5, "<<": 5, ">>": 5, "&": 5, "&^": 5,
  };

  private parseBinary(min: number): ASTNode | null {
    let left = this.parseUnary(); if (!left) return null;
    while (this.lex.peek().type === "operator") {
      const prec = GoParser.PREC[this.lex.peek().value] ?? 0;
      if (prec <= min) break;
      const op = this.lex.advance();
      const right = this.parseBinary(prec); if (!right) break;
      left = createNode("binary-expr", span(left.span.start, right.span.end), LANG, [left, right], op.value);
    }
    return left;
  }

  private parseUnary(): ASTNode | null {
    const tok = this.lex.peek();
    if (isOp(tok, "<-")) {
      const start = tok.start; this.lex.advance();
      const e = this.parseUnary(); if (!e) return null;
      return createNode("channel-expr", span(start, e.span.end), LANG, [e], "<-");
    }
    if (tok.type === "operator" && "!+-^*&".includes(tok.value)) {
      const start = tok.start; const op = this.lex.advance();
      const e = this.parseUnary(); if (!e) return null;
      return createNode("unary-expr", span(start, e.span.end), LANG, [e], op.value);
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ASTNode | null {
    let expr = this.parsePrimary(); if (!expr) return null;
    while (true) {
      const tok = this.lex.peek();
      if (isPunct(tok, ".")) {
        this.lex.advance();
        if (isPunct(this.lex.peek(), "(")) {
          this.lex.advance();
          if (isKw(this.lex.peek(), "type")) {
            this.lex.advance();
            if (isPunct(this.lex.peek(), ")")) this.lex.advance();
            expr = createNode("type-annotation", span(expr.span.start, this.lex.peek().start), LANG, [expr]); continue;
          }
          const inner = this.parseExpr();
          if (isPunct(this.lex.peek(), ")")) this.lex.advance();
          if (inner) expr = createNode("type-annotation", span(expr.span.start, this.lex.peek().start), LANG, [expr, inner]);
          continue;
        }
        const field = this.lex.advance();
        expr = createNode("member-expr", span(expr.span.start, field.end), LANG, [expr], field.value);
        continue;
      }
      if (isPunct(tok, "[")) {
        this.lex.advance();
        const idx = this.parseExpr();
        if (isPunct(this.lex.peek(), ":")) {
          this.lex.advance(); const hi = this.parseExpr();
          const ch = [expr]; if (idx) ch.push(idx); if (hi) ch.push(hi);
          if (isPunct(this.lex.peek(), ":")) { this.lex.advance(); const cap = this.parseExpr(); if (cap) ch.push(cap); }
          if (isPunct(this.lex.peek(), "]")) this.lex.advance();
          expr = createNode("index-expr", span(expr.span.start, this.lex.peek().start), LANG, ch); continue;
        }
        if (isPunct(this.lex.peek(), "]")) this.lex.advance();
        expr = createNode("index-expr", span(expr.span.start, this.lex.peek().start), LANG, idx ? [expr, idx] : [expr]);
        continue;
      }
      if (isPunct(tok, "(")) {
        const args = this.parseCallArgs();
        expr = createNode("call", span(expr.span.start, this.lex.peek().start), LANG, [expr, ...args]); continue;
      }
      break;
    }
    return expr;
  }

  private parseCallArgs(): ASTNode[] {
    if (!isPunct(this.lex.peek(), "(")) return [];
    this.lex.advance();
    const args: ASTNode[] = [];
    while (!this.lex.atEnd() && !isPunct(this.lex.peek(), ")")) {
      if (this.lex.peek().type === "comment") { this.lex.advance(); continue; }
      if (this.lex.peek().value === "...") { this.lex.advance(); const e = this.parseExpr(); if (e) args.push(e); }
      else { const e = this.parseExpr(); if (e) args.push(e); }
      if (isPunct(this.lex.peek(), ",")) this.lex.advance();
    }
    if (isPunct(this.lex.peek(), ")")) this.lex.advance();
    return args;
  }

  private parsePrimary(): ASTNode | null {
    const tok = this.lex.peek();
    if (tok.type === "eof") return null;
    if (tok.type === "identifier") { this.lex.advance(); return createNode("identifier", span(tok.start, tok.end), LANG, [], tok.value); }
    if (tok.type === "string") { this.lex.advance(); return createNode("string", span(tok.start, tok.end), LANG, [], tok.value); }
    if (tok.type === "number") { this.lex.advance(); return createNode("number", span(tok.start, tok.end), LANG, [], tok.value); }
    if (tok.type === "char") { this.lex.advance(); return createNode("string", span(tok.start, tok.end), LANG, [], tok.value); }
    if (tok.type === "comment") { this.lex.advance(); return createNode("comment", span(tok.start, tok.end), LANG, [], tok.value); }
    if (isPunct(tok, "(")) { this.lex.advance(); const e = this.parseExpr(); if (isPunct(this.lex.peek(), ")")) this.lex.advance(); return e; }
    if (isKw(tok, "func")) return this.parseFuncLit();
    if (isPunct(tok, "[")) return this.parseCompositeLit();
    if (isKw(tok, "map")) return this.parseMapLit();
    if (isKw(tok, "struct")) { this.lex.advance(); return this.parseKVBrace("struct", tok.start); }
    if (isKw(tok, "chan")) return this.parseChanType(tok.start);
    if (isKw(tok, "interface")) {
      this.lex.advance(); const ch: ASTNode[] = [];
      if (isPunct(this.lex.peek(), "{")) {
        this.lex.advance();
        while (!this.lex.atEnd() && !isPunct(this.lex.peek(), "}")) {
          if (this.lex.peek().type === "comment") { this.lex.advance(); continue; }
          ch.push(this.parseIfaceMethod());
        }
        if (isPunct(this.lex.peek(), "}")) this.lex.advance();
      }
      return createNode("interface", span(tok.start, this.lex.peek().start), LANG, ch);
    }
    if (tok.type === "keyword" && ["make","new","len","cap","append","copy","delete","close","panic","recover","println","print"].includes(tok.value)) {
      this.lex.advance(); return createNode("identifier", span(tok.start, tok.end), LANG, [], tok.value);
    }
    return null;
  }

  private parseFuncLit(): ASTNode {
    const start = this.lex.peek().start; this.lex.advance();
    const ch: ASTNode[] = [this.parseParamList()];
    if (isPunct(this.lex.peek(), "(")) ch.push(...this.parseNamedReturns());
    else { const r = this.tryParseType(); if (r) ch.push(r); }
    const b = this.parseBlock(); if (b) ch.push(b);
    return createNode("function", span(start, this.lex.peek().start), LANG, ch, "func-literal");
  }

  private parseCompositeLit(): ASTNode | null {
    const start = this.lex.peek().start; this.lex.advance();
    const ch: ASTNode[] = [];
    if (isPunct(this.lex.peek(), "]")) {
      this.lex.advance(); const et = this.tryParseType(); if (et) ch.push(et);
    } else {
      const sz = this.parseExpr(); if (sz) ch.push(sz);
      if (isPunct(this.lex.peek(), "]")) this.lex.advance();
      const et = this.tryParseType(); if (et) ch.push(et);
    }
    if (isPunct(this.lex.peek(), "{")) {
      this.lex.advance();
      while (!this.lex.atEnd() && !isPunct(this.lex.peek(), "}")) {
        const e = this.parseExpr(); if (e) ch.push(e);
        if (isPunct(this.lex.peek(), ",")) this.lex.advance();
      }
      if (isPunct(this.lex.peek(), "}")) this.lex.advance();
    }
    return createNode("index-expr", span(start, this.lex.peek().start), LANG, ch);
  }

  private parseMapLit(): ASTNode {
    const start = this.lex.peek().start; this.lex.advance(); // map
    this.lex.advance(); // [
    const kt = this.tryParseType();
    if (isPunct(this.lex.peek(), "]")) this.lex.advance();
    const vt = this.tryParseType();
    const ch: ASTNode[] = []; if (kt) ch.push(kt); if (vt) ch.push(vt);
    if (isPunct(this.lex.peek(), "{")) {
      this.lex.advance();
      while (!this.lex.atEnd() && !isPunct(this.lex.peek(), "}")) {
        const k = this.parseExpr(); if (k) ch.push(k);
        if (isPunct(this.lex.peek(), ":")) this.lex.advance();
        const v = this.parseExpr(); if (v) ch.push(v);
        if (isPunct(this.lex.peek(), ",")) this.lex.advance();
      }
      if (isPunct(this.lex.peek(), "}")) this.lex.advance();
    }
    return createNode("index-expr", span(start, this.lex.peek().start), LANG, ch);
  }

  private parseChanType(start: SourcePosition): ASTNode {
    this.lex.advance(); // chan
    if (isOp(this.lex.peek(), "<-")) this.lex.advance();
    const et = this.tryParseType();
    return createNode("channel-expr", span(start, this.lex.peek().start), LANG, et ? [et] : []);
  }

  private parseKVBrace(kind: string, start: SourcePosition): ASTNode {
    const ch: ASTNode[] = [];
    if (isPunct(this.lex.peek(), "{")) {
      this.lex.advance();
      while (!this.lex.atEnd() && !isPunct(this.lex.peek(), "}")) {
        const k = this.parseExpr(); if (k) ch.push(k);
        if (isPunct(this.lex.peek(), ":")) this.lex.advance();
        const v = this.parseExpr(); if (v) ch.push(v);
        if (isPunct(this.lex.peek(), ",")) this.lex.advance();
      }
      if (isPunct(this.lex.peek(), "}")) this.lex.advance();
    }
    return createNode(kind, span(start, this.lex.peek().start), LANG, ch);
  }

  // -- type parsing ----------------------------------------------------------

  private tryParseType(): ASTNode | null {
    const tok = this.lex.peek();
    if (tok.type === "eof") return null;
    if (isOp(tok, "*")) {
      const s = tok.start; this.lex.advance();
      const i = this.tryParseType();
      return createNode("unary-expr", span(s, i ? i.span.end : this.lex.peek().start), LANG, i ? [i] : [], "*");
    }
    if (tok.value === "...") {
      const s = tok.start; this.lex.advance();
      const i = this.tryParseType();
      return createNode("unary-expr", span(s, i ? i.span.end : this.lex.peek().start), LANG, i ? [i] : [], "...");
    }
    if (isPunct(tok, "[")) {
      const s = tok.start; this.lex.advance();
      if (isPunct(this.lex.peek(), "]")) {
        this.lex.advance(); const e = this.tryParseType();
        return createNode("index-expr", span(s, e ? e.span.end : this.lex.peek().start), LANG, e ? [e] : []);
      }
      const sz = this.parseExpr();
      if (isPunct(this.lex.peek(), "]")) this.lex.advance();
      const e = this.tryParseType();
      return createNode("index-expr", span(s, e ? e.span.end : this.lex.peek().start), LANG, [sz!, e!].filter(Boolean));
    }
    if (isKw(tok, "func")) return this.parseFuncLit();
    if (isKw(tok, "map")) return this.parseMapLit();
    if (isKw(tok, "chan")) return this.parseChanType(tok.start);
    if (isKw(tok, "struct")) { this.lex.advance(); return this.parseKVBrace("struct", tok.start); }
    if (isKw(tok, "interface")) {
      this.lex.advance(); const ch: ASTNode[] = [];
      if (isPunct(this.lex.peek(), "{")) {
        this.lex.advance();
        while (!this.lex.atEnd() && !isPunct(this.lex.peek(), "}")) {
          if (this.lex.peek().type === "comment") { this.lex.advance(); continue; }
          ch.push(this.parseIfaceMethod());
        }
        if (isPunct(this.lex.peek(), "}")) this.lex.advance();
      }
      return createNode("interface", span(tok.start, this.lex.peek().start), LANG, ch);
    }
    if (isPunct(tok, "(")) { this.lex.advance(); const i = this.tryParseType(); if (isPunct(this.lex.peek(), ")")) this.lex.advance(); return i; }
    if (tok.type === "identifier") {
      const it = this.lex.advance();
      let n = createNode("identifier", span(it.start, it.end), LANG, [], it.value);
      if (isPunct(this.lex.peek(), ".")) { this.lex.advance(); const r = this.lex.advance(); n = createNode("member-expr", span(it.start, r.end), LANG, [n], r.value); }
      if (isPunct(this.lex.peek(), "[")) { const ta = this.parseTypeParams(); n = createNode("index-expr", span(n.span.start, this.lex.peek().start), LANG, [n, ...ta]); }
      return n;
    }
    return null;
  }

  // -- type parameters (Go 1.18+) -------------------------------------------

  private parseTypeParams(): ASTNode[] {
    if (!isPunct(this.lex.peek(), "[")) return [];
    this.lex.advance();
    const ps: ASTNode[] = [];
    while (!this.lex.atEnd() && !isPunct(this.lex.peek(), "]")) {
      if (this.lex.peek().type === "comment") { this.lex.advance(); continue; }
      ps.push(this.parseTypeParam());
    }
    if (isPunct(this.lex.peek(), "]")) this.lex.advance();
    return ps;
  }

  private parseTypeParam(): ASTNode {
    const start = this.lex.peek().start;
    let label: string | undefined;
    if (this.lex.peek().type === "identifier") { label = this.lex.peek().value; this.lex.advance(); }
    const ch: ASTNode[] = [];
    const c = this.tryParseType(); if (c) ch.push(c);
    while (isOp(this.lex.peek(), "|")) { this.lex.advance(); const t = this.tryParseType(); if (t) ch.push(t); }
    if (isOp(this.lex.peek(), "~")) { this.lex.advance(); const t = this.tryParseType(); if (t) ch.push(t); }
    if (isPunct(this.lex.peek(), ",")) this.lex.advance();
    return createNode("parameter", span(start, this.lex.peek().start), LANG, ch, label);
  }

  // -- error recovery & utilities -------------------------------------------

  private recoverSkip(): ASTNode {
    const start = this.lex.peek().start;
    let depth = 0;
    while (!this.lex.atEnd()) {
      const t = this.lex.advance();
      if (isPunct(t, "{")) depth++;
      if (isPunct(t, "}")) { if (depth === 0) break; depth--; }
    }
    return createNode("error", span(start, this.lex.peek().start), LANG, [], "recovered");
  }

  private expectKw(kw: string): void { if (isKw(this.lex.peek(), kw)) this.lex.advance(); }

  private tokNode(tok: Token): ASTNode {
    const s = span(tok.start, tok.end);
    const kind = tok.type === "string" ? "string" : tok.type === "number" ? "number" : tok.type === "comment" ? "comment" : "identifier";
    return createNode(kind, s, LANG, [], tok.value);
  }

  private hasSemiAhead(): boolean {
    let depth = 0;
    for (let i = this.lex.peek().start.offset; i < this.src.length; i++) {
      const c = this.src[i]!;
      if ("({[".includes(c)) depth++;
      if (")}]".includes(c)) { if (depth === 0) return false; depth--; }
      if (c === ";" && depth === 0) return true;
      if (c === "{" && depth === 0) return false;
    }
    return false;
  }
}

// -- Exported LanguageParser -------------------------------------------------

export const goParser: LanguageParser = {
  parse(source: string, name: string): Either<ParseError, ASTNode> {
    return new GoParser(source).parse(name);
  },
  parseIncremental(source: string, name: string, _previous: ASTNode, _edit: EditDescriptor): Either<ParseError, ASTNode> {
    return goParser.parse(source, name);
  },
};
