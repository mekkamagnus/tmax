import { describe, expect, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("buffer-local major modes", () => {
  test("two buffers can keep different major modes", async () => {
    const fs = new MockFileSystem();
    const editor = new Editor(new MockTerminal(), fs);
    await editor.start();

    editor.createBuffer("a.py", "");
    editor.setEditorState({
      ...editor.getEditorState(),
      currentFilename: "a.py",
    });
    editor.activateMajorModeForFile("a.py");
    expect(editor.getCurrentMajorMode()).toBe("python");

    editor.createBuffer("b.ts", "");
    editor.setEditorState({
      ...editor.getEditorState(),
      currentFilename: "b.ts",
    });
    editor.activateMajorModeForFile("b.ts");
    expect(editor.getCurrentMajorMode()).toBe("typescript");

    editor.setEditorState({
      ...editor.getEditorState(),
      currentFilename: "a.py",
    });
    expect(editor.getCurrentMajorMode()).toBe("python");

    editor.stop();
  });
});
