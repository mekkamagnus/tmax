/**
 * @file repeat-change.test.ts
 * @description SPEC-044 Phase 2.2 (Steps 2.D + 2.E) — `.` repeat last change.
 * Mirrors the operator+text-object test pattern: real editor, real keypresses,
 * asserts on end state (buffer text, cursor position, undo round-trip).
 * Phase 2.F (insert-mode capture: `i…<Esc>.`) is intentionally out of scope.
 */

import { describe, expect, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import {
  bufferText,
  createStartedEditor,
  executeTlisp,
} from "../helpers/editor-fixture.ts";

async function press(editor: Editor, keys: string): Promise<void> {
  for (const key of keys) {
    await editor.handleKey(key);
  }
}

function cursor(editor: Editor): [number, number] {
  const line = executeTlisp(editor, "(cursor-line)");
  const col = executeTlisp(editor, "(cursor-column)");
  return [line.value as number, col.value as number];
}

describe("SPEC-044 Phase 2.2 — . repeat last change", () => {
  test("`.` alone with no prior change shows status and does not crash", async () => {
    const editor = await createStartedEditor("hello world");
    await press(editor, ".");
    expect(bufferText(editor)).toBe("hello world");
  });

  test("dw then . deletes the next word", async () => {
    const editor = await createStartedEditor("alpha beta gamma");
    await press(editor, "dw");
    expect(bufferText(editor)).toBe("beta gamma");
    await press(editor, ".");
    expect(bufferText(editor)).toBe("gamma");
  });

  test("dd then . deletes the next line", async () => {
    const editor = await createStartedEditor("line1\nline2\nline3\nline4");
    await press(editor, "dd");
    expect(bufferText(editor)).toBe("line2\nline3\nline4");
    await press(editor, ".");
    expect(bufferText(editor)).toBe("line3\nline4");
  });

  test("x then . deletes the next char", async () => {
    const editor = await createStartedEditor("abcde");
    await press(editor, "x");
    expect(bufferText(editor)).toBe("bcde");
    await press(editor, ".");
    expect(bufferText(editor)).toBe("cde");
  });

  test("D then . deletes to end of next line", async () => {
    const editor = await createStartedEditor("hello world\nfoo bar baz");
    await press(editor, "D");
    expect(bufferText(editor)).toBe("\nfoo bar baz");
    await press(editor, "j");
    await press(editor, ".");
    expect(bufferText(editor)).toBe("\n");
  });

  test("diw then . deletes the next inner word", async () => {
    const editor = await createStartedEditor("one two three four");
    await press(editor, "diw");
    expect(bufferText(editor)).toBe(" two three four");
    await press(editor, "w");
    await press(editor, ".");
    expect(bufferText(editor)).toBe("  three four");
  });

  test("5. overrides the recorded count (dw recorded with count 1, replayed with 5)", async () => {
    const editor = await createStartedEditor("a b c d e f g");
    await press(editor, "dw");
    expect(bufferText(editor)).toBe("b c d e f g");
    await press(editor, "5.");
    // 5 consecutive word deletes from cursor 0
    expect(bufferText(editor)).toBe("g");
  });

  test("cursor movement alone does not change the dot-repeat target", async () => {
    const editor = await createStartedEditor("alpha beta gamma delta");
    await press(editor, "dw");
    expect(bufferText(editor)).toBe("beta gamma delta");
    await press(editor, "w");
    await press(editor, "w");
    await press(editor, ".");
    // . replays dw at the current cursor (on "delta"), deleting it.
    expect(bufferText(editor)).toBe("beta gamma ");
  });

  test("yanks are NOT recorded — yy then . does not double-yank", async () => {
    const editor = await createStartedEditor("hello\nworld");
    await press(editor, "yy");
    await press(editor, ".");
    // Buffer unchanged: yank doesn't mutate, and . after yank must not mutate either.
    expect(bufferText(editor)).toBe("hello\nworld");
  });

  test("replayed change is itself undoable as a separate step", async () => {
    const editor = await createStartedEditor("alpha beta gamma");
    await press(editor, "dw");
    await press(editor, ".");
    expect(bufferText(editor)).toBe("gamma");
    await press(editor, "u");
    // Single undo reverts only the last change (the . replay).
    expect(bufferText(editor)).toBe("beta gamma");
  });

  test("ciw records the change; . at a new word replays it", async () => {
    const editor = await createStartedEditor("foo bar baz");
    await press(editor, "ciw");
    await press(editor, "X");
    await editor.handleKey("Escape");
    expect(bufferText(editor)).toBe("X bar baz");
    await press(editor, "w");
    await press(editor, ".");
    // Replay: ciw was a change; the recorded combo is "ciw" which on replay
    // deletes the inner word and enters insert mode at the new cursor.
    // Insert-mode text capture (Phase 2.F) is out of scope, so the replayed
    // change only deletes the inner word and stops at insert mode.
    expect(bufferText(editor)).toBe("X  baz");
  });

  test("count multiplies — 2dw records as count=2 and . repeats the same 2-word delete", async () => {
    const editor = await createStartedEditor("a b c d e f g h");
    await press(editor, "2dw");
    expect(bufferText(editor)).toBe("c d e f g h");
    await press(editor, ".");
    expect(bufferText(editor)).toBe("e f g h");
  });

  test("cursor at the deleted char after rx, then . re-applies the replace", async () => {
    const editor = await createStartedEditor("aaaaa");
    await press(editor, "rx");
    expect(bufferText(editor)).toBe("xaaaa");
    await press(editor, "l");
    await press(editor, ".");
    expect(bufferText(editor)).toBe("xxaaa");
    expect(cursor(editor)).toEqual([0, 1]);
  });
});
