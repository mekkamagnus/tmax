import { describe, expect, test } from "bun:test";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import type { EditorState } from "../../src/core/types.ts";
import {
  editorStateToJson,
  jsonToEditorState,
} from "../../src/server/serialize.ts";

const content = (buffer: EditorState["currentBuffer"]): string => {
  const result = buffer?.getContent();
  return result?._tag === "Right" ? result.right : "";
};

describe("daemon render-state serialization", () => {
  test("preserves window and tab state needed by remote renderers", () => {
    const main = FunctionalTextBufferImpl.create("main");
    const split = FunctionalTextBufferImpl.create("split");
    const tab = FunctionalTextBufferImpl.create("tab");
    const state = {
      currentBuffer: main,
      cursorPosition: { line: 0, column: 0 },
      mode: "normal",
      statusMessage: "",
      viewportTop: 0,
      commandLine: "",
      mxCommand: "",
      config: {
        theme: "default",
        tabSize: 4,
        autoSave: false,
        keyBindings: {},
        maxUndoLevels: 100,
        showLineNumbers: true,
        relativeLineNumbers: false,
        wordWrap: false,
      },
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

    const roundTrip = jsonToEditorState(editorStateToJson(state));

    expect(roundTrip.windows).toHaveLength(2);
    expect(content(roundTrip.windows?.[1]?.buffer)).toBe("split");
    expect(roundTrip.currentWindowIndex).toBe(1);
    expect(roundTrip.tabs).toHaveLength(2);
    expect(content(roundTrip.tabs?.[1]?.buffer)).toBe("tab");
    expect(roundTrip.currentTabIndex).toBe(1);
  });

  test("round-trips viewportLeft through serialization", () => {
    const main = FunctionalTextBufferImpl.create("hello");
    const state = {
      currentBuffer: main,
      cursorPosition: { line: 0, column: 0 },
      mode: "normal",
      statusMessage: "",
      viewportTop: 5,
      viewportLeft: 40,
      commandLine: "",
      mxCommand: "",
      config: {
        theme: "default",
        tabSize: 4,
        autoSave: false,
        keyBindings: {},
        maxUndoLevels: 100,
        showLineNumbers: true,
        relativeLineNumbers: false,
        wordWrap: false,
      },
      windows: [],
      currentWindowIndex: 0,
      tabs: [],
      currentTabIndex: 0,
    } satisfies EditorState;

    const roundTrip = jsonToEditorState(editorStateToJson(state));

    expect(roundTrip.viewportTop).toBe(5);
    expect(roundTrip.viewportLeft).toBe(40);
  });
});
