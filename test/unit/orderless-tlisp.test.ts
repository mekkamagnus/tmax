import { describe, expect, test } from "bun:test";
import { createEditorFixture } from "../helpers/editor-fixture.ts";
import { Editor } from "../../src/editor/editor.ts";
import { Either } from "../../src/utils/task-either.ts";

const execute = (editor: Editor, source: string) => {
  const result = editor.getInterpreter().execute(source);
  if (Either.isLeft(result)) throw new Error(result.left.message);
  return result.right;
};

const matchedValues = (editor: Editor, input: string): string[] => {
  const result = execute(editor, `
    (editor/completion/orderless/orderless-filter "${input}"
      (list
        (hashmap "value" "buffer-save" "display" "buffer-save" "annotation" "Save the buffer")
        (hashmap "value" "*Messages*" "display" "*Messages*" "annotation" "Messages special")))
  `);
  return (result.value as Array<{ value: Map<string, { value: unknown }> }>).map(candidate =>
    candidate.value.get("value")?.value as string
  );
};

describe("T-Lisp Orderless", () => {
  test("matches all components in any order and preserves source order", async () => {
    const fixture = await createEditorFixture();
    try {
      const editor = fixture.editor;
      const result = editor.getInterpreter().execute(`
        (editor/completion/orderless/orderless-filter "save buf"
          (list
            (hashmap "value" "buffer-save" "display" "buffer-save" "annotation" "")
            (hashmap "value" "save-buffer" "display" "save-buffer" "annotation" "")
            (hashmap "value" "buffer-kill" "display" "buffer-kill" "annotation" "")))
      `);
      if (Either.isLeft(result)) throw new Error(result.left.message);

      expect((result.right.value as Array<{ value: Map<string, { value: unknown }> }>).map(candidate =>
        candidate.value.get("value")?.value
      )).toEqual(["buffer-save", "save-buffer"]);
    } finally {
      fixture.dispose();
    }
  });

  test("supports smart case and the required affix dispatch styles", async () => {
    const fixture = await createEditorFixture();
    try {
      const editor = fixture.editor;

      expect(matchedValues(editor, "=buffer-save")).toContain("buffer-save");
      expect(matchedValues(editor, "^buffer")).toContain("buffer-save");
      expect(matchedValues(editor, "~bs")).toContain("buffer-save");
      expect(matchedValues(editor, ",bs")).toContain("buffer-save");
      expect(matchedValues(editor, "!Messages")).toEqual(["buffer-save"]);
      expect(matchedValues(editor, "&special")).toEqual(["*Messages*"]);
      expect(matchedValues(editor, "BUFFER")).toEqual([]);
      expect(matchedValues(editor, "[")).toEqual([]);
    } finally {
      fixture.dispose();
    }
  });

  test("publishes display and annotation highlight spans from T-Lisp", async () => {
    const fixture = await createEditorFixture();
    try {
      const editor = fixture.editor;

      const display = execute(editor, `
        (car (editor/completion/orderless/orderless-filter "save"
          (list (hashmap "value" "buffer-save" "display" "buffer-save" "annotation" "Save buffer"))))
      `);
      const annotation = execute(editor, `
        (car (editor/completion/orderless/orderless-filter "&Save"
          (list (hashmap "value" "buffer-save" "display" "buffer-save" "annotation" "Save buffer"))))
      `);
      const displayMap = display.value as Map<string, { value: unknown }>;
      const annotationMap = annotation.value as Map<string, { value: unknown }>;

      expect((displayMap.get("spans")?.value as unknown[]).length).toBeGreaterThan(0);
      expect((annotationMap.get("annotation-spans")?.value as unknown[]).length).toBeGreaterThan(0);
    } finally {
      fixture.dispose();
    }
  });
});
