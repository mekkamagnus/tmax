/**
 * @file marks.test.ts
 * @description SPEC-044 Phase 4.A — Vim marks (ma, 'a, `a).
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

describe("SPEC-044 Phase 4.A — Vim marks", () => {
  function bufferText(editor: Editor): string {
    return rightValue(editor.getInterpreter().execute("(buffer-text)") as any).value as string;
  }

  function cursor(editor: Editor): [number, number] {
    const pos = rightValue(editor.getInterpreter().execute("(cursor-position)") as any).value as V[];
    return [Number(pos[0]!.value), Number(pos[1]!.value)];
  }

  describe("vim-mark-set / vim-mark-get", () => {
    test("set then get returns the stored position", async () => {
      const editor = await createStartedEditor("hello\nworld");
      editor.getInterpreter().execute("(cursor-move 1 2)");
      editor.getInterpreter().execute('(vim-mark-set "a")');
      const res = rightValue(editor.getInterpreter().execute('(vim-mark-get "a")') as any);
      expect(res.type).toBe("list");
      const pair = res.value as V[];
      expect(Number(pair[0]!.value)).toBe(1);
      expect(Number(pair[1]!.value)).toBe(2);
    });

    test("set at (0,0) returns 0,0", async () => {
      const editor = await createStartedEditor("hello");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute('(vim-mark-set "a")');
      const res = rightValue(editor.getInterpreter().execute('(vim-mark-get "a")') as any);
      const pair = res.value as V[];
      expect(Number(pair[0]!.value)).toBe(0);
      expect(Number(pair[1]!.value)).toBe(0);
    });

    test("re-setting same mark overwrites previous entry", async () => {
      const editor = await createStartedEditor("aaa\nbbb\nccc");
      editor.getInterpreter().execute("(cursor-move 0 1)");
      editor.getInterpreter().execute('(vim-mark-set "a")');
      editor.getInterpreter().execute("(cursor-move 2 2)");
      editor.getInterpreter().execute('(vim-mark-set "a")');
      const res = rightValue(editor.getInterpreter().execute('(vim-mark-get "a")') as any);
      const pair = res.value as V[];
      expect(Number(pair[0]!.value)).toBe(2);
      expect(Number(pair[1]!.value)).toBe(2);
    });

    test("get on unset mark returns nil", async () => {
      const editor = await createStartedEditor("hello");
      const res = rightValue(editor.getInterpreter().execute('(vim-mark-get "z")') as any);
      expect(res.type).toBe("nil");
    });

    test("clear removes a mark", async () => {
      const editor = await createStartedEditor("hello");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute('(vim-mark-set "a")');
      editor.getInterpreter().execute('(vim-mark-clear "a")');
      const res = rightValue(editor.getInterpreter().execute('(vim-mark-get "a")') as any);
      expect(res.type).toBe("nil");
    });
  });

  describe("vim-mark-jump exact (backtick)", () => {
    test("jumps to exact line and column", async () => {
      const editor = await createStartedEditor("hello\nworld\nfoo");
      editor.getInterpreter().execute("(cursor-move 2 2)");
      editor.getInterpreter().execute('(vim-mark-set "a")');
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute('(vim-mark-jump "a" t)');
      expect(cursor(editor)).toEqual([2, 2]);
    });
  });

  describe("vim-mark-jump line (apostrophe)", () => {
    test("jumps to mark's line at first non-blank", async () => {
      const editor = await createStartedEditor("hello\n  world\nfoo");
      editor.getInterpreter().execute("(cursor-move 1 4)");
      editor.getInterpreter().execute('(vim-mark-set "a")');
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute('(vim-mark-jump "a" nil)');
      const [line, col] = cursor(editor);
      expect(line).toBe(1);
      expect(col).toBe(2);
    });
  });

  describe("pending state machine", () => {
    test("begin-set sets pending, reset clears it", async () => {
      const editor = await createStartedEditor("hello");
      editor.getInterpreter().execute("(vim-mark-begin-set)");
      expect(rightValue(editor.getInterpreter().execute("(vim-mark-pending-p)") as any).value).toBe(true);
      editor.getInterpreter().execute("(vim-mark-reset-pending)");
      expect(rightValue(editor.getInterpreter().execute("(vim-mark-pending-p)") as any).value).toBe(false);
    });

    test("dispatch-mark set consumes a register and stores position", async () => {
      const editor = await createStartedEditor("hello\nworld");
      editor.getInterpreter().execute("(cursor-move 1 3)");
      editor.getInterpreter().execute("(vim-mark-begin-set)");
      editor.getInterpreter().execute('(vim-dispatch-mark "b")');
      const res = rightValue(editor.getInterpreter().execute('(vim-mark-get "b")') as any);
      const pair = res.value as V[];
      expect(Number(pair[0]!.value)).toBe(1);
      expect(Number(pair[1]!.value)).toBe(3);
      expect(rightValue(editor.getInterpreter().execute("(vim-mark-pending-p)") as any).value).toBe(false);
    });

    test("dispatch-mark jump-line jumps via pending state", async () => {
      const editor = await createStartedEditor("hello\n  world\nfoo");
      editor.getInterpreter().execute("(cursor-move 1 4)");
      editor.getInterpreter().execute("(vim-mark-begin-set)");
      editor.getInterpreter().execute('(vim-dispatch-mark "a")');
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-mark-begin-jump-line)");
      editor.getInterpreter().execute('(vim-dispatch-mark "a")');
      const [line, col] = cursor(editor);
      expect(line).toBe(1);
      expect(col).toBe(2);
    });
  });

  describe("Jumping to an unset mark", () => {
    test("jump on unset mark returns nil and does not move cursor", async () => {
      const editor = await createStartedEditor("hello");
      editor.getInterpreter().execute("(cursor-move 0 3)");
      const before = cursor(editor);
      const res = rightValue(editor.getInterpreter().execute('(vim-mark-jump "z" t)') as any);
      expect(res.type).toBe("nil");
      expect(cursor(editor)).toEqual(before);
    });
  });

  test("marks never mutate the buffer", async () => {
    const editor = await createStartedEditor("hello\nworld");
    editor.getInterpreter().execute("(cursor-move 1 2)");
    editor.getInterpreter().execute('(vim-mark-set "a")');
    editor.getInterpreter().execute('(vim-mark-jump "a" true)');
    expect(bufferText(editor)).toBe("hello\nworld");
  });
});

// SPEC-067 — verify the marks BINDINGS route ma / `a / 'a through the
// normal-mode handler (the eval-based tests above call vim-mark-* directly).
describe("SPEC-067 — marks keypress bindings", () => {
  async function press(editor: Editor, keys: string): Promise<void> {
    for (const key of keys) {
      await editor.handleKey(key);
    }
  }

  function line(editor: Editor): number {
    return Number(rightValue(editor.getInterpreter().execute("(cursor-line)") as any).value);
  }

  function col(editor: Editor): number {
    return Number(rightValue(editor.getInterpreter().execute("(cursor-column)") as any).value);
  }

  test("ma sets a mark and `a jumps back to the exact position", async () => {
    const editor = await createStartedEditor("hello\nworld\nfoo");
    editor.getInterpreter().execute("(cursor-move 2 2)");
    await press(editor, "ma");
    editor.getInterpreter().execute("(cursor-move 0 0)");
    await press(editor, "`a");
    expect(line(editor)).toBe(2);
    expect(col(editor)).toBe(2);
  });

  test("'a jumps to the mark's line at first non-blank", async () => {
    const editor = await createStartedEditor("hello\n  world\nfoo");
    editor.getInterpreter().execute("(cursor-move 1 4)");
    await press(editor, "ma");
    editor.getInterpreter().execute("(cursor-move 0 0)");
    await press(editor, "'a");
    expect(line(editor)).toBe(1);
    expect(col(editor)).toBe(2); // first non-blank of "  world"
  });
});
