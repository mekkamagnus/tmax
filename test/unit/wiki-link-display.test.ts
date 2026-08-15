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

  test("a [[ inside an inline code span renders raw", () => {
    const code = { start: 0, end: 10, style: defaultDarkTheme.code! };
    const t = transformWikiLine("`[[code]]` x", [code]);
    expect(t.changed).toBe(false);
    expect(t.text).toBe("`[[code]]` x");
  });

  test("no wiki links → identity, cheap path", () => {
    const t = transformWikiLine("plain [text](url) line");
    expect(t.changed).toBe(false);
    expect(t.text).toBe("plain [text](url) line");
    expect(t.mapCol(5)).toBe(5);
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

  test("plain [text](url) links render unchanged", () => {
    const lines = captureFrame(makeState("go [Anthropic](https://anthropic.com) now"), 80, 24);
    const row = stripAnsi(lines[0]!);
    expect(row).toContain("[Anthropic](https://anthropic.com)");
  });

  test("frontmatter renders unchanged", () => {
    const lines = captureFrame(makeState("---\ntitle: x\n---\n"), 80, 24);
    expect(stripAnsi(lines[0]!)).toContain("---");
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
