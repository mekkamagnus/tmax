/**
 * @file expandtab.test.ts
 * @description #144 — vim expandtab: when expand-tabs is non-nil, Tab inserts
 * spaces to the next tab-width stop; otherwise it inserts a literal \t.
 * Covers the cross-module setter path (:set et/noet/ts=N in command-line.tlisp
 * → set-expand-tabs/set-tab-width in insert-entries.tlisp).
 */

import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor } from "../helpers/editor-fixture.ts";

describe("#144 — expandtab (insert-tab spaces vs literal tab)", () => {
  function bufferText(editor: Editor): string {
    const result = editor.getInterpreter().execute("(buffer-text)") as any;
    if (result?._tag === "Right") return result.right.value;
    throw new Error("buffer-text failed");
  }

  function eval_(editor: Editor, expr: string): void {
    const result = editor.getInterpreter().execute(expr) as any;
    if (result?._tag === "Left") {
      throw new Error(`${expr} failed: ${result.left?.message}`);
    }
  }

  test("default: Tab inserts a literal tab character", async () => {
    const editor = await createStartedEditor("");
    eval_(editor, "(cursor-move 0 0)(insert-tab)");
    expect(bufferText(editor)).toBe("\t");
  });

  test("expand-tabs on, tab-width 4 at col 0 → 4 spaces", async () => {
    const editor = await createStartedEditor("");
    eval_(editor, '(funcall "set-expand-tabs" t)(funcall "set-tab-width" 4)');
    eval_(editor, "(cursor-move 0 0)(insert-tab)");
    expect(bufferText(editor)).toBe("    ");
  });

  test("expand-tabs on at col 2 → 2 spaces (next stop col 4)", async () => {
    const editor = await createStartedEditor("ab");
    eval_(editor, '(funcall "set-expand-tabs" t)(funcall "set-tab-width" 4)');
    eval_(editor, "(cursor-move 0 2)(insert-tab)");
    expect(bufferText(editor)).toBe("ab  ");
  });

  test("expand-tabs on at col 5 → 3 spaces (next stop col 8)", async () => {
    const editor = await createStartedEditor("abcde");
    eval_(editor, '(funcall "set-expand-tabs" t)(funcall "set-tab-width" 4)');
    eval_(editor, "(cursor-move 0 5)(insert-tab)");
    expect(bufferText(editor)).toBe("abcde   ");
  });

  test("set-tab-width 2 → 2-space tab stops", async () => {
    const editor = await createStartedEditor("");
    eval_(editor, '(funcall "set-expand-tabs" t)(funcall "set-tab-width" 2)');
    eval_(editor, "(cursor-move 0 0)(insert-tab)");
    expect(bufferText(editor)).toBe("  ");
  });

  test("expand-tabs off reverts to literal tab", async () => {
    const editor = await createStartedEditor("");
    eval_(editor, '(funcall "set-expand-tabs" t)(funcall "set-tab-width" 4)');
    eval_(editor, '(funcall "set-expand-tabs" nil)');
    eval_(editor, "(cursor-move 0 0)(insert-tab)");
    expect(bufferText(editor)).toBe("\t");
  });

  test(":set et enables spaces; :set noet reverts to tab", async () => {
    const editor = await createStartedEditor("");
    eval_(editor, '(editor-dispatch-command-line "set et")');
    eval_(editor, "(cursor-move 0 0)(insert-tab)");
    expect(bufferText(editor)).toBe("    ");
    eval_(editor, '(editor-dispatch-command-line "set noet")');
    eval_(editor, "(cursor-move 0 0)(buffer-delete-range 0 0 0 4)");
    eval_(editor, "(cursor-move 0 0)(insert-tab)");
    expect(bufferText(editor)).toBe("\t");
  });

  test(":set ts=2 changes the tab stop width", async () => {
    const editor = await createStartedEditor("");
    eval_(editor, '(editor-dispatch-command-line "set et")');
    eval_(editor, '(editor-dispatch-command-line "set ts=2")');
    eval_(editor, "(cursor-move 0 0)(insert-tab)");
    expect(bufferText(editor)).toBe("  ");
  });
});
