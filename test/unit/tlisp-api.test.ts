import { describe, expect, test } from "bun:test";
import { TextBufferImpl } from "../../src/core/buffer";
import { createEditorAPI } from "../../src/editor/tlisp-api";
import { createNumber, createString, createSymbol } from "../../src/tlisp/values";
import { Either } from "../../src/utils/task-either";
import { expectDefined, expectRight, createTestAPIContext } from "../helpers/editor-fixture.ts";
import { MessageLog, type LogLevel } from "../../src/editor/message-log.ts";
import { Log, ViewBoundLog } from "../../src/editor/log-store.ts";

function createState() {
  const currentBuffer = TextBufferImpl.create("");
  return createTestAPIContext({
    currentBuffer,
    buffers: new Map([["default", currentBuffer]]),
  });
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
    state.buffers.set("other-buffer", TextBufferImpl.create(""));
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

  function createStateWithMessages() {
    const state = createState();
    state.buffers.set('*Messages*', TextBufferImpl.create(''));
    // CHORE-44 Change 2: logMessage and getMessageLog share one Log store so the
    // SPEC-055 query/max/level primitives observe what (message)/(log-message)
    // record (MessageLog is retained only for the legacy render-based path).
    void new MessageLog();
    const store = new Log();
    state.logMessage = (msg: string, level?: string, command?: string) => {
      store.log({ level: (level ?? 'info') as LogLevel, text: msg, command, category: 'editor' });
      state.buffers.set('*Messages*', TextBufferImpl.create(store.render('messages')));
    };
    state.getMessageLog = () => new ViewBoundLog(store, 'messages');
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
    // debug should NOT set status message — capture the baseline before the
    // call and assert the debug-level log did not overwrite it with the log
    // text.
    const before = state.getModel().statusMessage;
    expectRight(logMsg([createSymbol(":debug"), createString("test debug")]));
    expect(state.getModel().statusMessage).toBe(before);
    expect(state.getModel().statusMessage).not.toBe("test debug");
  });

  test("log-message at error level sets status", () => {
    const state = createStateWithMessages();
    const api = createEditorAPI(state);
    const logMsg = expectDefined(api.get("log-message"));
    expectRight(logMsg([createSymbol(":error"), createString("bad")]));
    expect(state.getModel().statusMessage).toBe("bad");
  });

  test("echo sets status WITHOUT logging (SPEC-055 two-tier split)", () => {
    const state = createStateWithMessages();
    const api = createEditorAPI(state);
    const echo = expectDefined(api.get("echo"));
    const result = expectRight(echo([createString("which-key hint")]));
    expect(String(result.value)).toBe("which-key hint");
    expect(state.getModel().statusMessage).toBe("which-key hint");
    // Critical: echo must NOT append to the log (contrast with message).
    const log = state.getMessageLog!();
    expect(log.getEntries()).toHaveLength(0);
  });

  test("message both echoes AND logs (contrast with echo)", () => {
    const state = createStateWithMessages();
    const api = createEditorAPI(state);
    const message = expectDefined(api.get("message"));
    expectRight(message([createString("logged msg")]));
    expect(state.getModel().statusMessage).toBe("logged msg");
    const log = state.getMessageLog!();
    expect(log.getEntries()).toHaveLength(1);
  });

  test("echo requires at least one argument", () => {
    const state = createStateWithMessages();
    const api = createEditorAPI(state);
    const echo = expectDefined(api.get("echo"));
    expect(Either.isLeft(echo([]))).toBe(true);
  });

  test("clear-messages empties the log", () => {
    const state = createStateWithMessages();
    state.logMessage!("hello", "info");
    const api = createEditorAPI(state);
    const clear = expectDefined(api.get("clear-messages"));
    clear([]);
    const log = state.getMessageLog!();
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
    const log = state.getMessageLog!();
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
    const log = state.getMessageLog!();
    expect(log.maxSize).toBe(500);
  });

  test("last-command returns current last command", () => {
    const state = createStateWithMessages();
    state.setLastCommand("(my-func)");
    const api = createEditorAPI(state);
    const lastCmd = expectDefined(api.get("last-command"));
    const result = expectRight(lastCmd([]));
    expect(String(result.value)).toBe("(my-func)");
  });
});
