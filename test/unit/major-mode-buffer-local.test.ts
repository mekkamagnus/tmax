import { describe, expect, test } from "bun:test";
import { createEditorFixture } from "../helpers/editor-fixture.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("buffer-local major modes", () => {
  test("two buffers can keep different major modes", async () => {
    const fs = new MockFileSystem();
    const fixture = await createEditorFixture({ filesystem: fs });
    try {
      const editor = fixture.editor;

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
    } finally {
      fixture.dispose();
    }
  });
});
