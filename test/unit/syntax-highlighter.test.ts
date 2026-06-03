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

describe("Syntax Highlighting", () => {
  // ---------------------------------------------------------------------------
  // TypeScript keyword highlighting
  // ---------------------------------------------------------------------------
  describe("TypeScript keywords", () => {
    test("tokenizes const as keyword", () => {
      const tokens = tokenize("const x = 1;", 0, typescriptRules);
      const constToken = tokens.find(t => t.value === "const");
      expect(constToken).toBeDefined();
      expect(constToken!.type).toBe("keyword");
    });

    test("tokenizes let as keyword", () => {
      const tokens = tokenize("let y = 2;", 0, typescriptRules);
      const letToken = tokens.find(t => t.value === "let");
      expect(letToken).toBeDefined();
      expect(letToken!.type).toBe("keyword");
    });

    test("tokenizes function as keyword", () => {
      const tokens = tokenize("function foo() {}", 0, typescriptRules);
      const fnToken = tokens.find(t => t.value === "function");
      expect(fnToken).toBeDefined();
      expect(fnToken!.type).toBe("keyword");
    });

    test("tokenizes async and await as keywords", () => {
      const tokens = tokenize("async function run() { await done(); }", 0, typescriptRules);
      const asyncToken = tokens.find(t => t.value === "async");
      const awaitToken = tokens.find(t => t.value === "await");
      expect(asyncToken).toBeDefined();
      expect(asyncToken!.type).toBe("keyword");
      expect(awaitToken).toBeDefined();
      expect(awaitToken!.type).toBe("keyword");
    });

    test("tokenizes multiple keywords on one line", () => {
      const tokens = tokenize("if (x) { return x; }", 0, typescriptRules);
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
      const tokens = tokenize('const s = "hello world";', 0, typescriptRules);
      const strToken = tokens.find(t => t.type === "string");
      expect(strToken).toBeDefined();
      expect(strToken!.value).toBe('"hello world"');
    });

    test("tokenizes single-quoted strings", () => {
      const tokens = tokenize("const c = 'x';", 0, typescriptRules);
      const strToken = tokens.find(t => t.type === "string");
      expect(strToken).toBeDefined();
      expect(strToken!.value).toBe("'x'");
    });

    test("tokenizes template literals", () => {
      const tokens = tokenize("const t = `hello ${name}`;", 0, typescriptRules);
      const strToken = tokens.find(t => t.type === "string");
      expect(strToken).toBeDefined();
      expect(strToken!.value).toMatch(/^`.*`$/);
    });

    test("handles escaped quotes inside strings", () => {
      const tokens = tokenize('const s = "say \\"hi\\"";', 0, typescriptRules);
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
      const tokens = tokenize("const x = 1; // comment", 0, typescriptRules);
      const commentToken = tokens.find(t => t.type === "comment");
      expect(commentToken).toBeDefined();
      expect(commentToken!.value).toBe("// comment");
    });

    test("tokenizes inline block comments", () => {
      const tokens = tokenize("const x = /* inline */ 1;", 0, typescriptRules);
      const commentToken = tokens.find(t => t.type === "comment");
      expect(commentToken).toBeDefined();
      expect(commentToken!.value).toBe("/* inline */");
    });

    test("line comments take priority over partial matches", () => {
      const tokens = tokenize("// const x = 1;", 0, typescriptRules);
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
      const tokens = tokenize("const x = 42;", 0, typescriptRules);
      const numToken = tokens.find(t => t.type === "number");
      expect(numToken).toBeDefined();
      expect(numToken!.value).toBe("42");
    });

    test("tokenizes hexadecimal literals", () => {
      const tokens = tokenize("const h = 0xFF;", 0, typescriptRules);
      const numToken = tokens.find(t => t.type === "number");
      expect(numToken).toBeDefined();
      expect(numToken!.value).toBe("0xFF");
    });

    test("tokenizes floating point literals", () => {
      const tokens = tokenize("const f = 3.14;", 0, typescriptRules);
      const numToken = tokens.find(t => t.type === "number");
      expect(numToken).toBeDefined();
      expect(numToken!.value).toBe("3.14");
    });

    test("tokenizes scientific notation", () => {
      const tokens = tokenize("const s = 1e10;", 0, typescriptRules);
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
      const tokens = tokenize("def foo():", 0, pythonRules);
      const defToken = tokens.find(t => t.value === "def");
      expect(defToken).toBeDefined();
      expect(defToken!.type).toBe("keyword");
    });

    test("tokenizes class as keyword", () => {
      const tokens = tokenize("class MyClass:", 0, pythonRules);
      const classToken = tokens.find(t => t.value === "class");
      expect(classToken).toBeDefined();
      expect(classToken!.type).toBe("keyword");
    });

    test("tokenizes if as keyword", () => {
      const tokens = tokenize("if x > 0:", 0, pythonRules);
      const ifToken = tokens.find(t => t.value === "if");
      expect(ifToken).toBeDefined();
      expect(ifToken!.type).toBe("keyword");
    });

    test("tokenizes return as keyword", () => {
      const tokens = tokenize("return x", 0, pythonRules);
      const returnToken = tokens.find(t => t.value === "return");
      expect(returnToken).toBeDefined();
      expect(returnToken!.type).toBe("keyword");
    });

    test("tokenizes Python comments", () => {
      const tokens = tokenize("x = 1  # this is a comment", 0, pythonRules);
      const commentToken = tokens.find(t => t.type === "comment");
      expect(commentToken).toBeDefined();
      expect(commentToken!.value).toBe("# this is a comment");
    });

    test("tokenizes Python None as constant", () => {
      const tokens = tokenize("x = None", 0, pythonRules);
      const noneToken = tokens.find(t => t.value === "None");
      expect(noneToken).toBeDefined();
      expect(noneToken!.type).toBe("constant");
    });

    test("tokenizes Python built-in functions", () => {
      const tokens = tokenize("len(items)", 0, pythonRules);
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
      const tokens = tokenize("(defun foo (x) x)", 0, lispRules);
      const defunToken = tokens.find(t => t.value === "defun");
      expect(defunToken).toBeDefined();
      expect(defunToken!.type).toBe("keyword");
    });

    test("tokenizes let as keyword", () => {
      const tokens = tokenize("(let ((x 1)) x)", 0, lispRules);
      const letToken = tokens.find(t => t.value === "let");
      expect(letToken).toBeDefined();
      expect(letToken!.type).toBe("keyword");
    });

    test("tokenizes if as keyword", () => {
      const tokens = tokenize("(if t 1 2)", 0, lispRules);
      const ifToken = tokens.find(t => t.value === "if");
      expect(ifToken).toBeDefined();
      expect(ifToken!.type).toBe("keyword");
    });

    test("tokenizes lambda as keyword", () => {
      const tokens = tokenize("(lambda (x) (+ x 1))", 0, lispRules);
      const lambdaToken = tokens.find(t => t.value === "lambda");
      expect(lambdaToken).toBeDefined();
      expect(lambdaToken!.type).toBe("keyword");
    });

    test("tokenizes Lisp line comments", () => {
      const tokens = tokenize("; this is a comment", 0, lispRules);
      const commentToken = tokens.find(t => t.type === "comment");
      expect(commentToken).toBeDefined();
      expect(commentToken!.value).toBe("; this is a comment");
    });

    test("tokenizes parentheses as punctuation", () => {
      const tokens = tokenize("(+ 1 2)", 0, lispRules);
      const parens = tokens.filter(t => t.type === "punctuation");
      expect(parens.length).toBe(2);
      expect(parens.map(p => p.value).sort()).toEqual(["(", ")"]);
    });

    test("tokenizes nil as boolean", () => {
      const tokens = tokenize("(if nil 1 2)", 0, lispRules);
      const nilToken = tokens.find(t => t.value === "nil");
      expect(nilToken).toBeDefined();
      expect(nilToken!.type).toBe("boolean");
    });

    test("tokenizes built-in functions as builtin", () => {
      const tokens = tokenize("(car xs)", 0, lispRules);
      const carToken = tokens.find(t => t.value === "car");
      expect(carToken).toBeDefined();
      expect(carToken!.type).toBe("builtin");
    });
  });

  // ---------------------------------------------------------------------------
  // Default dark theme
  // ---------------------------------------------------------------------------
  describe("Default dark theme", () => {
    test("maps keyword to magenta bold", () => {
      expect(defaultDarkTheme.keyword).toBeDefined();
      expect(defaultDarkTheme.keyword!.fg).toBe("magenta");
      expect(defaultDarkTheme.keyword!.bold).toBe(true);
    });

    test("maps string to green", () => {
      expect(defaultDarkTheme.string).toBeDefined();
      expect(defaultDarkTheme.string!.fg).toBe("green");
    });

    test("maps comment to black dim", () => {
      expect(defaultDarkTheme.comment).toBeDefined();
      expect(defaultDarkTheme.comment!.fg).toBe("black");
      expect(defaultDarkTheme.comment!.dim).toBe(true);
    });

    test("maps number to yellow", () => {
      expect(defaultDarkTheme.number).toBeDefined();
      expect(defaultDarkTheme.number!.fg).toBe("yellow");
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
      const tokens = tokenize("const x = 1;", 0, typescriptRules);
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
      const tokens = tokenize("const x = 1;", 0, typescriptRules);
      const constToken = tokens.find(t => t.value === "const")!;
      const spans = highlightLine(tokens, defaultDarkTheme);
      const constSpan = spans.find(s => s.start === constToken.startCol && s.end === constToken.endCol);
      expect(constSpan).toBeDefined();
      expect(constSpan!.style.fg).toBe("magenta");
      expect(constSpan!.style.bold).toBe(true);
    });

    test("string spans get the string style from theme", () => {
      const tokens = tokenize('"hello"', 0, typescriptRules);
      const spans = highlightLine(tokens, defaultDarkTheme);
      expect(spans.length).toBe(1);
      expect(spans[0]!.style.fg).toBe("green");
    });
  });

  // ---------------------------------------------------------------------------
  // Empty lines and no-match lines
  // ---------------------------------------------------------------------------
  describe("Edge cases", () => {
    test("empty line produces empty tokens", () => {
      const tokens = tokenize("", 0, typescriptRules);
      expect(tokens).toEqual([]);
    });

    test("empty line produces empty spans", () => {
      const tokens = tokenize("", 0, typescriptRules);
      const spans = highlightLine(tokens, defaultDarkTheme);
      expect(spans).toEqual([]);
    });

    test("plain text with no matches produces empty tokens", () => {
      const tokens = tokenize("    ", 0, typescriptRules);
      expect(tokens).toEqual([]);
    });

    test("plain text with no matches produces empty spans", () => {
      const tokens = tokenize("    ", 0, typescriptRules);
      const spans = highlightLine(tokens, defaultDarkTheme);
      expect(spans).toEqual([]);
    });

    test("tokens have correct column offsets", () => {
      const tokens = tokenize("  const", 0, typescriptRules);
      const constToken = tokens.find(t => t.value === "const");
      expect(constToken).toBeDefined();
      expect(constToken!.startCol).toBe(2);
      expect(constToken!.endCol).toBe(7);
    });

    test("tokens have correct line number", () => {
      const tokens = tokenize("const x = 1;", 5, typescriptRules);
      for (const token of tokens) {
        expect(token.line).toBe(5);
      }
    });
  });
});
