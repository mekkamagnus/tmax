/**
 * @file render-visual.test.ts
 * @description Visual assertion tests proving syntax highlighting colors reach the rendered output.
 * Exercises the full pipeline: tokenizer → highlighter → spans → render → ANSI/HTML output.
 */

import { describe, test, expect } from "bun:test";
import { captureFrame } from "../../src/render/capture-frame.ts";
import { ansiToHtml, ansiLinesToHtmlDocument } from "../../src/render/ansi-to-html.ts";
import { defaultDarkTheme } from "../../src/syntax/types.ts";
import { hexToRGB } from "../../src/steep/matcha.ts";
import { isHexColor } from "../../src/steep/matcha.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import type { EditorState } from "../../src/core/types.ts";

function makeVisualState(content: string, filename: string): EditorState {
  const buf = FunctionalTextBufferImpl.create(content);
  return {
    currentBuffer: buf as any,
    cursorPosition: { line: 0, column: 0 },
    mode: "normal",
    statusMessage: "",
    viewportTop: 0,
    config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: false },
    commandLine: "",
    mxCommand: "",
    currentFilename: filename,
  };
}

/** Convert #RRGGBB to the ANSI 24-bit escape sequence string */
function hexToAnsi(hex: string): string {
  const [r, g, b] = hexToRGB(hex as `#${string}`);
  return `${r};${g};${b}`;
}

/** Get the first buffer line from captureFrame output (index 0) */
function captureLine(content: string, filename: string, lineIdx: number): string {
  const state = makeVisualState(content, filename);
  const lines = captureFrame(state, 80, 24);
  return lines[lineIdx] ?? "";
}

describe("Render Visual: T-Lisp/Lisp", () => {
  test("keyword (defun) renders with purple #c678dd", () => {
    const line = captureLine("(defun foo)", "test.tlisp", 0);
    const expected = hexToAnsi("#c678dd");
    expect(line).toContain(`38;2;${expected}m`);
  });

  test("keyword (defun) includes bold escape", () => {
    const line = captureLine("(defun foo)", "test.tlisp", 0);
    expect(line).toContain("\x1b[1m");
  });

  test("comment (;;) renders with dim gray #5c6370", () => {
    const line = captureLine(";; comment text", "test.tlisp", 0);
    const expected = hexToAnsi("#5c6370");
    expect(line).toContain(`38;2;${expected}m`);
  });

  test("comment includes dim attribute", () => {
    const line = captureLine(";; comment text", "test.tlisp", 0);
    expect(line).toContain("\x1b[2m");
  });

  test("string renders with green #98c379", () => {
    const line = captureLine('"hello world"', "test.tlisp", 0);
    const expected = hexToAnsi("#98c379");
    expect(line).toContain(`38;2;${expected}m`);
  });

  test("number renders with orange #d19a66", () => {
    const line = captureLine("42", "test.tlisp", 0);
    const expected = hexToAnsi("#d19a66");
    expect(line).toContain(`38;2;${expected}m`);
  });

  test("boolean (nil) renders with orange #d19a66", () => {
    const line = captureLine("nil", "test.tlisp", 0);
    const expected = hexToAnsi("#d19a66");
    expect(line).toContain(`38;2;${expected}m`);
  });

  test("builtin (car) renders with yellow #e5c07b", () => {
    const line = captureLine("(car x)", "test.tlisp", 0);
    const expected = hexToAnsi("#e5c07b");
    expect(line).toContain(`38;2;${expected}m`);
  });

  test("parenthesis renders with light gray #abb2bf", () => {
    const line = captureLine("()", "test.tlisp", 0);
    const expected = hexToAnsi("#abb2bf");
    expect(line).toContain(`38;2;${expected}m`);
  });

  test("multiple tokens on one line each get their own color", () => {
    const line = captureLine("(defun foo 42)", "test.tlisp", 0);
    // Should have punctuation color for '('
    expect(line).toContain(`38;2;${hexToAnsi("#abb2bf")}`);
    // Should have keyword color for 'defun'
    expect(line).toContain(`38;2;${hexToAnsi("#c678dd")}`);
    // Should have number color for '42'
    expect(line).toContain(`38;2;${hexToAnsi("#d19a66")}`);
  });
});

describe("Render Visual: TypeScript", () => {
  test("keyword (function) renders with purple #c678dd", () => {
    const line = captureLine("function hello() {}", "test.ts", 0);
    const expected = hexToAnsi("#c678dd");
    expect(line).toContain(`38;2;${expected}m`);
  });

  test("comment (//) renders with dim gray #5c6370", () => {
    const line = captureLine("// comment", "test.ts", 0);
    const expected = hexToAnsi("#5c6370");
    expect(line).toContain(`38;2;${expected}m`);
  });

  test("string renders with green #98c379", () => {
    const line = captureLine('"hello"', "test.ts", 0);
    const expected = hexToAnsi("#98c379");
    expect(line).toContain(`38;2;${expected}m`);
  });
});

describe("Render Visual: HTML output verification", () => {
  test("keyword ANSI produces correct RGB span in HTML", () => {
    const line = captureLine("(defun foo)", "test.tlisp", 0);
    const html = ansiToHtml(line);
    expect(html).toContain("color:rgb(198,120,221)");
  });

  test("comment ANSI produces correct dim RGB span in HTML", () => {
    const line = captureLine(";; comment", "test.tlisp", 0);
    const html = ansiToHtml(line);
    expect(html).toContain("color:rgb(92,99,112)");
  });

  test("full HTML document contains colored spans", () => {
    const state = makeVisualState("(defun foo)", "test.tlisp");
    const lines = captureFrame(state, 80, 24);
    const doc = ansiLinesToHtmlDocument(lines);
    expect(doc).toContain("color:rgb(198,120,221)"); // keyword purple
    expect(doc).toContain("<!DOCTYPE html>");
    expect(doc).toContain("#282c34"); // background
  });
});

describe("Render Visual: Theme coverage sweep", () => {
  // For each theme entry with a hex fg, verify it produces the right ANSI code.
  // We use a simple line that should trigger each token type.
  const tokenSamples: Record<string, { line: string; filename: string }> = {
    keyword: { line: "defun", filename: "test.tlisp" },
    string: { line: '"hello"', filename: "test.tlisp" },
    comment: { line: ";; x", filename: "test.tlisp" },
    number: { line: "42", filename: "test.tlisp" },
    boolean: { line: "nil", filename: "test.tlisp" },
    builtin: { line: "car", filename: "test.tlisp" },
    punctuation: { line: "(", filename: "test.tlisp" },
    type: { line: "string", filename: "test.ts" },
    // operator: not easily triggered in isolation for lisp; skip
    decorator: { line: "@test", filename: "test.ts" },
  };

  for (const [tokenType, sample] of Object.entries(tokenSamples)) {
    const themeEntry = defaultDarkTheme[tokenType];
    if (!themeEntry?.fg || !isHexColor(themeEntry.fg)) continue;
    const fg = themeEntry.fg;

    test(`${tokenType} token renders with theme color ${fg}`, () => {
      const line = captureLine(sample.line, sample.filename, 0);
      const expected = hexToAnsi(fg);
      expect(line).toContain(`38;2;${expected}m`);
    });

    test(`${tokenType} token produces correct HTML rgb() color`, () => {
      const line = captureLine(sample.line, sample.filename, 0);
      const html = ansiToHtml(line);
      const [r, g, b] = hexToRGB(fg as `#${string}`);
      expect(html).toContain(`color:rgb(${r},${g},${b})`);
    });
  }
});

describe("Render Visual: Edge cases", () => {
  test("no syntax colors for file without extension", () => {
    const line = captureLine("(defun foo)", "Makefile", 0);
    // Should not contain 24-bit color codes for syntax
    expect(line).not.toContain("38;2;");
  });

  test("empty line has no syntax colors", () => {
    const state = makeVisualState("\n(defun foo)", "test.tlisp");
    const lines = captureFrame(state, 80, 24);
    const firstLine = lines[0]!;
    // First line is empty — no 24-bit syntax color
    expect(firstLine).not.toContain("38;2;");
  });

  test("token at column 0 still gets colored", () => {
    const line = captureLine("defun foo", "test.tlisp", 0);
    // 'defun' starts at column 0 and should still be purple
    expect(line).toContain(`38;2;${hexToAnsi("#c678dd")}`);
  });
});
