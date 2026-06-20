import { describe, expect, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";

const rightValue = (result: any) => {
  expect(result._tag).toBe("Right");
  return result.right;
};

describe("T-Lisp module system", () => {
  test("does not copy module exports into the global environment", () => {
    const interpreter = new TLispInterpreterImpl();

    expect(interpreter.execute('(defmodule a/one (export run) (defun run () "one"))')._tag).toBe("Right");
    expect(interpreter.execute('(defmodule b/two (export run) (defun run () "two"))')._tag).toBe("Right");

    expect(interpreter.execute("(run)")._tag).toBe("Left");
    expect(rightValue(interpreter.execute("(a/one/run)"))).toEqual({ type: "string", value: "one" });
    expect(rightValue(interpreter.execute("(b/two/run)"))).toEqual({ type: "string", value: "two" });
  });

  test("supports qualified, aliased, and selective imports with private exports hidden", () => {
    const interpreter = new TLispInterpreterImpl();

    expect(interpreter.execute(`
      (defmodule math/tools
        (export value inc)
        (defvar value 41)
        (defun inc (x) (+ x 1))
        (defun hidden () 0))
    `)._tag).toBe("Right");

    expect(rightValue(interpreter.execute("(progn (require-module math/tools) (tools/inc tools/value))"))).toEqual({ type: "number", value: 42 });
    expect(rightValue(interpreter.execute("(progn (require-module math/tools :as mt) (mt/inc 4))"))).toEqual({ type: "number", value: 5 });
    expect(rightValue(interpreter.execute("(progn (require-module math/tools :import (inc)) (inc 9))"))).toEqual({ type: "number", value: 10 });
    expect(interpreter.execute("(math/tools/hidden)")._tag).toBe("Left");
  });

  test("current-module reports the defining module during module evaluation", () => {
    const interpreter = new TLispInterpreterImpl();

    expect(interpreter.execute(`
      (defmodule meta/current
        (export here)
        (defun here () (current-module)))
    `)._tag).toBe("Right");

    expect(rightValue(interpreter.execute("(current-module)"))).toEqual({ type: "nil", value: null });
    expect(rightValue(interpreter.execute("(meta/current/here)"))).toEqual({ type: "string", value: "meta/current" });
  });

  test("module-lookup only exposes exported symbols", () => {
    const editor = new Editor(new MockTerminal(), new MockFileSystem());
    const interpreter = editor.getInterpreter();

    expect(interpreter.execute(`
      (defmodule lookup/privacy
        (export public)
        (defun public () "public")
        (defun private () "private"))
    `)._tag).toBe("Right");

    expect(rightValue(interpreter.execute('(module-lookup "lookup/privacy" "public")')).type).toBe("function");
    expect(interpreter.execute('(module-lookup "lookup/privacy" "private")')._tag).toBe("Left");
  });

  test("editor runtime supports truthful provide/featurep/require (SPEC-003/007)", () => {
    const editor = new Editor(new MockTerminal(), new MockFileSystem());
    const interpreter = editor.getInterpreter();

    // featurep returns nil before provide
    expect(interpreter.execute('(featurep "x")')._tag).toBe("Right");
    // provide registers the feature
    expect(interpreter.execute('(provide "x")')._tag).toBe("Right");
    // featurep returns t after provide
    const after = interpreter.execute('(featurep "x")');
    expect(after._tag).toBe("Right");
    if (after._tag === "Right") expect(after.right.value).toBe(true);
    // require succeeds for provided feature
    expect(interpreter.execute('(require "x")')._tag).toBe("Right");
    // require fails for unprovided feature
    expect(interpreter.execute('(require "y")')._tag).toBe("Left");
  });

  test("editor command metadata includes module origins", async () => {
    const editor = new Editor(new MockTerminal(), new MockFileSystem());
    editor.createBuffer("scratch", "abc\n");
    await editor.start();

    const result = editor.getInterpreter().execute('(describe-function "vim-reset-pending")');

    expect(result._tag).toBe("Right");
    if (result._tag === "Left") return;
    const values = result.right.value as Array<{ type: string; value: unknown }>;
    expect(values[1]?.value).toContain("from module editor/commands/vim-dispatch");
  });

  test("plain plugins are isolated even when they define the same name", async () => {
    const filesystem = new MockFileSystem();
    const editor = new Editor(new MockTerminal(), filesystem);
    await editor.start();

    filesystem.setDirectory("/test/tlpa");
    filesystem.setDirectory("/test/tlpa/one");
    filesystem.setFile("/test/tlpa/one/plugin.tlisp", '(defun plugin-init () "one")');
    filesystem.setDirectory("/test/tlpa/two");
    filesystem.setFile("/test/tlpa/two/plugin.tlisp", '(defun plugin-init () "two")');

    const loaded = await editor.loadPluginsFromDirectory("/test/tlpa");

    expect(loaded.loaded).toEqual(["one", "two"]);
    expect(editor.getInterpreter().execute("(plugin-init)")._tag).toBe("Left");
    expect(rightValue(editor.getInterpreter().execute("(user/plugin/one/plugin-init)"))).toEqual({ type: "string", value: "one" });
    expect(rightValue(editor.getInterpreter().execute("(user/plugin/two/plugin-init)"))).toEqual({ type: "string", value: "two" });
  });
});
