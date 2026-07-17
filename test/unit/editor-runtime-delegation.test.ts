/**
 * @file editor-runtime-delegation.test.ts
 * @description CHORE-44 Change 3 — proves the extracted runtime collaborators
 * are unit-testable with fake dependencies (AC3.2) and that `Editor` delegates
 * to them (AC3.4). Currently covers `LoggingRuntime` (the first collaborator);
 * additional collaborators are added as Changes 3's other extractions land.
 */

import { describe, test, expect } from "bun:test";
import { LoggingRuntime } from "../../src/editor/runtime/logging-runtime.ts";
import { PluginRuntime } from "../../src/editor/runtime/plugin-runtime.ts";
import { createStartedEditor, bufferText, expectRight } from "../helpers/editor-fixture.ts";

describe("CHORE-44 Change 3 — LoggingRuntime collaborator", () => {
  test("is unit-testable with fake deps: logMessage renders into the *Messages* buffer via the callback", () => {
    const set: Record<string, string> = {};
    const meta: Record<string, { modified: boolean }> = {};
    const rt = new LoggingRuntime({
      setBuffer: (name, text) => { set[name] = text; },
      updateBufferMetadata: (name, m) => { meta[name] = m; },
    });

    rt.logMessage("hello world", "info");

    // The log→buffer formatting lives in the collaborator (AC3.4): Editor would
    // only pass the rendered text through setBuffer.
    expect(set["*Messages*"]).toContain("hello world");
    expect(meta["*Messages*"]).toEqual({ modified: false });
  });

  test("logDaemonEvent renders the *daemon* buffer; logProgram renders its category buffer + mirrors failures", () => {
    const set: Record<string, string> = {};
    const rt = new LoggingRuntime({ setBuffer: (n, t) => { set[n] = t; }, updateBufferMetadata: () => {} });
    rt.logDaemonEvent("client-connected", "id1");
    expect(set["*daemon*"]).toContain("client-connected");
    rt.logProgram("shell", { level: "error", text: "boom" });
    expect(set["*Shell Output*"]).toContain("boom");
    // Mirrored failure surfaces in *Messages*.
    expect(set["*Messages*"]).toContain("boom");
  });

  test("Editor.logMessage delegates to the collaborator (end-to-end via a started editor)", async () => {
    const editor = await createStartedEditor();
    editor.logMessage("delegated-msg", "info");
    // The *Messages* virtual buffer reflects the delegated render.
    editor.createBuffer("test", "x"); // ensure a current buffer for bufferText
    const messages = editor.getState().buffers?.get("*Messages*");
    expect(messages).toBeDefined();
    const content = messages!.getContent();
    expect(expectRight(content)).toContain("delegated-msg");
    editor.stop();
    void bufferText;
  });
});
describe("CHORE-44 Change 3 — PluginRuntime collaborator", () => {
  test("plugin file parsing is pure and lives in the collaborator (AC3.4)", () => {
    const rt = new PluginRuntime();
    expect(rt.pluginModuleName("My Cool Plugin!")).toBe("user/plugin/My-Cool-Plugin");
    expect(rt.pluginModuleName("   ")).toBe("user/plugin/plugin");
    expect(rt.pluginHasDefmodule("(defmodule foo (export) ...)")).toBe(true);
    expect(rt.pluginHasDefmodule("(defun x) 5)")).toBe(false);
    expect(rt.collectPluginExports("(defun a)\n(defvar b)\n(defmacro c)\n(defun a)")).toEqual(["a", "b", "c"]);
    // A module-less plugin is wrapped in an isolated defmodule with its exports.
    const wrapped = rt.wrapPluginModule("demo", "(defun greet)\n(defun wave)");
    expect(wrapped.startsWith("(defmodule user/plugin/demo")).toBe(true);
    expect(wrapped).toContain("(export greet wave)");
    // A plugin that already declares a module is left untouched.
    const selfModule = "(defmodule user/plugin/self (export) (defun x))";
    expect(rt.wrapPluginModule("self", selfModule)).toBe(selfModule);
  });
});
