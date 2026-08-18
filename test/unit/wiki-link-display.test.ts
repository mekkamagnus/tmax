/**
 * @file wiki-link-display.test.ts
 * @description SPEC-119 (#194): `[[wiki-link]]` reads as text, renders as a
 *   markdown link — display-only transform (buffer unchanged), toggle via the
 *   wiki-link-display minor mode, cursor column mapping, regressions (plain
 *   links, code spans, frontmatter).
 */

import { describe, test, expect } from "bun:test";
import { captureFrame } from "../../src/render/capture-frame.ts";
import { getCursorScreenOffset, renderBufferLines } from "../../src/frontend/render/buffer-lines.ts";
import { transformWikiLine } from "../../src/frontend/render/wiki-display.ts";
import { defaultDarkTheme } from "../../src/syntax/types.ts";
import { TextBufferImpl } from "../../src/core/buffer.ts";
import type { EditorState } from "../../src/core/types.ts";
import type { HighlightSpan, ANSIStyle } from "../../src/core/contracts/editor.ts";
import { Either } from "../../src/utils/task-either.ts";

function makeState(content: string, opts: { major?: string; minor?: string[] } = {}): EditorState {
  const buf = TextBufferImpl.create(content);
  return {
    currentBuffer: buf as any,
    cursorPosition: { line: 0, column: 0 },
    mode: "normal",
    statusMessage: "",
    viewportTop: 0,
    config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: false },
    commandLine: "",
    mxCommand: "",
    currentFilename: "note.md",
    currentMajorMode: opts.major ?? "markdown",
    activeMinorModes: opts.minor ?? ["wiki-link-display"],
  };
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

describe("SPEC-119: transformWikiLine (pure)", () => {
  test("[[x]] renders as x — delimiters hidden, mapping 1:1", () => {
    const t = transformWikiLine("see [[goals]] now");
    expect(t.text).toBe("see goals now");
    expect(t.changed).toBe(true);
    // raw "see " = 0..4 identity; [[ at 4..6 → 4; goals 1:1; ]] → 9
    expect(t.mapCol(0)).toBe(0);
    expect(t.mapCol(4)).toBe(4);   // on "["
    expect(t.mapCol(6)).toBe(4);   // on "g" (raw col 6 = target start)
    expect(t.mapCol(8)).toBe(6);   // 1:1 inside target
    expect(t.mapCol(12)).toBe(9);  // on "]" → end of visible
    expect(t.mapCol(13)).toBe(9);  // after the link
    expect(t.mapCol(15)).toBe(11); // "now" identity-shifted by 4
  });

  test("[[target|display]] renders the display part", () => {
    const t = transformWikiLine("[[goals|the goals note]]");
    expect(t.text).toBe("the goals note");
    expect(t.mapCol(t.text.length + 99)).toBe(t.text.length); // clamped
  });

  test("wiki span collapses onto the visible target, other spans shift", () => {
    const resolved: ANSIStyle = defaultDarkTheme["wiki-link-resolved"]!;
    const wiki: HighlightSpan = { start: 4, end: 13, style: resolved };
    const t = transformWikiLine("see [[goals]] now", [wiki]);
    expect(t.spans.length).toBe(1);
    expect(t.spans[0]!.start).toBe(4);
    expect(t.spans[0]!.end).toBe(9);
    expect(t.spans[0]!.style).toBe(resolved);
  });

  test("a [[ inside inline code renders raw (span-based AND text-scan protection)", () => {
    const code: HighlightSpan = { start: 0, end: 10, style: defaultDarkTheme.code! };
    expect(transformWikiLine("`[[code]]` x", [code]).changed).toBe(false);
    // No spans at all (the cursor-offset path): the backtick text scan protects.
    const bare = transformWikiLine("`[[code]]` x");
    expect(bare.changed).toBe(false);
    expect(bare.text).toBe("`[[code]]` x");
  });

  test("no links at all → identity, cheap path", () => {
    const t = transformWikiLine("plain text line");
    expect(t.changed).toBe(false);
    expect(t.text).toBe("plain text line");
    expect(t.mapCol(5)).toBe(5);
  });

  // SPEC-121: inline markdown links compact to their label (design
  // confirmed: file text keeps the full link; display shows text only).
  test("[text](target) renders as text — delimiters zero-width", () => {
    const t = transformWikiLine("go [goals](goals.md) now");
    expect(t.changed).toBe(true);
    expect(t.text).toBe("go goals now");
    expect(t.mapCol(3)).toBe(3);   // on "[" → span start
    expect(t.mapCol(4)).toBe(3);   // 'g' of the label → 1:1 begins
    expect(t.mapCol(8)).toBe(7);   // 's' (label end) → display 7
    expect(t.mapCol(9)).toBe(8);   // on "]" → clamps to span end (display 8)
    expect(t.mapCol(19)).toBe(8);  // ")" → still span end
    expect(t.mapCol(21)).toBe(9);  // 'n' of "now" → identity-shifted
  });

  test("blank-label []() renders raw", () => {
    expect(transformWikiLine("a [](x) b").changed).toBe(false);
  });

  test("GATE: alias cursor maps EXACTLY 1:1 over the visible display text", () => {
    // [[a|bcd]] → "bcd". Raw cols: [ [ a | b c d ] ] = 0..8.
    const t = transformWikiLine("[[a|bcd]]");
    expect(t.text).toBe("bcd");
    expect(t.mapCol(4)).toBe(0); // 'b' — was min(4-2,3)=2 (rendered over 'd')
    expect(t.mapCol(5)).toBe(1); // 'c'
    expect(t.mapCol(6)).toBe(2); // 'd'
    expect(t.mapCol(3)).toBe(0); // '|' (hidden) clamps to span start
    expect(t.mapCol(2)).toBe(0); // 'a' (hidden target) clamps to span start
    expect(t.mapCol(7)).toBe(3); // ']' clamps to span end
  });

  test("GATE: whitespace-only inner text renders raw (no zero-width link)", () => {
    const t = transformWikiLine("a [[ ]] b");
    expect(t.changed).toBe(false);
    expect(t.text).toBe("a [[ ]] b");
    const t2 = transformWikiLine("a [[x| ]] b");
    expect(t2.changed).toBe(false);
  });

  test("GATE: trimmed alias display maps over the TRIMMED region", () => {
    // [[goals| the note ]] → "the note"; leading space of the display is skipped.
    const t = transformWikiLine("[[goals| the note ]]");
    expect(t.text).toBe("the note");
    expect(t.mapCol(9)).toBe(0); // 't' of "the" (raw col 9)
    expect(t.mapCol(10)).toBe(1); // 'h'
  });

  test("multiple links on one line", () => {
    const t = transformWikiLine("[[a]] and [[b]]");
    expect(t.text).toBe("a and b");
    expect(t.mapCol(15)).toBe(7); // end of line: raw 15 ("[[a]] and [[b]]") → display 7 ("a and b")
  });
});

describe("SPEC-119: render integration (toggle on/off)", () => {
  test("ON: markdown buffer renders the target with the link face, no brackets", () => {
    const lines = captureFrame(makeState("see [[goals]] now"), 80, 24);
    const row = stripAnsi(lines[0]!);
    expect(row).toContain("see goals now");
    expect(row).not.toContain("[[");
    expect(row).not.toContain("]]");
    // the link face reaches the rendered row
    expect(lines[0]!).toContain("38;2;97;175;239"); // #61afef
  });

  test("OFF (minor mode disabled): raw brackets shown", () => {
    const lines = captureFrame(makeState("see [[goals]] now", { minor: [] }), 80, 24);
    const row = stripAnsi(lines[0]!);
    expect(row).toContain("[[goals]]");
  });

  test("non-markdown buffer: untouched even with the minor on", () => {
    const lines = captureFrame(makeState("see [[goals]] now", { major: "fundamental" }), 80, 24);
    expect(stripAnsi(lines[0]!)).toContain("[[goals]]");
  });

  test("BUFFER text unchanged — the transform is display-only", () => {
    const state = makeState("see [[goals]] now");
    renderBufferLines(state, 80, 24);
    const line = state.currentBuffer!.getLine(0);
    expect(Either.isRight(line) ? line.right : String(line)).toBe("see [[goals]] now");
  });

  test("SPEC-121: [text](url) links render compact (label only, link face)", () => {
    const lines = captureFrame(makeState("go [Anthropic](https://anthropic.com) now"), 80, 24);
    const row = stripAnsi(lines[0]!);
    expect(row).toContain("go Anthropic now"); // label only — no brackets, no url
    expect(row).not.toContain("](https://");
    // still link-faced
    expect(lines[0]!).toContain("38;2;97;175;239");
  });

  test("frontmatter renders unchanged", () => {
    const lines = captureFrame(makeState("---\ntitle: x\n---\n"), 80, 24);
    expect(stripAnsi(lines[0]!)).toContain("---");
  });

  test("GATE: markdown-mode buffer without a markdown filename renders raw (no faceless transform)", () => {
    const state = makeState("see [[goals]] now");
    state.currentFilename = "notes.txt"; // major mode markdown, wrong extension
    const lines = captureFrame(state, 80, 24);
    expect(stripAnsi(lines[0]!)).toContain("[[goals]]");
  });

  test("GATE: terminal cursor (getCursorScreenOffset) agrees with render on code-span lines", () => {
    // '`[[a]]` x' — the wiki link is inside an inline code span, so the line
    // renders RAW. The offset path must therefore NOT shift the column.
    const state = makeState("`[[a]]` x");
    state.cursorPosition = { line: 0, column: 8 }; // on 'x'
    expect(getCursorScreenOffset(state, 24, 80).col).toBe(8);
  });

  test("cursor on the line maps into display coordinates", () => {
    const state = makeState("see [[goals]] now");
    state.cursorPosition = { line: 0, column: 6 }; // raw col 6 = "g" of goals
    const off = getCursorScreenOffset(state, 24, 80);
    expect(off.col).toBe(4); // display col of "g"
    // cursor on a delimiter lands on the span edge
    state.cursorPosition = { line: 0, column: 4 }; // raw col 4 = "["
    expect(getCursorScreenOffset(state, 24, 80).col).toBe(4);
  });
});
