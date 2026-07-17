import { describe, expect, test } from "bun:test";
import { createEditorFixture } from "../helpers/editor-fixture.ts";
import { Editor } from "../../src/editor/editor.ts";
import { Either } from "../../src/utils/task-either.ts";

const evaluateNumber = (editor: Editor, source: string): number => {
  const result = editor.getInterpreter().execute(source);
  if (Either.isLeft(result)) throw new Error(result.left.message);
  return result.right.value as number;
};

describe("T-Lisp Vertico and Marginalia", () => {
  test("publishes at most ten annotated rows and scrolls selection", async () => {
    const fixture = await createEditorFixture();
    try {
      const editor = fixture.editor;
      for (let index = 0; index < 14; index++) {
        editor.createBuffer(`buffer-${index}`, "content");
      }

      // SPEC-067: switch-buffer is driven via its command directly (the "C-x b"
      // key was freed so "C-x" can mean vim decrement-number; switch-buffer
      // remains reachable via "SPC x b" and M-x). Matches buffer-completion.test.ts.
      const open = editor.getInterpreter().execute("(switch-buffer)");
      if (Either.isLeft(open)) throw new Error(open.left.message);

      const initial = editor.getState().minibufferView;
      expect(initial?.rows.length).toBe(10);
      expect(initial?.rows.some(row =>
        row.segments.some(segment => segment.text.includes("fundamental"))
      )).toBe(true);

      for (let index = 0; index < 11; index++) await editor.handleKey("Down");
      expect(evaluateNumber(editor, '(hashmap-get (minibuffer-state-get) "scroll")')).toBeGreaterThan(0);
      expect(editor.getState().minibufferView?.message).toMatch(/\d+\/\d+/);
    } finally {
      fixture.dispose();
    }
  });
});
