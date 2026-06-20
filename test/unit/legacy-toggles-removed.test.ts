import { describe, expect, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";

describe("SPEC-004: legacy TS toggle functions removed", () => {
  test("toggle-line-numbers is no longer a registered primitive", async () => {
    const editor = new Editor(new MockTerminal(), new MockFileSystem());
    await editor.start();
    const interpreter = editor.getInterpreter();

    // The old TS toggle should not exist — minor modes replace it
    const result = interpreter.execute("(toggle-line-numbers)");
    expect(result._tag).toBe("Left");
  });

  test("toggle-relative-line-numbers is no longer a registered primitive", async () => {
    const editor = new Editor(new MockTerminal(), new MockFileSystem());
    await editor.start();
    const interpreter = editor.getInterpreter();

    const result = interpreter.execute("(toggle-relative-line-numbers)");
    expect(result._tag).toBe("Left");
  });

  test("line-numbers-mode minor mode works as replacement", async () => {
    const editor = new Editor(new MockTerminal(), new MockFileSystem());
    await editor.start();
    const interpreter = editor.getInterpreter();

    // The minor mode should be available
    const result = interpreter.execute('(minor-mode-active-p "line-numbers")');
    expect(result._tag).toBe("Right");
  });
});
