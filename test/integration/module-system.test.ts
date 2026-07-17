import { describe, expect, test } from "bun:test";
import { createEditorFixture } from "../helpers/editor-fixture.ts";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";

const expectRight = (result: any) => {
  expect(result._tag).toBe("Right");
  return result.right;
};

describe("Module system integration", () => {
  test("supports dependency imports and keeps private definitions isolated", () => {
    const interpreter = new TLispInterpreterImpl();

    expect(interpreter.execute(`
      (defmodule math/base
        (export inc)
        (defun inc (x) (+ x 1))
        (defun hidden () 99))
    `)._tag).toBe("Right");

    expect(interpreter.execute(`
      (defmodule math/use-base
        (export qualified aliased selective)
        (require-module math/base)
        (require-module math/base :as base)
        (require-module math/base :import (inc))
        (defun qualified () (base/inc 1))
        (defun aliased () (base/inc 2))
        (defun selective () (inc 3)))
    `)._tag).toBe("Right");

    expect(expectRight(interpreter.execute("(math/use-base/qualified)")).value).toBe(2);
    expect(expectRight(interpreter.execute("(math/use-base/aliased)")).value).toBe(3);
    expect(expectRight(interpreter.execute("(math/use-base/selective)")).value).toBe(4);
    expect(interpreter.execute("(math/base/hidden)")._tag).toBe("Left");
  });

  test("editor startup loads core modules and exposes public commands to discovery", async () => {
    const fixture = await createEditorFixture();
    try {
      const editor = fixture.editor;
      editor.createBuffer("scratch", "abc\n");

      const interpreter = editor.getInterpreter();

      expect(expectRight(interpreter.execute('(module-loaded? "editor/commands/vim-dispatch")')).value).toBe(true);

      const describe = expectRight(interpreter.execute('(describe-function "vim-reset-pending")'));
      const describeValues = describe.value as Array<{ value: unknown }>;
      expect(describeValues[1]?.value).toContain("from module editor/commands/vim-dispatch");

      const apropos = expectRight(interpreter.execute('(apropos-command "vim-reset")'));
      const names = (apropos.value as Array<{ value: Array<{ value: unknown }> }>).map((row) => row.value[0]?.value);
      expect(names).toContain("vim-reset-pending");

      await editor.handleKey(" ");
      await editor.handleKey(";");
      expect(editor.getState().mode).toBe("mx");
      expect(editor.getState().minibufferView?.rows.length).toBeGreaterThan(0);
    } finally {
      fixture.dispose();
    }
  });
});
