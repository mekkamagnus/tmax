import { describe, test, expect } from "bun:test";
import { createEditorAPI, type TlispEditorState } from "../../src/editor/tlisp-api";
import { FunctionalTextBufferImpl } from "../../src/core/buffer";
import { createString, createNumber, createNil, createList } from "../../src/tlisp/values";
import { Either } from "../../src/utils/task-either";

describe("T-Lisp API", () => {
  test("should create buffer with buffer-create", () => {
    // Create a mock state
    const state: TlispEditorState = {
      currentBuffer: FunctionalTextBufferImpl.create(""),
      buffers: new Map(),
      cursorLine: 0,
      cursorColumn: 0,
      terminal: {} as any, // Mock terminal
      filesystem: {} as any, // Mock filesystem
      mode: "normal",
      lastCommand: "",
      statusMessage: "",
      viewportTop: 0,
      commandLine: "",
      spacePressed: false,
      mxCommand: ""
    };

    // Add a default buffer
    state.buffers.set("default", state.currentBuffer!);

    const api = createEditorAPI(state);

    const bufferCreateFn = api.get("buffer-create");
    expect(bufferCreateFn).toBeDefined();

    // Call with valid arguments
    const eitherResult = bufferCreateFn([createString("test-buffer")]);

    // The function now returns Either<AppError, TLispValue>
    expect(eitherResult).toBeDefined();
    expect('right' in eitherResult).toBe(true); // Should be a right (success) Either
    expect(eitherResult.right?.type).toBe("string");
    expect(eitherResult.right?.value).toBe("test-buffer");
  });

  test("should switch buffer with buffer-switch", () => {
    // Create a mock state
    const state: TlispEditorState = {
      currentBuffer: FunctionalTextBufferImpl.create(""),
      buffers: new Map(),
      cursorLine: 0,
      cursorColumn: 0,
      terminal: {} as any, // Mock terminal
      filesystem: {} as any, // Mock filesystem
      mode: "normal",
      lastCommand: "",
      statusMessage: "",
      viewportTop: 0,
      commandLine: "",
      spacePressed: false,
      mxCommand: ""
    };

    // Add buffers
    state.buffers.set("default", state.currentBuffer!);
    state.buffers.set("other-buffer", FunctionalTextBufferImpl.create(""));

    const api = createEditorAPI(state);

    const bufferSwitchFn = api.get("buffer-switch");
    expect(bufferSwitchFn).toBeDefined();

    const eitherResult = bufferSwitchFn([createString("other-buffer")]);

    expect(eitherResult).toBeDefined();
    expect('right' in eitherResult).toBe(true); // Should be a right (success) Either
    expect(eitherResult.right?.type).toBe("string");
  });

  test("should return current buffer with buffer-current", () => {
    // Create a mock state
    const state: TlispEditorState = {
      currentBuffer: FunctionalTextBufferImpl.create(""),
      buffers: new Map(),
      cursorLine: 0,
      cursorColumn: 0,
      terminal: {} as any, // Mock terminal
      filesystem: {} as any, // Mock filesystem
      mode: "normal",
      lastCommand: "",
      statusMessage: "",
      viewportTop: 0,
      commandLine: "",
      spacePressed: false,
      mxCommand: ""
    };

    // Add a default buffer
    state.buffers.set("default", state.currentBuffer!);
    state.currentBuffer = state.buffers.get("default")!;

    const api = createEditorAPI(state);

    const bufferCurrentFn = api.get("buffer-current");
    expect(bufferCurrentFn).toBeDefined();

    const eitherResult = bufferCurrentFn([]);

    expect(eitherResult).toBeDefined();
    expect('right' in eitherResult).toBe(true); // Should be a right (success) Either
  });

  test("should return cursor position with cursor-position", () => {
    // Create a mock state
    const state: TlispEditorState = {
      currentBuffer: FunctionalTextBufferImpl.create(""),
      buffers: new Map(),
      cursorLine: 0,
      cursorColumn: 0,
      terminal: {} as any, // Mock terminal
      filesystem: {} as any, // Mock filesystem
      mode: "normal",
      lastCommand: "",
      statusMessage: "",
      viewportTop: 0,
      commandLine: "",
      spacePressed: false,
      mxCommand: ""
    };

    // Add a default buffer
    state.buffers.set("default", state.currentBuffer!);

    const api = createEditorAPI(state);

    const cursorPositionFn = api.get("cursor-position");
    expect(cursorPositionFn).toBeDefined();

    const eitherResult = cursorPositionFn([]);

    expect(eitherResult).toBeDefined();
    expect('right' in eitherResult).toBe(true); // Should be a right (success) Either
    expect(eitherResult.right?.type).toBe("list");
  });

  test("should validate argument counts", () => {
    // Create a mock state
    const state: TlispEditorState = {
      currentBuffer: FunctionalTextBufferImpl.create(""),
      buffers: new Map(),
      cursorLine: 0,
      cursorColumn: 0,
      terminal: {} as any, // Mock terminal
      filesystem: {} as any, // Mock filesystem
      mode: "normal",
      lastCommand: "",
      statusMessage: "",
      viewportTop: 0,
      commandLine: "",
      spacePressed: false,
      mxCommand: ""
    };

    // Add a default buffer
    state.buffers.set("default", state.currentBuffer!);

    const api = createEditorAPI(state);

    const bufferCreateFn = api.get("buffer-create");
    expect(bufferCreateFn).toBeDefined();

    // Call with wrong number of arguments
    const eitherResult = bufferCreateFn([]); // Should require 1 argument

    expect(eitherResult).toBeDefined();
    expect('left' in eitherResult).toBe(true); // Should be a left (error) Either
  });

  test("should validate argument types", () => {
    // Create a mock state
    const state: TlispEditorState = {
      currentBuffer: FunctionalTextBufferImpl.create(""),
      buffers: new Map(),
      cursorLine: 0,
      cursorColumn: 0,
      terminal: {} as any, // Mock terminal
      filesystem: {} as any, // Mock filesystem
      mode: "normal",
      lastCommand: "",
      statusMessage: "",
      viewportTop: 0,
      commandLine: "",
      spacePressed: false,
      mxCommand: ""
    };

    // Add a default buffer
    state.buffers.set("default", state.currentBuffer!);

    const api = createEditorAPI(state);

    const bufferCreateFn = api.get("buffer-create");
    expect(bufferCreateFn).toBeDefined();

    // Call with wrong argument type
    const eitherResult = bufferCreateFn([createNumber(123)]); // Should require string

    expect(eitherResult).toBeDefined();
    expect('left' in eitherResult).toBe(true); // Should be a left (error) Either
  });
});