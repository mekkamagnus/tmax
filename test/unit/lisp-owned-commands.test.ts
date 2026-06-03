import { describe, expect, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Lisp-owned command libraries", () => {
  test("representative command libraries load and define functions", async () => {
    const editor = new Editor(new MockTerminal(), new MockFileSystem());
    await editor.start();
    const env = editor.getInterpreter().globalEnv;

    for (const name of [
      "save-buffer",
      "find-file",
      "isearch-forward",
      "query-replace",
      "indent-current-line",
      "dired",
    ]) {
      const value = env.lookup(name);
      expect(value?.type).toBe("function");
    }

    editor.stop();
  });
});
