import { describe, test, expect } from "bun:test";
import { createStartedEditor } from "../helpers/editor-fixture.ts";

describe("#164 shell integration — (shell) callable from interpreter", () => {
  test("(shell) creates a terminal and returns its ID", async () => {
    const editor = await createStartedEditor("");
    const result = editor.getInterpreter().execute("(shell)") as any;
    expect(result?._tag).toBe("Right");
    const id = result?.right?.value;
    expect(typeof id).toBe("string");
    expect(id).toMatch(/^term-/);
  });

  test("(shell-list) returns the terminal after creation", async () => {
    const editor = await createStartedEditor("");
    editor.getInterpreter().execute("(shell)");
    const result = editor.getInterpreter().execute("(shell-list)") as any;
    expect(result?._tag).toBe("Right");
    expect(result?.right?.type).toBe("list");
    expect(result?.right?.value?.length).toBe(1);
  });

  test("(shell-alive-p) returns true for running terminal", async () => {
    const editor = await createStartedEditor("");
    const shellResult = editor.getInterpreter().execute("(shell)") as any;
    const id = shellResult?.right?.value;
    const result = editor.getInterpreter().execute(`(shell-alive-p "${id}")`) as any;
    expect(result?._tag).toBe("Right");
    expect(result?.right?.value).toBe(true);
  });
});
