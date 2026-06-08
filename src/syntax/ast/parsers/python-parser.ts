/**
 * @file python-parser.ts
 * @description Indentation-aware recursive-descent parser for Python.
 * Produces ASTNode trees for syntax highlighting, navigation, and code analysis.
 */

import { Either } from "../../../utils/task-either.ts";
import type { Either as EitherType } from "../../../utils/task-either.ts";
import { createConfigError, type ConfigError } from "../../../error/types.ts";
import type { SourceSpan, SourcePosition } from "../../../tlisp/source.ts";
import type { ASTNode, EditDescriptor, LanguageParser, ParseError } from "../types.ts";
import { createNode } from "../types.ts";

// ── Token types ────────────────────────────────────────────────────────────

const TK = {
  EOF: 0,
  NEWLINE: 1,
  INDENT: 2,
  DEDENT: 3,
  NAME: 4,
  NUMBER: 5,
  STRING: 6,
  FSTRING: 7,
  OP: 8,
  COMMENT: 9,
  ERROR: 10,
} as const;
type TK = (typeof TK)[keyof typeof TK];

interface Token {
  readonly kind: TK;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const LANGUAGE = "python";

function pos(offset: number, src: string): SourcePosition {
  let line = 0;
  let col = 0;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === "\n") {
      line++;
      col = 0;
    } else {
      col++;
    }
  }
  return { line, column: col, offset };
}

function span(start: number, end: number, src: string): SourceSpan {
  return { start: pos(start, src), end: pos(end, src) };
}

function tokSpan(tok: Token, src: string): SourceSpan {
  return span(tok.start, tok.end, src);
}

// Operator sets for quick classification
const ASSIGN_OPS = new Set([
  "=", "+=", "-=", "*=", "/=", "//=", "%=", "**=",
  "<<=", ">>=", "&=", "|=", "^=", "@=",
]);

const COMP_OPS = new Set(["==", "!=", "<", ">", "<=", ">=", "in", "is", "not"]);
const AUG_ASSIGN_OPS = new Set([
  "+=", "-=", "*=", "/=", "//=", "%=", "**=",
  "<<=", ">>=", "&=", "|=", "^=", "@=",
]);

const KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await",
  "break", "class", "continue", "def", "del", "elif", "else", "except",
  "finally", "for", "from", "global", "if", "import", "in", "is",
  "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try",
  "while", "with", "yield", "match", "case", "type",
]);

// ── Indentation-aware lexer ────────────────────────────────────────────────

/**
 * Lex Python source into a flat token array with synthetic INDENT/DEDENT tokens.
 * Tracks an indent stack exactly like CPython does.
 */
function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const indentStack = [0];
  let i = 0;
  const len = src.length;
  let parenDepth = 0;
  let atLineStart = true;

  const emit = (kind: TK, text: string, start: number, end: number) => {
    tokens.push({ kind, text, start, end });
  };

  while (i < len) {
    // ── Whitespace at line start ─────────────────────────────────────
    if (atLineStart && parenDepth === 0) {
      atLineStart = false;

      // Skip blank / comment-only lines for indent tracking
      let lineStart = i;
      let ws = 0;
      while (i < len && src[i] === " ") { ws++; i++; }
      while (i < len && src[i] === "\t") { ws += 8 - (ws % 8); i++; }

      // Blank line or comment-only line: skip indent processing
      if (i >= len || src[i] === "\n" || src[i] === "#") {
        // Still emit comment if present
        if (i < len && src[i] === "#") {
          const cs = i;
          while (i < len && src[i] !== "\n") i++;
          emit(TK.COMMENT, src.slice(cs, i), cs, i);
        }
        if (i < len && src[i] === "\n") {
          emit(TK.NEWLINE, "\n", i, i + 1);
          i++;
          atLineStart = true;
        }
        continue;
      }

      const current = indentStack[indentStack.length - 1]!;
      if (ws > current) {
        indentStack.push(ws);
        emit(TK.INDENT, "", lineStart, lineStart);
      } else if (ws < current) {
        while (indentStack[indentStack.length - 1]! > ws) {
          indentStack.pop();
          emit(TK.DEDENT, "", lineStart, lineStart);
        }
      }
      // Token scanning continues from current i (already past whitespace)
      continue;
    }

    // ── Skip whitespace mid-line ─────────────────────────────────────
    if (src[i] === " " || src[i] === "\t" || src[i] === "\r") {
      i++;
      continue;
    }

    // ── Newline ──────────────────────────────────────────────────────
    if (src[i] === "\n") {
      if (parenDepth === 0) {
        emit(TK.NEWLINE, "\n", i, i + 1);
      }
      i++;
      atLineStart = true;
      continue;
    }

    // ── Comment ──────────────────────────────────────────────────────
    if (src[i] === "#") {
      const cs = i;
      while (i < len && src[i] !== "\n") i++;
      emit(TK.COMMENT, src.slice(cs, i), cs, i);
      continue;
    }

    // ── String / f-string ────────────────────────────────────────────
    if (src[i] === "'" || src[i] === '"' || (src[i] === "f" && i + 1 < len && (src[i + 1] === "'" || src[i + 1] === '"')) || (src[i] === "r" && i + 1 < len && (src[i + 1] === "'" || src[i + 1] === '"' || src[i + 1] === "f"))) {
      const ss = i;
      let isFString = false;

      // Check for f-string prefix
      if (src[i] === "f") { isFString = true; i++; }
      else if (src[i] === "r" && src[i + 1] === "f") { isFString = true; i += 2; }
      else if (src[i] === "r") { i++; }

      const quote = src[i]!;
      let triple = false;
      if (i + 2 < len && src[i] === quote && src[i + 1] === quote && src[i + 2] === quote) {
        triple = true;
        i += 3;
      } else {
        i++;
      }

      // Scan to end of string
      const terminator = triple ? quote!.repeat(3) : quote!;
      const termLen = terminator.length;
      while (i + termLen <= len) {
        if (src[i] === "\\") { i += 2; continue; }
        let match = true;
        for (let t = 0; t < termLen; t++) {
          if (src[i + t] !== terminator[t]) { match = false; break; }
        }
        if (match) { i += termLen; break; }
        if (src[i] === "\n" && !triple) { break; }
        i++;
      }

      emit(isFString ? TK.FSTRING : TK.STRING, src.slice(ss, i), ss, i);
      continue;
    }

    // ── Number ───────────────────────────────────────────────────────
    if (src[i]! >= "0" && src[i]! <= "9") {
      const ns = i;
      // Hex, octal, binary
      if (src[i] === "0" && i + 1 < len) {
        const c = src[i + 1]!.toLowerCase();
        if (c === "x" || c === "o" || c === "b") {
          i += 2;
          while (i < len && /[\da-fA-F_]/.test(src[i]!)) i++;
          // Possible int suffix
          emit(TK.NUMBER, src.slice(ns, i), ns, i);
          continue;
        }
      }
      while (i < len && /[\d_]/.test(src[i]!)) i++;
      if (i < len && src[i] === ".") { i++; while (i < len && /[\d_]/.test(src[i]!)) i++; }
      if (i < len && (src[i] === "e" || src[i] === "E")) {
        i++;
        if (i < len && (src[i] === "+" || src[i] === "-")) i++;
        while (i < len && /[\d_]/.test(src[i]!)) i++;
      }
      if (i < len && (src[i] === "j" || src[i] === "J")) i++;
      emit(TK.NUMBER, src.slice(ns, i), ns, i);
      continue;
    }

    // ── Name / keyword ───────────────────────────────────────────────
    if (/[a-zA-Z_]/.test(src[i]!)) {
      const ns = i;
      while (i < len && /[\w]/.test(src[i]!)) i++;
      const text = src.slice(ns, i);
      // f-string prefix that didn't precede a quote -> treat as name
      emit(TK.NAME, text, ns, i);
      continue;
    }

    // ── Operator / delimiter ─────────────────────────────────────────
    {
      const os = i;
      // Three-character operators
      if (i + 2 < len) {
        const tri = src.slice(i, i + 3);
        if (tri === "**=" || tri === "//=" || tri === "<<=" || tri === ">>=") {
          emit(TK.OP, tri, os, os + 3);
          i += 3;
          if (tri.includes("(") || tri.includes("[")) parenDepth++;
          continue;
        }
      }
      // Two-character operators
      if (i + 1 < len) {
        const duo = src.slice(i, i + 2);
        if (duo === "**" || duo === "//" || duo === "<<" || duo === ">>" ||
            duo === "<=" || duo === ">=" || duo === "==" || duo === "!=" ||
            duo === "+=" || duo === "-=" || duo === "*=" || duo === "/=" ||
            duo === "%=" || duo === "&=" || duo === "|=" || duo === "^=" ||
            duo ==="@=" || duo === "->" || duo === ":=") {
          emit(TK.OP, duo, os, os + 2);
          i += 2;
          continue;
        }
      }
      // Single character
      const ch = src[i]!;
      if (ch === "(" || ch === "[" || ch === "{") parenDepth++;
      if (ch === ")" || ch === "]" || ch === "}") parenDepth = Math.max(0, parenDepth - 1);
      emit(TK.OP, ch, os, os + 1);
      i++;
    }
  }

  // Emit remaining DEDENTs at EOF
  while (indentStack.length > 1) {
    indentStack.pop();
    emit(TK.DEDENT, "", len, len);
  }

  emit(TK.EOF, "", len, len);
  return tokens;
}

// ── Parser state ───────────────────────────────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos = 0;
  private src: string;
  private fileName: string;

  constructor(tokens: Token[], src: string, fileName: string) {
    this.tokens = tokens;
    this.src = src;
    this.fileName = fileName;
  }

  // ── Token access ──────────────────────────────────────────────────

  private cur(): Token { return this.tokens[this.pos]!; }
  private peek(offset = 1): Token { return this.tokens[this.pos + offset] ?? this.tokens[this.tokens.length - 1]!; }

  private at(kind: TK, text?: string): boolean {
    const t = this.cur();
    return t.kind === kind && (text === undefined || t.text === text);
  }

  private atName(text?: string): boolean {
    return this.at(TK.NAME, text);
  }

  private atOp(text?: string): boolean {
    return this.at(TK.OP, text);
  }

  private eat(kind: TK, text?: string): Token | null {
    if (this.at(kind, text)) return this.advance();
    return null;
  }

  private advance(): Token {
    const t = this.cur();
    this.pos++;
    return t;
  }

  private expect(kind: TK, text?: string): Token {
    const t = this.cur();
    if (t.kind === kind && (text === undefined || t.text === text)) {
      return this.advance();
    }
    // Error recovery: return a synthetic token and keep going
    return this.advance();
  }

  private match(kind: TK, text?: string): boolean {
    if (this.at(kind, text)) { this.advance(); return true; }
    return false;
  }

  // ── Node factories ────────────────────────────────────────────────

  private nodeSpan(start: number, end: number): SourceSpan {
    return span(start, end, this.src);
  }

  private tokNode(kind: string, tok: Token, label?: string): ASTNode {
    return createNode(kind, tokSpan(tok, this.src), LANGUAGE, [], label ?? tok.text);
  }

  private offsetOf(tok: Token | ASTNode): { start: number; end: number } {
    if ("span" in tok && typeof (tok as ASTNode).span === "object") {
      const a = tok as ASTNode;
      return { start: a.span.start.offset, end: a.span.end.offset };
    }
    const t = tok as Token;
    return { start: t.start, end: t.end };
  }

  private synNode(kind: string, startTok: Token | ASTNode, endTok: Token | ASTNode, children: ASTNode[], label?: string): ASTNode {
    const s = this.nodeSpan(this.offsetOf(startTok).start, this.offsetOf(endTok).end);
    return createNode(kind, s, LANGUAGE, children, label);
  }

  private errorNode(startTok: Token, msg: string): ASTNode {
    // Resync: skip to next NEWLINE or DEDENT or EOF
    while (!this.at(TK.EOF) && !this.at(TK.NEWLINE)) {
      this.advance();
    }
    return createNode("error", tokSpan(startTok, this.src), LANGUAGE, [], msg);
  }

  // ── Top-level ─────────────────────────────────────────────────────

  parseFile(): ASTNode {
    const children: ASTNode[] = [];
    const start = this.cur().start;

    while (!this.at(TK.EOF)) {
      // Skip newlines between top-level statements
      if (this.match(TK.NEWLINE)) continue;
      if (this.match(TK.INDENT)) continue;
      if (this.match(TK.DEDENT)) continue;
      if (this.at(TK.COMMENT)) {
        children.push(this.tokNode("comment", this.advance()));
        continue;
      }
      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);
    }

    const end = this.tokens[this.tokens.length - 1]!.end;
    return createNode("file", this.nodeSpan(start, end), LANGUAGE, children, this.fileName);
  }

  // ── Statements ────────────────────────────────────────────────────

  private parseStatement(): ASTNode | null {
    // Decorators must come before def/class
    if (this.atOp("@")) return this.parseDecorated();
    // async def / async for / async with
    if (this.atName("async")) {
      const next = this.peek();
      if (next.kind === TK.NAME && next.text === "def") {
        this.advance(); // consume 'async'
        return this.parseDef();
      }
      if (next.kind === TK.NAME && next.text === "for") {
        this.advance();
        return this.parseFor();
      }
      if (next.kind === TK.NAME && next.text === "with") {
        this.advance();
        return this.parseWith();
      }
    }
    if (this.atName("def")) return this.parseDef();
    if (this.atName("class")) return this.parseClass();
    if (this.atName("if")) return this.parseIf();
    if (this.atName("for")) return this.parseFor();
    if (this.atName("while")) return this.parseWhile();
    if (this.atName("try")) return this.parseTry();
    if (this.atName("with")) return this.parseWith();
    if (this.atName("match")) return this.parseMatch();
    if (this.atName("import") || this.atName("from")) return this.parseImport();
    if (this.atName("return")) return this.parseReturn();
    if (this.atName("raise")) return this.parseRaise();
    if (this.atName("yield")) return this.parseYieldStmt();
    if (this.atName("pass") || this.atName("break") || this.atName("continue")) {
      return this.tokNode("identifier", this.advance());
    }
    if (this.atName("global") || this.atName("nonlocal")) return this.parseGlobalNonlocal();
    if (this.atName("assert")) return this.parseAssert();
    if (this.atName("del")) return this.parseDel();
    // Expression statement / assignment
    return this.parseExprOrAssign();
  }

  // ── Decorators ────────────────────────────────────────────────────

  private parseDecorated(): ASTNode {
    const decorators: ASTNode[] = [];
    const startTok = this.cur();

    while (this.atOp("@")) {
      const at = this.advance();
      const name = this.parseDottedName();
      const args = this.atOp("(") ? this.parseArgList() : null;
      const dSpan = this.nodeSpan(at.start, (args ?? name).span.end.offset);
      const dChildren = args ? [name, args] : [name];
      decorators.push(createNode("decorator", dSpan, LANGUAGE, dChildren, name.label));
      this.match(TK.NEWLINE);
    }

    // The decorated statement
    const stmt = this.parseStatement();
    if (!stmt) {
      return this.errorNode(startTok, "Expected statement after decorator");
    }

    // Merge decorators as leading children
    stmt.children = [...decorators, ...stmt.children];
    stmt.span = this.nodeSpan(startTok.start, stmt.span.end.offset);
    return stmt;
  }

  private parseDottedName(): ASTNode {
    const startTok = this.cur();
    const parts: ASTNode[] = [];
    parts.push(this.tokNode("identifier", this.advance()));
    while (this.atOp(".")) {
      this.advance();
      if (this.at(TK.NAME)) parts.push(this.tokNode("identifier", this.advance()));
    }
    if (parts.length === 1) return parts[0]!;
    return this.synNode("identifier", startTok, parts[parts.length - 1]!, parts, parts.map(p => p.label).join("."));
  }

  // ── def ───────────────────────────────────────────────────────────

  private parseDef(): ASTNode {
    const defTok = this.advance(); // eat 'def'
    const asyncPrefix = false; // async handled at decorated level

    // Function name
    const nameTok = this.expect(TK.NAME);
    const name = nameTok.text;

    // Type params (Python 3.12+)
    if (this.atOp("[")) this.skipBracketGroup();

    // Parameters
    let params: ASTNode;
    if (this.atOp("(")) {
      params = this.parseParams();
    } else {
      params = createNode("block", tokSpan(defTok, this.src), LANGUAGE, []);
    }

    const children: ASTNode[] = [params];

    // Return type annotation
    if (this.atOp("->")) {
      this.advance();
      children.push(this.parseTypeAnnotation());
    }

    this.match(TK.OP, ":");

    // Body
    if (this.at(TK.NEWLINE) || this.at(TK.INDENT)) {
      children.push(this.parseBlock());
    } else {
      // Single-line body
      children.push(this.parseStatement() ?? createNode("pass", tokSpan(defTok, this.src), LANGUAGE));
    }

    const endTok = children[children.length - 1]!;
    const funcKind = this.isInsideClass() ? "method" : "function";
    return this.synNode(funcKind, defTok, endTok, children, name);
  }

  private isInsideClass(): boolean {
    // Simple heuristic: look at preceding tokens for unmatched class scope
    // For a full implementation we'd track a scope stack
    return false; // decorated() sets kind to "method" via context
  }

  private parseParams(): ASTNode {
    const open = this.advance(); // eat '('
    const params: ASTNode[] = [];

    while (!this.at(TK.EOF) && !this.atOp(")")) {
      if (this.at(TK.OP, "*")) {
        // *args or bare *
        const star = this.advance();
        if (this.at(TK.NAME)) {
          const n = this.advance();
          const pSpan = this.nodeSpan(star.start, n.end);
          let child: ASTNode[] = [];
          let pLabel = "*" + n.text;
          if (this.atOp(":")) {
            this.advance();
            child.push(this.parseTypeAnnotation());
          }
          if (this.atOp("=")) {
            this.advance();
            child.push(this.parseExpr());
          }
          params.push(createNode("parameter", pSpan, LANGUAGE, child, pLabel));
        } else {
          params.push(createNode("parameter", tokSpan(star, this.src), LANGUAGE, [], "*"));
        }
      } else if (this.at(TK.OP, "/")) {
        const slash = this.advance();
        params.push(createNode("parameter", tokSpan(slash, this.src), LANGUAGE, [], "/"));
      } else if (this.at(TK.NAME)) {
        params.push(this.parseParam());
      } else {
        // skip unexpected
        this.advance();
      }
      this.match(TK.OP, ",");
    }

    this.expect(TK.OP, ")");
    const close = this.tokens[this.pos - 1]!;
    return this.synNode("block", open, close, params, "params");
  }

  private parseParam(): ASTNode {
    const nameTok = this.advance();
    const children: ASTNode[] = [];

    // Type annotation
    if (this.atOp(":")) {
      this.advance();
      children.push(this.parseTypeAnnotation());
    }

    // Default value
    if (this.atOp("=")) {
      this.advance();
      children.push(this.parseExpr());
    }

    const endOffset = children.length > 0
      ? children[children.length - 1]!.span.end.offset
      : nameTok.end;
    const pSpan = this.nodeSpan(nameTok.start, endOffset);
    return createNode("parameter", pSpan, LANGUAGE, children, nameTok.text);
  }

  // ── class ─────────────────────────────────────────────────────────

  private parseClass(): ASTNode {
    const clsTok = this.advance(); // eat 'class'
    const nameTok = this.expect(TK.NAME);
    const name = nameTok.text;
    const children: ASTNode[] = [];

    // Type params (3.12+)
    if (this.atOp("[")) this.skipBracketGroup();

    // Inheritance
    if (this.atOp("(")) {
      children.push(this.parseInheritanceList());
    }

    this.match(TK.OP, ":");

    if (this.at(TK.NEWLINE) || this.at(TK.INDENT)) {
      children.push(this.parseBlock());
    }

    const endTok = children.length > 0 ? children[children.length - 1]! : nameTok;
    return this.synNode("class", clsTok, endTok, children, name);
  }

  private parseInheritanceList(): ASTNode {
    const open = this.advance(); // eat '('
    const bases: ASTNode[] = [];

    while (!this.at(TK.EOF) && !this.atOp(")")) {
      bases.push(this.parseExpr());
      this.match(TK.OP, ",");
    }
    this.expect(TK.OP, ")");
    const close = this.tokens[this.pos - 1]!;
    return this.synNode("block", open, close, bases, "bases");
  }

  // ── if / elif / else ──────────────────────────────────────────────

  private parseIf(): ASTNode {
    const ifTok = this.advance(); // eat 'if'
    const children: ASTNode[] = [];

    children.push(this.parseExpr()); // condition
    this.match(TK.OP, ":");

    if (this.at(TK.NEWLINE) || this.at(TK.INDENT)) {
      children.push(this.parseBlock());
    }

    // elif branches
    while (this.atName("elif")) {
      const elifTok = this.advance();
      const elifChildren: ASTNode[] = [];
      elifChildren.push(this.parseExpr());
      this.match(TK.OP, ":");
      if (this.at(TK.NEWLINE) || this.at(TK.INDENT)) {
        elifChildren.push(this.parseBlock());
      }
      const elifEnd = elifChildren[elifChildren.length - 1]!;
      children.push(this.synNode("if-stmt", elifTok, elifEnd, elifChildren));
    }

    // else
    if (this.atName("else")) {
      const elseTok = this.advance();
      this.match(TK.OP, ":");
      const elseChildren: ASTNode[] = [];
      if (this.at(TK.NEWLINE) || this.at(TK.INDENT)) {
        elseChildren.push(this.parseBlock());
      }
      const elseEnd = elseChildren.length > 0 ? elseChildren[elseChildren.length - 1]! : elseTok;
      children.push(this.synNode("block", elseTok, elseEnd, elseChildren, "else"));
    }

    const endTok = children[children.length - 1]!;
    return this.synNode("if-stmt", ifTok, endTok, children);
  }

  // ── for ───────────────────────────────────────────────────────────

  private parseFor(): ASTNode {
    const forTok = this.advance(); // eat 'for'
    const children: ASTNode[] = [];

    // Target(s)
    children.push(this.parseTargetList());

    this.expect(TK.NAME, "in");

    // Iterable
    children.push(this.parseExpr());
    this.match(TK.OP, ":");

    if (this.at(TK.NEWLINE) || this.at(TK.INDENT)) {
      children.push(this.parseBlock());
    }

    // else
    if (this.atName("else")) {
      const elseTok = this.advance();
      this.match(TK.OP, ":");
      const elseBlock = this.parseBlock();
      children.push(this.synNode("block", elseTok, elseBlock, [elseBlock], "else"));
    }

    const endTok = children[children.length - 1]!;
    return this.synNode("for-stmt", forTok, endTok, children);
  }

  // ── while ─────────────────────────────────────────────────────────

  private parseWhile(): ASTNode {
    const whileTok = this.advance();
    const children: ASTNode[] = [];

    children.push(this.parseExpr());
    this.match(TK.OP, ":");

    if (this.at(TK.NEWLINE) || this.at(TK.INDENT)) {
      children.push(this.parseBlock());
    }

    const endTok = children[children.length - 1]!;
    return this.synNode("while-stmt", whileTok, endTok, children);
  }

  // ── try / except / finally ────────────────────────────────────────

  private parseTry(): ASTNode {
    const tryTok = this.advance();
    const children: ASTNode[] = [];

    this.match(TK.OP, ":");
    if (this.at(TK.NEWLINE) || this.at(TK.INDENT)) {
      children.push(this.parseBlock());
    }

    // except clauses
    while (this.atName("except")) {
      const excTok = this.advance();
      const excChildren: ASTNode[] = [];

      // Exception type (optional)
      if (!this.atOp(":")) {
        excChildren.push(this.parseExpr());
        // 'as' variable
        if (this.atName("as")) {
          this.advance();
          excChildren.push(this.tokNode("variable", this.expect(TK.NAME)));
        }
      }
      this.match(TK.OP, ":");
      if (this.at(TK.NEWLINE) || this.at(TK.INDENT)) {
        excChildren.push(this.parseBlock());
      }
      const excEnd = excChildren[excChildren.length - 1] ?? excTok;
      children.push(this.synNode("block", excTok, excEnd, excChildren, "except"));
    }

    // else
    if (this.atName("else")) {
      const elseTok = this.advance();
      this.match(TK.OP, ":");
      const elseBlock = this.parseBlock();
      children.push(this.synNode("block", elseTok, elseBlock, [elseBlock], "else"));
    }

    // finally
    if (this.atName("finally")) {
      const finTok = this.advance();
      this.match(TK.OP, ":");
      const finBlock = this.parseBlock();
      children.push(this.synNode("block", finTok, finBlock, [finBlock], "finally"));
    }

    const endTok = children[children.length - 1]!;
    return this.synNode("try-stmt", tryTok, endTok, children);
  }

  // ── with ──────────────────────────────────────────────────────────

  private parseWith(): ASTNode {
    const withTok = this.advance();
    const children: ASTNode[] = [];

    do {
      const itemChildren: ASTNode[] = [this.parseExpr()];
      if (this.atName("as")) {
        this.advance();
        itemChildren.push(this.parseExpr());
      }
      const lastItem = itemChildren[itemChildren.length - 1]!;
      const itemStart = itemChildren[0]!;
      children.push(this.synNode("block", itemStart, lastItem, itemChildren));
    } while (this.match(TK.OP, ","));

    this.match(TK.OP, ":");

    if (this.at(TK.NEWLINE) || this.at(TK.INDENT)) {
      children.push(this.parseBlock());
    }

    const endTok = children[children.length - 1]!;
    return this.synNode("with-stmt", withTok, endTok, children);
  }

  // ── match / case ──────────────────────────────────────────────────

  private parseMatch(): ASTNode {
    const matchTok = this.advance();
    const children: ASTNode[] = [];

    children.push(this.parseExpr());
    this.match(TK.OP, ":");

    if (this.at(TK.NEWLINE)) this.advance();
    if (this.at(TK.INDENT)) this.advance();

    while (this.atName("case")) {
      children.push(this.parseCase());
    }

    if (this.at(TK.DEDENT)) this.advance();

    const endTok = children[children.length - 1] ?? matchTok;
    return this.synNode("match-stmt", matchTok, endTok, children);
  }

  private parseCase(): ASTNode {
    const caseTok = this.advance();
    const children: ASTNode[] = [];

    children.push(this.parseExpr()); // pattern

    if (this.atName("if")) {
      this.advance();
      children.push(this.parseExpr()); // guard
    }

    this.match(TK.OP, ":");

    if (this.at(TK.NEWLINE) || this.at(TK.INDENT)) {
      children.push(this.parseBlock());
    }

    const endTok = children[children.length - 1] ?? caseTok;
    return this.synNode("case", caseTok, endTok, children);
  }

  // ── import / from-import ──────────────────────────────────────────

  private parseImport(): ASTNode {
    const startTok = this.cur();
    const children: ASTNode[] = [];

    if (this.atName("from")) {
      this.advance();
      // Module name
      children.push(this.parseDottedName());
      // Relative imports
      if (children.length === 0 && this.atOp(".")) {
        const dots: ASTNode[] = [];
        while (this.atOp(".")) dots.push(this.tokNode("identifier", this.advance()));
        children.push(...dots);
      }
      this.expect(TK.NAME, "import");
    } else {
      this.advance(); // eat 'import'
    }

    // Import targets
    do {
      if (this.atOp("(")) { this.advance(); } // multi-line import
      const target = this.parseImportTarget();
      children.push(target);
    } while (this.match(TK.OP, ","));

    const endTok = children[children.length - 1]!;
    return this.synNode("import", startTok, endTok, children);
  }

  private parseImportTarget(): ASTNode {
    const name = this.parseDottedName();
    if (this.atName("as")) {
      this.advance();
      const alias = this.expect(TK.NAME);
      return this.synNode("variable", name, alias, [name], alias.text);
    }
    return name;
  }

  // ── return ────────────────────────────────────────────────────────

  private parseReturn(): ASTNode {
    const retTok = this.advance();
    if (this.at(TK.NEWLINE) || this.at(TK.EOF) || this.at(TK.COMMENT)) {
      return this.tokNode("return-stmt", retTok);
    }
    const val = this.parseExpr();
    return this.synNode("return-stmt", retTok, val, [val]);
  }

  // ── raise ─────────────────────────────────────────────────────────

  private parseRaise(): ASTNode {
    const raiseTok = this.advance();
    if (this.at(TK.NEWLINE) || this.at(TK.EOF)) {
      return this.tokNode("identifier", raiseTok, "raise");
    }
    const children: ASTNode[] = [this.parseExpr()];
    if (this.atName("from")) {
      this.advance();
      children.push(this.parseExpr());
    }
    const endTok = children[children.length - 1]!;
    return this.synNode("call", raiseTok, endTok, children, "raise");
  }

  // ── yield ─────────────────────────────────────────────────────────

  private parseYieldStmt(): ASTNode {
    const yieldTok = this.advance();
    const children: ASTNode[] = [];
    if (this.atName("from")) {
      this.advance();
      children.push(this.parseExpr());
    } else if (!this.at(TK.NEWLINE) && !this.at(TK.EOF)) {
      children.push(this.parseExpr());
    }
    if (children.length === 0) return this.tokNode("yield-expr", yieldTok);
    const endTok = children[children.length - 1]!;
    return this.synNode("yield-expr", yieldTok, endTok, children);
  }

  // ── global / nonlocal ─────────────────────────────────────────────

  private parseGlobalNonlocal(): ASTNode {
    const kwTok = this.advance();
    const names: ASTNode[] = [];
    do {
      names.push(this.tokNode("variable", this.expect(TK.NAME)));
    } while (this.match(TK.OP, ","));
    const endTok = names[names.length - 1]!;
    return this.synNode("identifier", kwTok, endTok, names, kwTok.text);
  }

  // ── assert ────────────────────────────────────────────────────────

  private parseAssert(): ASTNode {
    const assertTok = this.advance();
    const children: ASTNode[] = [this.parseExpr()];
    if (this.atOp(",")) {
      this.advance();
      children.push(this.parseExpr());
    }
    const endTok = children[children.length - 1]!;
    return this.synNode("call", assertTok, endTok, children, "assert");
  }

  // ── del ───────────────────────────────────────────────────────────

  private parseDel(): ASTNode {
    const delTok = this.advance();
    const children: ASTNode[] = [];
    do {
      children.push(this.parseExpr());
    } while (this.match(TK.OP, ","));
    const endTok = children[children.length - 1]!;
    return this.synNode("call", delTok, endTok, children, "del");
  }

  // ── Expression statement / assignment ─────────────────────────────

  private parseExprOrAssign(): ASTNode {
    const expr = this.parseExpr();
    const startTok = this.tokens[this.pos - 1] ?? expr;

    // Augmented assignment: x += 1
    if (this.atOp() && AUG_ASSIGN_OPS.has(this.cur().text)) {
      const opTok = this.advance();
      const rhs = this.parseExpr();
      return createNode(
        "assignment",
        this.nodeSpan(expr.span.start.offset, rhs.span.end.offset),
        LANGUAGE,
        [expr, rhs],
        opTok.text,
      );
    }

    // Annotated assignment: x: int = 1
    if (this.atOp(":")) {
      this.advance();
      const typeAnn = this.parseTypeAnnotation();
      if (this.atOp("=")) {
        this.advance();
        const rhs = this.parseExpr();
        return createNode(
          "assignment",
          this.nodeSpan(expr.span.start.offset, rhs.span.end.offset),
          LANGUAGE,
          [expr, typeAnn, rhs],
        );
      }
      // Annotation only (x: int)
      return createNode(
        "assignment",
        this.nodeSpan(expr.span.start.offset, typeAnn.span.end.offset),
        LANGUAGE,
        [expr, typeAnn],
      );
    }

    // Simple / chained assignment: a = b = 1
    if (this.atOp("=")) {
      const targets: ASTNode[] = [expr];
      while (this.atOp("=")) {
        this.advance();
        targets.push(this.parseExpr());
      }
      // Last target is the RHS value
      const rhs = targets.pop()!;
      const endOffset = rhs.span.end.offset;
      return createNode(
        "assignment",
        this.nodeSpan(expr.span.start.offset, endOffset),
        LANGUAGE,
        [...targets, rhs],
      );
    }

    // Walrus operator in expression context already handled
    return expr;
  }

  // ── Block (indented suite) ────────────────────────────────────────

  private parseBlock(): ASTNode {
    const startTok = this.cur();
    const children: ASTNode[] = [];

    // Skip past NEWLINE and INDENT
    while (this.at(TK.NEWLINE) || this.at(TK.INDENT)) this.advance();

    while (!this.at(TK.EOF) && !this.at(TK.DEDENT)) {
      if (this.match(TK.NEWLINE)) continue;
      if (this.match(TK.INDENT)) continue;
      if (this.at(TK.COMMENT)) {
        children.push(this.tokNode("comment", this.advance()));
        continue;
      }
      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);
    }

    this.match(TK.DEDENT);

    const endOffset = children.length > 0
      ? children[children.length - 1]!.span.end.offset
      : startTok.start;
    return createNode("block", this.nodeSpan(startTok.start, endOffset), LANGUAGE, children);
  }

  // ── Expressions (precedence climbing) ─────────────────────────────

  /**
   * Expression entry point. Handles ternary (x if cond else y).
   */
  private parseExpr(): ASTNode {
    return this.parseTernary();
  }

  private parseTernary(): ASTNode {
    let expr = this.parseLambda();

    if (this.atName("if")) {
      const ifTok = this.advance();
      const cond = this.parseLambda();
      this.expect(TK.NAME, "else");
      const elseVal = this.parseExpr();
      return createNode(
        "ternary-expr",
        this.nodeSpan(expr.span.start.offset, elseVal.span.end.offset),
        LANGUAGE,
        [expr, cond, elseVal],
      );
    }

    // Walrus operator: name := expr
    if (this.atOp(":=")) {
      this.advance();
      const rhs = this.parseExpr();
      return createNode(
        "assignment",
        this.nodeSpan(expr.span.start.offset, rhs.span.end.offset),
        LANGUAGE,
        [expr, rhs],
        ":=",
      );
    }

    return expr;
  }

  private parseLambda(): ASTNode {
    if (this.atName("lambda")) {
      const lambdaTok = this.advance();
      const children: ASTNode[] = [];

      // Parameters (until ':')
      if (!this.atOp(":")) {
        children.push(this.parseLambdaParams());
      }
      this.expect(TK.OP, ":");
      children.push(this.parseExpr());

      const endTok = children[children.length - 1]!;
      return this.synNode("lambda", lambdaTok, endTok, children);
    }

    return this.parseOr();
  }

  private parseLambdaParams(): ASTNode {
    const params: ASTNode[] = [];
    do {
      const n = this.expect(TK.NAME);
      const pChildren: ASTNode[] = [];
      if (this.atOp(":")) {
        this.advance();
        pChildren.push(this.parseExpr());
      }
      if (this.atOp("=")) {
        this.advance();
        pChildren.push(this.parseExpr());
      }
      const endOff = pChildren.length > 0 ? pChildren[pChildren.length - 1]!.span.end.offset : n.end;
      params.push(createNode("parameter", this.nodeSpan(n.start, endOff), LANGUAGE, pChildren, n.text));
    } while (this.match(TK.OP, ","));
    return createNode("block", this.nodeSpan(params[0]!.span.start.offset, params[params.length - 1]!.span.end.offset), LANGUAGE, params, "params");
  }

  // ── Binary operators by precedence ────────────────────────────────

  private parseOr(): ASTNode {
    let left = this.parseAnd();
    while (this.atName("or")) {
      const op = this.advance();
      const right = this.parseAnd();
      left = this.binaryNode(left, op, right);
    }
    return left;
  }

  private parseAnd(): ASTNode {
    let left = this.parseNot();
    while (this.atName("and")) {
      const op = this.advance();
      const right = this.parseNot();
      left = this.binaryNode(left, op, right);
    }
    return left;
  }

  private parseNot(): ASTNode {
    if (this.atName("not")) {
      const op = this.advance();
      const operand = this.parseNot();
      return createNode(
        "unary-expr",
        this.nodeSpan(op.start, operand.span.end.offset),
        LANGUAGE,
        [operand],
        "not",
      );
    }
    return this.parseComp();
  }

  private parseComp(): ASTNode {
    let left = this.parsePipe();
    // Chained comparisons: a < b < c
    const ops: Token[] = [];
    const rights: ASTNode[] = [];

    while (this.isCompOp()) {
      ops.push(this.advance());
      rights.push(this.parsePipe());
    }

    if (ops.length === 0) return left;

    // Flatten chained comparisons into a single compare-expr
    let result = left;
    for (let i = 0; i < ops.length; i++) {
      const right = rights[i]!;
      result = createNode(
        "compare-expr",
        this.nodeSpan(result.span.start.offset, right.span.end.offset),
        LANGUAGE,
        [result, right],
        ops[i]!.text,
      );
    }
    return result;
  }

  private isCompOp(): boolean {
    if (this.atOp() && COMP_OPS.has(this.cur().text)) return true;
    if (this.atName("in") || this.atName("is")) return true;
    if (this.atName("not") && this.peek().kind === TK.NAME && this.peek().text === "in") {
      // "not in" — consume both
      this.advance();
      return true;
    }
    return false;
  }

  private parsePipe(): ASTNode { return this.parseBinOp(() => this.parseXor(), "|"); }
  private parseXor(): ASTNode { return this.parseBinOp(() => this.parseAmp(), "^"); }
  private parseAmp(): ASTNode { return this.parseBinOp(() => this.parseShift(), "&"); }

  private parseShift(): ASTNode {
    let left = this.parseAdd();
    while (this.atOp("<<") || this.atOp(">>")) {
      const op = this.advance();
      const right = this.parseAdd();
      left = this.binaryNode(left, op, right);
    }
    return left;
  }

  private parseAdd(): ASTNode {
    let left = this.parseMul();
    while (this.atOp("+") || this.atOp("-")) {
      const op = this.advance();
      const right = this.parseMul();
      left = this.binaryNode(left, op, right);
    }
    return left;
  }

  private parseMul(): ASTNode {
    let left = this.parseFactor();
    while (this.atOp("*") || this.atOp("/") || this.atOp("//") || this.atOp("%") || this.atOp("@")) {
      const op = this.advance();
      const right = this.parseFactor();
      left = this.binaryNode(left, op, right);
    }
    return left;
  }

  private parseFactor(): ASTNode {
    if (this.atOp("+") || this.atOp("-") || this.atOp("~")) {
      const op = this.advance();
      const operand = this.parseFactor();
      return createNode(
        "unary-expr",
        this.nodeSpan(op.start, operand.span.end.offset),
        LANGUAGE,
        [operand],
        op.text,
      );
    }
    return this.parsePower();
  }

  private parsePower(): ASTNode {
    let base = this.parseAwait();
    if (this.atOp("**")) {
      const op = this.advance();
      const exp = this.parseFactor(); // right-associative
      return this.binaryNode(base, op, exp);
    }
    return base;
  }

  private parseAwait(): ASTNode {
    if (this.atName("await")) {
      const awTok = this.advance();
      const val = this.parseAwait();
      return createNode(
        "await-expr",
        this.nodeSpan(awTok.start, val.span.end.offset),
        LANGUAGE,
        [val],
      );
    }
    return this.parsePostfix();
  }

  // ── Postfix (calls, subscripts, attribute access) ─────────────────

  private parsePostfix(): ASTNode {
    let expr = this.parseAtom();

    while (true) {
      if (this.atOp("(")) {
        const args = this.parseCallArgs(expr);
        expr = args;
      } else if (this.atOp("[")) {
        expr = this.parseSubscript(expr);
      } else if (this.atOp(".")) {
        const dot = this.advance();
        const attr = this.expect(TK.NAME);
        expr = createNode(
          "member-expr",
          this.nodeSpan(expr.span.start.offset, attr.end),
          LANGUAGE,
          [expr],
          attr.text,
        );
      } else {
        break;
      }
    }

    return expr;
  }

  private parseCallArgs(callee: ASTNode): ASTNode {
    const open = this.advance(); // eat '('
    const children: ASTNode[] = [callee];

    while (!this.at(TK.EOF) && !this.atOp(")")) {
      // Keyword argument: name=expr
      if (this.at(TK.NAME) && this.peek().kind === TK.OP && this.peek().text === "=") {
        const kwName = this.advance();
        this.advance(); // eat '='
        const kwVal = this.parseExpr();
        const kwSpan = this.nodeSpan(kwName.start, kwVal.span.end.offset);
        children.push(createNode("parameter", kwSpan, LANGUAGE, [kwVal], kwName.text));
      } else if (this.atOp("*")) {
        const star = this.advance();
        if (this.atOp("*")) {
          // **kwargs
          this.advance();
          children.push(createNode("parameter", tokSpan(star, this.src), LANGUAGE, [this.parseExpr()], "**"));
        } else {
          children.push(createNode("parameter", tokSpan(star, this.src), LANGUAGE, [this.parseExpr()], "*"));
        }
      } else {
        children.push(this.parseExpr());
      }
      this.match(TK.OP, ",");
    }
    this.expect(TK.OP, ")");
    const close = this.tokens[this.pos - 1]!;
    return this.synNode("call", open, close, children);
  }

  private parseSubscript(collection: ASTNode): ASTNode {
    const open = this.advance(); // eat '['
    const children: ASTNode[] = [collection];

    // Slice handling: start:stop:step
    while (!this.at(TK.EOF) && !this.atOp("]")) {
      if (this.atOp(":")) {
        this.advance();
        continue;
      }
      children.push(this.parseExpr());
      this.match(TK.OP, ":");
      this.match(TK.OP, ",");
    }
    this.expect(TK.OP, "]");
    const close = this.tokens[this.pos - 1]!;
    return this.synNode("index-expr", open, close, children);
  }

  // ── Atom (literals, names, groupings, comprehensions) ─────────────

  private parseAtom(): ASTNode {
    const t = this.cur();

    // Number literal
    if (t.kind === TK.NUMBER) {
      return this.tokNode("number", this.advance());
    }

    // String literal
    if (t.kind === TK.STRING) {
      return this.tokNode("string", this.advance());
    }

    // F-string
    if (t.kind === TK.FSTRING) {
      return this.parseFString();
    }

    // Name / keyword-as-value
    if (t.kind === TK.NAME) {
      if (t.text === "True" || t.text === "False" || t.text === "None") {
        return this.tokNode("identifier", this.advance());
      }
      if (t.text === "not") {
        // Handled by parseNot, but safe fallback
        const op = this.advance();
        const operand = this.parseExpr();
        return createNode(
          "unary-expr",
          this.nodeSpan(op.start, operand.span.end.offset),
          LANGUAGE,
          [operand],
          "not",
        );
      }
      return this.tokNode("identifier", this.advance());
    }

    // Parenthesized expression or tuple or generator comprehension
    if (this.atOp("(")) {
      return this.parseParenOrTuple();
    }

    // List literal or list comprehension
    if (this.atOp("[")) {
      return this.parseListOrComprehension();
    }

    // Dict/set literal or dict/set comprehension
    if (this.atOp("{")) {
      return this.parseDictSetOrComprehension();
    }

    // Yield expression
    if (this.atName("yield")) {
      return this.parseYieldStmt();
    }

    // Fallback: consume and produce error node
    return this.errorNode(this.advance(), `Unexpected token: ${t.text}`);
  }

  private parseParenOrTuple(): ASTNode {
    const open = this.advance(); // eat '('

    if (this.atOp(")")) {
      this.advance();
      return createNode("identifier", this.nodeSpan(open.start, this.tokens[this.pos - 1]!.end), LANGUAGE, [], "()");
    }

    const first = this.parseExpr();

    // Generator comprehension: (expr for ...)
    if (this.atName("for")) {
      return this.parseComprehensionTail("comprehension", open, first);
    }

    const items: ASTNode[] = [first];
    while (this.match(TK.OP, ",")) {
      if (this.atOp(")")) break;
      items.push(this.parseExpr());
    }
    this.expect(TK.OP, ")");
    const close = this.tokens[this.pos - 1]!;
    if (items.length === 1) return first; // plain grouped expr
    return this.synNode("identifier", open, close, items, "tuple");
  }

  private parseListOrComprehension(): ASTNode {
    const open = this.advance(); // eat '['

    if (this.atOp("]")) {
      this.advance();
      return createNode("identifier", this.nodeSpan(open.start, this.tokens[this.pos - 1]!.end), LANGUAGE, [], "[]");
    }

    const first = this.parseExpr();

    // List comprehension: [expr for ...]
    if (this.atName("for")) {
      return this.parseComprehensionTail("comprehension", open, first);
    }

    const items: ASTNode[] = [first];
    while (this.match(TK.OP, ",")) {
      if (this.atOp("]")) break;
      items.push(this.parseExpr());
    }
    this.expect(TK.OP, "]");
    const close = this.tokens[this.pos - 1]!;
    return this.synNode("identifier", open, close, items, "list");
  }

  private parseDictSetOrComprehension(): ASTNode {
    const open = this.advance(); // eat '{'

    if (this.atOp("}")) {
      this.advance();
      return createNode("identifier", this.nodeSpan(open.start, this.tokens[this.pos - 1]!.end), LANGUAGE, [], "{}");
    }

    const first = this.parseExpr();

    // Dict comprehension: {k: v for ...}
    if (this.atOp(":")) {
      this.advance();
      const val = this.parseExpr();
      if (this.atName("for")) {
        return this.parseComprehensionTail("comprehension", open, first, val);
      }
      // Dict literal
      const items: ASTNode[] = [createNode("identifier", this.nodeSpan(first.span.start.offset, val.span.end.offset), LANGUAGE, [first, val], ":")];
      while (this.match(TK.OP, ",")) {
        if (this.atOp("}")) break;
        const k = this.parseExpr();
        this.expect(TK.OP, ":");
        const v = this.parseExpr();
        items.push(createNode("identifier", this.nodeSpan(k.span.start.offset, v.span.end.offset), LANGUAGE, [k, v], ":"));
      }
      this.expect(TK.OP, "}");
      const close = this.tokens[this.pos - 1]!;
      return this.synNode("identifier", open, close, items, "dict");
    }

    // Set comprehension: {expr for ...}
    if (this.atName("for")) {
      return this.parseComprehensionTail("comprehension", open, first);
    }

    // Set literal
    const items: ASTNode[] = [first];
    while (this.match(TK.OP, ",")) {
      if (this.atOp("}")) break;
      items.push(this.parseExpr());
    }
    this.expect(TK.OP, "}");
    const close = this.tokens[this.pos - 1]!;
    return this.synNode("identifier", open, close, items, "set");
  }

  /**
   * Parse the "for ... in ... if ..." tail of a comprehension.
   * `extraValue` is the value expression in a dict comprehension (k: v).
   */
  private parseComprehensionTail(kind: string, open: Token, first: ASTNode, extraValue?: ASTNode): ASTNode {
    const children: ASTNode[] = extraValue ? [first, extraValue] : [first];

    while (this.atName("for")) {
      const forTok = this.advance();
      const target = this.parseTargetList();
      this.expect(TK.NAME, "in");
      const iter = this.parseOr(); // use lower precedence to avoid consuming 'if'
      const compChildren: ASTNode[] = [target, iter];

      // Conditionals
      while (this.atName("if")) {
        this.advance();
        compChildren.push(this.parseOr());
      }

      const compEnd = compChildren[compChildren.length - 1]!;
      children.push(this.synNode("for-stmt", forTok, compEnd, compChildren));
    }

    // Determine closing bracket
    let closeBracket = "]";
    if (open.text === "(") closeBracket = ")";
    if (open.text === "{") closeBracket = "}";
    this.expect(TK.OP, closeBracket);
    const close = this.tokens[this.pos - 1]!;
    return this.synNode(kind, open, close, children, "comprehension");
  }

  // ── F-string ──────────────────────────────────────────────────────

  private parseFString(): ASTNode {
    const tok = this.advance(); // eat f-string token
    const text = tok.text;
    const children: ASTNode[] = [];
    const inner = text.slice(text.indexOf("'") !== -1 ? text.indexOf("'") : text.indexOf('"'));
    const quoteChar = inner[0]!;
    let content = inner;
    // Strip surrounding quotes
    if (content.startsWith(quoteChar.repeat(3))) {
      content = content.slice(3, -3);
    } else if (content.startsWith(quoteChar)) {
      content = content.slice(1, -1);
    }

    // Scan for {expr} interpolations
    let idx = 0;
    const parts: { isExpr: boolean; text: string }[] = [];
    while (idx < content.length) {
      if (content[idx] === "{" && content[idx + 1] !== "{") {
        const start = idx;
        let depth = 1;
        idx++;
        while (idx < content.length && depth > 0) {
          if (content[idx] === "{") depth++;
          if (content[idx] === "}") depth--;
          idx++;
        }
        parts.push({ isExpr: true, text: content.slice(start + 1, idx - 1) });
      } else if (content[idx] === "{" && content[idx + 1] === "{") {
        parts.push({ isExpr: false, text: "{" });
        idx += 2;
      } else if (content[idx] === "}" && content[idx + 1] === "}") {
        parts.push({ isExpr: false, text: "}" });
        idx += 2;
      } else {
        const start = idx;
        while (idx < content.length) {
          if (content[idx] === "{" || content[idx] === "}") break;
          idx++;
        }
        parts.push({ isExpr: false, text: content.slice(start, idx) });
      }
    }

    for (const part of parts) {
      if (part.isExpr) {
        // Best-effort: parse inner expression. Use a placeholder identifier.
        children.push(createNode("identifier", tokSpan(tok, this.src), LANGUAGE, [], part.text));
      }
    }

    return createNode("fstring", tokSpan(tok, this.src), LANGUAGE, children, text);
  }

  // ── Target list (for-loop targets, etc.) ──────────────────────────

  private parseTargetList(): ASTNode {
    const targets: ASTNode[] = [];
    targets.push(this.parseTarget());
    while (this.match(TK.OP, ",")) {
      if (this.atName("in") || this.atOp(":")) break;
      targets.push(this.parseTarget());
    }
    if (targets.length === 1) return targets[0]!;
    const first = targets[0]!;
    const last = targets[targets.length - 1]!;
    return createNode("identifier", this.nodeSpan(first.span.start.offset, last.span.end.offset), LANGUAGE, targets, "tuple-target");
  }

  private parseTarget(): ASTNode {
    if (this.atOp("(")) {
      return this.parseParenOrTuple();
    }
    if (this.atOp("[")) {
      return this.parseListOrComprehension();
    }
    if (this.at(TK.NAME)) {
      return this.tokNode("variable", this.advance());
    }
    if (this.atOp("*")) {
      const star = this.advance();
      const inner = this.parseTarget();
      return createNode(
        "variable",
        this.nodeSpan(star.start, inner.span.end.offset),
        LANGUAGE,
        [inner],
        "*" + (inner.label ?? ""),
      );
    }
    return this.tokNode("identifier", this.advance());
  }

  // ── Type annotation (simplified) ──────────────────────────────────

  private parseTypeAnnotation(): ASTNode {
    const startTok = this.cur();
    const node = this.parsePostfix(); // Reuse expression parsing
    return node;
  }

  // ── Arg list (decorators, etc.) ───────────────────────────────────

  private parseArgList(): ASTNode {
    const open = this.advance(); // eat '('
    const children: ASTNode[] = [];
    while (!this.at(TK.EOF) && !this.atOp(")")) {
      children.push(this.parseExpr());
      this.match(TK.OP, ",");
    }
    this.expect(TK.OP, ")");
    const close = this.tokens[this.pos - 1]!;
    return this.synNode("call", open, close, children);
  }

  // ── Utility ───────────────────────────────────────────────────────

  private skipBracketGroup(): void {
    let depth = 0;
    while (!this.at(TK.EOF)) {
      if (this.atOp("[")) depth++;
      if (this.atOp("]")) { depth--; if (depth === 0) { this.advance(); return; } }
      this.advance();
    }
  }

  private binaryNode(left: ASTNode, op: Token, right: ASTNode): ASTNode {
    return createNode(
      "binary-expr",
      this.nodeSpan(left.span.start.offset, right.span.end.offset),
      LANGUAGE,
      [left, right],
      op.text,
    );
  }

  // ── parseBinOp helper ─────────────────────────────────────────────

  /**
   * Generic left-associative binary operator parser.
   */
  private parseBinOp(next: () => ASTNode, ...ops: string[]): ASTNode {
    let left = next();
    while (this.atOp() && ops.includes(this.cur().text)) {
      const op = this.advance();
      const right = next();
      left = this.binaryNode(left, op, right);
    }
    return left;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export const pythonParser: LanguageParser = {
  parse(source: string, name: string): EitherType<ParseError, ASTNode> {
    try {
      const tokens = tokenize(source);
      const parser = new Parser(tokens, source, name);
      const ast = parser.parseFile();
      return Either.right(ast);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Either.left(createConfigError("ParseError", `Python parse error: ${message}`, name));
    }
  },

  parseIncremental(
    source: string,
    name: string,
    _previous: ASTNode,
    _edit: EditDescriptor,
  ): EitherType<ParseError, ASTNode> {
    // Full reparse — incremental parsing not yet implemented
    return pythonParser.parse(source, name);
  },
};
