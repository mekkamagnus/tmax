import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createEditorFixture, type EditorFixture } from "../helpers/editor-fixture.ts";

const EDITOR_INTERACTION_TIMEOUT_MS = 15000;

describe("Lisp-owned generic minibuffer input", () => {
  let fixture: EditorFixture;

  beforeEach(async () => {
    fixture = await createEditorFixture();
  });

  afterEach(() => {
    fixture?.dispose();
  });

  const openMx = async () => {
    await fixture.editor.handleKey(" ");
    await fixture.editor.handleKey(";");
  };

  test("SPC ; opens M-x with a vertical generic view", async () => {
    await openMx();

    const state = fixture.editor.getState();
    expect(state.mode).toBe("mx");
    expect(state.minibufferView?.prompt).toBe("M-x ");
    expect(state.minibufferView?.rows.length).toBeGreaterThan(1);
  }, EDITOR_INTERACTION_TIMEOUT_MS);

  test("printable input and Backspace update the Lisp session and compatibility input", async () => {
    await openMx();
    for (const key of "buffer") await fixture.editor.handleKey(key);
    await fixture.editor.handleKey("Backspace");

    const state = fixture.editor.getState();
    expect(state.mxCommand).toBe("buffe");
    expect(state.minibufferView?.input).toBe("buffe");
  }, EDITOR_INTERACTION_TIMEOUT_MS);

  test("ambiguous matches remain visible and Tab inserts the selected candidate", async () => {
    await openMx();
    for (const key of "buffer") await fixture.editor.handleKey(key);

    const before = fixture.editor.getState();
    expect(before.minibufferView?.rows.length).toBeGreaterThan(1);

    const selected = before.minibufferView?.rows.find(row => row.selected)
      ?.segments.filter(segment => segment.face !== "annotation")
      .map(segment => segment.text).join("").trim() ?? "";
    await fixture.editor.handleKey("Tab");

    expect(fixture.editor.getState().mxCommand).toBe(selected);
  }, EDITOR_INTERACTION_TIMEOUT_MS);

  test("no match is reported in the generic view instead of statusMessage", async () => {
    await openMx();
    for (const key of "zzzzzzzz") await fixture.editor.handleKey(key);

    expect(fixture.editor.getState().minibufferView?.message).toBe("No match");
  }, EDITOR_INTERACTION_TIMEOUT_MS);

  test("C-n, C-p, Down, and Up navigate without TypeScript selection policy", async () => {
    await openMx();
    const first = fixture.editor.getState().minibufferView?.rows.findIndex(row => row.selected);

    await fixture.editor.handleKey("\x0e");
    const second = fixture.editor.getState().minibufferView?.rows.findIndex(row => row.selected);
    await fixture.editor.handleKey("Up");
    const back = fixture.editor.getState().minibufferView?.rows.findIndex(row => row.selected);

    expect(second).not.toBe(first);
    expect(back).toBe(first);
  }, EDITOR_INTERACTION_TIMEOUT_MS);

  test("Escape and C-g cancel and clear the generic view", async () => {
    await openMx();
    await fixture.editor.handleKey("b");
    await fixture.editor.handleKey("Escape");

    expect(fixture.editor.getState().mode).toBe("normal");
    expect(fixture.editor.getState().mxCommand).toBe("");
    expect(fixture.editor.getState().minibufferView).toBeUndefined();

    await openMx();
    await fixture.editor.handleKey("\x07");
    expect(fixture.editor.getState().mode).toBe("normal");
  }, EDITOR_INTERACTION_TIMEOUT_MS);

  test("M-p and M-n navigate T-Lisp-owned command history", async () => {
    const interpreter = fixture.editor.getInterpreter();
    interpreter.execute('(editor/completion/minibuffer/minibuffer-history-add "editor-mode")');
    interpreter.execute('(editor/completion/minibuffer/minibuffer-history-add "save-buffer")');

    await openMx();
    await fixture.editor.handleKey("\x1bp");
    expect(fixture.editor.getState().mxCommand).toBe("save-buffer");
    await fixture.editor.handleKey("\x1bp");
    expect(fixture.editor.getState().mxCommand).toBe("editor-mode");
    await fixture.editor.handleKey("\x1bn");
    expect(fixture.editor.getState().mxCommand).toBe("save-buffer");
  }, EDITOR_INTERACTION_TIMEOUT_MS);
});
