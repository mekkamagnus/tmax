/**
 * @file code-major-modes.test.ts
 * @description #151 / SPEC-095 — typescript/python/go/lisp major modes are
 * functional: highlighting on activation, working indent (the engine now APPLIES
 * the calculated column; rules stored directly, 4-backslash-escaped), and a
 * per-mode reindent-buffer command (g =).
 */

import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

function ok(editor: Editor, expr: string): any {
  const r = editor.getInterpreter().execute(expr) as any;
  if (r?._tag !== "Right") throw new Error(`${expr} failed: ${r?.left?.message ?? r}`);
  return r.right.value;
}
function line(editor: Editor, n: number): string {
  return ok(editor, `(buffer-line ${n})`);
}
async function withMode(mode: string, content: string): Promise<Editor> {
  const editor = await createStartedEditor(content);
  executeTlisp(editor, `(major-mode-set "${mode}")`);
  return editor;
}

describe("#151 — code major modes: highlight + indent + reindent-buffer", () => {
  test("each mode sets its syntax language (highlighting)", async () => {
    for (const mode of ["typescript", "python", "go", "lisp"]) {
      const editor = await withMode(mode, "");
      expect(ok(editor, "(syntax-get-language)")).toBe(mode);
    }
  });

  test("reindent-buffer indents a line after '{' and dedents '}' (typescript)", async () => {
    const editor = await withMode("typescript", "{\nx\n}");
    ok(editor, "(reindent-buffer)");
    expect(line(editor, 1)).toBe("    x");
    expect(line(editor, 2)).toBe("}");
  });

  test("reindent-buffer indents EVERY body line (multi-line; WeakMap re-key)", async () => {
    // Catches the buffer-swap orphaning: each apply returns a new immutable
    // TextBuffer, so the rules must be re-keyed or only line 1 gets indented.
    const editor = await withMode("typescript", "{\nx\ny\nz\n}");
    ok(editor, "(reindent-buffer)");
    expect(line(editor, 1)).toBe("    x");
    expect(line(editor, 2)).toBe("    y");
    expect(line(editor, 3)).toBe("    z");
    expect(line(editor, 4)).toBe("}");
  });

  test("reindent-buffer indents a line after '{' (go)", async () => {
    const editor = await withMode("go", "{\nx\n}");
    ok(editor, "(reindent-buffer)");
    expect(line(editor, 1)).toBe("    x");
    expect(line(editor, 2)).toBe("}");
  });

  test("reindent-buffer indents a body line after 'if x:' (python)", async () => {
    const editor = await withMode("python", "if x:\nbody");
    ok(editor, "(reindent-buffer)");
    expect(line(editor, 1)).toBe("    body");
  });

  test("reindent-buffer indents a line after '(' (lisp)", async () => {
    const editor = await withMode("lisp", "(\nx");
    ok(editor, "(reindent-buffer)");
    expect(line(editor, 1)).toBe("    x");
  });

  test("indent-apply-line applies (no longer calculate-only)", async () => {
    const editor = await withMode("typescript", "{\nx\n}");
    ok(editor, "(indent-apply-line 1)");
    expect(line(editor, 1)).toBe("    x");
  });

  test("indent-on-Enter: pressing Enter after '{' auto-indents the new line (electric-indent)", async () => {
    // The real Enter flow: insert-newline (swaps the immutable buffer) THEN
    // post-newline-hook → indent-apply-line. Rules must survive the swap (editor
    // setCurrentBuffer migrates indentRulesByBuffer) and the apply must handle the
    // trailing empty line (insert, not replace). Multiple Enters must all indent.
    const editor = await withMode("typescript", "{");
    ok(editor, "(cursor-move 0 1)(insert-newline)(post-newline-hook)");
    expect(line(editor, 1)).toBe("    ");
    ok(editor, "(insert-newline)(post-newline-hook)");
    expect(line(editor, 2)).toBe("    ");
  });

  test("reindent-buffer is reachable via the g = keymap binding in each mode", async () => {
    const bufFor: Record<string, string> = {
      typescript: "{\nx\n}", python: "if x:\nbody", go: "{\nx\n}", lisp: "(\nx",
    };
    for (const mode of ["typescript", "python", "go", "lisp"]) {
      const editor = await withMode(mode, bufFor[mode]!);
      ok(editor, "(reindent-buffer)");
      expect(line(editor, 1)).toMatch(/^\s/); // gained indent
    }
  });
});
