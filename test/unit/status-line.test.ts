import { describe, expect, test } from "bun:test";
import { renderStatusLine } from "../../src/frontend/render/status-line.ts";
import { stripAnsi } from "../../src/steep/matcha.ts";
import type { EditorState } from "../../src/core/types.ts";

function makeState(overrides: Partial<EditorState> = {}): EditorState {
  return {
    cursorPosition: { line: 0, column: 0 },
    mode: "normal",
    statusMessage: "",
    viewportTop: 0,
    viewportLeft: 0,
    config: {
      theme: 'default',
      tabSize: 4,
      autoSave: false,
      keyBindings: {},
      maxUndoLevels: 100,
      showLineNumbers: true,
      relativeLineNumbers: false,
      wordWrap: false,
    },
    ...overrides,
  } as EditorState;
}

describe("SPEC-003: status line minor-mode lighters", () => {
  test("renders major mode without lighters when none active", () => {
    const state = makeState({ mode: "normal", currentMajorMode: "python" });
    const line = renderStatusLine(state, 80);
    const plain = stripAnsi(line);

    expect(plain).toContain("[python]");
    // No lighter parenthesized text
    expect(plain).not.toMatch(/\([A-Za-z]+\)/);
  });

  test("renders minor-mode lighters when active", () => {
    const state = makeState({
      mode: "normal",
      currentMajorMode: "python",
      activeMinorModeLighters: ["Ln", "Fill"],
    });
    const line = renderStatusLine(state, 80);
    const plain = stripAnsi(line);

    expect(plain).toContain("[python]");
    expect(plain).toContain("(Ln");
    expect(plain).toContain("Fill)");
  });

  test("renders a single minor-mode lighter", () => {
    const state = makeState({
      mode: "insert",
      currentMajorMode: "fundamental",
      activeMinorModeLighters: ["WK"],
    });
    const line = renderStatusLine(state, 80);
    const plain = stripAnsi(line);

    expect(plain).toContain("[fundamental]");
    expect(plain).toContain("(WK)");
  });

  test("renders no lighter section when lighters array is empty", () => {
    const state = makeState({
      mode: "normal",
      currentMajorMode: "lisp",
      activeMinorModeLighters: [],
    });
    const line = renderStatusLine(state, 80);
    const plain = stripAnsi(line);

    expect(plain).toContain("[lisp]");
    expect(plain).not.toContain("()");
  });

  test("renders no lighter section when lighters is undefined", () => {
    const state = makeState({
      mode: "normal",
      currentMajorMode: "markdown",
    });
    const line = renderStatusLine(state, 80);
    const plain = stripAnsi(line);

    expect(plain).toContain("[markdown]");
    expect(plain).not.toContain("()");
  });
});
