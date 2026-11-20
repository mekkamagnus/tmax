import { describe, expect, test } from "bun:test";
import { editorStateToJson, jsonToEditorState } from "../helpers/wire-imports.ts";
import { executeTlisp } from "../helpers/editor-fixture.ts";
import { createStartedEditor, type Editor } from "../helpers/editor-fixture.ts";

// The modeline's named-buffer fix (round 32): currentBufferName must survive
// the frame round trip — serialize -> wire -> deserialize -> status line.
// The regression that held *scratch* over *Fikra* for months was exactly a
// missing field on ONE of these two hops.

describe("buffer name wire round trip (#253, fikra round 32)", () => {
  test("a named buffer's name survives editorStateToJson -> jsonToEditorState", async () => {
    const editor = await createStartedEditor("");
    executeTlisp(editor, '(buffer-create "*Fikra*")');
    executeTlisp(editor, '(buffer-switch "*Fikra*")');
    const state = editor.getEditorState();
    expect(state.currentBufferName).toBe("*Fikra*");
    const wire = editorStateToJson(state) as unknown as Record<string, unknown>;
    expect(wire.currentBufferName).toBe("*Fikra*");
    const back = jsonToEditorState(wire) as unknown as { currentBufferName?: string };
    expect(back.currentBufferName).toBe("*Fikra*");
  });

  test("switching to a named non-file buffer clears the stale filename", async () => {
    const editor = await createStartedEditor("");
    executeTlisp(editor, '(buffer-create "*Fikra*")');
    executeTlisp(editor, '(buffer-switch "*Fikra*")');
    const state = editor.getEditorState();
    expect(state.currentBufferName).toBe("*Fikra*");
    expect(state.currentFilename ?? null).toBeNull();
  });
});
