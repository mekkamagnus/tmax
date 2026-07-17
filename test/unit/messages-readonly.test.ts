import { describe, expect, test } from "bun:test";
import { FunctionalTextBufferImpl } from "../../src/core/buffer";
import { createEditorAPI } from "../../src/editor/tlisp-api";
import { createString } from "../../src/tlisp/values";
import { Either } from "../../src/utils/task-either";
import { expectDefined, expectRight, createTestAPIContext } from "../helpers/editor-fixture.ts";

function createState() {
  const scratchBuffer = FunctionalTextBufferImpl.create("");
  const messagesBuffer = FunctionalTextBufferImpl.create("existing messages\n");
  return createTestAPIContext({
    currentBuffer: messagesBuffer,
    buffers: new Map([
      ["default", scratchBuffer],
      ["*Messages*", messagesBuffer],
    ]),
  });
}

describe("SPEC-016: *Messages* buffer read-only guard", () => {
  test("buffer-insert is rejected when *Messages* is current buffer", () => {
    const state = createState();
    // currentBuffer is *Messages* in this state
    const api = createEditorAPI(state);
    const bufferInsert = expectDefined(api.get("buffer-insert"));

    const result = bufferInsert([createString("injected")]);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.type).toBe("BufferError");
      expect(result.left.message).toContain("read-only");
    }
  });

  test("buffer-delete-range is rejected when *Messages* is current buffer", () => {
    const state = createState();
    const api = createEditorAPI(state);
    const bufferDeleteRange = expectDefined(api.get("buffer-delete-range"));

    // args: startLine, startCol, endLine, endCol
    const result = bufferDeleteRange([
      { type: "number", value: 0 } as any,
      { type: "number", value: 0 } as any,
      { type: "number", value: 0 } as any,
      { type: "number", value: 5 } as any,
    ]);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.type).toBe("BufferError");
    }
  });

  test("buffer-insert works when a writable buffer is current", () => {
    const state = createState();
    // Switch to the writable default buffer
    state.setCurrentBufferDirect(state.buffers.get("default")!);
    const api = createEditorAPI(state);
    const bufferInsert = expectDefined(api.get("buffer-insert"));

    const result = bufferInsert([createString("hello")]);

    expect(Either.isRight(result)).toBe(true);
  });

  test("buffer-insert-at-position is rejected when *Messages* is current buffer", () => {
    const state = createState();
    const api = createEditorAPI(state);
    const bufferInsertAt = expectDefined(api.get("buffer-insert-at-position"));

    const result = bufferInsertAt([
      { type: "number", value: 0 } as any,
      { type: "number", value: 0 } as any,
      createString("x"),
    ]);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.type).toBe("BufferError");
    }
  });
});
