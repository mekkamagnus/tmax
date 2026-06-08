/**
 * @file tlisp-parser.ts
 * @description Adapts the existing T-Lisp parser to produce ASTNode trees
 */

import type { Either } from "../../../utils/task-either.ts";
import { Either as E } from "../../../utils/task-either.ts";
import { createConfigError, type ConfigError } from "../../../error/types.ts";
import { TLispParser, type ParsedForm } from "../../../tlisp/parser.ts";
import type { TLispValue } from "../../../tlisp/types.ts";
import { getSourceSpan } from "../../../tlisp/source-metadata.ts";
import type { SourceSpan } from "../../../tlisp/source.ts";
import type { ASTNode, ParseError, EditDescriptor, LanguageParser } from "../types.ts";
import { createNode } from "../types.ts";

/**
 * Convert T-Lisp value types to AST node kinds.
 */
function valueKind(v: TLispValue): string {
  if (v.type === "number") return "number";
  if (v.type === "string") return "string";
  if (v.type === "boolean") return "identifier";
  if (v.type === "nil") return "identifier";
  if (v.type === "symbol") {
    const name = v.value as string;
    if (["defun", "defmacro", "defn", "fn", "lambda"].includes(name)) return "keyword";
    if (["defvar", "defconst", "def", "let", "let*"].includes(name)) return "keyword";
    if (["if", "cond", "when", "unless", "case"].includes(name)) return "keyword";
    if (["progn", "do", "loop", "while", "for", "dolist", "dotimes"].includes(name)) return "keyword";
    if (["quote", "quasiquote", "unquote", "unquote-splicing"].includes(name)) return "keyword";
    if (["set!", "setq"].includes(name)) return "keyword";
    if (["import", "require", "provide"].includes(name)) return "keyword";
    return "identifier";
  }
  if (v.type === "list") return "call";
  return "identifier";
}

function defaultSpan(): SourceSpan {
  return { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } };
}

/**
 * Convert a TLispValue to an ASTNode tree.
 */
function valueToNode(v: TLispValue, language: string, source: string): ASTNode {
  const span = getSourceSpan(v) ?? defaultSpan();
  const kind = valueKind(v);

  if (v.type === "list") {
    const items = v.value as TLispValue[];
    if (items.length === 0) {
      return createNode("call", span, language, [], "()");
    }

    const head = items[0]!;
    const headName = head.type === "symbol" ? (head.value as string) : "";

    // Check for special forms that produce structured nodes
    if (headName === "defun" && items.length >= 3) {
      const nameNode = valueToNode(items[1]!, language, source);
      const paramsNode = valueToNode(items[2]!, language, source);
      const bodyNodes = items.slice(3).map((it) => valueToNode(it, language, source));
      return createNode("function", span, language, [paramsNode, ...bodyNodes], nameNode.label ?? "");
    }
    if (headName === "defmacro" && items.length >= 3) {
      const nameNode = valueToNode(items[1]!, language, source);
      const paramsNode = valueToNode(items[2]!, language, source);
      const bodyNodes = items.slice(3).map((it) => valueToNode(it, language, source));
      return createNode("function", span, language, [paramsNode, ...bodyNodes], nameNode.label ?? "");
    }
    if (headName === "lambda" && items.length >= 2) {
      const paramsNode = valueToNode(items[1]!, language, source);
      const bodyNodes = items.slice(2).map((it) => valueToNode(it, language, source));
      return createNode("function", span, language, [paramsNode, ...bodyNodes], "lambda");
    }
    if (headName === "fn" && items.length >= 2) {
      const paramsNode = valueToNode(items[1]!, language, source);
      const bodyNodes = items.slice(2).map((it) => valueToNode(it, language, source));
      return createNode("function", span, language, [paramsNode, ...bodyNodes], "fn");
    }
    if (headName === "defvar" && items.length >= 2) {
      const nameNode = valueToNode(items[1]!, language, source);
      const initNodes = items.slice(2).map((it) => valueToNode(it, language, source));
      return createNode("variable", span, language, initNodes, nameNode.label ?? "");
    }
    if (headName === "defconst" && items.length >= 2) {
      const nameNode = valueToNode(items[1]!, language, source);
      const initNodes = items.slice(2).map((it) => valueToNode(it, language, source));
      return createNode("variable", span, language, initNodes, nameNode.label ?? "");
    }
    if (headName === "def" && items.length >= 2) {
      const nameNode = valueToNode(items[1]!, language, source);
      const rest = items.slice(2).map((it) => valueToNode(it, language, source));
      return createNode("variable", span, language, rest, nameNode.label ?? "");
    }
    if (headName === "let" || headName === "let*") {
      const children = items.slice(1).map((it) => valueToNode(it, language, source));
      return createNode("block", span, language, children);
    }
    if (headName === "if") {
      const children = items.slice(1).map((it) => valueToNode(it, language, source));
      return createNode("if-stmt", span, language, children);
    }
    if (headName === "cond" || headName === "case") {
      const children = items.slice(1).map((it) => valueToNode(it, language, source));
      return createNode("if-stmt", span, language, children);
    }
    if (headName === "when" || headName === "unless") {
      const children = items.slice(1).map((it) => valueToNode(it, language, source));
      return createNode("if-stmt", span, language, children);
    }
    if (headName === "progn" || headName === "do") {
      const children = items.slice(1).map((it) => valueToNode(it, language, source));
      return createNode("block", span, language, children);
    }
    if (headName === "quote") {
      const children = items.slice(1).map((it) => valueToNode(it, language, source));
      return createNode("call", span, language, children, "quote");
    }
    if (headName === "import" || headName === "require" || headName === "provide") {
      const children = items.slice(1).map((it) => valueToNode(it, language, source));
      return createNode("import", span, language, children);
    }

    // Generic call
    const children = items.map((it) => valueToNode(it, language, source));
    return createNode("call", span, language, children);
  }

  if (v.type === "symbol") {
    return createNode("identifier", span, language, [], v.value as string);
  }

  return createNode(kind, span, language);
}

export const tlispParser: LanguageParser = {
  parse(source: string, name: string): Either<ParseError, ASTNode> {
    const parser = new TLispParser();
    const result = parser.parseProgram(source, name);

    if (E.isLeft(result)) {
      return E.left(createConfigError("ParseError", result.left.message, name));
    }

    const forms = result.right;
    const children = forms.map((form: ParsedForm) => valueToNode(form.value, "tlisp", source));

    const fileSpan: SourceSpan = forms.length > 0
      ? {
          start: forms[0]!.span.start,
          end: forms[forms.length - 1]!.span.end,
        }
      : defaultSpan();

    const root = createNode("file", fileSpan, "tlisp", children, name);
    return E.right(root);
  },

  parseIncremental(source: string, name: string): Either<ParseError, ASTNode> {
    // T-Lisp files are small — full reparse is fine
    return tlispParser.parse(source, name);
  },
};
