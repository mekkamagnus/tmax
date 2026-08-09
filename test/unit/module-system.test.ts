import { describe, expect, test } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { createEditorFixture } from "../helpers/editor-fixture.ts";

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

  // BUG-63 regression guard: defun names containing `--` (and `---`) export and
  // resolve identically to single-`-` names on every resolution path. The
  // original report (a `--` defun left "Undefined" after require-module) was a
  // source typo — the export list named a different symbol than the defun. The
  // interpreter is correct; this test pins it so it cannot silently regress.
  test("exports and resolves defun names containing -- and --- (BUG-63)", async () => {
    const interpreter = new TLispInterpreterImpl();

    expect(interpreter.execute(`
      (defmodule dd/names
        (export single-dash double--dash triple---dash)
        (defun single-dash (x) (+ x 1))
        (defun double--dash (x) (+ x 2))
        (defun triple---dash (x) (+ x 3)))
    `)._tag).toBe("Right");

    // qualified resolution — single, double, and triple dash all export + resolve
    expect(rightValue(interpreter.execute("(dd/names/single-dash 10)"))).toEqual({ type: "number", value: 11 });
    expect(rightValue(interpreter.execute("(dd/names/double--dash 10)"))).toEqual({ type: "number", value: 12 });
    expect(rightValue(interpreter.execute("(dd/names/triple---dash 10)"))).toEqual({ type: "number", value: 13 });

    // aliased (:as) resolution of a -- name
    expect(rightValue(interpreter.execute("(progn (require-module dd/names :as dn) (dn/double--dash 10))"))).toEqual({ type: "number", value: 12 });

    // selective import of a -- name
    expect(rightValue(interpreter.execute("(progn (require-module dd/names :import (double--dash)) (double--dash 10))"))).toEqual({ type: "number", value: 12 });

    // unqualified unique-export resolution of a -- name
    expect(rightValue(interpreter.execute("(progn (require-module dd/names) (double--dash 10))"))).toEqual({ type: "number", value: 12 });

    // async executeAsync path (defun/defmodule/require-module are sync-only
    // special forms; the async evaluator delegates to the same handlers — pin
    // a -- name resolves there too so the path cannot silently regress).
    expect(rightValue(await interpreter.executeAsync("(progn (require-module dd/names) (double--dash 10))"))).toEqual({ type: "number", value: 12 });
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

  test("module-lookup only exposes exported symbols", async () => {
    const fixture = await createEditorFixture({ start: false });
    try {
      const editor = fixture.editor;
      const interpreter = editor.getInterpreter();

      expect(interpreter.execute(`
        (defmodule lookup/privacy
          (export public)
          (defun public () "public")
          (defun private () "private"))
      `)._tag).toBe("Right");

      expect(rightValue(interpreter.execute('(module-lookup "lookup/privacy" "public")')).type).toBe("function");
      expect(interpreter.execute('(module-lookup "lookup/privacy" "private")')._tag).toBe("Left");
    } finally {
      fixture.dispose();
    }
  });

  test("editor runtime supports truthful provide/featurep/require (SPEC-003/007)", async () => {
    const fixture = await createEditorFixture({ start: false });
    try {
      const editor = fixture.editor;
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
    } finally {
      fixture.dispose();
    }
  });

  test("editor command metadata includes module origins", async () => {
    const fixture = await createEditorFixture({ start: false });
    try {
      const editor = fixture.editor;
      editor.createBuffer("scratch", "abc\n");
      await editor.start();

      // #177 renamed the array-returning TS primitive `describe-function` →
      // `describe-function-info` (the bare name now renders to *Help*). This
      // test inspects the raw module-origin metadata, so it uses the info form.
      const result = editor.getInterpreter().execute('(describe-function-info "vim-reset-pending")');

      expect(result._tag).toBe("Right");
      if (result._tag === "Left") return;
      const values = result.right.value as Array<{ type: string; value: unknown }>;
      expect(values[1]?.value).toContain("from module editor/commands/vim-dispatch");
    } finally {
      fixture.dispose();
    }
  });

  test("plain plugins are isolated even when they define the same name", async () => {
    const filesystem = new MockFileSystem();
    const fixture = await createEditorFixture({ filesystem, start: false });
    try {
      const editor = fixture.editor;
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
    } finally {
      fixture.dispose();
    }
  });
});
