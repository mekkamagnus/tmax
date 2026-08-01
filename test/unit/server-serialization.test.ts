import { describe, expect, test } from "bun:test";
import { TextBufferImpl } from "../../src/core/buffer.ts";
import type { EditorState } from "../../src/core/types.ts";
import {
  editorStateToJson,
  jsonToEditorState,
  DEFAULT_RENDER_HEIGHT,
} from "../../src/server/serialize.ts";

const content = (buffer: EditorState["currentBuffer"]): string => {
  const result = buffer?.getContent();
  return result?._tag === "Right" ? result.right : "";
};

const baseConfig = {
  theme: "default",
  tabSize: 4,
  autoSave: false,
  keyBindings: {},
  maxUndoLevels: 100,
  showLineNumbers: true,
  relativeLineNumbers: false,
  wordWrap: false,
};

describe("daemon render-state serialization", () => {
  test("preserves window and tab metadata needed by remote renderers", () => {
    const main = TextBufferImpl.create("main");
    const split = TextBufferImpl.create("split");
    const tab = TextBufferImpl.create("tab");
    const state = {
      currentBuffer: main,
      cursorPosition: { line: 0, column: 0 },
      mode: "normal",
      statusMessage: "",
      viewportTop: 0,
      commandLine: "",
      mxCommand: "",
      config: baseConfig,
      windows: [
        { id: "one", buffer: main, cursorLine: 0, cursorColumn: 0, viewportTop: 0, viewportLeft: 0 },
        { id: "two", buffer: split, cursorLine: 0, cursorColumn: 0, viewportTop: 0, viewportLeft: 0, splitType: "horizontal" },
      ],
      currentWindowIndex: 1,
      tabs: [
        { id: "tab-one", label: "one", buffer: main },
        { id: "tab-two", label: "two", buffer: tab },
      ],
      currentTabIndex: 1,
    } satisfies EditorState;

    const json = editorStateToJson(state);
    const roundTrip = jsonToEditorState(json);

    expect(roundTrip.windows).toHaveLength(2);
    // Window buffer text is NOT on the wire (issue #46) — metadata only.
    expect(roundTrip.windows?.[1]?.id).toBe("two");
    expect(roundTrip.windows?.[1]?.splitType).toBe("horizontal");
    expect(roundTrip.currentWindowIndex).toBe(1);
    expect(roundTrip.tabs).toHaveLength(2);
    expect(roundTrip.tabs?.[1]?.label).toBe("two");
    expect(roundTrip.currentTabIndex).toBe(1);
    // bufferContent must never appear on the wire.
    expect("bufferContent" in json).toBe(false);
  });

  test("round-trips viewportLeft through serialization", () => {
    const main = TextBufferImpl.create("hello");
    const state = {
      currentBuffer: main,
      cursorPosition: { line: 0, column: 0 },
      mode: "normal",
      statusMessage: "",
      viewportTop: 5,
      viewportLeft: 40,
      commandLine: "",
      mxCommand: "",
      config: baseConfig,
      windows: [],
      currentWindowIndex: 0,
      tabs: [],
      currentTabIndex: 0,
    } satisfies EditorState;

    const roundTrip = jsonToEditorState(editorStateToJson(state));

    expect(roundTrip.viewportTop).toBe(5);
    expect(roundTrip.viewportLeft).toBe(40);
  });

  test("serializes only the viewport rows, not the full buffer (issue #46)", () => {
    const big = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const buffer = TextBufferImpl.create(big);
    const state = {
      currentBuffer: buffer,
      cursorPosition: { line: 100, column: 0 },
      mode: "normal",
      statusMessage: "",
      viewportTop: 100,
      commandLine: "",
      mxCommand: "",
      config: baseConfig,
      windows: [],
      currentWindowIndex: 0,
      tabs: [],
      currentTabIndex: 0,
    } satisfies EditorState;

    const json = editorStateToJson(state, 5);

    // Only the 5 viewport rows are on the wire — not 500.
    expect(json.visibleLines).toHaveLength(5);
    expect(json.visibleLines[0]).toBe("line 100");
    expect(json.visibleLines[4]).toBe("line 104");
    expect(json.totalLines).toBe(500);
    expect(typeof json.bufferRevision).toBe("number");

    // Out-of-range lines the renderer asks for come back as "".
    const roundTrip = jsonToEditorState(json);
    expect(content(roundTrip.currentBuffer)).toBe("line 100\nline 101\nline 102\nline 103\nline 104");
    const line = roundTrip.currentBuffer!.getLine(0);
    expect(line?._tag === "Right" && line.right).toBe("");
    const farLine = roundTrip.currentBuffer!.getLine(400);
    expect(farLine?._tag === "Right" && farLine.right).toBe("");
    const inView = roundTrip.currentBuffer!.getLine(102);
    expect(inView?._tag === "Right" && inView.right).toBe("line 102");
    const count = roundTrip.currentBuffer!.getLineCount();
    expect(count?._tag === "Right" && count.right).toBe(500);
  });

  test("deserialized buffer is read-only — edits refuse and return Left (issue #46)", () => {
    const buffer = TextBufferImpl.create("hello\nworld");
    const state = {
      currentBuffer: buffer,
      cursorPosition: { line: 0, column: 0 },
      mode: "normal",
      statusMessage: "",
      viewportTop: 0,
      commandLine: "",
      mxCommand: "",
      config: baseConfig,
      windows: [],
      currentWindowIndex: 0,
      tabs: [],
      currentTabIndex: 0,
    } satisfies EditorState;

    const roundTrip = jsonToEditorState(editorStateToJson(state));
    const ins = roundTrip.currentBuffer!.insert({ line: 0, column: 0 }, "x");
    expect(ins?._tag).toBe("Left");
  });

  test("default render height embeds DEFAULT_RENDER_HEIGHT rows", () => {
    const buffer = TextBufferImpl.create(Array.from({ length: 100 }, (_, i) => `l${i}`).join("\n"));
    const state = {
      currentBuffer: buffer,
      cursorPosition: { line: 0, column: 0 },
      mode: "normal",
      statusMessage: "",
      viewportTop: 0,
      commandLine: "",
      mxCommand: "",
      config: baseConfig,
      windows: [],
      currentWindowIndex: 0,
      tabs: [],
      currentTabIndex: 0,
    } satisfies EditorState;

    expect(editorStateToJson(state).visibleLines).toHaveLength(DEFAULT_RENDER_HEIGHT);
  });
});
