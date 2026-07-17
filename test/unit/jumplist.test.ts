/**
 * @file jumplist.test.ts
 * @description SPEC-044 Phase 4.E — C-o / C-i jumplist navigation.
 */

import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import {
  createStartedEditor,
} from "../helpers/editor-fixture.ts";

type V = { type: string; value?: any };

function rightValue(result: any): V {
  if (result?._tag !== "Right") {
    throw new Error("Expected Right, got: " + JSON.stringify(result));
  }
  return result.right as V;
}

describe("SPEC-044 Phase 4.E — jumplist (C-o / C-i)", () => {
  function cursor(editor: Editor): [number, number] {
    const pos = rightValue(editor.getInterpreter().execute("(cursor-position)") as any).value as V[];
    return [Number(pos[0]!.value), Number(pos[1]!.value)];
  }

  function jumpIndex(editor: Editor): number {
    return Number(rightValue(editor.getInterpreter().execute("(vim-jump-index)") as any).value);
  }

  describe("vim-jump-record", () => {
    test("record appends cursor position to the jumplist", async () => {
      const editor = await createStartedEditor("aaa\nbbb\nccc");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-jump-record)");
      expect(jumpIndex(editor)).toBe(0);
    });

    test("multiple records grow the jumplist", async () => {
      const editor = await createStartedEditor("aaa\nbbb\nccc\nddd");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-jump-record)");
      editor.getInterpreter().execute("(cursor-move 1 0)");
      editor.getInterpreter().execute("(vim-jump-record)");
      editor.getInterpreter().execute("(cursor-move 2 0)");
      editor.getInterpreter().execute("(vim-jump-record)");
      expect(jumpIndex(editor)).toBe(2);
    });

    test("record after navigating back truncates forward tail", async () => {
      const editor = await createStartedEditor("aaa\nbbb\nccc\nddd");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-jump-record)");
      editor.getInterpreter().execute("(cursor-move 1 0)");
      editor.getInterpreter().execute("(vim-jump-record)");
      editor.getInterpreter().execute("(cursor-move 2 0)");
      editor.getInterpreter().execute("(vim-jump-record)");
      expect(jumpIndex(editor)).toBe(2);
      editor.getInterpreter().execute("(vim-jump-back)");
      expect(jumpIndex(editor)).toBe(1);
      // Record from here — should drop entry[2] ((2,0)) and append (1,0).
      // After truncate-then-append: trimmed = [(0,0),(1,0)], append → 3 entries, pointer = 2.
      editor.getInterpreter().execute("(vim-jump-record)");
      expect(jumpIndex(editor)).toBe(2);
      // Verify the forward tail ((2,0)) is gone by trying to go forward.
      const res = rightValue(editor.getInterpreter().execute("(vim-jump-forward)") as any);
      expect(res.type).toBe("nil");
    });
  });

  describe("vim-jump-back (C-o)", () => {
    test("moves to the previous recorded position", async () => {
      const editor = await createStartedEditor("aaa\nbbb\nccc");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-jump-record)");
      editor.getInterpreter().execute("(cursor-move 2 2)");
      editor.getInterpreter().execute("(vim-jump-record)");
      // Now cursor is at (2,2), pointer at 1.
      editor.getInterpreter().execute("(vim-jump-back)");
      expect(cursor(editor)).toEqual([0, 0]);
      expect(jumpIndex(editor)).toBe(0);
    });

    test("does nothing when already at oldest", async () => {
      const editor = await createStartedEditor("aaa\nbbb");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-jump-record)");
      const before = cursor(editor);
      const res = rightValue(editor.getInterpreter().execute("(vim-jump-back)") as any);
      expect(res.type).toBe("nil");
      expect(cursor(editor)).toEqual(before);
    });
  });

  describe("vim-jump-forward (C-i)", () => {
    test("moves to the next recorded position after a back", async () => {
      const editor = await createStartedEditor("aaa\nbbb\nccc");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-jump-record)");
      editor.getInterpreter().execute("(cursor-move 2 2)");
      editor.getInterpreter().execute("(vim-jump-record)");
      editor.getInterpreter().execute("(vim-jump-back)");  // -> (0,0)
      expect(cursor(editor)).toEqual([0, 0]);
      editor.getInterpreter().execute("(vim-jump-forward)");
      expect(cursor(editor)).toEqual([2, 2]);
      expect(jumpIndex(editor)).toBe(1);
    });

    test("does nothing when already at newest", async () => {
      const editor = await createStartedEditor("aaa\nbbb");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-jump-record)");
      const before = cursor(editor);
      const res = rightValue(editor.getInterpreter().execute("(vim-jump-forward)") as any);
      expect(res.type).toBe("nil");
      expect(cursor(editor)).toEqual(before);
    });
  });

  describe("vim-jump-clear", () => {
    test("clears the jumplist and resets the pointer", async () => {
      const editor = await createStartedEditor("aaa\nbbb");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-jump-record)");
      editor.getInterpreter().execute("(cursor-move 1 0)");
      editor.getInterpreter().execute("(vim-jump-record)");
      expect(jumpIndex(editor)).toBe(1);
      editor.getInterpreter().execute("(vim-jump-clear)");
      expect(jumpIndex(editor)).toBe(-1);
    });
  });

  test("jumplist operations never mutate the buffer", async () => {
    const editor = await createStartedEditor("hello\nworld");
    editor.getInterpreter().execute("(cursor-move 0 0)");
    editor.getInterpreter().execute("(vim-jump-record)");
    editor.getInterpreter().execute("(cursor-move 1 0)");
    editor.getInterpreter().execute("(vim-jump-record)");
    editor.getInterpreter().execute("(vim-jump-back)");
    editor.getInterpreter().execute("(vim-jump-forward)");
    const text = rightValue(editor.getInterpreter().execute("(buffer-text)") as any).value;
    expect(text).toBe("hello\nworld");
  });
});

// SPEC-067 — verify the jumplist BINDINGS route C-o / C-i through the
// normal-mode handler. Jump positions are seeded via (vim-jump-record) because
// jump motions do not auto-record in tmax (auto-recording is out of scope for
// this spec — Track 1 only binds + tests the existing jumplist commands).
describe("SPEC-067 — jumplist keypress bindings", () => {
  async function press(editor: Editor, keys: string): Promise<void> {
    for (const key of keys) {
      await editor.handleKey(key);
    }
  }

  function cursor(editor: Editor): [number, number] {
    const pos = rightValue(editor.getInterpreter().execute("(cursor-position)") as any).value as V[];
    return [Number(pos[0]!.value), Number(pos[1]!.value)];
  }

  test("C-o jumps back to the previous recorded position", async () => {
    const editor = await createStartedEditor("aaa\nbbb\nccc");
    editor.getInterpreter().execute("(cursor-move 0 0)");
    editor.getInterpreter().execute("(vim-jump-record)");
    editor.getInterpreter().execute("(cursor-move 2 2)");
    editor.getInterpreter().execute("(vim-jump-record)");
    await editor.handleKey("C-o");
    expect(cursor(editor)).toEqual([0, 0]);
  });

  test("C-i jumps forward after a C-o", async () => {
    const editor = await createStartedEditor("aaa\nbbb\nccc");
    editor.getInterpreter().execute("(cursor-move 0 0)");
    editor.getInterpreter().execute("(vim-jump-record)");
    editor.getInterpreter().execute("(cursor-move 2 2)");
    editor.getInterpreter().execute("(vim-jump-record)");
    await editor.handleKey("C-o");
    await editor.handleKey("C-i");
    expect(cursor(editor)).toEqual([2, 2]);
  });
});
