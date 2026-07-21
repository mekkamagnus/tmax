/**
 * @file editor-runtime-delegation.test.ts
 * @description CHORE-44 Change 3 — proves the extracted runtime collaborators
 * are unit-testable with fake dependencies (AC3.2) and that `Editor` delegates
 * to them (AC3.4). Covers LoggingRuntime, PluginRuntime, BindingRuntime
 * (low-level + policy), and CommandRuntime (AC3.6), plus static assertions
 * that `Editor` no longer owns the extracted algorithms (AC3.7).
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LoggingRuntime } from "../../src/editor/runtime/logging-runtime.ts";
import { PluginRuntime } from "../../src/editor/runtime/plugin-runtime.ts";
import { WorkspaceRuntime } from "../../src/editor/runtime/workspace-runtime.ts";
import { BindingRuntime } from "../../src/editor/runtime/binding-runtime.ts";
import { CommandRuntime } from "../../src/editor/runtime/command-runtime.ts";
import { Either } from "../../src/utils/task-either.ts";
import { createValidationError } from "../../src/error/types.ts";
import type { AppError, EvalError } from "../../src/error/types.ts";
import type { Cmd, Msg, EditorRuntime } from "../../src/editor/functional/index.ts";
import type { TLispValue } from "../../src/tlisp/types.ts";
import { createNil } from "../../src/tlisp/values.ts";
import { TextBufferImpl } from "../../src/core/buffer.ts";
import { bindMacros, createMacroState } from "../../src/editor/api/macro-recording.ts";
import { createStartedEditor, bufferText, expectRight } from "../helpers/editor-fixture.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import type { BindingEvaluator } from "../../src/editor/runtime/binding-runtime.ts";
import type { FileSystem } from "../../src/core/contracts/filesystem.ts";
import type { WorkspaceState } from "../../src/core/contracts/workspace.ts";

describe("CHORE-44 Change 3 — WorkspaceRuntime collaborator", () => {
  test("serializes editor-owned state while excluding *Messages* and preserving mode metadata", () => {
    const runtime = new WorkspaceRuntime();
    const main = TextBufferImpl.create("main text");
    const messages = TextBufferImpl.create("log text");
    const workspace = runtime.serializeWorkspace({
      buffers: new Map([["main", main], ["*Messages*", messages]]),
      bufferMetadata: new Map([["main", { filename: "/tmp/main.ts", modified: true, recency: 1 }]]),
      bufferModeStates: new Map([["/tmp/main.ts", {
        majorMode: "typescript",
        activeMinorModes: ["line-numbers"],
        minorModeActivationOrder: ["line-numbers"],
        minorModeSources: { "line-numbers": "local" },
        localMinorModeOverrides: {},
        minorModeSavedConfig: {},
      }]]),
      minorModeRegistry: new Map([["line-numbers", {
        name: "line-numbers", description: "lines", lighter: " LN", global: false,
        initValue: false, activateHook: "", deactivateHook: "",
      }]]),
      model: { currentBuffer: main, cursorPosition: { line: 3, column: 4 }, viewportTop: 2 },
      currentBufferName: "main",
      currentMajorMode: "typescript",
      activeMinorModes: ["line-numbers"],
    });

    expect(workspace.buffers.has("*Messages*")).toBe(false);
    expect(workspace.buffers.has("*scratch*")).toBe(true);
    expect(workspace.bufferMetadata.get("main")).toMatchObject({
      filename: "/tmp/main.ts", modified: true, cursorLine: 3, cursorColumn: 4,
    });
    expect(workspace.bufferModeStates.get("main")).toEqual({
      majorMode: "typescript", minorModes: ["line-numbers"], lighters: [" LN"],
    });
  });

  test("reconcile deep-copies buffers and rebuilds isolated metadata/mode maps", () => {
    const source = TextBufferImpl.create("source");
    const incoming: WorkspaceState = {
      metadata: { id: "w", name: "w", createdAt: "now", lastAccessed: "now", formatVersion: 1 },
      buffers: new Map([["main", source]]),
      bufferMetadata: new Map([["main", { name: "main", modified: true, cursorLine: 1, cursorColumn: 2 }]]),
      bufferModeStates: new Map([["main", { majorMode: "typescript", minorModes: ["numbers"] }]]),
      windows: [], tabs: [], cursorState: { line: 0, column: 0 }, viewportState: { top: 0 },
    };

    const reconciled = new WorkspaceRuntime().reconcileWorkspace(incoming, 10, "messages");
    expect(reconciled.buffers.get("main")).not.toBe(source);
    expect(expectRight(reconciled.buffers.get("main")!.getContent())).toBe("source");
    expect(expectRight(reconciled.buffers.get("*Messages*")!.getContent())).toBe("messages");
    source.insert({ line: 0, column: 6 }, " changed");
    expect(expectRight(reconciled.buffers.get("main")!.getContent())).toBe("source");
    expect(reconciled.bufferMetadata.get("main")?.recency).toBe(10);
    expect(reconciled.bufferMetadata.get("*Messages*")?.recency).toBe(11);
    expect(reconciled.bufferModeStates.get("main")).toMatchObject({
      majorMode: "typescript", activeMinorModes: ["numbers"], minorModeSources: { numbers: "local" },
    });
    expect(reconciled.nextRecency).toBe(12);
  });
});

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

  test("discovers plugin directories and reports loaded, skipped, and evaluator failures through fakes", async () => {
    const fs = new MockFileSystem();
    fs.setDirectory("/plugins");
    fs.setDirectory("/plugins/good");
    fs.setDirectory("/plugins/bad");
    fs.setDirectory("/plugins/empty");
    fs.setFile("/plugins/good/plugin.tlisp", "(defun hello () 1)");
    fs.setFile("/plugins/bad/plugin.tlisp", "(defun broken () 1)");
    const evaluated: string[] = [];
    const result = await new PluginRuntime().loadPluginsFromDirectory("/plugins", fs, (code) => {
      evaluated.push(code);
      return code.includes("user/plugin/bad")
        ? Either.left<EvalError, TLispValue>({ type: "EvalError", variant: "RuntimeError", message: "bad plugin" })
        : Either.right<TLispValue, EvalError>(createNil());
    });

    expect(result.total).toBe(3);
    expect(result.loaded).toEqual(["good"]);
    expect(result.skipped).toEqual(["empty"]);
    expect(result.errors).toEqual([{ plugin: "bad", error: "bad plugin" }]);
    expect(evaluated[0]).toContain("(defmodule user/plugin/good");
  });

  test("reports a missing plugin directory without evaluating code", async () => {
    let evaluations = 0;
    const result = await new PluginRuntime().loadPluginsFromDirectory("/missing", new MockFileSystem(), () => {
      evaluations++;
      return Either.right<TLispValue, EvalError>(createNil());
    });
    expect(result.loaded).toEqual([]);
    expect(result.errors).toEqual([{ plugin: "directory", error: "Plugin directory does not exist: /missing" }]);
    expect(evaluations).toBe(0);
  });

  test("saves and reloads per-editor macros through the injected filesystem", async () => {
    const previousHome = process.env.HOME;
    process.env.HOME = "/plugin-runtime-test";
    try {
      const fs = new MockFileSystem();
      const source = bindMacros(createMacroState());
      expect(Either.isRight(source.set("a", ["i", "x", "Escape"]))).toBe(true);
      const runtime = new PluginRuntime();
      expect(await runtime.saveMacros(fs, source)).toBe(true);

      const target = bindMacros(createMacroState());
      expect(await runtime.loadMacros(fs, target)).toBe(true);
      const loaded = target.get("a");
      expect(Either.isRight(loaded)).toBe(true);
      if (Either.isRight(loaded)) expect(loaded.right).toEqual(["i", "x", "Escape"]);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });
});

// ── CommandRuntime (AC3.6) ───────────────────────────────────────────
describe("CHORE-44 Change 3 — CommandRuntime collaborator", () => {
  /** Build a CommandRuntime wired to fake deps + a recording commitMsg spy. */
  function makeRuntime(getRuntime: () => EditorRuntime): { runtime: CommandRuntime; committed: Msg[] } {
    const committed: Msg[] = [];
    const runtime = new CommandRuntime({
      getRuntime,
      commitMsg: (m) => { committed.push(m); },
    });
    return { runtime, committed };
  }

  test("classifyCommand: Left → failed outcome carrying the AppError", () => {
    const { runtime } = makeRuntime(() => ({} as EditorRuntime));
    const err = createValidationError("ConstraintViolation", "boom");
    const outcome = runtime.classifyCommand(Either.left<AppError, readonly Msg[]>(err));
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.error).toBe(err);
  });

  test("classifyCommand: Right with OpenFileSucceeded → succeeded with content", () => {
    const { runtime } = makeRuntime(() => ({} as EditorRuntime));
    const msgs: Msg[] = [{ type: "OpenFileSucceeded", commandId: "c1", filename: "f", content: "hello" }];
    const outcome = runtime.classifyCommand(Either.right<readonly Msg[], AppError>(msgs));
    expect(outcome.status).toBe("succeeded");
    if (outcome.status === "succeeded") expect(outcome.content).toBe("hello");
  });

  test("classifyCommand: Right with EvalTlispSucceeded → succeeded with result", () => {
    const { runtime } = makeRuntime(() => ({} as EditorRuntime));
    const result: TLispValue = { type: "number", value: 42 } as unknown as TLispValue;
    const msgs: Msg[] = [{ type: "EvalTlispSucceeded", commandId: "c2", result }];
    const outcome = runtime.classifyCommand(Either.right<readonly Msg[], AppError>(msgs));
    expect(outcome.status).toBe("succeeded");
    if (outcome.status === "succeeded" && outcome.result) {
      expect((outcome.result as { value: number }).value).toBe(42);
    }
  });

  test("trackCommand settles the waiter after the matching Cmd drains (runCmd path)", async () => {
    let getRuntimeCalls = 0;
    const fakeRuntime: EditorRuntime = {
      evalTlisp: () => Either.left<AppError, TLispValue>(createValidationError("ConstraintViolation", "x")),
      evalTlispAsync: async () => Either.left<AppError, TLispValue>(createValidationError("ConstraintViolation", "x")),
      readFile: async () => Either.left<AppError, string>(createValidationError("ConstraintViolation", "x")),
      writeFile: async () => Either.right<void, AppError>(undefined),
      logMessage: () => {},
      logProgram: () => {},
      toAppError: (e: unknown) => createValidationError("ConstraintViolation", String(e)),
    };
    const { runtime, committed } = makeRuntime(() => { getRuntimeCalls++; return fakeRuntime; });

    const commandId = "log-1";
    const waiter = runtime.trackCommand(commandId);
    const cmd: Cmd = { tag: "LogMessage", commandId, owner: "background", message: "hi", level: "info" };
    runtime.enqueueCmd(cmd);
    const outcome = await waiter;
    expect(outcome.status).toBe("succeeded");
    // LogMessage produces no follow-up Msgs, so commitMsg is NOT called.
    expect(committed.length).toBe(0);
    expect(getRuntimeCalls).toBe(1);
  });

  test("drain commits a *Failed follow-up Msg when runCmd yields a handled error (Right with *Failed)", async () => {
    // EvalTlisp whose runtime.evalTlisp returns Left<AppError> maps to a Right
    // containing an EvalTlispFailed follow-up — that follow-up is committed
    // through commitMsg (and would fire notifyStateChange once in the real
    // Editor.applyUpdate). This mirrors how handled errors reach the model.
    const fakeRuntime: EditorRuntime = {
      evalTlisp: () => Either.left<AppError, TLispValue>(createValidationError("ConstraintViolation", "eval err")),
      evalTlispAsync: async () => Either.left<AppError, TLispValue>(createValidationError("ConstraintViolation", "x")),
      readFile: async () => Either.left<AppError, string>(createValidationError("ConstraintViolation", "x")),
      writeFile: async () => Either.right<void, AppError>(undefined),
      logMessage: () => {},
      logProgram: () => {},
      toAppError: (e: unknown) => createValidationError("ConstraintViolation", e instanceof Error ? e.message : String(e)),
    };
    const { runtime, committed } = makeRuntime(() => fakeRuntime);
    const commandId = "eval-1";
    const cmd: Cmd = { tag: "EvalTlisp", commandId, owner: "handler", expr: "(+ 1 2)" };
    runtime.enqueueCmd(cmd);
    await new Promise<void>(resolve => queueMicrotask(resolve));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(committed.length).toBe(1);
    expect(committed[0]?.type).toBe("EvalTlispFailed");
    if (committed[0] && committed[0].type === "EvalTlispFailed") {
      expect(committed[0].commandId).toBe(commandId);
    }
  });

  test("drain commits each follow-up Msg exactly once (AC3.5 notification-once)", async () => {
    const fakeRuntime: EditorRuntime = {
      evalTlisp: () => Either.left<AppError, TLispValue>(createValidationError("ConstraintViolation", "x")),
      evalTlispAsync: async () => Either.left<AppError, TLispValue>(createValidationError("ConstraintViolation", "x")),
      // OpenFile success yields exactly one follow-up: OpenFileSucceeded.
      readFile: async () => Either.right<string, AppError>("CONTENT"),
      writeFile: async () => Either.right<void, AppError>(undefined),
      logMessage: () => {},
      logProgram: () => {},
      toAppError: (e: unknown) => createValidationError("ConstraintViolation", String(e)),
    };
    const { runtime, committed } = makeRuntime(() => fakeRuntime);
    const commandId = "open-1";
    const cmd: Cmd = { tag: "OpenFile", commandId, owner: "openFile", filename: "f" };
    runtime.enqueueCmd(cmd);
    await new Promise<void>(resolve => queueMicrotask(resolve));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    // Exactly one follow-up committed — once per Msg, no duplicates (AC3.5).
    expect(committed.length).toBe(1);
    expect(committed[0]?.type).toBe("OpenFileSucceeded");
  });

  test("concurrent enqueues drain serially (FIFO, one drain at a time)", async () => {
    const order: string[] = [];
    const fakeRuntime: EditorRuntime = {
      evalTlisp: () => Either.left<AppError, TLispValue>(createValidationError("ConstraintViolation", "x")),
      evalTlispAsync: async () => Either.left<AppError, TLispValue>(createValidationError("ConstraintViolation", "x")),
      readFile: async () => Either.right<string, AppError>(""),
      writeFile: async () => { order.push("write-start"); await Promise.resolve(); order.push("write-end"); return Either.right<void, AppError>(undefined); },
      logMessage: () => {},
      logProgram: () => {},
      toAppError: (e: unknown) => createValidationError("ConstraintViolation", String(e)),
    };
    const { runtime } = makeRuntime(() => fakeRuntime);
    runtime.enqueueCmd({ tag: "SaveFile", commandId: "a", owner: "saveFile", filename: "a", content: "" });
    runtime.enqueueCmd({ tag: "SaveFile", commandId: "b", owner: "saveFile", filename: "b", content: "" });
    // Give the drain microtask rounds to complete both (serial).
    for (let i = 0; i < 6; i++) await new Promise<void>(r => queueMicrotask(r));
    // Writes interleave per-cmd (start→end→start→end) proving serial drain.
    expect(order).toEqual(["write-start", "write-end", "write-start", "write-end"]);
  });
});

// ── BindingRuntime policy (AC3.6) ────────────────────────────────────
describe("CHORE-44 Change 3 — BindingRuntime policy (core/fallback/init)", () => {
  function makeBinding(files: Record<string, string>) {
    const fs = new MockFileSystem();
    for (const [path, content] of Object.entries(files)) {
      fs.files.set(path, content);
    }
    const evaluated: string[] = [];
    let coreLoaded = false;
    let lineNumbersToggled = false;
    let statusMessage = "";
    const evalCode: BindingEvaluator = (code) => {
      evaluated.push(code);
      return Either.right<TLispValue, EvalError>(createNil());
    };
    const rt = new BindingRuntime({
      filesystem: fs as unknown as FileSystem,
      evalCode,
      setCoreBindingsLoaded: (v) => { coreLoaded = v; },
      getCoreBindingsLoaded: () => coreLoaded,
      onCoreBindingsLoaded: () => { lineNumbersToggled = true; },
      setStatusMessage: (m) => { statusMessage = m; },
    });
    return { rt, evaluated, isCoreLoaded: () => coreLoaded, lineNumbersToggled: () => lineNumbersToggled, statusMessage: () => statusMessage, fs };
  }

  test("loadCoreBindings loads keymaps + 4 required files in order, then toggles line-numbers", async () => {
    const { rt, evaluated, isCoreLoaded, lineNumbersToggled } = makeBinding({
      "/core/keymaps.tlisp": "(keymaps)",
      "/core/bindings/normal.tlisp": "(normal)",
      "/core/bindings/insert.tlisp": "(insert)",
      "/core/bindings/visual.tlisp": "(visual)",
      "/core/bindings/command.tlisp": "(command)",
    });
    await rt.loadCoreBindings("/core/bindings", "/core/keymaps.tlisp");
    // First evaluated is the keymap, then the 4 mode files in order.
    expect(evaluated.slice(0, 5)).toEqual(["(keymaps)", "(normal)", "(insert)", "(visual)", "(command)"]);
    expect(isCoreLoaded()).toBe(true);
    expect(lineNumbersToggled()).toBe(true);
  });

  test("loadCoreBindings falls back when a required file is missing", async () => {
    const { rt, evaluated } = makeBinding({
      "/core/keymaps.tlisp": "(keymaps)",
      "/core/bindings/normal.tlisp": "(normal)",
      // insert/visual/command missing
    });
    await rt.loadCoreBindings("/core/bindings", "/core/keymaps.tlisp");
    // Fallback keymap string (contains the fallback bindings comment) is evaluated.
    expect(evaluated.some(c => c.includes("Minimal fallback bindings"))).toBe(true);
  });

  test("loadInitFile loads the init path and returns it; honors explicit path", async () => {
    const { rt, evaluated } = makeBinding({ "/custom/init.tlisp": "(defvar x 1)" });
    const resolved = await rt.loadInitFile("/custom/init.tlisp", []);
    expect(resolved).toBe("/custom/init.tlisp");
    expect(evaluated).toContain("(defvar x 1)");
  });

  test("loadInitFile falls back to ~/.config/tmax/init.tlisp path on default read failure", async () => {
    // Seed the literal ~ path so the fallback read succeeds.
    const { rt } = makeBinding({ "~/.config/tmax/init.tlisp": "(defvar y 2)" });
    // Override HOME so the default path computation is deterministic; the
    // MockFileSystem reads by exact key, so the default ${HOME}/.config/...
    // key is NOT seeded → read fails → fallback to literal ~ path succeeds.
    const oldHome = process.env.HOME;
    process.env.HOME = "/tmp/tmax-binding-test-no-such";
    try {
      const resolved = await rt.loadInitFile(undefined, []);
      expect(resolved).toBe("~/.config/tmax/init.tlisp");
    } finally {
      process.env.HOME = oldHome;
    }
  });

  test("loadBindingsFromFile honors silent (no warn path still returns false)", async () => {
    const { rt } = makeBinding({});
    const loud = await rt.loadBindingsFromFile("/missing.tlisp", false);
    const silent = await rt.loadBindingsFromFile("/missing.tlisp", true);
    expect(loud).toBe(false);
    expect(silent).toBe(false);
  });
});

// ── AC3.7 static assertions: Editor no longer owns the algorithms ───
describe("CHORE-44 Change 3 — AC3.7 static assertions on editor.ts", () => {
  const editorSrc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "editor", "editor.ts"),
    "utf8",
  );

  test("editor.ts contains no queue-spinning drain loop (while cmdQueue / runCmd(cmd, getRuntime()))", () => {
    expect(editorSrc.includes("while (this.cmdQueue")).toBe(false);
    expect(editorSrc.includes("runCmd(cmd, this.getRuntime())")).toBe(false);
  });

  test("editor.ts contains no fallback-keymap string literal (lives in binding-runtime)", () => {
    expect(editorSrc.includes("Minimal fallback bindings")).toBe(false);
    expect(editorSrc.includes('(key-bind "q" "(editor-quit)" "normal")')).toBe(false);
  });

  test("editor.ts contains no requiredBindingFiles array (policy lives in binding-runtime)", () => {
    expect(editorSrc.includes("requiredBindingFiles")).toBe(false);
  });

  test("drainCommands / enqueueCmd / trackCommand / classifyCommand remain on the prototype as facades", () => {
    expect(editorSrc.includes("drainCommands")).toBe(true);
    expect(editorSrc.includes("enqueueCmd")).toBe(true);
    expect(editorSrc.includes("trackCommand")).toBe(true);
    expect(editorSrc.includes("classifyCommand")).toBe(true);
  });
});

// ── AC3.3: no runtime collaborator imports editor.ts ─────────────────
describe("CHORE-44 Change 3 — AC3.3 collaborators do not import editor.ts", () => {
  const runtimeDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "editor", "runtime");
  for (const file of [
    "binding-runtime.ts",
    "command-runtime.ts",
    "logging-runtime.ts",
    "plugin-runtime.ts",
    "workspace-runtime.ts",
  ]) {
    test(`${file} does not import editor.ts`, () => {
      const src = readFileSync(join(runtimeDir, file), "utf8");
      expect(src).not.toContain('from "../editor.ts"');
      expect(src).not.toContain('from "../editor"');
      expect(src).not.toMatch(/import\s+.*\s+from\s+["']\.\.\/editor\.ts["']/);
    });
  }
});
