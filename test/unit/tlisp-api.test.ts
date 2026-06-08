import { describe, expect, test } from "bun:test";
import { FunctionalTextBufferImpl } from "../../src/core/buffer";
import { createEditorAPI, type TlispEditorState } from "../../src/editor/tlisp-api";
import { createNumber, createString, createSymbol } from "../../src/tlisp/values";
import { Either } from "../../src/utils/task-either";
import { expectDefined, expectRight } from "../helpers/editor-fixture.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MessageLog } from "../../src/editor/message-log.ts";

function createState(): TlispEditorState {
  const currentBuffer = FunctionalTextBufferImpl.create("");
  return {
    currentBuffer,
    buffers: new Map([["default", currentBuffer]]),
    cursorLine: 0,
    cursorColumn: 0,
    terminal: new MockTerminal(),
    filesystem: new MockFileSystem(),
    mode: "normal",
    lastCommand: "",
    statusMessage: "",
    viewportTop: 0,
    commandLine: "",
    spacePressed: false,
    mxCommand: "",
    cursorFocus: "buffer",
  };
}

describe("T-Lisp API", () => {
  test("creates a buffer", () => {
    const api = createEditorAPI(createState());
    const createBuffer = expectDefined(api.get("buffer-create"));

    const result = expectRight(createBuffer([createString("test-buffer")]));

    expect(result.type).toBe("string");
    expect(result.value).toBe("test-buffer");
  });

  test("switches buffers", () => {
    const state = createState();
    state.buffers.set("other-buffer", FunctionalTextBufferImpl.create(""));
    const switchBuffer = expectDefined(createEditorAPI(state).get("buffer-switch"));

    const result = expectRight(switchBuffer([createString("other-buffer")]));

    expect(result.type).toBe("string");
  });

  test("returns the current buffer", () => {
    const currentBuffer = expectDefined(createEditorAPI(createState()).get("buffer-current"));

    expect(Either.isRight(currentBuffer([]))).toBe(true);
  });

  test("returns cursor position", () => {
    const cursorPosition = expectDefined(createEditorAPI(createState()).get("cursor-position"));

    expect(expectRight(cursorPosition([])).type).toBe("list");
  });

  test("validates argument counts", () => {
    const createBuffer = expectDefined(createEditorAPI(createState()).get("buffer-create"));

    expect(Either.isLeft(createBuffer([]))).toBe(true);
  });

  test("validates argument types", () => {
    const createBuffer = expectDefined(createEditorAPI(createState()).get("buffer-create"));

    expect(Either.isLeft(createBuffer([createNumber(123)]))).toBe(true);
  });

  // --- Messages API tests ---

  function createStateWithMessages(): TlispEditorState {
    const state = createState();
    state.buffers.set('*Messages*', FunctionalTextBufferImpl.create(''));
    const messageLog = new MessageLog();
    state.logMessage = (msg: string, level?: string, command?: string) => {
      messageLog.log((level as any) ?? 'info', msg, command);
      state.buffers.set('*Messages*', FunctionalTextBufferImpl.create(messageLog.render()));
    };
    (state as any)._getMessageLog = () => messageLog;
    return state;
  }

  test("message with format string %s", () => {
    const state = createStateWithMessages();
    const api = createEditorAPI(state);
    const message = expectDefined(api.get("message"));
    const result = expectRight(message([createString("Saved %s"), createString("foo.txt")]));
    expect(String(result.value)).toBe("Saved foo.txt");
  });

  test("message with format string %s and %d", () => {
    const state = createStateWithMessages();
    const api = createEditorAPI(state);
    const message = expectDefined(api.get("message"));
    const result = expectRight(message([createString("Saved %s (%d bytes)"), createString("foo.txt"), createNumber(1024)]));
    expect(String(result.value)).toBe("Saved foo.txt (1024 bytes)");
  });

  test("message with %% literal percent", () => {
    const state = createStateWithMessages();
    const api = createEditorAPI(state);
    const message = expectDefined(api.get("message"));
    const result = expectRight(message([createString("100%% done")]));
    expect(String(result.value)).toBe("100% done");
  });

  test("message without format directives joins with spaces", () => {
    const state = createStateWithMessages();
    const api = createEditorAPI(state);
    const message = expectDefined(api.get("message"));
    const result = expectRight(message([createString("hello"), createString("world")]));
    expect(String(result.value)).toBe("hello world");
  });

  test("message with extra %s substitutes empty", () => {
    const state = createStateWithMessages();
    const api = createEditorAPI(state);
    const message = expectDefined(api.get("message"));
    const result = expectRight(message([createString("a %s b %s c"), createString("X")]));
    expect(String(result.value)).toBe("a X b  c");
  });

  test("log-message logs at explicit level", () => {
    const state = createStateWithMessages();
    const api = createEditorAPI(state);
    const logMsg = expectDefined(api.get("log-message"));
    const result = expectRight(logMsg([createSymbol(":debug"), createString("test debug")]));
    expect(String(result.value)).toBe("test debug");
    // debug should NOT set status message
    expect(state.statusMessage).toBe("");
  });

  test("log-message at error level sets status", () => {
    const state = createStateWithMessages();
    const api = createEditorAPI(state);
    const logMsg = expectDefined(api.get("log-message"));
    expectRight(logMsg([createSymbol(":error"), createString("bad")]));
    expect(state.statusMessage).toBe("bad");
  });

  test("clear-messages empties the log", () => {
    const state = createStateWithMessages();
    state.logMessage!("hello", "info");
    const api = createEditorAPI(state);
    const clear = expectDefined(api.get("clear-messages"));
    clear([]);
    const log = (state as any)._getMessageLog();
    expect(log.getEntries()).toHaveLength(0);
  });

  test("message-log-level returns current level", () => {
    const state = createStateWithMessages();
    const api = createEditorAPI(state);
    const getLevel = expectDefined(api.get("message-log-level"));
    const result = expectRight(getLevel([]));
    expect(String(result.value)).toBe("info");
  });

  test("set-message-log-level changes the level", () => {
    const state = createStateWithMessages();
    const api = createEditorAPI(state);
    const setLevel = expectDefined(api.get("set-message-log-level"));
    expectRight(setLevel([createSymbol(":warn")]));
    const log = (state as any)._getMessageLog();
    expect(log.minLevel).toBe("warn");
  });

  test("message-log-max returns current max", () => {
    const state = createStateWithMessages();
    const api = createEditorAPI(state);
    const getMax = expectDefined(api.get("message-log-max"));
    const result = expectRight(getMax([]));
    expect(Number(result.value)).toBe(1000);
  });

  test("set-message-log-max changes the max", () => {
    const state = createStateWithMessages();
    const api = createEditorAPI(state);
    const setMax = expectDefined(api.get("set-message-log-max"));
    expectRight(setMax([createNumber(500)]));
    const log = (state as any)._getMessageLog();
    expect(log.maxSize).toBe(500);
  });

  test("last-command returns current last command", () => {
    const state = createStateWithMessages();
    state.lastCommand = "(my-func)";
    const api = createEditorAPI(state);
    const lastCmd = expectDefined(api.get("last-command"));
    const result = expectRight(lastCmd([]));
    expect(String(result.value)).toBe("(my-func)");
  });
});
