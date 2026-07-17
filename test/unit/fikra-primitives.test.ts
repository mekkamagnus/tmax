import { describe, expect, test } from "bun:test";
import { TextBufferImpl } from "../../src/core/buffer";
import { createEditorAPI } from "../../src/editor/tlisp-api";
import { createString, createNumber, createBoolean, createList, createSymbol } from "../../src/tlisp/values";
import { Either } from "../../src/utils/task-either";
import { expectDefined, expectRight, createTestAPIContext } from "../helpers/editor-fixture.ts";

function createState() {
  const currentBuffer = TextBufferImpl.create("");
  return createTestAPIContext({
    currentBuffer,
    buffers: new Map([["default", currentBuffer]]),
  });
}

// ── json-read-from-string ─────────────────────────────────────────────

describe("json-read-from-string", () => {
  const api = createEditorAPI(createState());
  const jsonParse = expectDefined(api.get("json-read-from-string"));

  test("parses JSON object to alist", () => {
    const result = expectRight(jsonParse([createString('{"type":"text","content":"hello"}')]));
    expect(result.type).toBe("list");
    const pairs = result.value as any[];
    expect(pairs.length).toBe(2);
  });

  test("parses JSON array to list", () => {
    const result = expectRight(jsonParse([createString("[1, 2, 3]")]));
    expect(result.type).toBe("list");
    const items = result.value as any[];
    expect(items.length).toBe(3);
    expect(Number(items[0]!.value)).toBe(1);
    expect(Number(items[1]!.value)).toBe(2);
    expect(Number(items[2]!.value)).toBe(3);
  });

  test("parses JSON string", () => {
    const result = expectRight(jsonParse([createString('"hello"')]));
    expect(result.type).toBe("string");
    expect(result.value).toBe("hello");
  });

  test("parses JSON number", () => {
    const result = expectRight(jsonParse([createString("42")]));
    expect(result.type).toBe("number");
    expect(result.value).toBe(42);
  });

  test("parses JSON boolean", () => {
    const result = expectRight(jsonParse([createString("true")]));
    expect(result.type).toBe("boolean");
    expect(result.value).toBe(true);
  });

  test("parses JSON null to nil", () => {
    const result = expectRight(jsonParse([createString("null")]));
    expect(result.type).toBe("nil");
  });

  test("returns nil on invalid JSON", () => {
    const result = expectRight(jsonParse([createString("invalid")]));
    expect(result.type).toBe("nil");
  });

  test("rejects non-string argument", () => {
    expect(Either.isLeft(jsonParse([createNumber(42)]))).toBe(true);
  });

  test("rejects missing argument", () => {
    expect(Either.isLeft(jsonParse([]))).toBe(true);
  });
});

// ── make-process ──────────────────────────────────────────────────────

describe("make-process", () => {
  test("spawns a process and returns a pid", () => {
    const state = createState();
    const api = createEditorAPI(state);
    const makeProc = expectDefined(api.get("make-process"));

    const result = expectRight(makeProc([
      createSymbol(":command"),
      createList([createString("echo"), createString("hello")]),
    ]));

    expect(result.type).toBe("number");
    expect(Number(result.value)).toBeGreaterThan(0);
  });

  test("spawns a process with string command", () => {
    const api = createEditorAPI(createState());
    const makeProc = expectDefined(api.get("make-process"));

    const result = expectRight(makeProc([
      createSymbol(":command"),
      createString("echo hello"),
    ]));

    expect(result.type).toBe("number");
  });

  test("rejects missing :command argument", () => {
    const api = createEditorAPI(createState());
    const makeProc = expectDefined(api.get("make-process"));

    expect(Either.isLeft(makeProc([]))).toBe(true);
  });
});

// ── signal ────────────────────────────────────────────────────────────

describe("signal", () => {
  test("rejects missing arguments", () => {
    const api = createEditorAPI(createState());
    const sig = expectDefined(api.get("signal"));

    expect(Either.isLeft(sig([]))).toBe(true);
  });

  test("rejects unknown pid", () => {
    const api = createEditorAPI(createState());
    const sig = expectDefined(api.get("signal"));

    expect(Either.isLeft(sig([createNumber(99999), createString("SIGTERM")]))).toBe(true);
  });
});

// ── process-write ─────────────────────────────────────────────────────

describe("process-write", () => {
  test("rejects missing arguments", () => {
    const api = createEditorAPI(createState());
    const write = expectDefined(api.get("process-write"));

    expect(Either.isLeft(write([]))).toBe(true);
  });

  test("rejects unknown pid", () => {
    const api = createEditorAPI(createState());
    const write = expectDefined(api.get("process-write"));

    expect(Either.isLeft(write([createNumber(99999), createString("data")]))).toBe(true);
  });
});

// ── http-request ──────────────────────────────────────────────────────

describe("http-request", () => {
  test("returns a request id for valid URL", () => {
    const api = createEditorAPI(createState());
    const httpReq = expectDefined(api.get("http-request"));

    const result = expectRight(httpReq([createString("http://localhost:1/nonexistent")]));
    expect(result.type).toBe("number");
    expect(Number(result.value)).toBeGreaterThan(0);
  });

  test("rejects missing URL argument", () => {
    const api = createEditorAPI(createState());
    const httpReq = expectDefined(api.get("http-request"));

    expect(Either.isLeft(httpReq([]))).toBe(true);
  });

  test("rejects non-string URL", () => {
    const api = createEditorAPI(createState());
    const httpReq = expectDefined(api.get("http-request"));

    expect(Either.isLeft(httpReq([createNumber(42)]))).toBe(true);
  });
});

// ── buffer-set-read-only ──────────────────────────────────────────────

describe("buffer-set-read-only", () => {
  test("sets buffer read-only", () => {
    const state = createState();
    state.buffers.set("test-buf", TextBufferImpl.create("hello"));
    state.setCurrentBufferDirect(state.buffers.get("test-buf")!);
    const api = createEditorAPI(state);

    const setRO = expectDefined(api.get("buffer-set-read-only"));
    const result = expectRight(setRO([createBoolean(true)]));
    expect(result.value).toBe(true);
  });

  test("sets buffer writable again", () => {
    const state = createState();
    state.buffers.set("test-buf", TextBufferImpl.create("hello"));
    state.setCurrentBufferDirect(state.buffers.get("test-buf")!);
    const api = createEditorAPI(state);

    const setRO = expectDefined(api.get("buffer-set-read-only"));
    expectRight(setRO([createBoolean(true)]));
    const result = expectRight(setRO([createBoolean(false)]));
    expect(result.value).toBe(false);
  });

  test("accepts t symbol for true", () => {
    const state = createState();
    const api = createEditorAPI(state);

    const setRO = expectDefined(api.get("buffer-set-read-only"));
    const result = expectRight(setRO([createSymbol("t")]));
    expect(result.value).toBe(true);
  });

  test("rejects invalid argument type", () => {
    const state = createState();
    const api = createEditorAPI(state);

    const setRO = expectDefined(api.get("buffer-set-read-only"));
    expect(Either.isLeft(setRO([createString("yes")]))).toBe(true);
  });

  test("rejects missing argument", () => {
    const api = createEditorAPI(createState());
    const setRO = expectDefined(api.get("buffer-set-read-only"));

    expect(Either.isLeft(setRO([]))).toBe(true);
  });
});
