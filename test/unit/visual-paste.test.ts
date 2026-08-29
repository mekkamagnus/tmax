/**
 * @file visual-paste.test.ts
 * @description SPEC-230 (#230): visual-mode paste-over-selection (p / P).
 * Covers: charwise replace + cursor + Vim register swap, P equivalence,
 * linewise (mid-buffer and through-EOF), blockwise, pending register
 * prefix, empty register, undo, and the vi"p end-to-end flow from the bug.
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

function getRegister(editor: Editor): string {
  const value = executeTlisp(editor, `(get-register "\\\"")`);
  if (value.type === "nil") return "";
  if (value.type === "string") return value.value as string;
  throw new Error(`Register " held unexpected type: ${value.type}`);
}

function setRegister(editor: Editor, text: string): void {
  executeTlisp(editor, `(set-register "\\\"" "${text}")`);
}

function moveTo(editor: Editor, line: number, column: number): void {
  executeTlisp(editor, `(cursor-move ${line} ${column})`);
}

const pos = (editor: Editor): [number, number] => [
  executeTlisp(editor, `(cursor-line)`).value as number,
  executeTlisp(editor, `(cursor-column)`).value as number,
];

const mode = (editor: Editor): string =>
  executeTlisp(editor, `(editor-mode)`).value as string;

describe("SPEC-230: visual paste over selection", () => {
  test("vi\"p replaces the quoted string, swaps the register, cursor on last pasted char", async () => {
    const editor = await createStartedEditor('say "hello world" out loud\nsecond line');
    // Yank "second" into the unnamed register (real yank path).
    moveTo(editor, 1, 0);
    await press(editor, "yiw");
    expect(getRegister(editor)).toBe("second");
    // Select the inner quoted string and paste over it.
    moveTo(editor, 0, 5);
    await press(editor, 'vi"');
    await press(editor, "p");
    expect(bufferText(editor)).toBe('say "second" out loud\nsecond line');
    // Vim swap: the replaced selection becomes the register.
    expect(getRegister(editor)).toBe("hello world");
    expect(mode(editor)).toBe("normal");
    // Cursor on the LAST character of the pasted text ('d' of second ends at col 10).
    expect(pos(editor)).toEqual([0, 10]);
  });

  test("P in visual mode behaves like p", async () => {
    const editor = await createStartedEditor('say "hello world" out loud');
    setRegister(editor, "XY");
    moveTo(editor, 0, 5);
    await press(editor, 'vi"');
    await press(editor, "P");
    expect(bufferText(editor)).toBe('say "XY" out loud');
    expect(getRegister(editor)).toBe("hello world");
    expect(mode(editor)).toBe("normal");
    expect(pos(editor)).toEqual([0, 6]);
  });

  test("backwards selection (anchor after cursor) pastes at the selection start", async () => {
    const editor = await createStartedEditor('say "hello world" out loud');
    setRegister(editor, "XY");
    // Enter visual at the far end, extend BACK to col 5 — start normalizes to 5.
    moveTo(editor, 0, 16);
    await press(editor, "v");
    moveTo(editor, 0, 5);
    await press(editor, "p");
    expect(bufferText(editor)).toBe('say "XY" out loud');
    expect(getRegister(editor)).toBe("hello world");
    expect(pos(editor)).toEqual([0, 6]);
  });

  test("V p replaces whole lines mid-buffer, cursor at first non-blank", async () => {
    const editor = await createStartedEditor("one\ntwo\nthree\nfour");
    setRegister(editor, "  padded\nfresh\n");
    moveTo(editor, 1, 0);
    await press(editor, "V");
    await press(editor, "p");
    expect(bufferText(editor)).toBe("one\n  padded\nfresh\nthree\nfour");
    expect(getRegister(editor)).toBe("two\n");
    expect(mode(editor)).toBe("normal");
    // First non-blank of the first pasted line.
    expect(pos(editor)).toEqual([1, 2]);
  });

  test("V p through end-of-buffer pastes below the last remaining line", async () => {
    const editor = await createStartedEditor("one\ntwo\nthree");
    setRegister(editor, "aa\nbb\n");
    moveTo(editor, 2, 0);
    await press(editor, "V");
    await press(editor, "p");
    expect(bufferText(editor)).toBe("one\ntwo\naa\nbb");
    expect(getRegister(editor)).toBe("three\n");
  });

  test("block paste re-inserts segments at the rectangle column", async () => {
    const editor = await createStartedEditor("aaaa first\nbbbb second\ncccc third");
    setRegister(editor, "XY\nZ");
    // Block-select the 2x2 rectangle at lines 0-1, cols 4-5 (covers " f" and " s").
    moveTo(editor, 0, 4);
    await press(editor, "\x16"); // C-v
    moveTo(editor, 1, 5);
    await press(editor, "p");
    // Rectangle deleted (" f" / " s"), segments re-inserted at the left column.
    expect(bufferText(editor)).toBe("aaaaXYirst\nbbbbZecond\ncccc third");
    expect(getRegister(editor)).toBe(" f\n s");
    expect(mode(editor)).toBe("normal");
  });

  test("empty register: status message, buffer unchanged", async () => {
    const editor = await createStartedEditor('say "hello" there');
    const before = bufferText(editor);
    moveTo(editor, 0, 5);
    await press(editor, 'vi"');
    executeTlisp(editor, `(set-register "\\\"" "")`);
    await press(editor, "p");
    expect(bufferText(editor)).toBe(before);
    expect(mode(editor)).toBe("visual");
    expect(editor.getState().statusMessage).toBe("Nothing to paste");
  });

  test("block paste with a reversed-column rectangle pastes at the true left edge (verify-gate)", async () => {
    const editor = await createStartedEditor("aaaa first\nbbbb second");
    setRegister(editor, "XY\nZ");
    // Anchor at (0,8) — RIGHT of the cursor column — cursor ends at (1,4).
    // Rectangle = lines 0-1 × cols 4-8 (" firs"/" seco" deleted), left edge 4.
    moveTo(editor, 0, 8);
    await press(editor, "\x16");
    moveTo(editor, 1, 4);
    await press(editor, "p");
    expect(bufferText(editor)).toBe("aaaaXYt\nbbbbZnd");
    expect(pos(editor)).toEqual([0, 4]);
  });

  test("block paste past EOF appends fully, register swaps, and one undo restores (verify-gate)", async () => {
    const editor = await createStartedEditor("one\ntwo");
    const before = bufferText(editor);
    setRegister(editor, "AA\nBB\nCC");
    // Block rectangle on the LAST two lines; 3 segments extend past EOF.
    moveTo(editor, 0, 2);
    await press(editor, "\x16");
    moveTo(editor, 1, 3);
    await press(editor, "p");
    // Rectangle col 2..clamped-EOL deleted ("e"/"o"); AA/BB re-inserted at
    // col 2, CC appended as a padded new line.
    expect(bufferText(editor)).toBe("onAA\ntwBB\n  CC");
    expect(getRegister(editor)).toBe("e\no");
    expect(mode(editor)).toBe("normal");
    executeTlisp(editor, `(undo)`);
    expect(bufferText(editor)).toBe(before);
  });

  test("visual paste is one undo step", async () => {
    const editor = await createStartedEditor('say "hello" out loud');
    const before = bufferText(editor);
    setRegister(editor, "XY");
    moveTo(editor, 0, 5);
    await press(editor, 'vi"');
    await press(editor, "p");
    expect(bufferText(editor)).toBe('say "XY" out loud');
    executeTlisp(editor, `(undo)`);
    expect(bufferText(editor)).toBe(before);
  });

  // #230 regression: V d / V y were broken pre-fix (zero-width line selection
  // span-deleted nothing / registered without the trailing newline).
  test("V d deletes whole lines (pre-existing linewise gap, fixed)", async () => {
    const editor = await createStartedEditor("one\ntwo\nthree");
    moveTo(editor, 1, 0);
    await press(editor, "V");
    await press(editor, "d");
    expect(bufferText(editor)).toBe("one\nthree");
    expect(getRegister(editor)).toBe("two\n");
    expect(mode(editor)).toBe("normal");
  });

  test("V y registers whole lines with trailing newline (linewise paste round-trip)", async () => {
    const editor = await createStartedEditor("one\ntwo\nthree");
    moveTo(editor, 1, 0);
    await press(editor, "V");
    await press(editor, "y");
    expect(getRegister(editor)).toBe("two\n");
    expect(bufferText(editor)).toBe("one\ntwo\nthree");
    // Round-trip: paste the linewise register on another line's V selection.
    moveTo(editor, 0, 0);
    await press(editor, "V");
    await press(editor, "p");
    // "one" replaced by the register's line: two/two/three.
    expect(bufferText(editor)).toBe("two\ntwo\nthree");
    expect(getRegister(editor)).toBe("one\n");
  });
});
