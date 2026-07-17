/**
 * @file indent-ops.test.ts
 * @description SPEC-044 Phase 5 — indent + case operators (>>, <<, ~, guu, gUU, g~~).
 */

import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import {
  createStartedEditor,
} from "../helpers/editor-fixture.ts";

describe("SPEC-044 Phase 5 — indent + case operators", () => {
  /**
   * Helper: get the text of the current buffer.
   */
  function bufferText(editor: Editor): string {
    const result = editor.getInterpreter().execute("(buffer-text)") as any;
    if (result?._tag === "Right") return result.right.value;
    throw new Error("buffer-text failed");
  }

  /**
   * Helper: get cursor as [line, column].
   */
  function cursor(editor: Editor): [number, number] {
    const lineRes = editor.getInterpreter().execute("(cursor-line)") as any;
    const colRes = editor.getInterpreter().execute("(cursor-column)") as any;
    return [lineRes.right.value, colRes.right.value];
  }

  describe("Phase 5.E — ~ toggle-case-char", () => {
    test("toggles case of single char under cursor", async () => {
      const editor = await createStartedEditor("hello");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-toggle-case-char 1)");
      expect(bufferText(editor)).toBe("Hello");
    });

    test("toggles case of count chars and advances cursor", async () => {
      const editor = await createStartedEditor("abcdef");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-toggle-case-char 3)");
      expect(bufferText(editor)).toBe("ABCdef");
      expect(cursor(editor)).toEqual([0, 3]);
    });

    test("handles non-letter chars without corruption", async () => {
      const editor = await createStartedEditor("a.b.c");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-toggle-case-char 3)");
      expect(bufferText(editor)).toBe("A.B.c");
    });
  });

  describe("Phase 5.A — >> << line indent", () => {
    test(">> indents current line by shiftwidth", async () => {
      const editor = await createStartedEditor("hello");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-indent-line 1)");
      expect(bufferText(editor)).toBe("  hello");
    });

    test(">> indents count lines", async () => {
      const editor = await createStartedEditor("one\ntwo\nthree");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-indent-line 2)");
      expect(bufferText(editor)).toBe("  one\n  two\nthree");
    });

    test("<< outdents current line by shiftwidth", async () => {
      const editor = await createStartedEditor("    hello");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-outdent-line 1)");
      expect(bufferText(editor)).toBe("  hello");
    });

    test("<< outdents count lines", async () => {
      const editor = await createStartedEditor("  one\n  two\n  three");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-outdent-line 2)");
      expect(bufferText(editor)).toBe("one\ntwo\n  three");
    });

    test("<< on line with no indent is a no-op", async () => {
      const editor = await createStartedEditor("hello");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-outdent-line 1)");
      expect(bufferText(editor)).toBe("hello");
    });
  });

  describe("Phase 5.D — guu gUU g~~ case-line operators", () => {
    test("guu lowercases the current line", async () => {
      const editor = await createStartedEditor("HELLO World");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-lowercase-line)");
      expect(bufferText(editor)).toBe("hello world");
    });

    test("gUU uppercases the current line", async () => {
      const editor = await createStartedEditor("hello world");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-uppercase-line)");
      expect(bufferText(editor)).toBe("HELLO WORLD");
    });

    test("g~~ toggles case of every char in the line", async () => {
      const editor = await createStartedEditor("Hello World");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-toggle-case-line)");
      expect(bufferText(editor)).toBe("hELLO wORLD");
    });
  });

  describe("Undo bookend", () => {
    test("u after >> restores the original line", async () => {
      const editor = await createStartedEditor("hello");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-indent-line 1)");
      expect(bufferText(editor)).toBe("  hello");
      editor.getInterpreter().execute("(undo)");
      expect(bufferText(editor)).toBe("hello");
    });

    test("u after ~ restores the original char", async () => {
      const editor = await createStartedEditor("hello");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(vim-toggle-case-char 1)");
      expect(bufferText(editor)).toBe("Hello");
      editor.getInterpreter().execute("(undo)");
      expect(bufferText(editor)).toBe("hello");
    });
  });

  describe("Phase 5.C — visual >, <, ~", () => {
    test("> in visual mode indents each selected line", async () => {
      const editor = await createStartedEditor("one\ntwo\nthree");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(visual-enter-line-mode)");
      editor.getInterpreter().execute("(cursor-move 2 0)");
      editor.getInterpreter().execute("(visual-update-end)");
      editor.getInterpreter().execute("(vim-visual-indent)");
      expect(bufferText(editor)).toBe("  one\n  two\n  three");
    });

    test("< in visual mode outdents each selected line", async () => {
      const editor = await createStartedEditor("  one\n  two\n  three");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(visual-enter-line-mode)");
      editor.getInterpreter().execute("(cursor-move 2 0)");
      editor.getInterpreter().execute("(visual-update-end)");
      editor.getInterpreter().execute("(vim-visual-outdent)");
      expect(bufferText(editor)).toBe("one\ntwo\nthree");
    });

    test("~ in visual mode toggles case of selected chars", async () => {
      const editor = await createStartedEditor("hello world");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(visual-enter-char-mode)");
      editor.getInterpreter().execute("(cursor-move 0 4)");
      editor.getInterpreter().execute("(visual-update-end)");
      editor.getInterpreter().execute("(vim-visual-toggle-case)");
      expect(bufferText(editor)).toBe("HELLO world");
    });

    test("visual-mode operators exit to normal mode", async () => {
      const editor = await createStartedEditor("hello");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(visual-enter-char-mode)");
      editor.getInterpreter().execute("(cursor-move 0 2)");
      editor.getInterpreter().execute("(visual-update-end)");
      editor.getInterpreter().execute("(vim-visual-toggle-case)");
      const modeRes = editor.getInterpreter().execute('(editor-mode)') as any;
      expect(modeRes.right.value).toBe("normal");
    });

    test("u after visual > restores the original lines", async () => {
      const editor = await createStartedEditor("one\ntwo");
      editor.getInterpreter().execute("(cursor-move 0 0)");
      editor.getInterpreter().execute("(visual-enter-line-mode)");
      editor.getInterpreter().execute("(cursor-move 1 0)");
      editor.getInterpreter().execute("(visual-update-end)");
      editor.getInterpreter().execute("(vim-visual-indent)");
      expect(bufferText(editor)).toBe("  one\n  two");
      editor.getInterpreter().execute("(undo)");
      expect(bufferText(editor)).toBe("one\ntwo");
    });
  });
});

// SPEC-067 — verify the indent BINDINGS route >> / << / 2>> through the
// normal-mode handler (the eval tests above call vim-indent-line directly).
describe("SPEC-067 — indent keypress bindings", () => {
  async function press(editor: Editor, keys: string): Promise<void> {
    for (const key of keys) {
      await editor.handleKey(key);
    }
  }

  function bufferText(editor: Editor): string {
    const result = editor.getInterpreter().execute("(buffer-text)") as any;
    if (result?._tag === "Right") return result.right.value;
    throw new Error("buffer-text failed");
  }

  test(">> indents the current line by shiftwidth", async () => {
    const editor = await createStartedEditor("hello");
    editor.getInterpreter().execute("(cursor-move 0 0)");
    await press(editor, ">>");
    expect(bufferText(editor)).toBe("  hello");
  });

  test("<< outdents the current line by shiftwidth", async () => {
    const editor = await createStartedEditor("    hello");
    editor.getInterpreter().execute("(cursor-move 0 0)");
    await press(editor, "<<");
    expect(bufferText(editor)).toBe("  hello");
  });

  test("2>> indents two lines via count-prefix (SPEC-067 AC #3)", async () => {
    const editor = await createStartedEditor("one\ntwo\nthree");
    editor.getInterpreter().execute("(cursor-move 0 0)");
    await press(editor, "2>>");
    expect(bufferText(editor)).toBe("  one\n  two\nthree");
  });
});
