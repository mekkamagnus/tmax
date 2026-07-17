/**
 * @file typescript-parser.ts
 * @description Recursive-descent parser for TypeScript/JavaScript producing ASTNode trees.
 *              Covers: functions, classes, interfaces, blocks, expressions, declarations,
 *              control flow, type annotations, JSX, decorators, and error recovery.
 */

import { Either, type Either as EitherType } from "../../../utils/task-either.ts";
import { createConfigError, type ConfigError } from "../../../error/types.ts";
import type { SourceSpan } from "../../../tlisp/source.ts";
import type { ASTNode, EditDescriptor, LanguageParser, ParseError } from "../types.ts";
import { createNode } from "../types.ts";
// CHORE-44 Change 11 AC11.4 — shared parser mechanics (position math only).
import {
  buildLineMap,
  positionAt,
  spanFrom,
} from "./shared/source-position.ts";
import { errorNode as sharedErrorNode } from "./shared/node-factory.ts";

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

/** Classification of a token for lookahead decisions. */
export type TokenClass =
  | "keyword"
  | "punctuation"
  | "operator"
  | "identifier"
  | "string"
  | "number"
  | "regexp"
  | "comment"
  | "type"
  | "boolean"
  | "decorator"
  | "eof";

/** Extended token carrying a classification field. */
export interface TypedToken {
  type: string;
  value: string;
  /** 0-based byte offset in the source string. */
  startOffset: number;
  /** Exclusive end offset. */
  endOffset: number;
  /** Classification for lookahead. */
  tokenClass: TokenClass;
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

const KEYWORDS = new Set([
  "abstract", "as", "asserts", "async", "await", "break", "case", "catch",
  "class", "const", "constructor", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "export", "extends", "finally", "for",
  "from", "function", "if", "implements", "import", "in", "instanceof",
  "interface", "is", "keyof", "let", "module", "namespace", "new", "of",
  "package", "private", "protected", "public", "readonly", "require",
  "return", "satisfies", "set", "static", "super", "switch", "this",
  "throw", "try", "type", "typeof", "var", "void", "while", "with", "yield",
]);

const TYPE_KEYWORDS = new Set([
  "any", "bigint", "boolean", "never", "null", "number", "object", "string",
  "symbol", "undefined", "unknown", "void", "infer",
]);

const SINGLE_CHAR_PUNCTUATION = new Set([
  "(", ")", "{", "}", "[", "]", ";", ",", ":", ".", "?", "~",
]);

const MULTI_CHAR_OPS: readonly string[] = [
  "===", "!==", ">>>=", ">>>", "<<=", ">>=",
  "==", "!=", "<=", ">=", "&&", "||", "??", "**",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "=>", "...", "++", "--", "<<", ">>", "?.",
  "!.", // not real but harmless; longest match
];

/**
 * Minimal lexer.  Produces TypedToken[] from source text.
 * Does NOT understand regex ambiguity (division vs regex) — it skips regex
 * tokens in favour of correctness on typical TypeScript code.
 */
function tokenize(source: string): TypedToken[] {
  const tokens: TypedToken[] = [];
  let pos = 0;
  const len = source.length;

  const skipWhitespaceAndComments = (): void => {
    while (pos < len) {
      const ch = source[pos]!;
      // line comment
      if (ch === "/" && source[pos + 1] === "/") {
        const start = pos;
        while (pos < len && source[pos] !== "\n") pos++;
        tokens.push(makeToken("comment", source.slice(start, pos), start, pos, "comment"));
        continue;
      }
      // block comment
      if (ch === "/" && source[pos + 1] === "*") {
        const start = pos;
        pos += 2;
        while (pos < len - 1 && !(source[pos] === "*" && source[pos + 1] === "/")) pos++;
        pos = Math.min(pos + 2, len);
        tokens.push(makeToken("comment", source.slice(start, pos), start, pos, "comment"));
        continue;
      }
      // whitespace
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        pos++;
        continue;
      }
      break;
    }
  };

  while (pos < len) {
    skipWhitespaceAndComments();
    if (pos >= len) break;

    const ch = source[pos]!;

    // strings
    if (ch === '"' || ch === "'" || ch === "`") {
      const start = pos;
      const quote = ch;
      pos++;
      if (quote === "`") {
        // template literal — handle ${ } nesting loosely
        let depth = 1;
        while (pos < len && depth > 0) {
          if (source[pos] === "\\") { pos += 2; continue; }
          if (source[pos] === "`") { depth--; pos++; continue; }
          if (source[pos] === "$" && source[pos + 1] === "{") { depth++; pos += 2; continue; }
          pos++;
        }
      } else {
        while (pos < len && source[pos] !== quote) {
          if (source[pos] === "\\") pos++;
          pos++;
        }
        if (pos < len) pos++; // closing quote
      }
      tokens.push(makeToken("string", source.slice(start, pos), start, pos, "string"));
      continue;
    }

    // numbers
    if (isDigit(ch) || (ch === "." && pos + 1 < len && isDigit(source[pos + 1]!))) {
      const start = pos;
      if (source[pos] === "0" && (source[pos + 1] === "x" || source[pos + 1] === "X")) {
        pos += 2;
        while (pos < len && isHexDigit(source[pos]!)) pos++;
      } else if (source[pos] === "0" && (source[pos + 1] === "b" || source[pos + 1] === "B")) {
        pos += 2;
        while (pos < len && (source[pos] === "0" || source[pos] === "1")) pos++;
      } else if (source[pos] === "0" && (source[pos + 1] === "o" || source[pos + 1] === "O")) {
        pos += 2;
        while (pos < len && isOctalDigit(source[pos]!)) pos++;
      } else {
        while (pos < len && isDigit(source[pos]!)) pos++;
        if (pos < len && source[pos] === ".") {
          pos++;
          while (pos < len && isDigit(source[pos]!)) pos++;
        }
        if (pos < len && (source[pos] === "e" || source[pos] === "E")) {
          pos++;
          if (pos < len && (source[pos] === "+" || source[pos] === "-")) pos++;
          while (pos < len && isDigit(source[pos]!)) pos++;
        }
      }
      tokens.push(makeToken("number", source.slice(start, pos), start, pos, "number"));
      continue;
    }

    // decorators
    if (ch === "@" && pos + 1 < len && isIdentStart(source[pos + 1]!)) {
      const start = pos;
      pos++; // @
      while (pos < len && isIdentPart(source[pos]!)) pos++;
      tokens.push(makeToken("decorator", source.slice(start, pos), start, pos, "decorator"));
      continue;
    }

    // identifiers & keywords
    if (isIdentStart(ch)) {
      const start = pos;
      while (pos < len && isIdentPart(source[pos]!)) pos++;
      const text = source.slice(start, pos);
      if (text === "true" || text === "false") {
        tokens.push(makeToken("boolean", text, start, pos, "boolean"));
      } else if (KEYWORDS.has(text)) {
        tokens.push(makeToken("keyword", text, start, pos, "keyword"));
      } else if (TYPE_KEYWORDS.has(text)) {
        tokens.push(makeToken("type", text, start, pos, "type"));
      } else {
        tokens.push(makeToken("identifier", text, start, pos, "identifier"));
      }
      continue;
    }

    // multi-char operators
    let matched = false;
    for (const op of MULTI_CHAR_OPS) {
      if (source.startsWith(op, pos)) {
        tokens.push(makeToken("operator", op, pos, pos + op.length, "operator"));
        pos += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // single-char punctuation
    if (SINGLE_CHAR_PUNCTUATION.has(ch)) {
      tokens.push(makeToken("punctuation", ch, pos, pos + 1, "punctuation"));
      pos++;
      continue;
    }

    // single-char operators that aren't in SINGLE_CHAR_PUNCTUATION
    if (isOperatorChar(ch)) {
      tokens.push(makeToken("operator", ch, pos, pos + 1, "operator"));
      pos++;
      continue;
    }

    // fallback: skip unknown character
    pos++;
  }

  // eof sentinel
  tokens.push(makeToken("eof", "", pos, pos, "eof"));
  return tokens;
}

function makeToken(
  type: string,
  value: string,
  startOffset: number,
  endOffset: number,
  tokenClass: TokenClass,
): TypedToken {
  return { type, value, startOffset, endOffset, tokenClass };
}

// ---------------------------------------------------------------------------
// Character helpers
// ---------------------------------------------------------------------------

function isDigit(ch: string): boolean { return ch >= "0" && ch <= "9"; }
function isHexDigit(ch: string): boolean { return isDigit(ch) || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F"); }
function isOctalDigit(ch: string): boolean { return ch >= "0" && ch <= "7"; }
function isIdentStart(ch: string): boolean { return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$"; }
function isIdentPart(ch: string): boolean { return isIdentStart(ch) || isDigit(ch); }
function isOperatorChar(ch: string): boolean { return "+-*/%<>=!&|^~".includes(ch); }

// ---------------------------------------------------------------------------
// Parser state
// ---------------------------------------------------------------------------

const LANG = "typescript";

// CHORE-44 Change 11 AC11.4: positionAt/spanFrom moved to shared/source-position.ts.
// `buildLineMap` is the renamed `computeLineOffsets` (semantically identical:
// line-start offsets, 0-based, one entry per `\n`).

// ---------------------------------------------------------------------------
// Recursive-descent parser
// ---------------------------------------------------------------------------

class Parser {
  private tokens: TypedToken[];
  private pos: number;
  private source: string;
  private lineOffsets: number[];
  private fileName: string;

  private constructor(source: string, name: string, tokens: TypedToken[]) {
    this.source = source;
    this.fileName = name;
    this.tokens = tokens;
    this.pos = 0;
    this.lineOffsets = buildLineMap(source);
  }

  // -- public entry ----------------------------------------------------------

  static parse(source: string, name: string): EitherType<ParseError, ASTNode> {
    try {
      const tokens = tokenize(source);
      const parser = new Parser(source, name, tokens);
      const children = parser.parseTopLevel();
      const startOff = children.length > 0 ? children[0]!.span.start.offset : 0;
      const endOff = children.length > 0 ? children[children.length - 1]!.span.end.offset : 0;
      const root = createNode("file", spanFrom(startOff, endOff, parser.lineOffsets), LANG, children, name);
      return Either.right(root);
    } catch (err) {
      return Either.left(createConfigError(
        "ParseError",
        err instanceof Error ? err.message : String(err),
        name,
      ));
    }
  }

  // -- helpers ---------------------------------------------------------------

  private cur(): TypedToken { return this.tokens[this.pos]!; }
  private peek(offset: number = 0): TypedToken { return this.tokens[this.pos + offset] ?? this.tokens[this.tokens.length - 1]!; }

  private at(value: string): boolean { return this.cur().value === value; }
  private atType(tc: TokenClass): boolean { return this.cur().tokenClass === tc; }

  private eat(value: string): TypedToken | null {
    if (this.cur().value === value) return this.advance();
    return null;
  }

  private expect(value: string): TypedToken {
    if (this.cur().value === value) return this.advance();
    // error recovery: don't advance, caller handles
    return this.cur();
  }

  private advance(): TypedToken {
    const t = this.tokens[this.pos]!;
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private span(startOff: number, endOff: number): SourceSpan {
    return spanFrom(startOff, endOff, this.lineOffsets);
  }

  // -- top-level -------------------------------------------------------------

  private parseTopLevel(): ASTNode[] {
    const items: ASTNode[] = [];
    while (this.cur().tokenClass !== "eof") {
      const node = this.parseStatement();
      if (node) items.push(node);
    }
    return items;
  }

  // -- statement dispatch ----------------------------------------------------

  private parseStatement(): ASTNode | null {
    const t = this.cur();

    // decorators attach to the next declaration
    if (t.tokenClass === "decorator") {
      return this.parseDecoratedDeclaration();
    }

    switch (t.value) {
      case "import": return this.parseImport();
      case "export": return this.parseExport();
      case "function": return this.parseFunctionDeclaration();
      case "class": return this.parseClass();
      case "interface": return this.parseInterface();
      case "type": return this.parseTypeAlias();
      case "enum": return this.parseEnum();
      case "if": return this.parseIf();
      case "for": return this.parseFor();
      case "while": return this.parseWhile();
      case "do": return this.parseDoWhile();
      case "switch": return this.parseSwitch();
      case "try": return this.parseTry();
      case "return": return this.parseReturn();
      case "throw": return this.parseThrow();
      case "break": return this.parseBreakOrContinue("break-stmt");
      case "continue": return this.parseBreakOrContinue("continue-stmt");
      case "var":
      case "let":
      case "const": return this.parseVariableDeclaration();
      case ";": this.advance(); return null;
      case "{": return this.parseBlock();
      default:
        // expression statement
        return this.parseExpressionStatement();
    }
  }

  // -- decorators ------------------------------------------------------------

  private parseDecoratedDeclaration(): ASTNode {
    const decorators: ASTNode[] = [];
    const startOff = this.cur().startOffset;
    while (this.cur().tokenClass === "decorator") {
      const dt = this.advance();
      decorators.push(createNode("decorator", this.span(dt.startOffset, dt.endOffset), LANG, [], dt.value));
    }
    const decl = this.parseStatement();
    if (decl) {
      // prepend decorators as first children
      decl.children = [...decorators, ...decl.children];
      for (const d of decorators) d.parent = decl;
      decl.span = this.span(startOff, decl.span.end.offset);
      return decl;
    }
    // fallback: return decorator group as error
    return createNode("error", this.span(startOff, this.peek(-1).endOffset), LANG, decorators);
  }

  // -- import ----------------------------------------------------------------

  private parseImport(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("import");
    const children: ASTNode[] = [];

    // type import
    if (this.eat("type")) { /* consumed */ }

    if (this.cur().value === "{") {
      this.parseImportSpecifiers(children);
    } else if (this.cur().tokenClass === "identifier") {
      // default import or namespace
      const id = this.advance();
      children.push(createNode("identifier", this.span(id.startOffset, id.endOffset), LANG, [], id.value));
      if (this.eat(",")) {
        if (this.cur().value === "{") {
          this.parseImportSpecifiers(children);
        } else if (this.at("*")) {
          this.eat("*");
          this.expect("as");
          const ns = this.advance();
          children.push(createNode("identifier", this.span(ns.startOffset, ns.endOffset), LANG, [], ns.value));
        }
      }
    } else if (this.at("*")) {
      this.eat("*");
      this.expect("as");
      const ns = this.advance();
      children.push(createNode("identifier", this.span(ns.startOffset, ns.endOffset), LANG, [], ns.value));
    }

    if (this.eat("from")) {
      if (this.cur().tokenClass === "string") {
        const src = this.advance();
        children.push(createNode("string", this.span(src.startOffset, src.endOffset), LANG, [], src.value));
      }
    }

    this.eat(";");
    const endOff = this.peek(-1).endOffset;
    return createNode("import", this.span(startOff, endOff), LANG, children);
  }

  private parseImportSpecifiers(children: ASTNode[]): void {
    this.expect("{");
    while (!this.at("}") && this.cur().tokenClass !== "eof") {
      const id = this.advance();
      const label = id.value;
      const subChildren: ASTNode[] = [];
      if (this.eat("as")) {
        const local = this.advance();
        subChildren.push(createNode("identifier", this.span(local.startOffset, local.endOffset), LANG, [], local.value));
      }
      children.push(createNode("identifier", this.span(id.startOffset, id.endOffset), LANG, subChildren, label));
      this.eat(",");
    }
    this.expect("}");
  }

  // -- export ----------------------------------------------------------------

  private parseExport(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("export");
    const children: ASTNode[] = [];

    if (this.eat("default")) {
      if (this.at("function")) {
        const fn = this.parseFunctionDeclaration();
        children.push(fn);
      } else if (this.at("class")) {
        const cls = this.parseClass();
        children.push(cls);
      } else {
        const expr = this.parseAssignmentExpressionOrHigher();
        if (expr) children.push(expr);
      }
    } else if (this.eat("type")) {
      if (this.cur().tokenClass === "identifier") {
        const ta = this.parseTypeAlias();
        children.push(ta);
      }
    } else if (this.at("function")) {
      children.push(this.parseFunctionDeclaration());
    } else if (this.at("class")) {
      children.push(this.parseClass());
    } else if (this.at("interface")) {
      children.push(this.parseInterface());
    } else if (this.at("enum")) {
      children.push(this.parseEnum());
    } else if (this.cur().value === "{") {
      // export { x, y }
      this.expect("{");
      while (!this.at("}") && this.cur().tokenClass !== "eof") {
        const id = this.advance();
        const sub: ASTNode[] = [];
        if (this.eat("as")) {
          const alias = this.advance();
          sub.push(createNode("identifier", this.span(alias.startOffset, alias.endOffset), LANG, [], alias.value));
        }
        children.push(createNode("identifier", this.span(id.startOffset, id.endOffset), LANG, sub, id.value));
        this.eat(",");
      }
      this.expect("}");
      if (this.eat("from")) {
        if (this.cur().tokenClass === "string") {
          const src = this.advance();
          children.push(createNode("string", this.span(src.startOffset, src.endOffset), LANG, [], src.value));
        }
      }
    } else if (this.at("*")) {
      this.eat("*");
      if (this.eat("as")) {
        const ns = this.advance();
        children.push(createNode("identifier", this.span(ns.startOffset, ns.endOffset), LANG, [], ns.value));
      }
      if (this.eat("from")) {
        if (this.cur().tokenClass === "string") {
          const src = this.advance();
          children.push(createNode("string", this.span(src.startOffset, src.endOffset), LANG, [], src.value));
        }
      }
    } else if (this.at("const") || this.at("let") || this.at("var")) {
      children.push(this.parseVariableDeclaration());
    }

    this.eat(";");
    const endOff = this.peek(-1).endOffset;
    return createNode("export", this.span(startOff, endOff), LANG, children);
  }

  // -- function --------------------------------------------------------------

  private parseFunctionDeclaration(): ASTNode {
    const startOff = this.cur().startOffset;
    const async = this.eat("async");
    this.expect("function");
    this.eat("*"); // generator
    const name = this.cur().tokenClass === "identifier" ? this.advance() : null;
    const label = name?.value;
    const children: ASTNode[] = [];

    // type parameters <T>
    if (this.at("<")) this.parseTypeParameters(children);

    // parameters
    this.parseParameterList(children);

    // return type
    if (this.at(":")) this.parseTypeAnnotation(children);

    // body
    if (this.at("{")) {
      children.push(this.parseBlock());
    } else {
      this.eat(";");
    }

    const endOff = this.peek(-1).endOffset;
    const fn = createNode("function", this.span(startOff, endOff), LANG, children, label);
    if (async) fn.label = (fn.label ?? "") + " (async)";
    return fn;
  }

  private parseArrowFunction(startOff: number): ASTNode {
    const children: ASTNode[] = [];
    const async = this.cur().value === "async" ? (this.advance(), true) : false;

    if (this.at("(")) {
      this.parseParameterList(children);
    } else if (this.cur().tokenClass === "identifier") {
      // single param without parens: x => ...
      const id = this.advance();
      children.push(createNode("parameter", this.span(id.startOffset, id.endOffset), LANG, [], id.value));
    }

    // optional return type
    if (this.at(":")) this.parseTypeAnnotation(children);

    this.expect("=>");

    if (this.at("{")) {
      children.push(this.parseBlock());
    } else {
      const expr = this.parseAssignmentExpressionOrHigher();
      if (expr) children.push(expr);
    }

    const endOff = this.peek(-1).endOffset;
    return createNode("arrow-function", this.span(startOff, endOff), LANG, children, async ? "async" : undefined);
  }

  private parseParameterList(children: ASTNode[]): void {
    this.expect("(");
    while (!this.at(")") && this.cur().tokenClass !== "eof") {
      children.push(this.parseParameter());
      this.eat(",");
    }
    this.expect(")");
  }

  private parseParameter(): ASTNode {
    const startOff = this.cur().startOffset;
    const modifiers: ASTNode[] = [];

    // access modifiers
    if (this.cur().value === "public" || this.cur().value === "private" ||
        this.cur().value === "protected" || this.cur().value === "readonly") {
      const mod = this.advance();
      modifiers.push(createNode("identifier", this.span(mod.startOffset, mod.endOffset), LANG, [], mod.value));
    }

    // rest
    const spread = this.eat("...");

    const name = this.advance();
    const label = name.value;
    const paramChildren: ASTNode[] = [...modifiers];

    // optional ?
    this.eat("?");

    // type annotation
    if (this.at(":")) this.parseTypeAnnotation(paramChildren);

    // initializer
    if (this.eat("=")) {
      const init = this.parseAssignmentExpressionOrHigher();
      if (init) paramChildren.push(init);
    }

    const endOff = this.peek(-1).endOffset;
    const node = createNode("parameter", this.span(startOff, endOff), LANG, paramChildren, label);
    if (spread) node.label = "..." + (node.label ?? "");
    return node;
  }

  // -- class -----------------------------------------------------------------

  private parseClass(): ASTNode {
    const startOff = this.cur().startOffset;
    const abstract = this.eat("abstract");
    this.expect("class");
    const name = this.cur().tokenClass === "identifier" ? this.advance() : null;
    const label = name?.value;
    const children: ASTNode[] = [];

    // type parameters
    if (this.at("<")) this.parseTypeParameters(children);

    // extends
    if (this.eat("extends")) {
      const base = this.parseTypeReference();
      children.push(createNode("identifier", base.span, LANG, [], base.label));
    }

    // implements
    if (this.eat("implements")) {
      do {
        const impl = this.parseTypeReference();
        children.push(createNode("identifier", impl.span, LANG, [], impl.label));
        if (!this.eat(",")) break;
      } while (this.cur().tokenClass !== "eof");
    }

    // body
    this.expect("{");
    while (!this.at("}") && this.cur().tokenClass !== "eof") {
      const member = this.parseClassMember();
      if (member) children.push(member);
    }
    this.expect("}");

    const endOff = this.peek(-1).endOffset;
    const cls = createNode("class", this.span(startOff, endOff), LANG, children, label);
    if (abstract) cls.label = (cls.label ?? "") + " (abstract)";
    return cls;
  }

  private parseClassMember(): ASTNode | null {
    // skip decorators but attach them
    const decorators: ASTNode[] = [];
    while (this.cur().tokenClass === "decorator") {
      const dt = this.advance();
      decorators.push(createNode("decorator", this.span(dt.startOffset, dt.endOffset), LANG, [], dt.value));
    }

    const startOff = this.cur().startOffset;
    const accessors: string[] = [];

    // access modifiers
    while (["public", "private", "protected", "static", "readonly", "abstract", "override", "declare"].includes(this.cur().value)) {
      accessors.push(this.advance().value);
    }

    // constructor
    if (this.at("constructor")) {
      const ctor = this.advance();
      const children: ASTNode[] = [...decorators];
      if (this.at("<")) this.parseTypeParameters(children);
      this.parseParameterList(children);
      if (this.at(":")) this.parseTypeAnnotation(children);
      if (this.at("{")) children.push(this.parseBlock());
      const endOff = this.peek(-1).endOffset;
      return createNode("function", this.span(startOff, endOff), LANG, children, "constructor");
    }

    // get/set accessor
    if (this.at("get") || this.at("set")) {
      const kind = this.advance().value;
      const name = this.advance();
      const children: ASTNode[] = [...decorators];
      this.parseParameterList(children);
      if (this.at("{")) children.push(this.parseBlock());
      const endOff = this.peek(-1).endOffset;
      return createNode("function", this.span(startOff, endOff), LANG, children, name.value);
    }

    // method: name( or name<T>(
    if (this.cur().tokenClass === "identifier" || this.cur().value === "#") {
      const nameTok = this.advance();
      const label = nameTok.value;

      // optional
      this.eat("?");
      this.eat("!");

      if (this.at("<") || this.at("(")) {
        // method
        const children: ASTNode[] = [...decorators];
        if (this.at("<")) this.parseTypeParameters(children);
        this.parseParameterList(children);
        if (this.at(":")) this.parseTypeAnnotation(children);
        if (this.at("{")) children.push(this.parseBlock());
        else this.eat(";");
        const endOff = this.peek(-1).endOffset;
        return createNode("function", this.span(startOff, endOff), LANG, children, label);
      }

      // property with optional type + initializer
      if (this.at(":") || this.at("=") || this.at(";")) {
        const propChildren: ASTNode[] = [...decorators];
        if (this.at(":")) this.parseTypeAnnotation(propChildren);
        if (this.eat("=")) {
          const init = this.parseAssignmentExpressionOrHigher();
          if (init) propChildren.push(init);
        }
        this.eat(";");
        const endOff = this.peek(-1).endOffset;
        return createNode("property", this.span(startOff, endOff), LANG, propChildren, label);
      }
    }

    // index signature [key: string]: type
    if (this.at("[")) {
      return this.parseIndexSignature(startOff, decorators);
    }

    // fallback: skip to semicolon or brace
    return this.recoverMember(startOff);
  }

  private parseIndexSignature(startOff: number, decorators: ASTNode[]): ASTNode {
    const children: ASTNode[] = [...decorators];
    this.expect("[");
    // parameter
    if (this.cur().tokenClass === "identifier") {
      const id = this.advance();
      const paramChildren: ASTNode[] = [];
      if (this.at(":")) this.parseTypeAnnotation(paramChildren);
      children.push(createNode("parameter", this.span(id.startOffset, id.endOffset), LANG, paramChildren, id.value));
    }
    this.expect("]");
    if (this.at(":")) this.parseTypeAnnotation(children);
    this.eat(";");
    const endOff = this.peek(-1).endOffset;
    return createNode("property", this.span(startOff, endOff), LANG, children);
  }

  private recoverMember(startOff: number): ASTNode | null {
    while (!this.at(";") && !this.at("}") && this.cur().tokenClass !== "eof") {
      this.advance();
    }
    this.eat(";");
    if (this.peek(-1).endOffset <= startOff) return null;
    return createNode("error", this.span(startOff, this.peek(-1).endOffset), LANG, []);
  }

  // -- interface -------------------------------------------------------------

  private parseInterface(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("interface");
    const name = this.advance();
    const children: ASTNode[] = [];

    if (this.at("<")) this.parseTypeParameters(children);

    // extends
    if (this.eat("extends")) {
      do {
        const ext = this.parseTypeReference();
        children.push(createNode("identifier", ext.span, LANG, [], ext.label));
        if (!this.eat(",")) break;
      } while (this.cur().tokenClass !== "eof");
    }

    this.expect("{");
    while (!this.at("}") && this.cur().tokenClass !== "eof") {
      const member = this.parseInterfaceMember();
      if (member) children.push(member);
    }
    this.expect("}");

    const endOff = this.peek(-1).endOffset;
    return createNode("interface", this.span(startOff, endOff), LANG, children, name.value);
  }

  private parseInterfaceMember(): ASTNode | null {
    const startOff = this.cur().startOffset;

    // skip optional modifiers
    while (["readonly", "public", "private", "protected"].includes(this.cur().value)) {
      this.advance();
    }

    // index signature
    if (this.at("[")) {
      const children: ASTNode[] = [];
      this.expect("[");
      if (this.cur().tokenClass === "identifier") {
        const id = this.advance();
        const sub: ASTNode[] = [];
        if (this.at(":")) this.parseTypeAnnotation(sub);
        children.push(createNode("parameter", this.span(id.startOffset, id.endOffset), LANG, sub, id.value));
      }
      this.expect("]");
      if (this.at(":")) this.parseTypeAnnotation(children);
      this.eat(";");
      return createNode("property", this.span(startOff, this.peek(-1).endOffset), LANG, children);
    }

    // call signature: (params) => type
    if (this.at("(")) {
      const children: ASTNode[] = [];
      if (this.at("<")) this.parseTypeParameters(children);
      this.parseParameterList(children);
      if (this.at(":")) this.parseTypeAnnotation(children);
      this.eat(";");
      return createNode("function", this.span(startOff, this.peek(-1).endOffset), LANG, children);
    }

    // name
    if (this.cur().tokenClass !== "identifier") {
      // skip unknown token
      this.advance();
      return null;
    }
    const name = this.advance();
    this.eat("?");
    this.eat("!");

    if (this.at("(") || this.at("<")) {
      // method signature
      const children: ASTNode[] = [];
      if (this.at("<")) this.parseTypeParameters(children);
      this.parseParameterList(children);
      if (this.at(":")) this.parseTypeAnnotation(children);
      this.eat(";");
      return createNode("function", this.span(startOff, this.peek(-1).endOffset), LANG, children, name.value);
    }

    // property
    const propChildren: ASTNode[] = [];
    if (this.at(":")) this.parseTypeAnnotation(propChildren);
    this.eat(";");
    return createNode("property", this.span(startOff, this.peek(-1).endOffset), LANG, propChildren, name.value);
  }

  // -- type alias ------------------------------------------------------------

  private parseTypeAlias(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("type");
    const name = this.advance();
    const children: ASTNode[] = [];

    if (this.at("<")) this.parseTypeParameters(children);

    this.expect("=");
    this.parseTypeNode(children);
    this.eat(";");

    const endOff = this.peek(-1).endOffset;
    return createNode("type-alias", this.span(startOff, endOff), LANG, children, name.value);
  }

  // -- enum ------------------------------------------------------------------

  private parseEnum(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("enum");
    const name = this.advance();
    const children: ASTNode[] = [];

    this.expect("{");
    while (!this.at("}") && this.cur().tokenClass !== "eof") {
      const memberName = this.advance();
      const memberChildren: ASTNode[] = [];
      if (this.eat("=")) {
        const val = this.parseAssignmentExpressionOrHigher();
        if (val) memberChildren.push(val);
      }
      children.push(createNode("property", this.span(memberName.startOffset, this.peek(-1).endOffset), LANG, memberChildren, memberName.value));
      this.eat(",");
    }
    this.expect("}");

    const endOff = this.peek(-1).endOffset;
    return createNode("enum", this.span(startOff, endOff), LANG, children, name.value);
  }

  // -- variable declarations -------------------------------------------------

  private parseVariableDeclaration(): ASTNode {
    const startOff = this.cur().startOffset;
    const kind = this.advance().value; // var | let | const
    const children: ASTNode[] = [];

    do {
      children.push(this.parseVariableDeclarator());
    } while (this.eat(",") && this.cur().tokenClass !== "eof");

    this.eat(";");

    const endOff = this.peek(-1).endOffset;
    return createNode("variable", this.span(startOff, endOff), LANG, children, kind);
  }

  private parseVariableDeclarator(): ASTNode {
    const startOff = this.cur().startOffset;

    // possibly destructured
    if (this.at("{") || this.at("[")) {
      return this.parseDestructuringPattern();
    }

    const name = this.advance();
    const children: ASTNode[] = [];

    // type annotation
    if (this.at(":")) this.parseTypeAnnotation(children);

    // definite assignment assertion
    this.eat("!");

    // initializer
    if (this.eat("=")) {
      const init = this.parseAssignmentExpressionOrHigher();
      if (init) children.push(init);
    }

    const endOff = this.peek(-1).endOffset;
    return createNode("variable", this.span(startOff, endOff), LANG, children, name.value);
  }

  private parseDestructuringPattern(): ASTNode {
    const startOff = this.cur().startOffset;
    const open = this.cur().value;
    const kind = open === "{" ? "object" : "array";
    const children: ASTNode[] = [];

    this.advance(); // { or [
    const close = open === "{" ? "}" : "]";

    while (!this.at(close) && this.cur().tokenClass !== "eof") {
      if (this.eat("...")) {
        // rest element
        if (this.cur().tokenClass === "identifier") {
          const id = this.advance();
          children.push(createNode("spread", this.span(id.startOffset, id.endOffset), LANG, [], id.value));
        }
      } else if (this.cur().tokenClass === "identifier") {
        const id = this.advance();
        const sub: ASTNode[] = [];
        // renaming: { x: y }
        if (this.eat(":")) {
          if (this.cur().tokenClass === "identifier") {
            const alias = this.advance();
            sub.push(createNode("identifier", this.span(alias.startOffset, alias.endOffset), LANG, [], alias.value));
          }
        }
        if (this.eat("=")) {
          const init = this.parseAssignmentExpressionOrHigher();
          if (init) sub.push(init);
        }
        children.push(createNode("variable", this.span(id.startOffset, this.peek(-1).endOffset), LANG, sub, id.value));
      } else if (this.at("{") || this.at("[")) {
        children.push(this.parseDestructuringPattern());
      }
      this.eat(",");
    }

    this.expect(close);

    // type annotation after destructuring
    if (this.at(":")) {
      // skip type annotation (children already represent the pattern)
      this.skipType();
    }

    // initializer
    if (this.eat("=")) {
      const init = this.parseAssignmentExpressionOrHigher();
      if (init) children.push(init);
    }

    const endOff = this.peek(-1).endOffset;
    return createNode(kind, this.span(startOff, endOff), LANG, children);
  }

  // -- control flow ----------------------------------------------------------

  private parseIf(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("if");
    const children: ASTNode[] = [];

    this.expect("(");
    children.push(this.parseExpression()!);
    this.expect(")");

    const thenStmt = this.parseStatementOrBlock();
    if (thenStmt) children.push(thenStmt);

    if (this.eat("else")) {
      const elseStmt = this.parseStatementOrBlock();
      if (elseStmt) children.push(elseStmt);
    }

    const endOff = this.peek(-1).endOffset;
    return createNode("if-stmt", this.span(startOff, endOff), LANG, children);
  }

  private parseFor(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("for");
    const children: ASTNode[] = [];

    this.expect("(");

    if (this.eat("const") || this.eat("let") || this.eat("var")) {
      // for...of / for...in
      children.push(this.parseVariableDeclarator());
      if (this.eat("of") || this.eat("in")) {
        children.push(this.parseExpression()!);
      }
    } else {
      // classic for
      if (!this.at(";")) children.push(this.parseExpression()!);
      this.expect(";");
      if (!this.at(";")) children.push(this.parseExpression()!);
      this.expect(";");
      if (!this.at(")")) children.push(this.parseExpression()!);
    }

    this.expect(")");

    const body = this.parseStatementOrBlock();
    if (body) children.push(body);

    const endOff = this.peek(-1).endOffset;
    return createNode("for-stmt", this.span(startOff, endOff), LANG, children);
  }

  private parseWhile(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("while");
    const children: ASTNode[] = [];

    this.expect("(");
    children.push(this.parseExpression()!);
    this.expect(")");

    const body = this.parseStatementOrBlock();
    if (body) children.push(body);

    const endOff = this.peek(-1).endOffset;
    return createNode("while-stmt", this.span(startOff, endOff), LANG, children);
  }

  private parseDoWhile(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("do");
    const children: ASTNode[] = [];

    const body = this.parseStatementOrBlock();
    if (body) children.push(body);

    this.expect("while");
    this.expect("(");
    children.push(this.parseExpression()!);
    this.expect(")");
    this.eat(";");

    const endOff = this.peek(-1).endOffset;
    return createNode("while-stmt", this.span(startOff, endOff), LANG, children);
  }

  private parseSwitch(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("switch");
    const children: ASTNode[] = [];

    this.expect("(");
    children.push(this.parseExpression()!);
    this.expect(")");

    this.expect("{");
    while (!this.at("}") && this.cur().tokenClass !== "eof") {
      if (this.eat("default")) {
        this.eat(":");
        const body: ASTNode[] = [];
        while (!this.at("case") && !this.at("}") && this.cur().tokenClass !== "eof") {
          const s = this.parseStatement();
          if (s) body.push(s);
        }
        children.push(createNode("block", this.span(startOff, this.peek(-1).endOffset), LANG, body, "default"));
      } else if (this.eat("case")) {
        const caseChildren: ASTNode[] = [];
        caseChildren.push(this.parseExpression()!);
        this.eat(":");
        while (!this.at("case") && !this.at("default") && !this.at("}") && this.cur().tokenClass !== "eof") {
          const s = this.parseStatement();
          if (s) caseChildren.push(s);
        }
        children.push(createNode("block", this.span(startOff, this.peek(-1).endOffset), LANG, caseChildren, "case"));
      } else {
        this.advance(); // skip unexpected
      }
    }
    this.expect("}");

    const endOff = this.peek(-1).endOffset;
    return createNode("switch-stmt", this.span(startOff, endOff), LANG, children);
  }

  private parseTry(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("try");
    const children: ASTNode[] = [];

    children.push(this.parseBlock());

    if (this.eat("catch")) {
      const catchChildren: ASTNode[] = [];
      if (this.eat("(")) {
        if (this.cur().tokenClass === "identifier") {
          const id = this.advance();
          catchChildren.push(createNode("parameter", this.span(id.startOffset, id.endOffset), LANG, [], id.value));
        }
        if (this.at(":")) this.parseTypeAnnotation(catchChildren);
        this.expect(")");
      }
      catchChildren.push(this.parseBlock());
      children.push(createNode("block", this.span(startOff, this.peek(-1).endOffset), LANG, catchChildren, "catch"));
    }

    if (this.eat("finally")) {
      children.push(this.parseBlock());
    }

    const endOff = this.peek(-1).endOffset;
    return createNode("try-stmt", this.span(startOff, endOff), LANG, children);
  }

  private parseReturn(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("return");
    const children: ASTNode[] = [];
    if (!this.at(";") && !this.at("}") && this.cur().tokenClass !== "eof") {
      const expr = this.parseExpression();
      if (expr) children.push(expr);
    }
    this.eat(";");
    const endOff = this.peek(-1).endOffset;
    return createNode("return-stmt", this.span(startOff, endOff), LANG, children);
  }

  private parseThrow(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("throw");
    const children: ASTNode[] = [];
    const expr = this.parseExpression();
    if (expr) children.push(expr);
    this.eat(";");
    const endOff = this.peek(-1).endOffset;
    return createNode("throw-stmt", this.span(startOff, endOff), LANG, children);
  }

  private parseBreakOrContinue(kind: "break-stmt" | "continue-stmt"): ASTNode {
    const startOff = this.cur().startOffset;
    this.advance(); // break or continue
    let label: string | undefined;
    if (this.cur().tokenClass === "identifier") {
      label = this.advance().value;
    }
    this.eat(";");
    const endOff = this.peek(-1).endOffset;
    return createNode(kind, this.span(startOff, endOff), LANG, [], label);
  }

  // -- block -----------------------------------------------------------------

  private parseBlock(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("{");
    const children: ASTNode[] = [];
    while (!this.at("}") && this.cur().tokenClass !== "eof") {
      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);
    }
    this.expect("}");
    const endOff = this.peek(-1).endOffset;
    return createNode("block", this.span(startOff, endOff), LANG, children);
  }

  private parseStatementOrBlock(): ASTNode | null {
    if (this.at("{")) return this.parseBlock();
    return this.parseStatement();
  }

  // -- expression statement --------------------------------------------------

  private parseExpressionStatement(): ASTNode | null {
    const startOff = this.cur().startOffset;
    const expr = this.parseExpression();
    if (!expr) { this.advance(); return null; }
    this.eat(";");
    const endOff = this.peek(-1).endOffset;
    return createNode("block", this.span(startOff, endOff), LANG, [expr]);
  }

  // -- expressions -----------------------------------------------------------

  private parseExpression(): ASTNode | null {
    return this.parseAssignmentExpressionOrHigher();
  }

  private parseAssignmentExpressionOrHigher(): ASTNode | null {
    // check for async arrow
    if (this.cur().value === "async" && this.peek(1).value === "=>" ||
        this.cur().value === "async" && this.peek(1).value === "(") {
      return this.parseArrowFunction(this.cur().startOffset);
    }

    const left = this.parseConditionalExpressionOrHigher();
    if (!left) return null;

    const assignOps = ["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "??=", "&&=", "||="];
    if (assignOps.includes(this.cur().value)) {
      const op = this.advance();
      const right = this.parseAssignmentExpressionOrHigher();
      const endOff = this.peek(-1).endOffset;
      return createNode("assignment", this.span(left.span.start.offset, endOff), LANG, [left, right!], op.value);
    }

    return left;
  }

  private parseConditionalExpressionOrHigher(): ASTNode | null {
    const expr = this.parseBinaryExpressionOrHigher(0);
    if (!expr) return null;

    if (this.eat("?")) {
      const then = this.parseAssignmentExpressionOrHigher();
      this.expect(":");
      const else_ = this.parseAssignmentExpressionOrHigher();
      const endOff = this.peek(-1).endOffset;
      return createNode("ternary-expr", this.span(expr.span.start.offset, endOff), LANG, [expr, then!, else_!]);
    }

    return expr;
  }

  // binary operator precedence table
  private static readonly BINOP_PREC: ReadonlyMap<string, number> = new Map([
    ["||", 1], ["??", 1],
    ["&&", 2],
    ["==", 3], ["===", 3], ["!=", 3], ["!==", 3],
    ["<", 4], [">", 4], ["<=", 4], [">=", 4], ["instanceof", 4], ["in", 4],
    ["+", 5], ["-", 5],
    ["*", 6], ["/", 6], ["%", 6],
    ["**", 7],
  ]);

  private parseBinaryExpressionOrHigher(minPrec: number): ASTNode | null {
    let left = this.parseUnaryExpressionOrHigher();
    if (!left) return null;

    while (true) {
      const op = this.cur().value;
      const prec = Parser.BINOP_PREC.get(op);
      if (prec === undefined || prec < minPrec) break;
      this.advance();
      const right = this.parseBinaryExpressionOrHigher(prec + 1);
      const endOff = right ? right.span.end.offset : this.peek(-1).endOffset;
      left = createNode("binary-expr", this.span(left.span.start.offset, endOff), LANG, [left, right!], op);
    }

    return left;
  }

  private parseUnaryExpressionOrHigher(): ASTNode | null {
    // prefix operators
    const prefixOps = ["!", "~", "-", "+", "delete", "typeof", "void"];
    if (prefixOps.includes(this.cur().value) && this.cur().tokenClass !== "eof") {
      const startOff = this.cur().startOffset;
      const op = this.advance();
      const operand = this.parseUnaryExpressionOrHigher();
      const endOff = operand ? operand.span.end.offset : this.peek(-1).endOffset;
      return createNode("unary-expr", this.span(startOff, endOff), LANG, [operand!], op.value);
    }

    // await
    if (this.cur().value === "await") {
      const startOff = this.cur().startOffset;
      this.advance();
      const operand = this.parseUnaryExpressionOrHigher();
      const endOff = operand ? operand.span.end.offset : this.peek(-1).endOffset;
      return createNode("await-expr", this.span(startOff, endOff), LANG, [operand!]);
    }

    // yield
    if (this.cur().value === "yield") {
      const startOff = this.cur().startOffset;
      this.advance();
      const star = this.eat("*");
      const children: ASTNode[] = [];
      if (!this.at(";") && !this.at("}") && this.cur().tokenClass !== "eof") {
        const val = this.parseAssignmentExpressionOrHigher();
        if (val) children.push(val);
      }
      const endOff = this.peek(-1).endOffset;
      return createNode("yield-expr", this.span(startOff, endOff), LANG, children, star ? "yield*" : undefined);
    }

    // new
    if (this.cur().value === "new") {
      return this.parseNewExpression();
    }

    // postfix: ++, --
    const expr = this.parsePostfixExpressionOrHigher();
    if (expr && (this.cur().value === "++" || this.cur().value === "--")) {
      const op = this.advance();
      const endOff = this.peek(-1).endOffset;
      return createNode("unary-expr", this.span(expr.span.start.offset, endOff), LANG, [expr], op.value);
    }

    return expr;
  }

  private parseNewExpression(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("new");
    let callee = this.parsePostfixExpressionOrHigher();
    if (!callee) {
      return createNode("error", this.span(startOff, this.peek(-1).endOffset), LANG, []);
    }

    if (this.at("(")) {
      const args = this.parseArgumentList();
      const endOff = this.peek(-1).endOffset;
      return createNode("new-expr", this.span(startOff, endOff), LANG, [callee, ...args]);
    }

    return createNode("new-expr", this.span(startOff, callee.span.end.offset), LANG, [callee]);
  }

  private parsePostfixExpressionOrHigher(): ASTNode | null {
    let expr = this.parsePrimaryExpression();
    if (!expr) return null;

    while (true) {
      if (this.at(".")) {
        this.advance();
        const prop = this.advance();
        const endOff = prop.endOffset;
        expr = createNode("member-expr", this.span(expr.span.start.offset, endOff), LANG, [expr], prop.value);
      } else if (this.at("?.")) {
        this.advance();
        const prop = this.advance();
        const endOff = prop.endOffset;
        expr = createNode("member-expr", this.span(expr.span.start.offset, endOff), LANG, [expr], prop.value);
      } else if (this.at("[")) {
        const startOff = expr.span.start.offset;
        this.advance();
        const index = this.parseExpression();
        this.expect("]");
        const endOff = this.peek(-1).endOffset;
        expr = createNode("index-expr", this.span(startOff, endOff), LANG, [expr, index!]);
      } else if (this.at("(")) {
        const args = this.parseArgumentList();
        const endOff = this.peek(-1).endOffset;
        expr = createNode("call", this.span(expr.span.start.offset, endOff), LANG, [expr, ...args]);
      } else if (this.cur().tokenClass === "string" && this.cur().value.startsWith("`")) {
        // tagged template literal
        const tmpl = this.parseTemplateLiteral();
        const endOff = this.peek(-1).endOffset;
        expr = createNode("call", this.span(expr.span.start.offset, endOff), LANG, [expr, tmpl]);
      } else {
        break;
      }
    }

    return expr;
  }

  private parseArgumentList(): ASTNode[] {
    const args: ASTNode[] = [];
    this.expect("(");
    while (!this.at(")") && this.cur().tokenClass !== "eof") {
      if (this.eat("...")) {
        const inner = this.parseAssignmentExpressionOrHigher();
        if (inner) {
          const spread = createNode("spread", inner.span, LANG, [inner]);
          args.push(spread);
        }
      } else {
        const arg = this.parseAssignmentExpressionOrHigher();
        if (arg) args.push(arg);
      }
      this.eat(",");
    }
    this.expect(")");
    return args;
  }

  // -- primary expressions ---------------------------------------------------

  private parsePrimaryExpression(): ASTNode | null {
    const t = this.cur();

    // arrow function (param) => ... or ident => ...
    if (this.isArrowFunctionStart()) {
      return this.parseArrowFunction(t.startOffset);
    }

    // parenthesized expression
    if (t.value === "(") {
      return this.parseParenOrArrow();
    }

    // array literal
    if (t.value === "[") {
      return this.parseArrayLiteral();
    }

    // object literal
    if (t.value === "{") {
      return this.parseObjectLiteral();
    }

    // template literal
    if (t.value === "`") {
      return this.parseTemplateLiteral();
    }

    // JSX
    if (t.value === "<" && this.isJSXStart()) {
      return this.parseJSX();
    }

    // string
    if (t.tokenClass === "string") {
      const tok = this.advance();
      return createNode("string", this.span(tok.startOffset, tok.endOffset), LANG, [], tok.value);
    }

    // number
    if (t.tokenClass === "number") {
      const tok = this.advance();
      return createNode("number", this.span(tok.startOffset, tok.endOffset), LANG, [], tok.value);
    }

    // boolean
    if (t.tokenClass === "boolean") {
      const tok = this.advance();
      return createNode("identifier", this.span(tok.startOffset, tok.endOffset), LANG, [], tok.value);
    }

    // identifier
    if (t.tokenClass === "identifier") {
      const tok = this.advance();
      return createNode("identifier", this.span(tok.startOffset, tok.endOffset), LANG, [], tok.value);
    }

    // this / super / null / undefined
    if (t.tokenClass === "keyword" && ["this", "super", "null", "undefined"].includes(t.value)) {
      const tok = this.advance();
      return createNode("identifier", this.span(tok.startOffset, tok.endOffset), LANG, [], tok.value);
    }

    // function expression
    if (t.value === "function") {
      return this.parseFunctionExpression();
    }

    // comment
    if (t.tokenClass === "comment") {
      const tok = this.advance();
      return createNode("comment", this.span(tok.startOffset, tok.endOffset), LANG, [], tok.value);
    }

    return null;
  }

  private isArrowFunctionStart(): boolean {
    // async () => or async ident =>
    if (this.cur().value === "async") {
      const next = this.peek(1);
      if (next.value === "(" || next.value === "=>" || next.tokenClass === "identifier") return true;
    }
    // ident => (but not in object literal key context)
    if (this.cur().tokenClass === "identifier" && this.peek(1).value === "=>") return true;
    // () => — detected in parseParenOrArrow
    return false;
  }

  private parseParenOrArrow(): ASTNode {
    // speculatively check if this is an arrow function
    // lookahead: if the parens content followed by =>, it's an arrow
    const saved = this.pos;
    const isArrow = this.tryDetectArrowFromParens();
    this.pos = saved;

    if (isArrow) {
      return this.parseArrowFunction(this.cur().startOffset);
    }

    // parenthesized expression
    const startOff = this.cur().startOffset;
    this.expect("(");
    const expr = this.parseExpression();
    this.expect(")");
    if (expr) {
      return expr; // transparent
    }
    return createNode("error", this.span(startOff, this.peek(-1).endOffset), LANG, []);
  }

  private tryDetectArrowFromParens(): boolean {
    // Walk forward matching parens, then check if =>
    this.expect("(");
    let depth = 1;
    while (depth > 0 && this.cur().tokenClass !== "eof") {
      if (this.cur().value === "(") depth++;
      else if (this.cur().value === ")") depth--;
      if (depth > 0) this.advance();
    }
    if (this.cur().value !== ")") return false;
    this.advance(); // skip )
    return this.cur().value === "=>";
  }

  private parseFunctionExpression(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("function");
    const star = this.eat("*");
    const name = this.cur().tokenClass === "identifier" ? this.advance() : null;
    const children: ASTNode[] = [];

    if (this.at("<")) this.parseTypeParameters(children);
    this.parseParameterList(children);
    if (this.at(":")) this.parseTypeAnnotation(children);
    if (this.at("{")) children.push(this.parseBlock());

    const endOff = this.peek(-1).endOffset;
    return createNode("function", this.span(startOff, endOff), LANG, children, name?.value ?? (star ? "generator" : undefined));
  }

  private parseArrayLiteral(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("[");
    const children: ASTNode[] = [];

    while (!this.at("]") && this.cur().tokenClass !== "eof") {
      if (this.eat("...")) {
        const inner = this.parseAssignmentExpressionOrHigher();
        if (inner) children.push(createNode("spread", inner.span, LANG, [inner]));
      } else {
        // handle missing elements: [1,,3]
        if (this.at(",")) {
          children.push(createNode("identifier", this.span(this.cur().startOffset, this.cur().startOffset), LANG, [], ""));
        } else {
          const el = this.parseAssignmentExpressionOrHigher();
          if (el) children.push(el);
        }
      }
      this.eat(",");
    }
    this.expect("]");

    const endOff = this.peek(-1).endOffset;
    return createNode("array", this.span(startOff, endOff), LANG, children);
  }

  private parseObjectLiteral(): ASTNode {
    const startOff = this.cur().startOffset;
    this.expect("{");
    const children: ASTNode[] = [];

    while (!this.at("}") && this.cur().tokenClass !== "eof") {
      children.push(this.parseObjectMember());
      this.eat(",");
    }
    this.expect("}");

    const endOff = this.peek(-1).endOffset;
    return createNode("object", this.span(startOff, endOff), LANG, children);
  }

  private parseObjectMember(): ASTNode {
    const startOff = this.cur().startOffset;

    // spread
    if (this.eat("...")) {
      const inner = this.parseAssignmentExpressionOrHigher();
      const endOff = this.peek(-1).endOffset;
      return createNode("spread", this.span(startOff, endOff), LANG, [inner!]);
    }

    // get/set
    if (this.cur().value === "get" && this.peek(1).value === "(") {
      return this.parseObjectMethod(startOff, "get");
    }
    if (this.cur().value === "set" && this.peek(1).value === "(") {
      return this.parseObjectMethod(startOff, "set");
    }

    // async method
    if (this.cur().value === "async" && (this.peek(1).value === "(" || this.peek(1).tokenClass === "identifier")) {
      this.advance(); // async
      return this.parseObjectMethod(startOff);
    }

    // * generator
    if (this.eat("*")) {
      return this.parseObjectMethod(startOff);
    }

    // compute key
    const key = this.parseObjectKey();
    const label = key?.label ?? "";

    // method shorthand: key(
    if (this.at("(") || this.at("<")) {
      const children: ASTNode[] = key ? [key] : [];
      if (this.at("<")) this.parseTypeParameters(children);
      this.parseParameterList(children);
      if (this.at(":")) this.parseTypeAnnotation(children);
      if (this.at("{")) children.push(this.parseBlock());
      const endOff = this.peek(-1).endOffset;
      return createNode("function", this.span(startOff, endOff), LANG, children, label);
    }

    // key: value
    const children: ASTNode[] = [];
    if (key) children.push(key);

    if (this.eat(":")) {
      const val = this.parseAssignmentExpressionOrHigher();
      if (val) children.push(val);
    }

    const endOff = this.peek(-1).endOffset;
    return createNode("property", this.span(startOff, endOff), LANG, children, label);
  }

  private parseObjectMethod(startOff: number, prefix?: string): ASTNode {
    const children: ASTNode[] = [];
    const name = this.cur().tokenClass === "identifier" || this.cur().tokenClass === "string" || this.cur().tokenClass === "number"
      ? this.advance() : null;
    const label = name?.value ?? prefix;
    if (this.at("<")) this.parseTypeParameters(children);
    this.parseParameterList(children);
    if (this.at(":")) this.parseTypeAnnotation(children);
    if (this.at("{")) children.push(this.parseBlock());
    const endOff = this.peek(-1).endOffset;
    return createNode("function", this.span(startOff, endOff), LANG, children, label);
  }

  private parseObjectKey(): ASTNode | null {
    if (this.cur().value === "[") {
      const startOff = this.cur().startOffset;
      this.advance();
      const expr = this.parseExpression();
      this.expect("]");
      const endOff = this.peek(-1).endOffset;
      return createNode("identifier", this.span(startOff, endOff), LANG, expr ? [expr] : []);
    }
    if (this.cur().tokenClass === "string") {
      const tok = this.advance();
      return createNode("string", this.span(tok.startOffset, tok.endOffset), LANG, [], tok.value);
    }
    if (this.cur().tokenClass === "number") {
      const tok = this.advance();
      return createNode("number", this.span(tok.startOffset, tok.endOffset), LANG, [], tok.value);
    }
    if (this.cur().tokenClass === "identifier" || this.cur().tokenClass === "keyword" || this.cur().tokenClass === "type") {
      const tok = this.advance();
      return createNode("identifier", this.span(tok.startOffset, tok.endOffset), LANG, [], tok.value);
    }
    return null;
  }

  private parseTemplateLiteral(): ASTNode {
    const tok = this.cur();
    // The lexer already consumed the full template as one token
    this.advance();
    return createNode("template-literal", this.span(tok.startOffset, tok.endOffset), LANG, [], tok.value);
  }

  // -- JSX -------------------------------------------------------------------

  private isJSXStart(): boolean {
    // < followed by identifier or .
    if (this.cur().value !== "<") return false;
    const next = this.peek(1);
    if (next.tokenClass === "identifier") return true;
    if (next.value === ">") return true; // fragment <>
    return false;
  }

  private parseJSX(): ASTNode {
    const startOff = this.cur().startOffset;

    // fragment <>
    if (this.cur().value === "<" && this.peek(1).value === ">") {
      this.advance(); // <
      this.advance(); // >
      const children: ASTNode[] = [];
      while (!(this.cur().value === "<" && this.peek(1).value === "/") && this.cur().tokenClass !== "eof") {
        const child = this.parseJSXChild();
        if (child) children.push(child);
      }
      this.expect("<");
      this.expect("/");
      this.expect(">");
      const endOff = this.peek(-1).endOffset;
      return createNode("jsx-fragment", this.span(startOff, endOff), LANG, children);
    }

    // element
    this.expect("<");
    const tagName = this.advance();
    const children: ASTNode[] = [];
    const attrs: ASTNode[] = [];

    // attributes
    while (this.cur().tokenClass === "identifier" || this.cur().value === "{") {
      if (this.cur().value === "{") {
        // JSX expression attribute {...expr}
        this.advance();
        const expr = this.parseExpression();
        this.expect("}");
        if (expr) attrs.push(createNode("spread", expr.span, LANG, [expr]));
      } else {
        const attrName = this.advance();
        const attrChildren: ASTNode[] = [];
        if (this.eat("=")) {
          if (this.cur().tokenClass === "string") {
            const val = this.advance();
            attrChildren.push(createNode("string", this.span(val.startOffset, val.endOffset), LANG, [], val.value));
          } else if (this.cur().value === "{") {
            this.advance();
            const expr = this.parseExpression();
            this.expect("}");
            if (expr) attrChildren.push(expr);
          } else {
            // JSX element as attribute value (rare but valid)
            const val = this.parsePrimaryExpression();
            if (val) attrChildren.push(val);
          }
        }
        attrs.push(createNode("property", this.span(attrName.startOffset, this.peek(-1).endOffset), LANG, attrChildren, attrName.value));
      }
    }

    // self-closing
    if (this.eat("/")) {
      this.expect(">");
      const endOff = this.peek(-1).endOffset;
      return createNode("jsx-element", this.span(startOff, endOff), LANG, attrs, tagName.value);
    }

    this.expect(">");

    // children
    while (!(this.cur().value === "<" && this.peek(1).value === "/") && this.cur().tokenClass !== "eof") {
      const child = this.parseJSXChild();
      if (child) children.push(child);
    }

    // closing tag
    this.expect("<");
    this.expect("/");
    this.advance(); // closing tag name
    this.expect(">");

    const allChildren = [...attrs, ...children];
    const endOff = this.peek(-1).endOffset;
    return createNode("jsx-element", this.span(startOff, endOff), LANG, allChildren, tagName.value);
  }

  private parseJSXChild(): ASTNode | null {
    if (this.cur().value === "{") {
      this.advance();
      const expr = this.parseExpression();
      this.expect("}");
      return expr;
    }
    if (this.cur().value === "<") {
      return this.parseJSX();
    }
    // text content
    if (this.cur().tokenClass === "string" && !this.cur().value.startsWith("`")) {
      const tok = this.advance();
      return createNode("string", this.span(tok.startOffset, tok.endOffset), LANG, [], tok.value);
    }
    // skip unknown
    this.advance();
    return null;
  }

  // -- type annotations ------------------------------------------------------

  private parseTypeAnnotation(children: ASTNode[]): void {
    this.expect(":");
    this.parseTypeNode(children);
  }

  private parseTypeParameters(children: ASTNode[]): void {
    this.expect("<");
    while (!this.at(">") && this.cur().tokenClass !== "eof") {
      children.push(this.parseTypeParameter());
      this.eat(",");
    }
    this.expect(">");
  }

  private parseTypeParameter(): ASTNode {
    const startOff = this.cur().startOffset;
    const name = this.advance();
    const children: ASTNode[] = [];
    if (this.eat("extends")) {
      this.parseTypeNode(children);
    }
    if (this.eat("=")) {
      this.parseTypeNode(children);
    }
    const endOff = this.peek(-1).endOffset;
    return createNode("parameter", this.span(startOff, endOff), LANG, children, name.value);
  }

  private parseTypeNode(children: ASTNode[]): void {
    this.parseTypeNodeInternal(children);
  }

  private parseTypeNodeInternal(children: ASTNode[]): void {
    const t = this.cur();

    // parenthesized or function type
    if (t.value === "(") {
      this.advance();
      if (this.isFunctionTypeParams()) {
        this.parseFunctionType(children);
        return;
      }
      // parenthesized type
      this.parseTypeNode(children);
      this.expect(")");
      this.parseTypePostfix(children);
      return;
    }

    // tuple
    if (t.value === "[") {
      this.parseTupleType(children);
      return;
    }

    // object type
    if (t.value === "{") {
      this.parseObjectType(children);
      return;
    }

    // typeof
    if (t.value === "typeof") {
      const startOff = t.startOffset;
      this.advance();
      const inner: ASTNode[] = [];
      this.parseTypeNode(inner);
      children.push(createNode("type-annotation", this.span(startOff, this.peek(-1).endOffset), LANG, inner, "typeof"));
      return;
    }

    // keyof
    if (t.value === "keyof" || t.value === "readonly" || t.value === "infer") {
      const prefix = this.advance().value;
      const inner: ASTNode[] = [];
      this.parseTypeNode(inner);
      children.push(createNode("type-annotation", this.span(t.startOffset, this.peek(-1).endOffset), LANG, inner, prefix));
      return;
    }

    // conditional: A extends B ? C : D (tricky — only if we see extends after a type)
    // We handle this in parseTypePostfix via "extends" keyword

    // basic type name
    if (t.tokenClass === "identifier" || t.tokenClass === "type" || t.tokenClass === "keyword") {
      const nameTok = this.advance();
      const inner: ASTNode[] = [];

      // type arguments
      if (this.at("<")) {
        this.expect("<");
        while (!this.at(">") && this.cur().tokenClass !== "eof") {
          this.parseTypeNode(inner);
          this.eat(",");
        }
        this.expect(">");
      }

      // array shorthand: Type[]
      this.parseTypePostfix(inner);

      const endOff = this.peek(-1).endOffset;
      children.push(createNode("type-annotation", this.span(nameTok.startOffset, endOff), LANG, inner, nameTok.value));
      return;
    }

    // string/number/boolean literal type
    if (t.tokenClass === "string" || t.tokenClass === "number" || t.tokenClass === "boolean") {
      const lit = this.advance();
      children.push(createNode("type-annotation", this.span(lit.startOffset, lit.endOffset), LANG, [], lit.value));
      this.parseTypePostfix(children);
      return;
    }

    // minus for negative number literal type
    if (t.value === "-") {
      this.advance();
      if (this.cur().tokenClass === "number") {
        const num = this.advance();
        children.push(createNode("type-annotation", this.span(t.startOffset, num.endOffset), LANG, [], "-" + num.value));
      }
      return;
    }

    // skip unknown
    if (this.cur().tokenClass !== "eof") this.advance();
  }

  private parseTypePostfix(children: ASTNode[]): void {
    // array shorthand: []
    while (this.at("[") && this.peek(1).value === "]") {
      this.advance(); // [
      this.advance(); // ]
    }
    // extends clause for conditional types
    if (this.cur().value === "extends") {
      const startOff = this.cur().startOffset;
      this.advance();
      const check: ASTNode[] = [];
      this.parseTypeNode(check);
      children.push(...check);
      if (this.eat("?")) {
        this.parseTypeNode(children);
        this.expect(":");
        this.parseTypeNode(children);
      }
    }
    // union/intersection
    while (this.cur().value === "|" || this.cur().value === "&") {
      const op = this.advance().value;
      this.parseTypeNode(children);
    }
  }

  private isFunctionTypeParams(): boolean {
    // rough heuristic: if the parens contain typed params, it's a function type
    // Walk forward until matching ), check if => follows
    let depth = 1;
    let i = this.pos + 1;
    while (i < this.tokens.length && depth > 0) {
      if (this.tokens[i]!.value === "(") depth++;
      else if (this.tokens[i]!.value === ")") depth--;
      i++;
    }
    // tokens[i-1] is ), tokens[i] is what follows
    return i < this.tokens.length && this.tokens[i]!.value === "=>";
  }

  private parseFunctionType(children: ASTNode[]): void {
    const startOff = this.cur().startOffset;
    const params: ASTNode[] = [];
    while (!this.at(")") && this.cur().tokenClass !== "eof") {
      params.push(this.parseParameter());
      this.eat(",");
    }
    this.expect(")");
    this.expect("=>");
    const ret: ASTNode[] = [];
    this.parseTypeNode(ret);
    const endOff = this.peek(-1).endOffset;
    children.push(createNode("type-annotation", this.span(startOff, endOff), LANG, [...params, ...ret], "function"));
  }

  private parseTupleType(children: ASTNode[]): void {
    const startOff = this.cur().startOffset;
    this.expect("[");
    const inner: ASTNode[] = [];
    while (!this.at("]") && this.cur().tokenClass !== "eof") {
      if (this.eat("...")) {
        this.parseTypeNode(inner);
      } else {
        this.parseTypeNode(inner);
      }
      this.eat(",");
    }
    this.expect("]");
    const endOff = this.peek(-1).endOffset;
    children.push(createNode("type-annotation", this.span(startOff, endOff), LANG, inner, "tuple"));
  }

  private parseObjectType(children: ASTNode[]): void {
    const startOff = this.cur().startOffset;
    this.expect("{");
    const inner: ASTNode[] = [];
    while (!this.at("}") && this.cur().tokenClass !== "eof") {
      // index signature
      if (this.at("[")) {
        this.advance();
        if (this.cur().tokenClass === "identifier") {
          const id = this.advance();
          const sub: ASTNode[] = [];
          if (this.at(":")) this.parseTypeAnnotation(sub);
          this.expect("]");
          if (this.at(":")) this.parseTypeAnnotation(sub);
          inner.push(createNode("property", this.span(id.startOffset, this.peek(-1).endOffset), LANG, sub, id.value));
        } else {
          this.expect("]");
        }
        this.eat(";");
        this.eat(",");
        continue;
      }
      // property or method
      while (["readonly", "public", "private", "protected"].includes(this.cur().value)) this.advance();
      if (this.cur().tokenClass === "identifier" || this.cur().tokenClass === "string" || this.cur().tokenClass === "number") {
        const name = this.advance();
        this.eat("?");
        this.eat("!");
        const sub: ASTNode[] = [];
        if (this.at("(")) {
          // method signature
          this.parseParameterList(sub);
          if (this.at(":")) this.parseTypeAnnotation(sub);
          inner.push(createNode("function", this.span(name.startOffset, this.peek(-1).endOffset), LANG, sub, name.value));
        } else {
          if (this.at(":")) this.parseTypeAnnotation(sub);
          inner.push(createNode("property", this.span(name.startOffset, this.peek(-1).endOffset), LANG, sub, name.value));
        }
      }
      this.eat(";");
      this.eat(",");
    }
    this.expect("}");
    const endOff = this.peek(-1).endOffset;
    children.push(createNode("type-annotation", this.span(startOff, endOff), LANG, inner, "object"));
  }

  private parseTypeReference(): ASTNode {
    const name = this.advance();
    const children: ASTNode[] = [];
    if (this.at("<")) {
      this.expect("<");
      while (!this.at(">") && this.cur().tokenClass !== "eof") {
        this.parseTypeNode(children);
        this.eat(",");
      }
      this.expect(">");
    }
    // dot-qualified: A.B.C
    while (this.at(".")) {
      this.advance();
      const next = this.advance();
      // flatten label
      const label = (name.value ?? "") + "." + next.value;
      const inner: ASTNode[] = [];
      if (this.at("<")) {
        this.expect("<");
        while (!this.at(">") && this.cur().tokenClass !== "eof") {
          this.parseTypeNode(inner);
          this.eat(",");
        }
        this.expect(">");
      }
      return createNode("type-annotation", this.span(name.startOffset, this.peek(-1).endOffset), LANG, inner, label);
    }
    return createNode("type-annotation", this.span(name.startOffset, this.peek(-1).endOffset), LANG, children, name.value);
  }

  /**
   * Skip a type annotation without producing AST nodes.
   * Used after destructuring patterns where we don't want type children.
   */
  private skipType(): void {
    this.expect(":");
    // skip until we hit = or , or ; or ) or } or >
    let depth = 0;
    while (this.cur().tokenClass !== "eof") {
      const v = this.cur().value;
      if (depth === 0 && (v === "=" || v === "," || v === ";" || v === ")" || v === "}")) break;
      if (v === "<" || v === "(" || v === "[" || v === "{") depth++;
      else if (v === ">" || v === ")" || v === "]" || v === "}") depth--;
      if (depth < 0) break;
      this.advance();
    }
  }

  // -- error recovery --------------------------------------------------------

  /**
   * On parse error, create an error node and scan forward to a recovery point.
   * Recovery tokens: `;`, `}`, `{`, or top-level declaration keywords.
   */
  private recoverWithError(startOff: number, message: string): ASTNode {
    // scan forward
    const recoveryKeywords = new Set([
      "function", "class", "interface", "type", "enum", "import", "export",
      "const", "let", "var", "if", "for", "while", "do", "switch", "try",
      "return", "throw", "break", "continue",
    ]);

    while (this.cur().tokenClass !== "eof") {
      const v = this.cur().value;
      if (v === ";" || v === "}") {
        this.advance();
        break;
      }
      if (v === "{" && this.cur().tokenClass === "punctuation") {
        break;
      }
      if (this.cur().tokenClass === "keyword" && recoveryKeywords.has(v)) {
        break;
      }
      this.advance();
    }

    const endOff = this.peek(-1).endOffset;
    return sharedErrorNode(this.span(startOff, endOff), LANG, message);
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
// CHORE-44 Change 11 AC11.4: `computeLineOffsets` moved to shared/source-position.ts
// as `buildLineMap` (semantically identical: line-start offsets, 0-based).

// ---------------------------------------------------------------------------
// Exported LanguageParser implementation
// ---------------------------------------------------------------------------

export const typescriptParser: LanguageParser = {
  parse(source: string, name: string): EitherType<ParseError, ASTNode> {
    return Parser.parse(source, name);
  },

  parseIncremental(
    source: string,
    name: string,
    _previous: ASTNode,
    _edit: EditDescriptor,
  ): EitherType<ParseError, ASTNode> {
    // Delegate to full parse for now.
    return Parser.parse(source, name);
  },
};
