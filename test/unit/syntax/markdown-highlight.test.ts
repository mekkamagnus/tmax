/**
 * @file markdown-highlight.test.ts
 * @description End-to-end tests verifying markdown syntax highlighting produces
 * styled ANSI output. Tests the full pipeline: tokenize → theme → ANSI escapes.
 */

import { describe, test, expect } from "bun:test";
import { computeHighlightSpans } from "../../../src/syntax/highlight-buffer.ts";
import { highlightLine } from "../../../src/syntax/highlighter.ts";
import { tokenize } from "../../../src/syntax/tokenizer.ts";
import { rules } from "../../../src/syntax/languages/markdown.ts";
import { defaultDarkTheme } from "../../../src/syntax/types.ts";
import { style, stripAnsi } from "../../../src/steep/matcha.ts";
import { captureFrame } from "../../../src/render/capture-frame.ts";
import { FunctionalTextBufferImpl } from "../../../src/core/buffer.ts";
import type { HighlightSpan, EditorState } from "../../../src/core/types.ts";

describe("markdown syntax highlighting — theme coverage", () => {
  const mdTokenTypes = [
    "heading", "bold", "italic", "link", "image", "code", "code-delimiter",
    "code-block", "blockquote", "strikethrough", "hr", "list-item",
    "task-item", "table-separator", "meta",
  ];

  test("all markdown token types have theme entries", () => {
    for (const type of mdTokenTypes) {
      expect(defaultDarkTheme[type], `theme missing entry for "${type}"`).toBeDefined();
    }
  });

  test("no markdown token type resolves to empty default style", () => {
    for (const type of mdTokenTypes) {
      const themeStyle = defaultDarkTheme[type];
      const hasStyle = themeStyle && (
        themeStyle.fg !== undefined ||
        themeStyle.bg !== undefined ||
        themeStyle.bold !== undefined ||
        themeStyle.dim !== undefined ||
        themeStyle.underline !== undefined
      );
      expect(hasStyle, `"${type}" theme entry is empty`).toBe(true);
    }
  });
});

describe("markdown syntax highlighting — highlight spans", () => {
  const mdFile = "test.md";

  function spansForLines(lines: string[]): HighlightSpan[][] {
    return computeHighlightSpans(
      (i) => lines[i] ?? "",
      0,
      lines.length,
      mdFile,
    );
  }

  test("heading line produces a span with bold style", () => {
    const spans = spansForLines(["# Hello World"]);
    expect(spans[0]!.length).toBeGreaterThan(0);
    const span = spans[0]![0]!;
    expect(span.style.bold).toBe(true);
    expect(span.style.fg).toBe("#e06c75");
  });

  test("bold text produces a span with bold style", () => {
    const spans = spansForLines(["this is **bold** text"]);
    const boldSpans = spans[0]?.filter(s => s.style.bold && s.style.fg === "#d19a66") ?? [];
    expect(boldSpans.length).toBeGreaterThan(0);
  });

  test("inline code produces a green span", () => {
    const spans = spansForLines(["use `code` here"]);
    const codeSpans = spans[0]?.filter(s => s.style.fg === "#98c379") ?? [];
    expect(codeSpans.length).toBeGreaterThan(0);
  });

  test("link produces an underlined span", () => {
    const spans = spansForLines(["[click](https://example.com)"]);
    const linkSpans = spans[0]?.filter(s => s.style.underline) ?? [];
    expect(linkSpans.length).toBeGreaterThan(0);
  });

  test("blockquote produces a purple span", () => {
    const spans = spansForLines(["> quoted text"]);
    const bqSpans = spans[0]?.filter(s => s.style.fg === "#c678dd") ?? [];
    expect(bqSpans.length).toBeGreaterThan(0);
  });

  test("front matter delimiter produces a dim span", () => {
    const spans = spansForLines(["---"]);
    const metaSpans = spans[0]?.filter(s => s.style.dim) ?? [];
    expect(metaSpans.length).toBeGreaterThan(0);
  });

  test("list item produces a cyan span", () => {
    const spans = spansForLines(["- item"]);
    const listSpans = spans[0]?.filter(s => s.style.fg === "#56b6c2") ?? [];
    expect(listSpans.length).toBeGreaterThan(0);
  });

  test("code fence delimiter produces a muted span", () => {
    const spans = spansForLines(["```typescript"]);
    const delimSpans = spans[0]?.filter(s => s.style.fg === "#5c6370") ?? [];
    expect(delimSpans.length).toBeGreaterThan(0);
  });

  test("strikethrough produces a dim red span", () => {
    const spans = spansForLines(["~~deleted~~"]);
    const strikeSpans = spans[0]?.filter(s => s.style.dim && s.style.fg === "#f85149") ?? [];
    expect(strikeSpans.length).toBeGreaterThan(0);
  });

  test("non-markdown file extension produces no spans", () => {
    const spans = computeHighlightSpans(
      (i) => ["# Hello"][i] ?? "",
      0,
      1,
      "test.txt",
    );
    expect(spans.length).toBe(0);
  });
});

describe("markdown syntax highlighting — ANSI output", () => {
  test("highlighted heading contains ANSI color escape", () => {
    const result = tokenize("# Hello", 0, rules, undefined, "markdown");
    const tokens = Array.isArray(result) ? result : result.tokens;
    const spans = highlightLine(tokens);
    const line = "# Hello";
    const parts: string[] = [];
    let pos = 0;
    for (const span of spans) {
      if (pos < span.start) parts.push(line.slice(pos, span.start));
      const segment = line.slice(span.start, span.end);
      const opts: Record<string, unknown> = {};
      if (span.style.fg) opts.fg = span.style.fg;
      if (span.style.bold) opts.bold = true;
      if (span.style.dim) opts.dim = true;
      parts.push(style(segment, opts as any));
      pos = span.end;
    }
    if (pos < line.length) parts.push(line.slice(pos));
    const output = parts.join("");
    // Should contain a 24-bit color escape (heading color #e06c75 = rgb 224,108,117)
    expect(output).toContain("\x1b[38;2;224;108;117m");
    // Should contain bold escape
    expect(output).toContain("\x1b[1m");
    // After stripping ANSI, should be the original text
    expect(stripAnsi(output)).toBe("# Hello");
  });

  test("highlighted link contains underline ANSI escape", () => {
    const result = tokenize("[click](https://example.com)", 0, rules, undefined, "markdown");
    const tokens = Array.isArray(result) ? result : result.tokens;
    const spans = highlightLine(tokens);
    // Link spans should have underline style
    const linkSpan = spans.find(s => s.style.underline);
    expect(linkSpan).toBeDefined();
    expect(linkSpan!.style.fg).toBe("#61afef");
  });
});

describe("markdown syntax highlighting — render pipeline (ANSI output)", () => {
  function renderMarkdown(content: string, filename = "test.md"): string[] {
    const buffer = FunctionalTextBufferImpl.create(content);
    const state: EditorState = {
      currentBuffer: buffer,
      cursorPosition: { line: 0, column: 0 },
      mode: "normal",
      statusMessage: "",
      viewportTop: 0,
      config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: true, relativeLineNumbers: false, wordWrap: false },
      commandLine: "",
      mxCommand: "",
      currentFilename: filename,
    };
    return captureFrame(state, 80, 24);
  }

  function hasColorEscape(line: string): boolean {
    return line.includes("\x1b[38;2;") || line.includes("\x1b[48;2;");
  }

  test("heading renders with 24-bit color escape", () => {
    const lines = renderMarkdown("# Hello World");
    const contentLine = lines.find(l => l.includes("Hello World"));
    expect(contentLine).toBeDefined();
    // #e06c75 = rgb(224,108,117)
    expect(contentLine!).toContain("\x1b[38;2;224;108;117m");
    expect(contentLine!).toContain("\x1b[1m");
  });

  test("bold renders with bold + orange escape", () => {
    const lines = renderMarkdown("**bold**");
    const contentLine = lines.find(l => l.includes("bold"));
    expect(contentLine).toBeDefined();
    // #d19a66 = rgb(209,154,102)
    expect(contentLine!).toContain("\x1b[38;2;209;154;102m");
    expect(contentLine!).toContain("\x1b[1m");
  });

  test("link renders with blue escape", () => {
    const lines = renderMarkdown("[text](https://example.com)");
    const contentLine = lines.find(l => l.includes("text"));
    expect(contentLine).toBeDefined();
    // #61afef = rgb(97,175,239)
    expect(contentLine!).toContain("\x1b[38;2;97;175;239m");
  });

  test("plain .txt file renders with no 24-bit color escapes", () => {
    const lines = renderMarkdown("# Hello World", "test.txt");
    const contentLine = lines.find(l => l.includes("Hello World"));
    expect(contentLine).toBeDefined();
    expect(hasColorEscape(contentLine!)).toBe(false);
  });

  test("all markdown token types produce ANSI escapes in rendered output", () => {
    const content = [
      "# Heading",
      "```ts",
      "code",
      "```",
      "**bold**",
      "*italic*",
      "~~strike~~",
      "[link](url)",
      "> quote",
      "- item",
      "- [x] task",
      "---",
    ].join("\n");
    const lines = renderMarkdown(content);

    const checks: [string, string][] = [
      ["Heading", "# Heading line should have color"],
      ["```ts", "Code delimiter should have color"],
      ["**bold**", "Bold should have color"],
      ["*italic*", "Italic should have color"],
      ["~~strike~~", "Strikethrough should have color"],
      ["[link]", "Link should have color"],
      ["> quote", "Blockquote should have color"],
      ["- item", "List item should have color"],
      ["- [x]", "Task item should have color"],
    ];

    for (const [text, msg] of checks) {
      const line = lines.find(l => stripAnsi(l).includes(text));
      expect(line, `Could not find rendered line containing "${text}"`).toBeDefined();
      expect(hasColorEscape(line!), `${msg}: "${text}"`).toBe(true);
    }
  });
});
