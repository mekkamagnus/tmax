import { describe, test, expect } from "bun:test";
import type { EditorState, SyntaxToken } from "../../src/core/types.ts";
import {
  foldToggle,
  foldOpen,
  foldClose,
  foldCloseAll,
  foldOpenAll,
  foldByLevel,
  foldIsCollapsed,
  foldGetRanges,
  findHeadingRanges,
} from "../../src/editor/api/fold-ops.ts";
import { rules } from "../../src/syntax/languages/markdown.ts";
import { tokenize, type TokenizeResult } from "../../src/syntax/tokenizer.ts";

function asTokens(result: SyntaxToken[] | TokenizeResult): SyntaxToken[] {
  return Array.isArray(result) ? result : result.tokens;
}

describe("fold-ops", () => {
  const makeState = (ranges?: Map<number, number>): EditorState =>
    ({ foldRanges: ranges ?? new Map() }) as EditorState;

  describe("foldToggle", () => {
    test("closes a heading range", () => {
      const state = makeState();
      const headingRanges = [
        { start: 0, end: 3, level: 1 },
        { start: 4, end: 7, level: 2 },
      ];
      const result = foldToggle(state, 0, headingRanges);
      expect(result.foldRanges!.has(0)).toBe(true);
      expect(result.foldRanges!.get(0)).toBe(3);
    });

    test("opens a previously closed fold", () => {
      const ranges = new Map([[0, 3]]);
      const state = makeState(ranges);
      const headingRanges = [{ start: 0, end: 3, level: 1 }];
      const result = foldToggle(state, 0, headingRanges);
      expect(result.foldRanges!.has(0)).toBe(false);
    });

    test("no-op when line is not a heading", () => {
      const state = makeState();
      const headingRanges = [{ start: 0, end: 3, level: 1 }];
      const result = foldToggle(state, 5, headingRanges);
      expect(result.foldRanges!.size).toBe(0);
    });
  });

  describe("foldOpen / foldClose", () => {
    test("foldOpen removes a fold", () => {
      const ranges = new Map([[0, 3]]);
      const state = makeState(ranges);
      const result = foldOpen(state, 0);
      expect(result.foldRanges!.has(0)).toBe(false);
    });

    test("foldClose adds a fold", () => {
      const state = makeState();
      const result = foldClose(state, 4, 7);
      expect(result.foldRanges!.get(4)).toBe(7);
    });
  });

  describe("foldCloseAll / foldOpenAll", () => {
    test("foldCloseAll closes all headings", () => {
      const state = makeState();
      const headingRanges = [
        { start: 0, end: 3, level: 1 },
        { start: 4, end: 7, level: 2 },
      ];
      const result = foldCloseAll(state, headingRanges);
      expect(result.foldRanges!.size).toBe(2);
    });

    test("foldOpenAll opens everything", () => {
      const ranges = new Map([[0, 3], [4, 7]]);
      const state = makeState(ranges);
      const result = foldOpenAll(state);
      expect(result.foldRanges!.size).toBe(0);
    });
  });

  describe("foldByLevel", () => {
    test("folds only headings above maxLevel", () => {
      const state = makeState();
      const headingRanges = [
        { start: 0, end: 3, level: 1 },
        { start: 4, end: 7, level: 2 },
        { start: 8, end: 11, level: 3 },
      ];
      const result = foldByLevel(state, 1, headingRanges);
      expect(result.foldRanges!.has(4)).toBe(true);
      expect(result.foldRanges!.has(8)).toBe(true);
      expect(result.foldRanges!.has(0)).toBe(false);
    });
  });

  describe("foldIsCollapsed / foldGetRanges", () => {
    test("foldIsCollapsed checks fold state", () => {
      const ranges = new Map([[0, 3]]);
      const state = makeState(ranges);
      expect(foldIsCollapsed(state, 0)).toBe(true);
      expect(foldIsCollapsed(state, 4)).toBe(false);
    });

    test("foldGetRanges returns all ranges", () => {
      const ranges = new Map([[0, 3], [4, 7]]);
      const state = makeState(ranges);
      const result = foldGetRanges(state);
      expect(result).toEqual([
        { start: 0, end: 3 },
        { start: 4, end: 7 },
      ]);
    });
  });

  describe("findHeadingRanges", () => {
    const lines = [
      "# Title",
      "Some text",
      "## Section 1",
      "More text",
      "### Subsection",
      "Detail",
      "## Section 2",
      "End",
    ];

    test("finds all headings with correct ranges", () => {
      const ranges = findHeadingRanges((i) => lines[i] ?? "", lines.length);
      expect(ranges).toEqual([
        { start: 0, end: 1, level: 1 },
        { start: 2, end: 3, level: 2 },
        { start: 4, end: 5, level: 3 },
        { start: 6, end: 7, level: 2 },
      ]);
    });

    test("returns empty for no headings", () => {
      const noHeadings = ["line 1", "line 2"];
      const ranges = findHeadingRanges((i) => noHeadings[i] ?? "", noHeadings.length);
      expect(ranges).toEqual([]);
    });
  });
});

describe("markdown tokenizer", () => {
  test("tokenizes ATX headings", () => {
    const tokens = asTokens(tokenize("# Hello World", 0, rules));
    const headings = tokens.filter((t: any) => t.type === "heading");
    expect(headings.length).toBe(1);
  });

  test("tokenizes code fences", () => {
    const tokens = asTokens(tokenize("```typescript", 0, rules));
    const fences = tokens.filter((t: any) => t.type === "code-delimiter");
    expect(fences.length).toBe(1);
  });

  test("tokenizes inline formatting", () => {
    const boldTokens = asTokens(tokenize("This is **bold** text", 0, rules));
    const italicTokens = asTokens(tokenize("This is *italic* text", 0, rules));
    expect(boldTokens.filter((t: any) => t.type === "bold").length).toBeGreaterThanOrEqual(1);
    expect(italicTokens.filter((t: any) => t.type === "italic").length).toBeGreaterThanOrEqual(1);
  });

  test("tokenizes links", () => {
    const tokens = asTokens(tokenize("[click here](https://example.com)", 0, rules));
    const links = tokens.filter((t: any) => t.type === "link");
    expect(links.length).toBe(1);
  });

  test("tokenizes list items", () => {
    const tokens = asTokens(tokenize("- list item", 0, rules));
    const items = tokens.filter((t: any) => t.type === "list-item");
    expect(items.length).toBe(1);
  });

  test("tokenizes blockquotes", () => {
    const tokens = asTokens(tokenize("> quoted text", 0, rules));
    const quotes = tokens.filter((t: any) => t.type === "blockquote");
    expect(quotes.length).toBe(1);
  });
});
