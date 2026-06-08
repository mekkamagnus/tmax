/**
 * @file syntax-highlighter.test.ts
 * @description Tests for syntax highlighting pipeline: tokenizer + highlighter
 */

import { describe, test, expect } from "bun:test";
import { tokenize } from "../../src/syntax/tokenizer.ts";
import { highlightLine } from "../../src/syntax/highlighter.ts";
import { defaultDarkTheme } from "../../src/syntax/types.ts";
import { rules as typescriptRules } from "../../src/syntax/languages/typescript.ts";
import { rules as pythonRules } from "../../src/syntax/languages/python.ts";
import { rules as lispRules } from "../../src/syntax/languages/lisp.ts";
import type { SyntaxToken, HighlightSpan, SyntaxRule } from "../../src/core/types.ts";

/** Stateless tokenize — returns SyntaxToken[] when no ParseState is given. */
const tokenizeStateless = (line: string, lineNum: number, rules: SyntaxRule[]): SyntaxToken[] => {
  const result = tokenize(line, lineNum, rules);
  return Array.isArray(result) ? result : (result as any).tokens ?? [];
};

describe("Syntax Highlighting", () => {
  // ---------------------------------------------------------------------------
  // TypeScript keyword highlighting
  // ---------------------------------------------------------------------------
  describe("TypeScript keywords", () => {
    test("tokenizes const as keyword", () => {
      const tokens = tokenizeStateless("const x = 1;", 0, typescriptRules);
      const constToken = tokens.find(t => t.value === "const");
      expect(constToken).toBeDefined();
      expect(constToken!.type).toBe("keyword");
    });

    test("tokenizes let as keyword", () => {
      const tokens = tokenizeStateless("let y = 2;", 0, typescriptRules);
      const letToken = tokens.find(t => t.value === "let");
      expect(letToken).toBeDefined();
      expect(letToken!.type).toBe("keyword");
    });

    test("tokenizes function as keyword", () => {
      const tokens = tokenizeStateless("function foo() {}", 0, typescriptRules);
      const fnToken = tokens.find(t => t.value === "function");
      expect(fnToken).toBeDefined();
      expect(fnToken!.type).toBe("keyword");
    });

    test("tokenizes async and await as keywords", () => {
      const tokens = tokenizeStateless("async function run() { await done(); }", 0, typescriptRules);
      const asyncToken = tokens.find(t => t.value === "async");
      const awaitToken = tokens.find(t => t.value === "await");
      expect(asyncToken).toBeDefined();
      expect(asyncToken!.type).toBe("keyword");
      expect(awaitToken).toBeDefined();
      expect(awaitToken!.type).toBe("keyword");
    });

    test("tokenizes multiple keywords on one line", () => {
      const tokens = tokenizeStateless("if (x) { return x; }", 0, typescriptRules);
      const keywords = tokens.filter(t => t.type === "keyword");
      const values = keywords.map(k => k.value);
      expect(values).toContain("if");
      expect(values).toContain("return");
    });
  });

  // ---------------------------------------------------------------------------
  // String literal tokenization
  // ---------------------------------------------------------------------------
  describe("String literals", () => {
    test("tokenizes double-quoted strings", () => {
      const tokens = tokenizeStateless('const s = "hello world";', 0, typescriptRules);
      const strToken = tokens.find(t => t.type === "string");
      expect(strToken).toBeDefined();
      expect(strToken!.value).toBe('"hello world"');
    });

    test("tokenizes single-quoted strings", () => {
      const tokens = tokenizeStateless("const c = 'x';", 0, typescriptRules);
      const strToken = tokens.find(t => t.type === "string");
      expect(strToken).toBeDefined();
      expect(strToken!.value).toBe("'x'");
    });

    test("tokenizes template literals", () => {
      const tokens = tokenizeStateless("const t = `hello ${name}`;", 0, typescriptRules);
      const strToken = tokens.find(t => t.type === "string");
      expect(strToken).toBeDefined();
      expect(strToken!.value).toMatch(/^`.*`$/);
    });

    test("handles escaped quotes inside strings", () => {
      const tokens = tokenizeStateless('const s = "say \\"hi\\"";', 0, typescriptRules);
      const strToken = tokens.find(t => t.type === "string");
      expect(strToken).toBeDefined();
      expect(strToken!.value).toContain('\\"');
    });
  });

  // ---------------------------------------------------------------------------
  // Comment tokenization
  // ---------------------------------------------------------------------------
  describe("Comments", () => {
    test("tokenizes line comments", () => {
      const tokens = tokenizeStateless("const x = 1; // comment", 0, typescriptRules);
      const commentToken = tokens.find(t => t.type === "comment");
      expect(commentToken).toBeDefined();
      expect(commentToken!.value).toBe("// comment");
    });

    test("tokenizes inline block comments", () => {
      const tokens = tokenizeStateless("const x = /* inline */ 1;", 0, typescriptRules);
      const commentToken = tokens.find(t => t.type === "comment");
      expect(commentToken).toBeDefined();
      expect(commentToken!.value).toBe("/* inline */");
    });

    test("line comments take priority over partial matches", () => {
      const tokens = tokenizeStateless("// const x = 1;", 0, typescriptRules);
      // The whole line should be one comment, not broken into keyword + number
      const commentToken = tokens.find(t => t.type === "comment");
      expect(commentToken).toBeDefined();
      expect(commentToken!.value).toBe("// const x = 1;");
      // No keyword tokens should appear since the comment covers the whole line
      const keywords = tokens.filter(t => t.type === "keyword");
      expect(keywords.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Number tokenization
  // ---------------------------------------------------------------------------
  describe("Numbers", () => {
    test("tokenizes integer literals", () => {
      const tokens = tokenizeStateless("const x = 42;", 0, typescriptRules);
      const numToken = tokens.find(t => t.type === "number");
      expect(numToken).toBeDefined();
      expect(numToken!.value).toBe("42");
    });

    test("tokenizes hexadecimal literals", () => {
      const tokens = tokenizeStateless("const h = 0xFF;", 0, typescriptRules);
      const numToken = tokens.find(t => t.type === "number");
      expect(numToken).toBeDefined();
      expect(numToken!.value).toBe("0xFF");
    });

    test("tokenizes floating point literals", () => {
      const tokens = tokenizeStateless("const f = 3.14;", 0, typescriptRules);
      const numToken = tokens.find(t => t.type === "number");
      expect(numToken).toBeDefined();
      expect(numToken!.value).toBe("3.14");
    });

    test("tokenizes scientific notation", () => {
      const tokens = tokenizeStateless("const s = 1e10;", 0, typescriptRules);
      const numToken = tokens.find(t => t.type === "number");
      expect(numToken).toBeDefined();
      expect(numToken!.value).toBe("1e10");
    });
  });

  // ---------------------------------------------------------------------------
  // Python keyword highlighting
  // ---------------------------------------------------------------------------
  describe("Python keywords", () => {
    test("tokenizes def as keyword", () => {
      const tokens = tokenizeStateless("def foo():", 0, pythonRules);
      const defToken = tokens.find(t => t.value === "def");
      expect(defToken).toBeDefined();
      expect(defToken!.type).toBe("keyword");
    });

    test("tokenizes class as keyword", () => {
      const tokens = tokenizeStateless("class MyClass:", 0, pythonRules);
      const classToken = tokens.find(t => t.value === "class");
      expect(classToken).toBeDefined();
      expect(classToken!.type).toBe("keyword");
    });

    test("tokenizes if as keyword", () => {
      const tokens = tokenizeStateless("if x > 0:", 0, pythonRules);
      const ifToken = tokens.find(t => t.value === "if");
      expect(ifToken).toBeDefined();
      expect(ifToken!.type).toBe("keyword");
    });

    test("tokenizes return as keyword", () => {
      const tokens = tokenizeStateless("return x", 0, pythonRules);
      const returnToken = tokens.find(t => t.value === "return");
      expect(returnToken).toBeDefined();
      expect(returnToken!.type).toBe("keyword");
    });

    test("tokenizes Python comments", () => {
      const tokens = tokenizeStateless("x = 1  # this is a comment", 0, pythonRules);
      const commentToken = tokens.find(t => t.type === "comment");
      expect(commentToken).toBeDefined();
      expect(commentToken!.value).toBe("# this is a comment");
    });

    test("tokenizes Python None as constant", () => {
      const tokens = tokenizeStateless("x = None", 0, pythonRules);
      const noneToken = tokens.find(t => t.value === "None");
      expect(noneToken).toBeDefined();
      expect(noneToken!.type).toBe("constant");
    });

    test("tokenizes Python built-in functions", () => {
      const tokens = tokenizeStateless("len(items)", 0, pythonRules);
      const builtinToken = tokens.find(t => t.value === "len");
      expect(builtinToken).toBeDefined();
      expect(builtinToken!.type).toBe("builtin");
    });
  });

  // ---------------------------------------------------------------------------
  // Lisp keyword tokenization
  // ---------------------------------------------------------------------------
  describe("Lisp keywords", () => {
    test("tokenizes defun as keyword", () => {
      const tokens = tokenizeStateless("(defun foo (x) x)", 0, lispRules);
      const defunToken = tokens.find(t => t.value === "defun");
      expect(defunToken).toBeDefined();
      expect(defunToken!.type).toBe("keyword");
    });

    test("tokenizes let as keyword", () => {
      const tokens = tokenizeStateless("(let ((x 1)) x)", 0, lispRules);
      const letToken = tokens.find(t => t.value === "let");
      expect(letToken).toBeDefined();
      expect(letToken!.type).toBe("keyword");
    });

    test("tokenizes if as keyword", () => {
      const tokens = tokenizeStateless("(if t 1 2)", 0, lispRules);
      const ifToken = tokens.find(t => t.value === "if");
      expect(ifToken).toBeDefined();
      expect(ifToken!.type).toBe("keyword");
    });

    test("tokenizes lambda as keyword", () => {
      const tokens = tokenizeStateless("(lambda (x) (+ x 1))", 0, lispRules);
      const lambdaToken = tokens.find(t => t.value === "lambda");
      expect(lambdaToken).toBeDefined();
      expect(lambdaToken!.type).toBe("keyword");
    });

    test("tokenizes Lisp line comments", () => {
      const tokens = tokenizeStateless("; this is a comment", 0, lispRules);
      const commentToken = tokens.find(t => t.type === "comment");
      expect(commentToken).toBeDefined();
      expect(commentToken!.value).toBe("; this is a comment");
    });

    test("tokenizes parentheses as punctuation", () => {
      const tokens = tokenizeStateless("(+ 1 2)", 0, lispRules);
      const parens = tokens.filter(t => t.type === "punctuation");
      expect(parens.length).toBe(2);
      expect(parens.map(p => p.value).sort()).toEqual(["(", ")"]);
    });

    test("tokenizes nil as boolean", () => {
      const tokens = tokenizeStateless("(if nil 1 2)", 0, lispRules);
      const nilToken = tokens.find(t => t.value === "nil");
      expect(nilToken).toBeDefined();
      expect(nilToken!.type).toBe("boolean");
    });

    test("tokenizes built-in functions as builtin", () => {
      const tokens = tokenizeStateless("(car xs)", 0, lispRules);
      const carToken = tokens.find(t => t.value === "car");
      expect(carToken).toBeDefined();
      expect(carToken!.type).toBe("builtin");
    });
  });

  // ---------------------------------------------------------------------------
  // Default dark theme
  // ---------------------------------------------------------------------------
  describe("Default dark theme", () => {
    test("maps keyword to purple bold", () => {
      expect(defaultDarkTheme.keyword).toBeDefined();
      expect(defaultDarkTheme.keyword!.fg).toBe("#c678dd");
      expect(defaultDarkTheme.keyword!.bold).toBe(true);
    });

    test("maps string to green (hex)", () => {
      expect(defaultDarkTheme.string).toBeDefined();
      expect(defaultDarkTheme.string!.fg).toBe("#98c379");
    });

    test("maps comment to gray dim", () => {
      expect(defaultDarkTheme.comment).toBeDefined();
      expect(defaultDarkTheme.comment!.fg).toBe("#5c6370");
      expect(defaultDarkTheme.comment!.dim).toBe(true);
    });

    test("maps number to orange (hex)", () => {
      expect(defaultDarkTheme.number).toBeDefined();
      expect(defaultDarkTheme.number!.fg).toBe("#d19a66");
    });

    test("has a default fallback style", () => {
      expect(defaultDarkTheme.default).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Highlight line produces spans from tokens
  // ---------------------------------------------------------------------------
  describe("highlightLine", () => {
    test("produces HighlightSpan from tokens", () => {
      const tokens = tokenizeStateless("const x = 1;", 0, typescriptRules);
      const spans = highlightLine(tokens, defaultDarkTheme);
      expect(spans.length).toBeGreaterThan(0);
      // Check that spans have the expected shape
      for (const span of spans) {
        expect(span).toHaveProperty("start");
        expect(span).toHaveProperty("end");
        expect(span).toHaveProperty("style");
        expect(typeof span.start).toBe("number");
        expect(typeof span.end).toBe("number");
      }
    });

    test("keyword spans get the keyword style from theme", () => {
      const tokens = tokenizeStateless("const x = 1;", 0, typescriptRules);
      const constToken = tokens.find(t => t.value === "const")!;
      const spans = highlightLine(tokens, defaultDarkTheme);
      const constSpan = spans.find(s => s.start === constToken.startCol && s.end === constToken.endCol);
      expect(constSpan).toBeDefined();
      expect(constSpan!.style.fg).toBe("#c678dd");
      expect(constSpan!.style.bold).toBe(true);
    });

    test("string spans get the string style from theme", () => {
      const tokens = tokenizeStateless('"hello"', 0, typescriptRules);
      const spans = highlightLine(tokens, defaultDarkTheme);
      expect(spans.length).toBe(1);
      expect(spans[0]!.style.fg).toBe("#98c379");
    });
  });

  // ---------------------------------------------------------------------------
  // Empty lines and no-match lines
  // ---------------------------------------------------------------------------
  describe("Edge cases", () => {
    test("empty line produces empty tokens", () => {
      const tokens = tokenizeStateless("", 0, typescriptRules);
      expect(tokens).toEqual([]);
    });

    test("empty line produces empty spans", () => {
      const tokens = tokenizeStateless("", 0, typescriptRules);
      const spans = highlightLine(tokens, defaultDarkTheme);
      expect(spans).toEqual([]);
    });

    test("plain text with no matches produces empty tokens", () => {
      const tokens = tokenizeStateless("    ", 0, typescriptRules);
      expect(tokens).toEqual([]);
    });

    test("plain text with no matches produces empty spans", () => {
      const tokens = tokenizeStateless("    ", 0, typescriptRules);
      const spans = highlightLine(tokens, defaultDarkTheme);
      expect(spans).toEqual([]);
    });

    test("tokens have correct column offsets", () => {
      const tokens = tokenizeStateless("  const", 0, typescriptRules);
      const constToken = tokens.find(t => t.value === "const");
      expect(constToken).toBeDefined();
      expect(constToken!.startCol).toBe(2);
      expect(constToken!.endCol).toBe(7);
    });

    test("tokens have correct line number", () => {
      const tokens = tokenizeStateless("const x = 1;", 5, typescriptRules);
      for (const token of tokens) {
        expect(token.line).toBe(5);
      }
    });
  });
});
