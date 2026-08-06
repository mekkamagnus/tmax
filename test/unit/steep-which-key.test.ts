/**
 * @file steep-which-key.test.ts
 * @description Deterministic verification gate for issue #124 / BUG-24: the
 *   Steep frontend (default `tmax` launch) must paint the which-key popup
 *   overlay when `state.whichKeyActive`. This is a PURE-function test of
 *   `renderSteepFrame` (no tmux / daemon / timeout / capture-renderer
 *   substitution) — it exercises the exact render path that was broken, so it
 *   is not the daemon-capture false green that hid the bug.
 */

import { describe, test, expect } from "bun:test";
import { renderSteepFrame } from "../../src/steep/render-frame.ts";
import type { EditorState } from "../../src/core/types.ts";
import { TextBufferImpl } from "../../src/core/buffer.ts";

function makeState(overrides: Partial<EditorState> = {}): EditorState {
  const buf = TextBufferImpl.create("line one\nline two\nline three");
  return {
    currentBuffer: buf as any,
    cursorPosition: { line: 0, column: 0 },
    mode: "normal",
    statusMessage: "test",
    viewportTop: 0,
    config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: false },
    commandLine: "",
    mxCommand: "",
    currentFilename: "test.txt",
    ...overrides,
  };
}

function popup(prefixLabel: string, entries: { key: string; command: string }[]) {
  return { prefixLabel, rows: [entries], height: 1 };
}

const contains = (lines: string[], needle: string) => lines.some(l => l.includes(needle));

describe("#124 BUG-24 — Steep renders the which-key overlay (deterministic gate)", () => {
  test("ACTIVE which-key: renderSteepFrame paints the popup header + a binding (SPC)", () => {
    const state = makeState({
      whichKeyActive: true,
      whichKeyPopup: popup("SPC — leader", [{ key: ";", command: "execute-extended-command" }]),
    });
    const lines = renderSteepFrame(state, 80, 24);
    expect(contains(lines, "SPC — leader")).toBe(true);
    expect(contains(lines, "execute-extended-command")).toBe(true);
  });

  test("ACTIVE which-key: g prefix", () => {
    const state = makeState({
      whichKeyActive: true,
      whichKeyPopup: popup("g — goto", [{ key: "g", command: "vim-gg" }]),
    });
    const lines = renderSteepFrame(state, 80, 24);
    expect(contains(lines, "g — goto")).toBe(true);
    expect(contains(lines, "vim-gg")).toBe(true);
  });

  test("ACTIVE which-key: C-w prefix", () => {
    const state = makeState({
      whichKeyActive: true,
      whichKeyPopup: popup("C-w — window", [{ key: "s", command: "split-window-below" }]),
    });
    const lines = renderSteepFrame(state, 80, 24);
    expect(contains(lines, "C-w — window")).toBe(true);
    expect(contains(lines, "split-window-below")).toBe(true);
  });

  test("INACTIVE which-key: no overlay is painted", () => {
    // Same popup data, but whichKeyActive false → overlay must NOT appear.
    const state = makeState({
      whichKeyActive: false,
      whichKeyPopup: popup("SPC — leader", [{ key: ";", command: "execute-extended-command" }]),
    });
    const lines = renderSteepFrame(state, 80, 24);
    expect(contains(lines, "SPC — leader")).toBe(false);
    expect(contains(lines, "execute-extended-command")).toBe(false);
  });
});
