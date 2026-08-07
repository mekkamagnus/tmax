/**
 * @file t2-minor-modes.test.ts
 * @description #153 / SPEC-096 — T2 minor modes. indent-tabs-mode is functional
 * (per-buffer tabs via minor-mode-active-p); the other 6 are registered toggles
 * (behavior deferred to their respective subsystems).
 */

import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

function ok(editor: Editor, expr: string): any {
  const r = editor.getInterpreter().execute(expr) as any;
  if (r?._tag !== "Right") throw new Error(`${expr} failed: ${r?.left?.message ?? r}`);
  return r.right.value;
}
function txt(editor: Editor): string {
  return ok(editor, "(buffer-text)");
}

describe("#153 — T2 minor modes", () => {
  test("all seven modes are registered at startup", async () => {
    const editor = await createStartedEditor("");
    const all = ok(editor, "(minor-mode-list-all)") as any[];
    const names = all.map((v: any) => v.value as string);
    for (const name of ["indent-tabs", "font-lock", "subword", "highlight-changes", "auto-save", "abbrev", "flymake"]) {
      expect(names).toContain(name);
    }
  });

  test("indent-tabs-mode: ON → insert-tab inserts a literal \\t", async () => {
    const editor = await createStartedEditor("");
    executeTlisp(editor, "(cursor-move 0 0)(indent-tabs-mode t)");
    expect(ok(editor, '(minor-mode-active-p "indent-tabs")')).toBe(true);
    executeTlisp(editor, "(insert-tab)");
    expect(txt(editor)).toBe("\t");
  });

  test("indent-tabs-mode: OFF → falls back to global expand-tabs (default: literal \\t)", async () => {
    const editor = await createStartedEditor("");
    executeTlisp(editor, "(cursor-move 0 0)");
    // indent-tabs off, expand-tabs nil (default) → literal \t
    executeTlisp(editor, "(insert-tab)");
    expect(txt(editor)).toBe("\t");
  });

  test("indent-tabs-mode: OFF + expand-tabs on → spaces", async () => {
    const editor = await createStartedEditor("");
    executeTlisp(editor, '(cursor-move 0 0)(funcall "set-expand-tabs" t)(funcall "set-tab-width" 4)');
    executeTlisp(editor, "(insert-tab)");
    expect(txt(editor)).toBe("    ");
  });

  test("indent-tabs-mode: ON overrides expand-tabs (tabs even with expand-tabs on)", async () => {
    const editor = await createStartedEditor("");
    executeTlisp(editor, '(cursor-move 0 0)(funcall "set-expand-tabs" t)(indent-tabs-mode t)');
    executeTlisp(editor, "(insert-tab)");
    expect(txt(editor)).toBe("\t");
  });

  test("the 6 registered modes: toggle flips minor-mode-active-p", async () => {
    for (const name of ["font-lock", "subword", "highlight-changes", "auto-save", "abbrev", "flymake"]) {
      const editor = await createStartedEditor("");
      expect(ok(editor, `(minor-mode-active-p "${name}")`)).toBe(false);
      executeTlisp(editor, `(minor-mode-toggle "${name}")`);
      expect(ok(editor, `(minor-mode-active-p "${name}")`)).toBe(true);
      executeTlisp(editor, `(minor-mode-toggle "${name}")`);
      expect(ok(editor, `(minor-mode-active-p "${name}")`)).toBe(false);
    }
  });
});
