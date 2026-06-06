import { describe, expect, test } from "bun:test";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

describe("Lisp-owned buffer completion", () => {
  test("C-x b opens a generic annotated completion view", async () => {
    const editor = await createStartedEditor();
    editor.createBuffer("alpha", "one");
    editor.createBuffer("*Messages*", "messages");

    await editor.handleKey("\x18");
    await editor.handleKey("b");

    const state = editor.getEditorState();
    expect(state.mode).toBe("mx");
    expect(state.minibufferView?.prompt).toBe("Switch to buffer: ");
    expect(state.minibufferView?.rows.some(row =>
      row.segments.some(segment => segment.text.includes("*Messages*"))
    )).toBe(true);
  });

  test("filters, switches to an existing buffer, and creates raw input", async () => {
    const editor = await createStartedEditor();
    editor.createBuffer("alpha", "one");
    editor.createBuffer("beta", "two");

    await editor.handleKey("\x18");
    await editor.handleKey("b");
    for (const key of "alpha") await editor.handleKey(key);
    await editor.handleKey("Enter");

    expect(executeTlisp(editor, "(buffer-current)").value).toBe("alpha");

    await editor.handleKey("\x18");
    await editor.handleKey("b");
    for (const key of "brand-new") await editor.handleKey(key);
    await editor.handleKey("Enter");

    expect(executeTlisp(editor, "(buffer-current)").value).toBe("brand-new");
    expect(editor.getState().buffers?.has("brand-new")).toBe(true);
  });

  test("cancel preserves the active buffer and annotations use factual modified state", async () => {
    const editor = await createStartedEditor();
    editor.createBuffer("alpha", "one");
    executeTlisp(editor, '(buffer-insert " changed")');

    await editor.handleKey("\x18");
    await editor.handleKey("b");
    expect(editor.getState().minibufferView?.rows.some(row =>
      row.segments.some(segment => segment.text.includes("+"))
    )).toBe(true);
    await editor.handleKey("Escape");

    expect(executeTlisp(editor, "(buffer-current)").value).toBe("alpha");
    expect(editor.getBufferDetails().find(buffer => buffer.name === "alpha")?.modified).toBe(true);
  });

  test("immutable edits preserve the current buffer file association", async () => {
    const editor = await createStartedEditor();
    editor.createBuffer("/tmp/notes.txt", "notes");
    editor.setEditorState({
      ...editor.getState(),
      currentFilename: "/tmp/notes.txt",
    });

    executeTlisp(editor, '(buffer-insert " changed")');

    expect(editor.getState().currentFilename).toBe("/tmp/notes.txt");
    expect(editor.getBufferDetails().find(buffer => buffer.current)?.filename).toBe("/tmp/notes.txt");
  });
});
