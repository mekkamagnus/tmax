import { describe, expect, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { Either } from "../../src/utils/task-either.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";

const evaluate = (editor: Editor, source: string) => {
  const result = editor.getInterpreter().execute(source);
  if (Either.isLeft(result)) throw new Error(result.left.message);
  return result.right;
};

describe("T-Lisp completion framework", () => {
  test("dispatches named tables, predicates, metadata, and replaceable styles", async () => {
    const editor = new Editor(new MockTerminal(), new MockFileSystem());
    await editor.start();

    const result = evaluate(editor, `
      (progn
        (defun spec-table (input action)
          (if (string= action "metadata")
            (hashmap "category" "spec")
            (list
              (hashmap "value" "alpha" "display" "alpha" "annotation" "")
              (hashmap "value" "beta" "display" "beta" "annotation" ""))))
        (defun spec-predicate (candidate)
          (string= (hashmap-get candidate "value") "beta"))
        (editor/completion/completion-all-completions "bet" "spec-table" "spec-predicate"))
    `);

    const candidates = result.value as Array<{ value: Map<string, { value: unknown }> }>;
    expect(candidates.map(candidate => candidate.value.get("value")?.value)).toEqual(["beta"]);
    expect(evaluate(editor, '(editor/completion/completion-metadata-get (editor/completion/completion-table-dispatch "spec-table" "" "metadata") "category")').value)
      .toBe("spec");
  });

  test("stores a serializable semantic session and restores mode/focus on cancel", async () => {
    const editor = new Editor(new MockTerminal(), new MockFileSystem());
    await editor.start();

    evaluate(editor, `
      (progn
        (defun spec-read-table (input action)
          (if (string= action "metadata")
            (hashmap "category" "spec")
            (list (hashmap "value" "alpha" "display" "alpha" "annotation" ""))))
        (defun spec-accept (value) value)
        (editor/completion/minibuffer/completing-read "Spec: " "spec-read-table" nil nil "" "spec-history" "spec-accept"))
    `);

    const active = editor.getState();
    expect(active.mode).toBe("mx");
    expect(active.minibufferState).toBeDefined();
    expect(() => JSON.stringify(active.minibufferState)).not.toThrow();

    evaluate(editor, '(editor/completion/minibuffer/minibuffer-dispatch-key "Escape")');
    expect(editor.getState().mode).toBe("normal");
    expect(editor.getState().cursorFocus).toBe("buffer");
  });
});
