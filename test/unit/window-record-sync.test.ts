/**
 * @file window-record-sync.test.ts
 * @description Record-sync invariant (issue #265, follows #262): every
 * model-buffer mutation must rebind the focused window record, or a focus
 * round-trip silently undoes it. Covers buffer-kill and buffer-create.
 */

import { describe, test, expect } from "bun:test";
import { createEditorFixture, type EditorFixture } from "../helpers/editor-fixture.ts";

describe("Buffer mutations survive focus round-trips (issue #265)", () => {
  test("killing the current buffer survives a focus round-trip", async () => {
    const content = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
    const fixture = await createEditorFixture({ initialContent: content, bufferName: "one" });
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute("(window-next)"); // focus bottom
      interpreter.execute('(buffer-create "two")');
      interpreter.execute('(buffer-switch "two")');
      interpreter.execute('(buffer-insert "keep")');
      interpreter.execute('(buffer-kill "two")'); // survivor: "one"
      interpreter.execute("(window-next)"); // round-trip away…
      interpreter.execute("(window-prev)"); // …and back

      // The kill must stick: the model must NOT resurrect "two".
      const name = interpreter.execute("(buffer-current)");
      expect(name._tag).toBe("Right");
      if (name._tag === "Right") {
        expect(name.right.value).toBe("one");
      }
      const buffers = interpreter.execute("(buffer-list)");
      expect(buffers._tag).toBe("Right");
      if (buffers._tag === "Right" && Array.isArray(buffers.right.value)) {
        const names = buffers.right.value.map((v: { value: unknown }) => v.value);
        expect(names).not.toContain("two");
      }
    } finally {
      fixture.dispose();
    }
  });

  test("creating a buffer survives a focus round-trip", async () => {
    const content = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
    const fixture = await createEditorFixture({ initialContent: content, bufferName: "one" });
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute("(window-next)"); // focus bottom (on "one")
      // Editor.createBuffer is the model-switching create path (the T-Lisp
      // buffer-create primitive only registers; find-file/tab-new route here).
      fixture.editor.createBuffer("three");
      interpreter.execute("(window-next)"); // round-trip away…
      interpreter.execute("(window-prev)"); // …and back

      const name = interpreter.execute("(buffer-current)");
      expect(name._tag).toBe("Right");
      if (name._tag === "Right") {
        expect(name.right.value).toBe("three");
      }
    } finally {
      fixture.dispose();
    }
  });
});
