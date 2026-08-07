/** purescript-mode.test.ts — #166 / SPEC-098 */
import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

function ok(editor: Editor, expr: string): any {
  const r = editor.getInterpreter().execute(expr) as any;
  if (r?._tag !== "Right") throw new Error(`${expr} failed: ${r?.left?.message ?? r}`);
  return r.right.value;
}

describe("#166 — purescript-mode", () => {
  test("auto-detect .purs", async () => {
    const editor = await createStartedEditor("");
    expect(ok(editor, '(auto-mode-detect "Main.purs")')).toBe("purescript");
  });

  test("in major-mode-list", async () => {
    const editor = await createStartedEditor("");
    const modes = ok(editor, "(major-mode-list)") as any[];
    expect(modes.map((m: any) => m.value)).toContain("purescript");
  });

  test("major-mode-set activates without error", async () => {
    const editor = await createStartedEditor("");
    expect(ok(editor, '(major-mode-set "purescript")')).toBe("purescript");
    expect(ok(editor, "(major-mode-get)")).toBe("purescript");
  });

  test("indent rules work (where → indent body)", async () => {
    const editor = await createStartedEditor("f x = x\n  where\nfoo");
    executeTlisp(editor, '(major-mode-set "purescript")');
    ok(editor, "(indent-apply-line 2)");
    const line2 = ok(editor, "(buffer-line 2)");
    expect(line2).toMatch(/^\s/); // 'foo' should be indented after 'where'
  });
});
