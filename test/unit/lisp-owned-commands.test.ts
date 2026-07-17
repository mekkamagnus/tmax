import { describe, expect, test } from "bun:test";
import { createEditorFixture } from "../helpers/editor-fixture.ts";

describe("Lisp-owned command libraries", () => {
  test("representative command libraries load and define functions", async () => {
    const fixture = await createEditorFixture();
    try {
      const editor = fixture.editor;
      const registry = editor.getInterpreter().moduleRegistry;

      for (const name of [
        "save-buffer",
        "find-file",
        "isearch-forward",
        "query-replace",
        "indent-current-line",
        "dired",
        "vim-operator-apply",
        "split-window-below",
        "split-window-right",
        "other-window",
        "delete-window",
        "relative-line-numbers-mode",
        "completing-read",
        "orderless-filter",
        "marginalia-annotate-candidate",
        "vertico-publish",
        "switch-buffer",
        "execute-extended-command",
      ]) {
        const resolved = registry.resolveUniqueExport(name);
        expect(typeof resolved, name).toBe("object");
        expect((resolved as { value?: { type?: string } }).value?.type).toBe("function");
      }
    } finally {
      fixture.dispose();
    }
  });

  test("TypeScript minibuffer handler only routes normalized keys to T-Lisp", async () => {
    const handler = await Bun.file("src/editor/handlers/mx-handler.ts").text();

    expect(handler).toContain("minibuffer-dispatch-key");
    expect(handler).not.toContain("getFuzzyCompletions");
    expect(handler).not.toContain("getAvailableCommands");
    expect(handler).not.toContain("bestMatch");
    expect(handler).not.toContain("state.mxCommand +=");
  });
});
