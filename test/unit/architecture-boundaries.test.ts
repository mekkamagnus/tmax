import { describe, expect, test } from "bun:test";
import {
  createStartedEditor,
  executeTlisp,
} from "../helpers/editor-fixture.ts";

const LISP_OWNED_COMMANDS = [
  "vim-dispatch-key",
  "vim-count-consume",
  "vim-begin-operator",
  "vim-operator-apply",
  "vim-begin-prefix",
  "vim-dispatch-prefix-key",
  "vim-delete-char",
  "insert-newline",
  "insert-backspace",
  "insert-tab",
  "split-window-below",
  "split-window-right",
  "other-window",
  "delete-window",
  "relative-line-numbers-mode",
] as const;

describe("T-Lisp architecture boundaries", () => {
  test("loads the complete Vim and daily-driver command inventory", async () => {
    const editor = await createStartedEditor();
    const env = editor.getInterpreter().globalEnv;

    for (const name of LISP_OWNED_COMMANDS) {
      expect(env.lookup(name)?.type, name).toBe("function");
    }
  });

  test("executes window, tab, and relative-line-number policy through T-Lisp", async () => {
    const editor = await createStartedEditor("one\ntwo\nthree");

    executeTlisp(editor, "(split-window-below)");
    expect(editor.getState().windows).toHaveLength(2);

    executeTlisp(editor, '(tab-new "second")');
    expect(editor.getState().tabs).toHaveLength(1);

    executeTlisp(editor, "(relative-line-numbers-mode 1)");
    expect(editor.getState().activeMinorModes).toContain("relative-line-numbers");
  });

  test("keeps TypeScript mode handlers free of Vim, window, and tab policy", async () => {
    const normal = await Bun.file("src/editor/handlers/normal-handler.ts").text();
    const insert = await Bun.file("src/editor/handlers/insert-handler.ts").text();
    const forbiddenNormalPolicy = [
      "pendingNormalOperator",
      "countPrefix",
      "split-window",
      "window-next",
      "tab-next",
      "tab-prev",
      "relative-line-numbers-mode",
    ];

    expect(normal).toContain("vim-dispatch-key");
    for (const token of forbiddenNormalPolicy) {
      expect(normal, token).not.toContain(token);
    }
    expect(insert).toContain("(insert-newline)");
    expect(insert).toContain("(insert-backspace)");
    expect(insert).toContain("(insert-tab)");
  });
});
