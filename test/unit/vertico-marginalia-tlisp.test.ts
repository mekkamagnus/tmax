import { describe, expect, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { Either } from "../../src/utils/task-either.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";

const evaluateNumber = (editor: Editor, source: string): number => {
  const result = editor.getInterpreter().execute(source);
  if (Either.isLeft(result)) throw new Error(result.left.message);
  return result.right.value as number;
};

describe("T-Lisp Vertico and Marginalia", () => {
  test("publishes at most ten annotated rows and scrolls selection", async () => {
    const editor = new Editor(new MockTerminal(), new MockFileSystem());
    await editor.start();
    for (let index = 0; index < 14; index++) {
      editor.createBuffer(`buffer-${index}`, "content");
    }

    await editor.handleKey("\x18");
    await editor.handleKey("b");

    const initial = editor.getState().minibufferView;
    expect(initial?.rows.length).toBe(10);
    expect(initial?.rows.some(row =>
      row.segments.some(segment => segment.text.includes("fundamental"))
    )).toBe(true);

    for (let index = 0; index < 11; index++) await editor.handleKey("Down");
    expect(evaluateNumber(editor, '(hashmap-get (minibuffer-state-get) "scroll")')).toBeGreaterThan(0);
    expect(editor.getState().minibufferView?.message).toMatch(/\d+\/\d+/);
  });
});
