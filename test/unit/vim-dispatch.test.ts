/**
 * @file vim-dispatch.test.ts
 * @description Regression tests for SPEC-005 Vim dispatcher behavior.
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

describe("SPEC-005 Vim dispatcher", () => {
  test("starts without a file with a usable scratch buffer", async () => {
    const editor = await createStartedEditor();

    expect(editor.getState().currentBuffer).toBeDefined();
    expect(bufferText(editor)).toBe("");
  });

  test("handles insert-mode Enter, Backspace, and Tab through editor input", async () => {
    const editor = await createStartedEditor();

    await editor.handleKey("i");
    await editor.handleKey("a");
    await editor.handleKey("\n");
    await editor.handleKey("b");
    await editor.handleKey("\x7f");
    await editor.handleKey("\t");

    expect(bufferText(editor)).toBe("a\n\t");
    expect(editor.getState().mode).toBe("insert");
    expect(editor.getState().cursorPosition).toEqual({ line: 1, column: 1 });
  });

  test("joins lines when insert-mode Backspace is pressed at line start", async () => {
    const editor = await createStartedEditor("abc\ndef");

    await editor.handleKey("j");
    await editor.handleKey("i");
    await editor.handleKey("\x7f");

    expect(bufferText(editor)).toBe("abcdef");
    expect(editor.getState().cursorPosition).toEqual({ line: 0, column: 3 });
  });

  test("routes counted motions and gg through the T-Lisp dispatcher", async () => {
    const editor = await createStartedEditor("one\ntwo\nthree\nfour\nfive\nsix");

    await editor.handleKey("5");
    await editor.handleKey("j");
    expect(editor.getState().cursorPosition.line).toBe(5);

    await editor.handleKey("5");
    await editor.handleKey("g");
    await editor.handleKey("g");
    expect(editor.getState().cursorPosition.line).toBe(4);
  });

  test("handles counted find-char dispatch", async () => {
    const editor = await createStartedEditor("one two two");

    await editor.handleKey("2");
    await editor.handleKey("f");
    await editor.handleKey("t");

    expect(editor.getState().cursorPosition).toEqual({ line: 0, column: 8 });
  });

  test("repeats till-char motion without stopping at the same target", async () => {
    const editor = await createStartedEditor("abc abc abc");

    await editor.handleKey("t");
    await editor.handleKey("c");
    await editor.handleKey(";");

    expect(editor.getState().cursorPosition).toEqual({ line: 0, column: 5 });
  });

  test("handles counted dd at end of buffer", async () => {
    const editor = await createStartedEditor("one\ntwo\nthree");

    await editor.handleKey("3");
    await editor.handleKey("d");
    await editor.handleKey("d");

    expect(bufferText(editor)).toBe("");
    expect(editor.getState().cursorPosition).toEqual({ line: 0, column: 0 });
  });

  test("handles insert-entry commands through the dispatcher", async () => {
    const editor = await createStartedEditor("abc\ndef");

    await editor.handleKey("o");
    await editor.handleKey("X");

    expect(bufferText(editor)).toBe("abc\nX\ndef");
    expect(editor.getState().mode).toBe("insert");
    expect(editor.getState().cursorPosition).toEqual({ line: 1, column: 1 });
  });

  test("positions all insert-entry commands correctly", async () => {
    const append = await createStartedEditor("abc");
    await append.handleKey("a");
    expect(append.getState().mode).toBe("insert");
    expect(append.getState().cursorPosition).toEqual({ line: 0, column: 1 });

    const appendLine = await createStartedEditor("abc");
    await appendLine.handleKey("A");
    expect(appendLine.getState().mode).toBe("insert");
    expect(appendLine.getState().cursorPosition).toEqual({ line: 0, column: 3 });

    const lineStart = await createStartedEditor("  abc");
    await lineStart.handleKey("I");
    expect(lineStart.getState().mode).toBe("insert");
    expect(lineStart.getState().cursorPosition).toEqual({ line: 0, column: 2 });

    const openAbove = await createStartedEditor("abc");
    await openAbove.handleKey("O");
    await openAbove.handleKey("X");
    expect(bufferText(openAbove)).toBe("X\nabc");
  });

  test("dispatches single-key edit commands", async () => {
    const deleteToEnd = await createStartedEditor("abc def");
    await press(deleteToEnd, "llD");
    expect(bufferText(deleteToEnd)).toBe("ab");

    const changeToEnd = await createStartedEditor("abc def");
    await press(changeToEnd, "llC");
    expect(bufferText(changeToEnd)).toBe("ab");
    expect(changeToEnd.getState().mode).toBe("insert");

    const yankToEnd = await createStartedEditor("abc def");
    await press(yankToEnd, "llY0P");
    expect(bufferText(yankToEnd)).toBe("c defabc def");

    const join = await createStartedEditor("one\ntwo");
    await join.handleKey("J");
    expect(bufferText(join)).toBe("one two");
  });

  test("dispatches delete operator motions and count combinations", async () => {
    const deleteWord = await createStartedEditor("one two three four");
    await press(deleteWord, "d3w");
    expect(bufferText(deleteWord)).toBe("four");

    const prefixCount = await createStartedEditor("one two three four");
    await press(prefixCount, "3dw");
    expect(bufferText(prefixCount)).toBe("four");

    const deleteEnd = await createStartedEditor("abc def");
    await press(deleteEnd, "lld$");
    expect(bufferText(deleteEnd)).toBe("ab");

    const deleteLast = await createStartedEditor("one\ntwo\nthree");
    await press(deleteLast, "jdG");
    expect(bufferText(deleteLast)).toBe("one");

    const deleteFirst = await createStartedEditor("one\ntwo\nthree");
    await press(deleteFirst, "jdgg");
    expect(bufferText(deleteFirst)).toBe("three");
  });

  test("dispatches change and yank operator motions", async () => {
    const changeWord = await createStartedEditor("one two");
    await press(changeWord, "cw");
    expect(bufferText(changeWord)).toBe(" two");
    expect(changeWord.getState().mode).toBe("insert");

    const changeLine = await createStartedEditor("one\ntwo\nthree");
    await press(changeLine, "2cc");
    expect(bufferText(changeLine)).toBe("\nthree");
    expect(changeLine.getState().mode).toBe("insert");

    const changeEnd = await createStartedEditor("abc def");
    await press(changeEnd, "llc$");
    expect(bufferText(changeEnd)).toBe("ab");
    expect(changeEnd.getState().mode).toBe("insert");

    const yankLine = await createStartedEditor("one\ntwo");
    await press(yankLine, "yyp");
    expect(bufferText(yankLine)).toBe("one\none\ntwo");

    const yankWord = await createStartedEditor("one two");
    await press(yankWord, "ywwP");
    expect(bufferText(yankWord)).toBe("one onetwo");

    const yankEnd = await createStartedEditor("abc def");
    await press(yankEnd, "lly$0P");
    expect(bufferText(yankEnd)).toBe("c defabc def");
  });

  test("updates the unnamed register for x and linewise deletes", async () => {
    const editor = await createStartedEditor("abc");

    await editor.handleKey("x");
    await editor.handleKey("p");
    expect(bufferText(editor)).toBe("bac");

    editor.createBuffer("lines", "one\ntwo\nthree");
    await editor.handleKey("d");
    await editor.handleKey("d");
    await editor.handleKey("p");
    expect(bufferText(editor)).toBe("two\none\nthree");
  });

  test("records a counted operator as one undoable edit", async () => {
    const editor = await createStartedEditor("one two three four");

    await editor.handleKey("2");
    await editor.handleKey("d");
    await editor.handleKey("w");
    expect(bufferText(editor)).toBe("three four");

    await editor.handleKey("u");
    expect(bufferText(editor)).toBe("one two three four");
  });

  test("cancels pending dispatcher state", async () => {
    const editor = await createStartedEditor("one two");

    await press(editor, "3d");
    await editor.handleKey("\x1b");
    await editor.handleKey("w");

    expect(bufferText(editor)).toBe("one two");
    expect(editor.getState().cursorPosition.column).toBe(4);
  });

  test("dispatches find repeats, bracket matching, and paragraph motions", async () => {
    const find = await createStartedEditor("abca bca");
    await press(find, "fc;");
    expect(find.getState().cursorPosition.column).toBe(6);
    await find.handleKey(",");
    expect(find.getState().cursorPosition.column).toBe(2);

    const bracket = await createStartedEditor("(one\n two)");
    await bracket.handleKey("%");
    expect(bracket.getState().cursorPosition).toEqual({ line: 1, column: 4 });

    const paragraph = await createStartedEditor("one\n\ntwo\n\nthree");
    await paragraph.handleKey("}");
    expect(paragraph.getState().cursorPosition.line).toBe(1);
    await press(paragraph, "}}");
    expect(paragraph.getState().cursorPosition.line).toBe(4);
    await paragraph.handleKey("{");
    expect(paragraph.getState().cursorPosition.line).toBe(3);
  });

  test("dispatches each find-char direction and till variant", async () => {
    const forward = await createStartedEditor("abc abc");
    await press(forward, "fc");
    expect(forward.getState().cursorPosition.column).toBe(2);

    const tillForward = await createStartedEditor("abc abc");
    await press(tillForward, "tc");
    expect(tillForward.getState().cursorPosition.column).toBe(1);

    const backward = await createStartedEditor("abc abc");
    await press(backward, "$Fc");
    expect(backward.getState().cursorPosition.column).toBe(2);

    const tillBackward = await createStartedEditor("abc abc");
    await press(tillBackward, "$Tc");
    expect(tillBackward.getState().cursorPosition.column).toBe(3);
  });

  test("dispatches viewport alignment prefixes", async () => {
    const editor = await createStartedEditor(Array.from({ length: 50 }, (_, line) => String(line)).join("\n"));
    await press(editor, "30jzt");
    expect(editor.getState().viewportTop).toBe(30);

    await press(editor, "zz");
    expect(editor.getState().viewportTop).toBe(18);

    await press(editor, "zb");
    expect(editor.getState().viewportTop).toBe(8);
  });

  test("uses zero as a motion unless a count is already active", async () => {
    const editor = await createStartedEditor("0123456789abcdefghij");

    await press(editor, "10l");
    expect(editor.getState().cursorPosition.column).toBe(10);
    await editor.handleKey("0");
    expect(editor.getState().cursorPosition.column).toBe(0);
    await press(editor, "10l");
    expect(editor.getState().cursorPosition.column).toBe(10);
  });

  test("swaps the visual anchor and changes the selection", async () => {
    const editor = await createStartedEditor("abc");

    await editor.handleKey("v");
    await editor.handleKey("l");
    await editor.handleKey("o");
    expect(editor.getState().cursorPosition).toEqual({ line: 0, column: 0 });

    await editor.handleKey("c");
    expect(bufferText(editor)).toBe("bc");
    expect(editor.getState().mode).toBe("insert");
  });

  test("dispatches gt and gT through T-Lisp prefix state", async () => {
    const editor = await createStartedEditor();

    executeTlisp(editor, '(tab-new "one")');
    executeTlisp(editor, '(buffer-insert "A")');
    executeTlisp(editor, '(tab-new "two")');
    executeTlisp(editor, '(buffer-insert "B")');

    await editor.handleKey("g");
    await editor.handleKey("T");
    expect(bufferText(editor)).toBe("A");

    await editor.handleKey("g");
    await editor.handleKey("t");
    expect(bufferText(editor)).toBe("B");
  });

  test("dispatches C-w split, focus, resize, and close through T-Lisp", async () => {
    const editor = await createStartedEditor("one\ntwo");

    await press(editor, "\x17s");
    expect(editor.getState().windows).toHaveLength(2);

    await press(editor, "\x17w");
    expect(editor.getState().currentWindowIndex).toBe(1);

    const initialHeight = editor.getState().windows?.[1]?.height ?? 0;
    await press(editor, "\x17+");
    expect(editor.getState().windows?.[1]?.height).toBe(initialHeight + 1);

    await press(editor, "\x17q");
    expect(editor.getState().windows).toHaveLength(1);
  });

  test("allows active legacy prefixes to complete before Vim dispatch", async () => {
    const editor = await createStartedEditor();

    await editor.handleKey(" ");
    await editor.handleKey(";");

    expect(editor.getState().mode).toBe("mx");
  });

  test("keeps the TypeScript normal handler as a thin T-Lisp router", async () => {
    const normalSource = await Bun.file("src/editor/handlers/normal-handler.ts").text();
    const insertSource = await Bun.file("src/editor/handlers/insert-handler.ts").text();

    expect(normalSource).toContain("vim-dispatch-key");
    expect(normalSource).not.toContain("pendingNormalOperator");
    expect(normalSource).not.toContain("countPrefix");
    expect(insertSource).toContain("insert-backspace");
    expect(insertSource).not.toContain("buffer-delete-range");
  });
});
