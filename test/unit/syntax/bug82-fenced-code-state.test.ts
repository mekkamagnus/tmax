import { describe, expect, test } from "bun:test";
import { computeHighlightSpans } from "../../../src/syntax/highlight-buffer.ts";
import { transformWikiLine } from "../../../src/frontend/render/wiki-display.ts";
import type { HighlightSpan } from "../../../src/core/contracts/editor.ts";

// #196 / BUG-82 — fenced code blocks must produce code-block spans. The old
// `state ?? undefined` plumbing could never bootstrap the tokenizer's stateful
// path (line 1 had no state → stateless branch → state never assigned), so
// fence interiors got no code-block spans and SPEC-119's wiki-link display
// transform leaked into fences.

const CODE_BLOCK_FG = "#abb2bf"; // theme "code-block" entry (types.ts)

function spansForLines(lines: string[], filename = "test.md", startLine = 0): HighlightSpan[][] {
  return computeHighlightSpans(
    (i) => lines[i] ?? "",
    startLine,
    lines.length,
    filename,
  );
}

describe("#196 (BUG-82): fenced code blocks produce code-block spans", () => {
  test("fence interior lines get full-line code-block spans", () => {
    const lines = [
      "before",
      "```",
      "const x = [[not-a-link]];",
      "```",
      "after",
    ];
    const spans = spansForLines(lines);
    const interior = spans[2] ?? [];
    expect(interior.length).toBeGreaterThan(0);
    for (const span of interior) {
      expect(span.style.fg).toBe(CODE_BLOCK_FG);
      expect(span.style.dim).toBe(true);
    }
    // The opening/closing delimiters are code-delimiter spans (muted), not
    // code-block — and lines outside the fence are unaffected.
    const outside = spans[0] ?? [];
    expect(outside.every((s) => s.style.fg !== CODE_BLOCK_FG)).toBe(true);
  });

  test("viewport window below the fence still sees fence state (warm-up)", () => {
    // The render path tokenizes viewport windows, not whole buffers: a fence
    // opened ABOVE the window must still apply to the window's lines.
    const lines = [
      "```",
      "line one in fence",
      "line two in fence",
      "```",
      "prose",
    ];
    const spans = spansForLines(lines, "test.md", 3); // window = [3, 5)
    // Line 3 is the closing delimiter, line 4 is prose again.
    expect((spans[3] ?? []).every((s) => s.style.fg !== CODE_BLOCK_FG)).toBe(true);
    expect((spans[4] ?? []).every((s) => s.style.fg !== CODE_BLOCK_FG)).toBe(true);

    const midFence = spansForLines(lines, "test.md", 2); // window = [2, 5)
    const interior = midFence[2] ?? [];
    expect(interior.length).toBeGreaterThan(0);
    expect(interior[0]!.style.fg).toBe(CODE_BLOCK_FG);
  });

  test("tildes fence delimiter is honored", () => {
    const lines = ["~~~", "fenced with tildes", "~~~"];
    const spans = spansForLines(lines);
    expect((spans[1] ?? [])[0]?.style.fg).toBe(CODE_BLOCK_FG);
  });

  test("SPEC-119 wiki transform skips fenced [[wiki-links]] (brackets intact)", () => {
    const lines = ["```", "[[goals]] tail", "```"];
    const spans = spansForLines(lines);
    const transformed = transformWikiLine(lines[1]!, spans[1]);
    // Not transformed: text keeps its brackets, no column mapping happened.
    expect(transformed.changed).toBe(false);
    expect(transformed.text).toBe("[[goals]] tail");
  });

  test("SPEC-119 wiki transform still applies outside fences", () => {
    const lines = ["```", "in fence", "```", "[[goals]] tail"];
    const spans = spansForLines(lines);
    const transformed = transformWikiLine(lines[3]!, spans[3]);
    expect(transformed.changed).toBe(true);
    expect(transformed.text).not.toContain("[[");
  });

  // NOTE (observed, out of scope): the state bootstrap fix enables ALL
  // ParseState transitions, but c-style block comments STILL produce no spans
  // for an unclosed `/*` opener — the TS rule set emits no token for the bare
  // opener, so cStyleTransitions.checkBlockComment never fires. That is a
  // language-rule gap (separate from BUG-82's bootstrap bug), recorded in the
  // spec resolution.
});
