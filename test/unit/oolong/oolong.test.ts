import { describe, test, expect } from "bun:test";
import { parse, parseInline } from "../../../src/steep/oolong/parser.ts";
import { renderMarkdown } from "../../../src/steep/oolong/renderer.ts";
import { darkTheme } from "../../../src/steep/oolong/themes/dark.ts";
import { lightTheme } from "../../../src/steep/oolong/themes/light.ts";
import { stripAnsi } from "../../../src/steep/matcha.ts";
import { wrapAnsi } from "../../../src/steep/oolong/wrap.ts";
import { formatTable, padCell } from "../../../src/steep/oolong/table.ts";

describe("oolong parser", () => {
  test("parses ATX headings h1-h6", () => {
    for (let l = 1; l <= 6; l++) {
      const hashes = "#".repeat(l);
      const doc = parse(`${hashes} Hello`);
      expect(doc.children[0]?.type).toBe("heading");
      expect((doc.children[0] as any).level).toBe(l);
    }
  });

  test("parses paragraph blocks", () => {
    const doc = parse("hello world");
    expect(doc.children[0]?.type).toBe("paragraph");
  });

  test("parses fenced code blocks with info string", () => {
    const doc = parse("```ts\nconsole.log('hi')\n```");
    const cb = doc.children[0] as any;
    expect(cb.type).toBe("codeBlock");
    expect(cb.language).toBe("ts");
    expect(cb.value).toBe("console.log('hi')");
  });

  test("parses nested blockquotes", () => {
    const doc = parse("> hello\n> > nested");
    expect(doc.children[0]?.type).toBe("blockquote");
  });

  test("parses unordered lists", () => {
    const doc = parse("- one\n- two\n- three");
    const list = doc.children[0] as any;
    expect(list.type).toBe("unorderedList");
    expect(list.children.length).toBe(3);
  });

  test("parses ordered lists", () => {
    const doc = parse("1. first\n2. second");
    const list = doc.children[0] as any;
    expect(list.type).toBe("orderedList");
    expect(list.start).toBe(1);
  });

  test("parses GFM task lists", () => {
    const doc = parse("- [x] done\n- [ ] todo");
    const list = doc.children[0] as any;
    expect(list.type).toBe("taskList");
    expect(list.children[0].checked).toBe(true);
    expect(list.children[1].checked).toBe(false);
  });

  test("parses inline bold, italic, strikethrough", () => {
    const nodes = parseInline("**bold** *italic* ~~strike~~");
    expect(nodes.some((n: any) => n.type === "strong")).toBe(true);
    expect(nodes.some((n: any) => n.type === "emphasis")).toBe(true);
    expect(nodes.some((n: any) => n.type === "strikethrough")).toBe(true);
  });

  test("parses inline code spans", () => {
    const nodes = parseInline("`code`");
    expect(nodes[0]?.type).toBe("inlineCode");
    expect((nodes[0] as any).value).toBe("code");
  });

  test("parses links", () => {
    const nodes = parseInline("[text](http://example.com)");
    expect(nodes[0]?.type).toBe("link");
    expect((nodes[0] as any).href).toBe("http://example.com");
  });

  test("parses images", () => {
    const nodes = parseInline("![alt](img.png)");
    expect(nodes[0]?.type).toBe("image");
    expect((nodes[0] as any).src).toBe("img.png");
  });

  test("parses GFM pipe tables", () => {
    const doc = parse("| H1 | H2 |\n| --- | --- |\n| a | b |");
    expect(doc.children[0]?.type).toBe("table");
  });

  test("parses YAML front matter", () => {
    const doc = parse("---\ntitle: Test\n---");
    expect(doc.children[0]?.type).toBe("yamlFrontMatter");
  });

  test("parses horizontal rules", () => {
    const doc = parse("---\n\n---\n");
    // First "---" is front matter since it starts at line 0
    const doc2 = parse("***\n");
    expect(doc2.children[0]?.type).toBe("horizontalRule");
  });
});

describe("oolong renderer", () => {
  const opts = { width: 80, theme: darkTheme };

  test("headings render with theme colors", () => {
    const lines = renderMarkdown("# Hello", opts);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => l.includes("\x1b["))).toBe(true);
  });

  test("bold text wraps with ANSI bold escapes", () => {
    const lines = renderMarkdown("**bold**", opts);
    expect(lines.some((l) => l.includes("\x1b[1m"))).toBe(true);
  });

  test("code blocks render", () => {
    const lines = renderMarkdown("```\nhello\n```", opts);
    expect(lines.some((l) => stripAnsi(l).includes("hello"))).toBe(true);
  });

  test("blockquotes render with prefix", () => {
    const lines = renderMarkdown("> quote", opts);
    expect(lines.some((l) => stripAnsi(l).includes("quote"))).toBe(true);
  });

  test("links render with visible URL", () => {
    const lines = renderMarkdown("[text](http://example.com)", opts);
    expect(lines.some((l) => stripAnsi(l).includes("http://example.com"))).toBe(true);
  });

  test("GFM tables render with aligned columns", () => {
    const md = "| Name | Age |\n| --- | --- |\n| Alice | 30 |";
    const lines = renderMarkdown(md, opts);
    expect(lines.some((l) => stripAnsi(l).includes("Alice"))).toBe(true);
    expect(lines.some((l) => l.includes("---"))).toBe(true);
  });

  test("output lines do not exceed specified width", () => {
    const longText = "word ".repeat(50).trim();
    const lines = renderMarkdown(longText, { width: 40, theme: darkTheme });
    for (const line of lines) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(40);
    }
  });

  test("dark theme vs light theme produces different ANSI colors", () => {
    const darkLines = renderMarkdown("# Test", { width: 80, theme: darkTheme });
    const lightLines = renderMarkdown("# Test", { width: 80, theme: lightTheme });
    const darkStyled = darkLines.find((l) => l.trim() !== "") ?? "";
    const lightStyled = lightLines.find((l) => l.trim() !== "") ?? "";
    expect(darkStyled).not.toBe(lightStyled);
  });

  test("empty document returns empty array", () => {
    const lines = renderMarkdown("", opts);
    expect(lines).toEqual([]);
  });

  test("plain text paragraph renders", () => {
    const lines = renderMarkdown("hello world", opts);
    expect(lines.some((l) => stripAnsi(l).includes("hello world"))).toBe(true);
  });
});

describe("oolong wrap", () => {
  test("wraps at word boundaries", () => {
    const result = wrapAnsi("hello world foo bar baz", 12);
    for (const line of result) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(12);
    }
  });

  test("preserves ANSI escapes in wrapped text", () => {
    const styled = "\x1b[1mhello world\x1b[0m";
    const result = wrapAnsi(styled, 8);
    expect(result.some((l) => l.includes("\x1b["))).toBe(true);
  });

  test("respects indent parameter", () => {
    const result = wrapAnsi("hello", 10, 4);
    expect(result[0]?.startsWith("    ")).toBe(true);
  });

  test("handles long words exceeding width", () => {
    const result = wrapAnsi("superlongwordthatwontfit", 10);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

describe("oolong table", () => {
  test("padCell left-aligns by default", () => {
    expect(padCell("hi", 6, null)).toBe("hi    ");
  });

  test("padCell right-aligns", () => {
    expect(padCell("hi", 6, "right")).toBe("    hi");
  });

  test("padCell center-aligns", () => {
    expect(padCell("hi", 6, "center")).toBe("  hi  ");
  });

  test("formatTable produces separator", () => {
    const doc = parse("| A | B |\n| --- | --- |\n| 1 | 2 |");
    const table = doc.children[0] as any;
    const fmt = formatTable(table);
    expect(fmt.separator).toContain("---");
    expect(fmt.rows.length).toBe(2);
    expect(fmt.colWidths.length).toBe(2);
  });
});

describe("oolong themes", () => {
  const requiredKeys = ["h1", "h2", "h3", "h4", "h5", "h6", "text", "strong", "emphasis", "codespan", "codeBlock", "blockquote", "link", "horizontalRule"];

  test("dark theme has all required style keys", () => {
    for (const key of requiredKeys) {
      expect(darkTheme[key as keyof typeof darkTheme]).toBeDefined();
    }
  });

  test("light theme has all required style keys", () => {
    for (const key of requiredKeys) {
      expect(lightTheme[key as keyof typeof lightTheme]).toBeDefined();
    }
  });

  test("theme styles have correct structure", () => {
    const ts = darkTheme.h1;
    expect(ts).toBeDefined();
    if (ts.color) expect(typeof ts.color).toBe("string");
    if (ts.bold !== undefined) expect(typeof ts.bold).toBe("boolean");
  });
});
