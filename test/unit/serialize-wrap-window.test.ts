/**
 * @file serialize-wrap-window.test.ts
 * @description Wrap-expansion wire window (2026-11-20 live catch): with
 *   wordWrap on, one logical line can occupy multiple screen rows — the
 *   serialized window must cover the WRAPPED height, or the client renders
 *   blank tails on large buffers (small buffers fit and masked it).
 */
import { describe, test, expect } from "bun:test";
import { editorStateToJson } from "../../src/server/serialize.ts";
import { TextBufferImpl } from "../../src/core/buffer.ts";
import type { EditorState } from "../../src/core/types.ts";

describe("wrap-aware serialization", () => {
  test("wrap on + wide lines: window exceeds the row count", () => {
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) lines.push("word ".repeat(30)); // ~150 chars/line → 2+ rows at 100 cols
    const buf = TextBufferImpl.create(lines.join("\n"));
    const state = {
      currentBuffer: buf as any,
      cursorPosition: { line: 59, column: 0 },
      mode: "normal",
      statusMessage: "",
      viewportTop: 40,
      config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: true, relativeLineNumbers: false, wordWrap: true },
      commandLine: "",
      mxCommand: "",
      currentFilename: "chat",
    } as unknown as EditorState;
    const json = editorStateToJson(state, 24, 100);
    // The window's WRAPPED height must cover the screen: every line at
    // ~150 chars wraps to 2 rows at the ~88-col content width.
    const cw = 88;
    const wrapped = json.visibleLines.reduce(
      (acc, l) => acc + Math.max(1, Math.ceil([...l].length / cw)), 0);
    expect(wrapped).toBeGreaterThanOrEqual(24);
    expect(json.visibleLines.every((l) => typeof l === "string")).toBe(true);
  });

  test("wrap off: window stays at the row count", () => {
    const buf = TextBufferImpl.create(Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n"));
    const state = {
      currentBuffer: buf as any,
      cursorPosition: { line: 59, column: 0 },
      mode: "normal", statusMessage: "", viewportTop: 40,
      config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: true, relativeLineNumbers: false, wordWrap: false },
      commandLine: "", mxCommand: "", currentFilename: "chat",
    } as unknown as EditorState;
    expect(editorStateToJson(state, 24, 100).visibleLines.length).toBe(24);
  });
});
