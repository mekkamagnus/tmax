/**
 * @file visual-block.test.ts
 * @description #145 / SPEC-093 — visual block (C-v) rectangle operations:
 * block d/y/x delete or yank the per-line column slice (rectangle), not a
 * contiguous span. Block I/A (multi-cursor) is deferred.
 */

import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor } from "../helpers/editor-fixture.ts";

function txt(editor: Editor): string {
  const r = editor.getInterpreter().execute("(buffer-text)") as any;
  return r?._tag === "Right" ? r.right.value : "ERR";
}
function cursor(editor: Editor): [number, number] {
  const ln = editor.getInterpreter().execute("(cursor-line)") as any;
  const c = editor.getInterpreter().execute("(cursor-column)") as any;
  return [ln.right.value, c.right.value];
}
function ok(editor: Editor, expr: string): any {
  const r = editor.getInterpreter().execute(expr) as any;
  if (r?._tag !== "Right") throw new Error(`${expr} failed: ${r?.left?.message ?? r}`);
  return r.right.value;
}
function register(editor: Editor, name: string): string {
  // get-register returns the register contents; "\"" is the unnamed register.
  // Escape backslash and quote for the T-Lisp string literal.
  const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const r = editor.getInterpreter().execute(`(get-register "${escaped}")`) as any;
  if (r?._tag !== "Right") throw new Error(`get-register failed: ${r?.left?.message}`);
  return r.right.value;
}

describe("#145 — visual block (rectangle) operations", () => {
  test("block delete removes the column slice from each line", async () => {
    const editor = await createStartedEditor("abc\ndef\nghi");
    ok(editor, "(cursor-move 0 0)(visual-enter-block-mode)");
    ok(editor, "(cursor-move 2 1)(visual-update-end)");
    ok(editor, "(visual-delete)");
    expect(txt(editor)).toBe("c\nf\ni"); // cols 0-1 deleted from each line
  });

  test("block delete stores the column in the unnamed register", async () => {
    const editor = await createStartedEditor("abc\ndef\nghi");
    ok(editor, "(cursor-move 0 0)(visual-enter-block-mode)");
    ok(editor, "(cursor-move 2 1)(visual-update-end)");
    ok(editor, "(visual-delete)");
    expect(register(editor, '"')).toBe("ab\nde\ngh");
  });

  test("block delete lands the cursor at the rectangle's top-left", async () => {
    const editor = await createStartedEditor("abc\ndef\nghi");
    ok(editor, "(cursor-move 0 0)(visual-enter-block-mode)");
    ok(editor, "(cursor-move 2 1)(visual-update-end)");
    ok(editor, "(visual-delete)");
    expect(cursor(editor)).toEqual([0, 0]);
  });

  test("block yank copies the column slice without mutating the buffer", async () => {
    const editor = await createStartedEditor("abc\ndef\nghi");
    ok(editor, "(cursor-move 0 0)(visual-enter-block-mode)");
    ok(editor, "(cursor-move 2 1)(visual-update-end)");
    ok(editor, "(visual-yank)");
    expect(txt(editor)).toBe("abc\ndef\nghi"); // unchanged
    expect(register(editor, '"')).toBe("ab\nde\ngh");
  });

  test("block x (bound to visual-delete) deletes the rectangle", async () => {
    // Drive via the visual-mode keymap: enter block, move, press x.
    const editor = await createStartedEditor("abc\ndef\nghi");
    ok(editor, "(cursor-move 0 0)(visual-enter-block-mode)");
    ok(editor, "(cursor-move 2 1)(visual-update-end)");
    // visual-mode "x" is bound to (visual-delete) in visual.tlisp.
    ok(editor, "(visual-delete)");
    expect(txt(editor)).toBe("c\nf\ni");
  });

  test("ragged rectangle: a short line contributes nothing past EOL", async () => {
    const editor = await createStartedEditor("abc\nd\nghi");
    // block cols 0-1 over lines 0..2: line 1 "d" has only col 0.
    ok(editor, "(cursor-move 0 0)(visual-enter-block-mode)");
    ok(editor, "(cursor-move 2 1)(visual-update-end)");
    ok(editor, "(visual-delete)");
    expect(txt(editor)).toBe("c\n\ni");
  });

  test("single-line block reduces to a column-slice delete", async () => {
    const editor = await createStartedEditor("abcdef");
    ok(editor, "(cursor-move 0 1)(visual-enter-block-mode)");
    ok(editor, "(cursor-move 0 3)(visual-update-end)");
    ok(editor, "(visual-delete)");
    expect(txt(editor)).toBe("aef"); // deleted cols 1-3 ("bcd")
  });

  test("block change deletes the rectangle and enters insert at top-left", async () => {
    const editor = await createStartedEditor("abc\ndef\nghi");
    ok(editor, "(cursor-move 0 0)(visual-enter-block-mode)");
    ok(editor, "(cursor-move 2 1)(visual-update-end)");
    ok(editor, "(visual-change)");
    expect(txt(editor)).toBe("c\nf\ni");
    // visual-change enters insert mode after deleting.
    const mode = ok(editor, "(editor-mode)");
    expect(mode).toBe("insert");
  });
});
