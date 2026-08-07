/**
 * @file t1-minor-modes.test.ts
 * @description #149 / SPEC-092 — T1 minor modes. read-only / overwrite /
 * electric-pair / electric-indent are functional; truncate-lines / show-paren /
 * whitespace are registered toggles (visual render is a render-pipeline follow-up).
 */

import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor } from "../helpers/editor-fixture.ts";

function txt(editor: Editor): string {
  const r = editor.getInterpreter().execute("(buffer-text)") as any;
  return r?._tag === "Right" ? r.right.value : "ERR";
}
function col(editor: Editor): number {
  const r = editor.getInterpreter().execute("(cursor-column)") as any;
  return r?._tag === "Right" ? r.right.value : -1;
}
function run(editor: Editor, expr: string): any {
  return editor.getInterpreter().execute(expr) as any;
}
function ok(editor: Editor, expr: string): any {
  const r = run(editor, expr);
  if (r?._tag !== "Right") throw new Error(`${expr} failed: ${r?.left?.message ?? r}`);
  return r.right.value;
}
function asStringList(v: any): string[] {
  return v.map((x: any) => x.value as string);
}

describe("#149 — T1 minor modes", () => {
  test("all seven modes are registered at startup", async () => {
    const editor = await createStartedEditor("");
    const all = asStringList(ok(editor, "(minor-mode-list-all)"));
    for (const name of ["read-only", "overwrite", "electric-pair", "electric-indent", "truncate-lines", "show-paren", "whitespace"]) {
      expect(all).toContain(name);
    }
  });

  test("read-only-mode: enabled → buffer mutation is refused", async () => {
    const editor = await createStartedEditor("abc");
    ok(editor, '(cursor-move 0 0)(read-only-mode t)');
    expect(ok(editor, "(buffer-read-only-p)")).toBe(true);
    const insertResult = run(editor, '(buffer-insert "X")');
    expect(insertResult._tag).toBe("Left");
    expect(insertResult.left.message).toMatch(/read-only|ReadOnly/i);
    expect(txt(editor)).toBe("abc"); // unchanged
    ok(editor, "(read-only-mode nil)");
    expect(ok(editor, "(buffer-read-only-p)")).toBe(false);
    ok(editor, '(buffer-insert "X")');
    expect(txt(editor)).toBe("Xabc");
  });

  test("overwrite-mode: typing before EOL replaces the next char", async () => {
    const editor = await createStartedEditor("abc");
    ok(editor, '(cursor-move 0 0)(overwrite-mode t)');
    ok(editor, '(insert-char "X")');
    expect(txt(editor)).toBe("Xbc"); // replaced 'a', length unchanged
  });

  test("overwrite-mode: typing at EOL still inserts (nothing to replace)", async () => {
    const editor = await createStartedEditor("ab");
    ok(editor, '(cursor-move 0 2)(overwrite-mode t)');
    ok(editor, '(insert-char "X")');
    expect(txt(editor)).toBe("abX");
  });

  test("overwrite off → insert-char is a plain insert (default behavior)", async () => {
    const editor = await createStartedEditor("ab");
    ok(editor, '(cursor-move 0 0)');
    ok(editor, '(insert-char "X")');
    expect(txt(editor)).toBe("Xab");
  });

  test("electric-pair-mode: open delimiter inserts the pair, cursor between", async () => {
    const pairs: [string, string][] = [["(", ")"], ["[", "]"], ["{", "}"]];
    for (const [open, close] of pairs) {
      const editor = await createStartedEditor("");
      ok(editor, "(electric-pair-mode t)");
      ok(editor, `(insert-char "${open}")`);
      expect(txt(editor)).toBe(open + close);
      expect(col(editor)).toBe(1);
    }
  });

  test("electric-pair-mode: non-open char is a plain insert", async () => {
    const editor = await createStartedEditor("");
    ok(editor, "(electric-pair-mode t)");
    ok(editor, '(insert-char "a")');
    expect(txt(editor)).toBe("a");
  });

  test("electric-indent-mode: active by default at startup (preserves auto-indent)", async () => {
    const editor = await createStartedEditor("");
    expect(ok(editor, '(minor-mode-active-p "electric-indent")')).toBe(true);
  });

  test("electric-indent-mode: global toggle disables it", async () => {
    const editor = await createStartedEditor("");
    ok(editor, "(global-electric-indent-mode nil)");
    expect(ok(editor, '(minor-mode-active-p "electric-indent")')).toBe(false);
    // re-enable
    ok(editor, "(global-electric-indent-mode t)");
    expect(ok(editor, '(minor-mode-active-p "electric-indent")')).toBe(true);
  });

  test("truncate-lines / show-paren / whitespace: registered + toggle flips active-p", async () => {
    for (const name of ["truncate-lines", "show-paren", "whitespace"]) {
      const editor = await createStartedEditor("");
      expect(ok(editor, `(minor-mode-active-p "${name}")`)).toBe(false);
      ok(editor, `(minor-mode-toggle "${name}")`);
      expect(ok(editor, `(minor-mode-active-p "${name}")`)).toBe(true);
      ok(editor, `(minor-mode-toggle "${name}")`);
      expect(ok(editor, `(minor-mode-active-p "${name}")`)).toBe(false);
    }
  });
});
