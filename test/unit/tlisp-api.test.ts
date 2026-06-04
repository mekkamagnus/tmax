import { describe, expect, test } from "bun:test";
import { FunctionalTextBufferImpl } from "../../src/core/buffer";
import { createEditorAPI, type TlispEditorState } from "../../src/editor/tlisp-api";
import { createNumber, createString } from "../../src/tlisp/values";
import { Either } from "../../src/utils/task-either";
import { expectDefined, expectRight } from "../helpers/editor-fixture.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";

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
});
