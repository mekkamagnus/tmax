/** project-commands.test.ts — #164 Task 9 */
import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor } from "../helpers/editor-fixture.ts";

function run(editor: Editor, expr: string): any {
  return editor.getInterpreter().execute(expr) as any;
}

describe("#164 Task 9 — project-mode commands", () => {
  test("project-root-set + project-root works", async () => {
    const editor = await createStartedEditor("");
    run(editor, '(project-root-set "/tmp/myproject")');
    const root = run(editor, "(project-root)");
    expect(root?._tag).toBe("Right");
    expect(root?.right?.value).toBe("/tmp/myproject");
  });

  test("project-status works after root set", async () => {
    const editor = await createStartedEditor("");
    run(editor, '(project-root-set "/tmp/test-project")');
    const result = run(editor, "(project-status)");
    expect(result?._tag).toBe("Right");
  });

  test("project-find-file with root set doesn't crash", async () => {
    const editor = await createStartedEditor("");
    run(editor, '(project-root-set "/tmp")');
    // Will try completing-read which may return nil — just verify no crash
    const result = run(editor, "(project-find-file)");
    expect(result?._tag).toBeDefined();
  });

  test("project-dired with root set doesn't crash", async () => {
    const editor = await createStartedEditor("");
    run(editor, '(project-root-set "/tmp")');
    const result = run(editor, "(project-dired)");
    expect(result?._tag).toBeDefined();
  });
});
