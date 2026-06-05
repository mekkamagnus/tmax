import { beforeEach, describe, expect, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";

describe("Lisp-owned generic minibuffer input", () => {
  let editor: Editor;

  beforeEach(async () => {
    editor = new Editor(new MockTerminal(), new MockFileSystem());
    await editor.start();
  });

  const openMx = async () => {
    await editor.handleKey(" ");
    await editor.handleKey(";");
  };

  test("SPC ; opens M-x with a vertical generic view", async () => {
    await openMx();

    const state = editor.getState();
    expect(state.mode).toBe("mx");
    expect(state.minibufferView?.prompt).toBe("M-x ");
    expect(state.minibufferView?.rows.length).toBeGreaterThan(1);
  });

  test("printable input and Backspace update the Lisp session and compatibility input", async () => {
    await openMx();
    for (const key of "buffer") await editor.handleKey(key);
    await editor.handleKey("Backspace");

    const state = editor.getState();
    expect(state.mxCommand).toBe("buffe");
    expect(state.minibufferView?.input).toBe("buffe");
  });

  test("ambiguous matches remain visible and Tab inserts the selected candidate", async () => {
    await openMx();
    for (const key of "buffer") await editor.handleKey(key);

    const before = editor.getState();
    expect(before.minibufferView?.rows.length).toBeGreaterThan(1);

    const selected = before.minibufferView?.rows.find(row => row.selected)
      ?.segments.filter(segment => segment.face !== "annotation")
      .map(segment => segment.text).join("").trim() ?? "";
    await editor.handleKey("Tab");

    expect(editor.getState().mxCommand).toBe(selected);
  });

  test("no match is reported in the generic view instead of statusMessage", async () => {
    await openMx();
    for (const key of "zzzzzzzz") await editor.handleKey(key);

    expect(editor.getState().minibufferView?.message).toBe("No match");
  });

  test("C-n, C-p, Down, and Up navigate without TypeScript selection policy", async () => {
    await openMx();
    const first = editor.getState().minibufferView?.rows.findIndex(row => row.selected);

    await editor.handleKey("\x0e");
    const second = editor.getState().minibufferView?.rows.findIndex(row => row.selected);
    await editor.handleKey("Up");
    const back = editor.getState().minibufferView?.rows.findIndex(row => row.selected);

    expect(second).not.toBe(first);
    expect(back).toBe(first);
  });

  test("Escape and C-g cancel and clear the generic view", async () => {
    await openMx();
    await editor.handleKey("b");
    await editor.handleKey("Escape");

    expect(editor.getState().mode).toBe("normal");
    expect(editor.getState().mxCommand).toBe("");
    expect(editor.getState().minibufferView).toBeUndefined();

    await openMx();
    await editor.handleKey("\x07");
    expect(editor.getState().mode).toBe("normal");
  });

  test("M-p and M-n navigate T-Lisp-owned command history", async () => {
    const interpreter = editor.getInterpreter();
    interpreter.execute('(minibuffer-history-add "editor-mode")');
    interpreter.execute('(minibuffer-history-add "save-buffer")');

    await openMx();
    await editor.handleKey("\x1bp");
    expect(editor.getState().mxCommand).toBe("save-buffer");
    await editor.handleKey("\x1bp");
    expect(editor.getState().mxCommand).toBe("editor-mode");
    await editor.handleKey("\x1bn");
    expect(editor.getState().mxCommand).toBe("save-buffer");
  });
});
