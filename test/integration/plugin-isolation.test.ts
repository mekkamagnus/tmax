import { describe, expect, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";

const expectRight = (result: any) => {
  expect(result._tag).toBe("Right");
  return result.right;
};

describe("Plugin isolation integration", () => {
  test("plain plugins are wrapped into plugin modules and do not collide globally", async () => {
    const filesystem = new MockFileSystem();
    const editor = new Editor(new MockTerminal(), filesystem);
    await editor.start();

    filesystem.setDirectory("/test/tlpa");
    filesystem.setDirectory("/test/tlpa/alpha");
    filesystem.setFile("/test/tlpa/alpha/plugin.tlisp", '(defun plugin-init () "alpha")');
    filesystem.setDirectory("/test/tlpa/beta");
    filesystem.setFile("/test/tlpa/beta/plugin.tlisp", '(defun plugin-init () "beta")');

    const loaded = await editor.loadPluginsFromDirectory("/test/tlpa");

    expect(loaded.loaded).toEqual(["alpha", "beta"]);
    expect(editor.getInterpreter().execute("(plugin-init)")._tag).toBe("Left");
    expect(expectRight(editor.getInterpreter().execute("(user/plugin/alpha/plugin-init)")).value).toBe("alpha");
    expect(expectRight(editor.getInterpreter().execute("(user/plugin/beta/plugin-init)")).value).toBe("beta");
  });

  test("explicit plugin modules load as declared and keep private helpers hidden", async () => {
    const filesystem = new MockFileSystem();
    const editor = new Editor(new MockTerminal(), filesystem);
    await editor.start();

    filesystem.setDirectory("/test/tlpa");
    filesystem.setDirectory("/test/tlpa/gamma");
    filesystem.setFile("/test/tlpa/gamma/plugin.tlisp", `
      (defmodule user/plugin/gamma
        (export plugin-init)
        (defun plugin-init () (plugin-hidden))
        (defun plugin-hidden () "gamma"))
    `);

    const loaded = await editor.loadPluginsFromDirectory("/test/tlpa");

    expect(loaded.loaded).toEqual(["gamma"]);
    expect(expectRight(editor.getInterpreter().execute("(user/plugin/gamma/plugin-init)")).value).toBe("gamma");
    expect(editor.getInterpreter().execute("(user/plugin/gamma/plugin-hidden)")._tag).toBe("Left");
  });
});
