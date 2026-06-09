import { describe, test, expect } from "bun:test";
import { tokenize } from "../../src/syntax/tokenizer.ts";
import { ParseState } from "../../src/syntax/parse-state.ts";
import { rules } from "../../src/syntax/languages/markdown.ts";

function tokenizeLine(line: string, lineNum: number, state?: ParseState) {
  const s = state ?? new ParseState();
  const result = tokenize(line, lineNum, rules, s, "markdown");
  if (Array.isArray(result)) return { tokens: result, nextState: s };
  return result;
}

function tokensOfType(line: string, type: string): number {
  return tokenizeLine(line, 0).tokens.filter(t => t.type === type).length;
}

describe("markdown tokenizer — token types", () => {
  test("front matter delimiter", () => {
    expect(tokensOfType("---", "meta")).toBe(1);
  });

  test("ATX headings h1-h6", () => {
    expect(tokensOfType("# H1", "heading")).toBe(1);
    expect(tokensOfType("## H2", "heading")).toBe(1);
    expect(tokensOfType("### H3", "heading")).toBe(1);
    expect(tokensOfType("#### H4", "heading")).toBe(1);
    expect(tokensOfType("##### H5", "heading")).toBe(1);
    expect(tokensOfType("###### H6", "heading")).toBe(1);
    // Not a heading without space
    expect(tokensOfType("####### Not a heading", "heading")).toBe(0);
  });

  test("setext heading underlines", () => {
    expect(tokensOfType("===", "heading")).toBe(1);
    expect(tokensOfType("---", "heading") + tokensOfType("---", "meta")).toBeGreaterThanOrEqual(1);
    expect(tokensOfType("=======", "heading")).toBe(1);
    expect(tokensOfType("-------", "heading")).toBeGreaterThanOrEqual(1);
  });

  test("fenced code block delimiters (backtick)", () => {
    expect(tokensOfType("```typescript", "code-delimiter")).toBe(1);
    expect(tokensOfType("```", "code-delimiter")).toBe(1);
  });

  test("fenced code block delimiters (tilde)", () => {
    expect(tokensOfType("~~~python", "code-delimiter")).toBe(1);
    expect(tokensOfType("~~~", "code-delimiter")).toBe(1);
  });

  test("inline code", () => {
    expect(tokensOfType("use `code` here", "code")).toBe(1);
  });

  test("bold", () => {
    expect(tokensOfType("this is **bold** text", "bold")).toBeGreaterThanOrEqual(1);
    expect(tokensOfType("this is __bold__ text", "bold")).toBeGreaterThanOrEqual(1);
  });

  test("bold+italic", () => {
    expect(tokensOfType("***bold italic***", "bold")).toBeGreaterThanOrEqual(1);
  });

  test("italic", () => {
    expect(tokensOfType("this is *italic* text", "italic")).toBeGreaterThanOrEqual(1);
    expect(tokensOfType("this is _italic_ text", "italic")).toBeGreaterThanOrEqual(1);
  });

  test("strikethrough", () => {
    expect(tokensOfType("this is ~~deleted~~ text", "strikethrough")).toBeGreaterThanOrEqual(1);
  });

  test("inline links", () => {
    expect(tokensOfType("[click](https://example.com)", "link")).toBe(1);
  });

  test("reference-style links", () => {
    expect(tokensOfType("[click][ref]", "link")).toBeGreaterThanOrEqual(1);
  });

  test("images", () => {
    expect(tokensOfType("![alt](img.png)", "image")).toBe(1);
  });

  test("blockquotes", () => {
    expect(tokensOfType("> quoted text", "blockquote")).toBe(1);
  });

  test("unordered list markers", () => {
    expect(tokensOfType("- item", "list-item")).toBeGreaterThanOrEqual(1);
    expect(tokensOfType("* item", "list-item")).toBeGreaterThanOrEqual(1);
    expect(tokensOfType("+ item", "list-item")).toBeGreaterThanOrEqual(1);
  });

  test("ordered list markers", () => {
    expect(tokensOfType("1. item", "list-item")).toBeGreaterThanOrEqual(1);
    expect(tokensOfType("2) item", "list-item")).toBeGreaterThanOrEqual(1);
  });

  test("task list markers", () => {
    expect(tokensOfType("- [ ] todo", "task-item")).toBe(1);
    expect(tokensOfType("- [x] done", "task-item")).toBe(1);
    expect(tokensOfType("- [X] done", "task-item")).toBe(1);
  });

  test("horizontal rules", () => {
    expect(tokensOfType("***", "hr")).toBe(1);
    expect(tokensOfType("___", "hr")).toBe(1);
  });

  test("pipe table separator", () => {
    expect(tokensOfType("|---|---|", "table-separator")).toBe(1);
    expect(tokensOfType("| :---: | ---: |", "table-separator")).toBe(1);
  });
});

describe("markdown tokenizer — fenced code block state", () => {
  test("enters and exits code fence (backtick)", () => {
    const r1 = tokenizeLine("```typescript", 0);
    expect(r1.tokens[0]?.type).toBe("code-delimiter");
    expect(r1.nextState.inCodeFence).toBe(true);

    const r2 = tokenizeLine("const x = 1;", 1, r1.nextState);
    expect(r2.tokens[0]?.type).toBe("code-block");
    expect(r2.nextState.inCodeFence).toBe(true);

    const r3 = tokenizeLine("```", 2, r2.nextState);
    expect(r3.tokens[0]?.type).toBe("code-delimiter");
    expect(r3.nextState.inCodeFence).toBe(false);
  });

  test("enters and exits code fence (tilde)", () => {
    const r1 = tokenizeLine("~~~", 0);
    expect(r1.nextState.inCodeFence).toBe(true);

    const r2 = tokenizeLine("some code", 1, r1.nextState);
    expect(r2.tokens[0]?.type).toBe("code-block");

    const r3 = tokenizeLine("~~~", 2, r2.nextState);
    expect(r3.nextState.inCodeFence).toBe(false);
  });

  test("tilde fence doesn't match backtick close", () => {
    const r1 = tokenizeLine("~~~", 0);
    const r2 = tokenizeLine("code", 1, r1.nextState);
    // Backtick close should NOT close a tilde fence
    const r3 = tokenizeLine("```", 2, r2.nextState);
    expect(r3.nextState.inCodeFence).toBe(true);
    // Now close with tilde
    const r4 = tokenizeLine("~~~", 3, r3.nextState);
    expect(r4.nextState.inCodeFence).toBe(false);
  });

  test("code fence with trailing whitespace closes correctly", () => {
    const r1 = tokenizeLine("```", 0);
    const r2 = tokenizeLine("code", 1, r1.nextState);
    const r3 = tokenizeLine("```   ", 2, r2.nextState);
    expect(r3.nextState.inCodeFence).toBe(false);
  });

  test("empty lines inside code fence are code-block tokens", () => {
    const r1 = tokenizeLine("```", 0);
    const r2 = tokenizeLine("", 1, r1.nextState);
    expect(r2.tokens[0]?.type).toBe("code-block");
    expect(r2.nextState.inCodeFence).toBe(true);
  });
});

describe("markdown tokenizer — precedence and priority", () => {
  test("front matter (priority 100) beats setext heading (89) for ---", () => {
    const result = tokenizeLine("---", 0);
    const types = result.tokens.map(t => t.type);
    // --- matches both meta (priority 100) and setext heading (89)
    // Higher priority wins, so meta should be the token type
    expect(types).toContain("meta");
  });

  test("heading (90) beats setext heading (89) for ###", () => {
    const result = tokenizeLine("### Heading", 0);
    expect(result.tokens[0]?.type).toBe("heading");
  });

  test("bold+italic (50) matches before bold (49)", () => {
    const result = tokenizeLine("***both***", 0);
    const bold = result.tokens.filter(t => t.type === "bold");
    expect(bold.length).toBeGreaterThanOrEqual(1);
    // The match should cover the full ***both***
    expect(bold[0]?.value).toBe("***both***");
  });

  test("image (65) matches before link (60)", () => {
    const result = tokenizeLine("![img](url)", 0);
    expect(result.tokens.some(t => t.type === "image")).toBe(true);
    expect(result.tokens.some(t => t.type === "link")).toBe(false);
  });

  test("task-item (72) matches before list-item (70)", () => {
    const result = tokenizeLine("- [x] done", 0);
    expect(result.tokens.some(t => t.type === "task-item")).toBe(true);
  });
});

describe("markdown tokenizer — edge cases", () => {
  test("empty string produces no tokens", () => {
    const result = tokenizeLine("", 0);
    expect(result.tokens.length).toBe(0);
  });

  test("plain text produces no tokens", () => {
    const result = tokenizeLine("just some plain text", 0);
    expect(result.tokens.length).toBe(0);
  });

  test("incomplete bold is not tokenized", () => {
    const result = tokenizeLine("**not bold", 0);
    expect(result.tokens.filter(t => t.type === "bold").length).toBe(0);
  });

  test("heading covers full line, link not separately tokenized", () => {
    const result = tokenizeLine("## Check out [this](url)", 0);
    expect(result.tokens.some(t => t.type === "heading")).toBe(true);
    // Heading regex covers the entire line at priority 90, so link (60) can't overlap
    expect(result.tokens.length).toBe(1);
  });

  test("multiple links on one line", () => {
    const result = tokenizeLine("[a](1) and [b](2)", 0);
    expect(result.tokens.filter(t => t.type === "link").length).toBe(2);
  });

  test("fenced code with info string", () => {
    const result = tokenizeLine("```typescript", 0);
    expect(result.tokens[0]?.type).toBe("code-delimiter");
    expect(result.nextState.inCodeFence).toBe(true);
  });
});
