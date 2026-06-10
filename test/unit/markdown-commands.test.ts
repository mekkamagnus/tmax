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
import { resolveMapping, type KeyMapping } from "../../src/editor/editor.ts";
import { rules } from "../../src/syntax/languages/markdown.ts";
import { tokenize, type TokenizeResult } from "../../src/syntax/tokenizer.ts";

function asTokens(result: SyntaxToken[] | TokenizeResult): SyntaxToken[] {
  return Array.isArray(result) ? result : result.tokens;
}

// ── Fold ops (TypeScript pure functions) ──────────────────────────────

describe("fold ops — comprehensive", () => {
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

    test("toggles multiple independent folds", () => {
      const headingRanges = [
        { start: 0, end: 3, level: 1 },
        { start: 4, end: 7, level: 2 },
        { start: 8, end: 11, level: 3 },
      ];
      const state = makeState();
      const r1 = foldToggle(state, 0, headingRanges);
      const r2 = foldToggle(r1 as EditorState, 8, headingRanges);
      expect(r2.foldRanges!.has(0)).toBe(true);
      expect(r2.foldRanges!.has(8)).toBe(true);
      expect(r2.foldRanges!.has(4)).toBe(false);
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

    test("foldOpen is no-op when fold doesn't exist", () => {
      const state = makeState(new Map());
      const result = foldOpen(state, 5);
      expect(result.foldRanges!.size).toBe(0);
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

    test("foldCloseAll with empty headings is no-op", () => {
      const state = makeState();
      const result = foldCloseAll(state, []);
      expect(result.foldRanges!.size).toBe(0);
    });
  });

  describe("foldByLevel", () => {
    test("folds only headings deeper than maxLevel", () => {
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

    test("foldByLevel 0 folds levels deeper than 0 (all headings)", () => {
      const state = makeState();
      const headingRanges = [
        { start: 0, end: 3, level: 1 },
        { start: 4, end: 7, level: 2 },
      ];
      const result = foldByLevel(state, 0, headingRanges);
      // level 1 > 0 and level 2 > 0, so both folded
      expect(result.foldRanges!.size).toBe(2);
    });

    test("foldByLevel 6 folds levels 2-6 only", () => {
      const state = makeState();
      const headingRanges = [
        { start: 0, end: 3, level: 1 },
        { start: 4, end: 7, level: 2 },
      ];
      const result = foldByLevel(state, 6, headingRanges);
      expect(result.foldRanges!.size).toBe(0);
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

    test("foldGetRanges with empty state returns empty", () => {
      const state = makeState();
      expect(foldGetRanges(state)).toEqual([]);
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

    test("last heading extends to end of file", () => {
      const singleHeading = ["# Only", "line1", "line2"];
      const ranges = findHeadingRanges((i) => singleHeading[i] ?? "", singleHeading.length);
      expect(ranges).toEqual([{ start: 0, end: 2, level: 1 }]);
    });

    test("skips non-heading lines", () => {
      const mixed = ["plain text", "## Heading", "content", "# Another"];
      const ranges = findHeadingRanges((i) => mixed[i] ?? "", mixed.length);
      expect(ranges).toEqual([
        { start: 1, end: 2, level: 2 },
        { start: 3, end: 3, level: 1 },
      ]);
    });
  });
});

// ── Key mapping resolution (G1 — mode-scoped bindings) ───────────────

describe("resolveMapping — major-mode scoping", () => {
  const makeMapping = (mode?: string, majorMode?: string): KeyMapping => ({
    key: ",b",
    command: "(test-cmd)",
    mode: mode as KeyMapping["mode"],
    majorMode,
  });

  test("prefers editor-mode + major-mode match", () => {
    const mappings = [
      makeMapping("normal"),
      makeMapping("normal", "markdown"),
    ];
    const result = resolveMapping(mappings, "normal", "markdown");
    expect(result?.majorMode).toBe("markdown");
  });

  test("falls back to editor-mode only when no major-mode match", () => {
    const mappings = [
      makeMapping("normal"),
      makeMapping("normal", "python"),
    ];
    const result = resolveMapping(mappings, "normal", "markdown");
    expect(result?.majorMode).toBeUndefined();
  });

  test("falls back to global when no mode match", () => {
    const mappings = [
      makeMapping(), // global
      makeMapping("normal", "python"),
    ];
    const result = resolveMapping(mappings, "normal", "markdown");
    expect(result?.mode).toBeUndefined();
    expect(result?.majorMode).toBeUndefined();
  });

  test("returns undefined when nothing matches", () => {
    const mappings = [
      makeMapping("insert", "markdown"),
    ];
    const result = resolveMapping(mappings, "normal", "typescript");
    expect(result).toBeUndefined();
  });

  test("no currentMajorMode skips major-mode matches", () => {
    const mappings = [
      makeMapping("normal", "markdown"),
      makeMapping("normal"),
    ];
    const result = resolveMapping(mappings, "normal");
    expect(result?.majorMode).toBeUndefined();
  });

  test("editor-mode match beats major-mode-only match", () => {
    const mappings = [
      makeMapping(undefined, "markdown"),
      makeMapping("normal"),
    ];
    const result = resolveMapping(mappings, "normal", "markdown");
    // editor-mode-only (step 2) should beat major-mode-only (step 3)
    expect(result?.mode).toBe("normal");
    expect(result?.majorMode).toBeUndefined();
  });

  test("major-mode only matches when no editor-mode-only exists", () => {
    const mappings = [
      makeMapping(undefined, "markdown"),
      makeMapping("insert"),
    ];
    const result = resolveMapping(mappings, "normal", "markdown");
    // No normal-mode-only mapping exists, so major-mode-only wins
    expect(result?.majorMode).toBe("markdown");
    expect(result?.mode).toBeUndefined();
  });
});

// ── T-Lisp command tests (integration) ───────────────────────────────
// These commands require a running T-Lisp interpreter and buffer state.
// They are tested through the daemon/integration test suite.
// The following lists what should be covered in integration tests:

// T-Lisp command tests require a running interpreter and buffer state.
// These are tested through daemon/integration tests. The following is a
// checklist of commands that need integration test coverage:
//
// - markdown-toggle-bold: wrap ** and unwrap
// - markdown-toggle-italic: wrap * and unwrap
// - markdown-toggle-strikethrough: wrap ~~ and unwrap
// - markdown-toggle-code: wrap ` and unwrap
// - markdown-next-heading / prev-heading / same-level / up-heading
// - markdown-promote-heading / demote-heading
// - markdown-align-table
// - markdown-insert-list-item / renumber-list
// - markdown-generate-toc
// - markdown-toggle-checkbox
// - markdown-do (context dispatch)

// ── Markdown tokenizer tests (migrated from markdown-fold.test.ts) ──

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
