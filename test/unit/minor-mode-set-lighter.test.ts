import { describe, expect, test } from "bun:test";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// #211 (RFC-027 §UI, Phase 0) — minor-mode-set-lighter: mutate a registered
// mode's lighter at runtime; the next minor-mode-list-lighters render (which
// feeds the status line) reflects it. Persistent mode state, not the
// transient editor-set-status message slot.

function listLighters(editor: Awaited<ReturnType<typeof createStartedEditor>>): string[] {
  const result = executeTlisp(editor, "(minor-mode-list-lighters)");
  return (result.value as { value: string }[]).map((v) => String(v.value));
}

describe("#211 minor-mode-set-lighter", () => {
  test("mutates a registered mode's lighter; list-lighters reflects it on next render", async () => {
    const editor = await createStartedEditor();
    executeTlisp(editor, '(minor-mode-register "testdyn" "test dynamic lighter" "TST")');
    executeTlisp(editor, '(minor-mode-set "testdyn" t)');

    // Sanity: static lighter visible while active.
    expect(listLighters(editor)).toContain("TST");

    // Dynamic update — the persistent-state contract.
    const ret = executeTlisp(editor, '(minor-mode-set-lighter "testdyn" "dyn:42●")');
    expect(String(ret.value)).toBe("dyn:42●");
    expect(listLighters(editor)).toContain("dyn:42●");
    expect(listLighters(editor)).not.toContain("TST");

    // And again — repeated re-render per event is the intended use.
    executeTlisp(editor, '(minor-mode-set-lighter "testdyn" "dyn:43◉")');
    expect(listLighters(editor)).toContain("dyn:43◉");
  });

  test("minor-mode-lighter getter reflects the mutation too", async () => {
    const editor = await createStartedEditor();
    executeTlisp(editor, '(minor-mode-register "testget" "getter" "G")');
    executeTlisp(editor, '(minor-mode-set-lighter "testget" "G2")');
    expect(String(executeTlisp(editor, '(minor-mode-lighter "testget")').value)).toBe("G2");
  });

  test("unregistered mode name errors", async () => {
    const editor = await createStartedEditor();
    let threw = false;
    try { executeTlisp(editor, '(minor-mode-set-lighter "no-such-mode" "X")'); } catch { threw = true; }
    expect(threw).toBe(true);
  });

  test("arity and type validation", async () => {
    const editor = await createStartedEditor();
    executeTlisp(editor, '(minor-mode-register "testval" "validation" "V")');
    for (const expr of [
      '(minor-mode-set-lighter "testval")',
      '(minor-mode-set-lighter)',
      '(minor-mode-set-lighter 42 "X")',
      '(minor-mode-set-lighter "testval" 42)',
    ]) {
      let threw = false;
      try { executeTlisp(editor, expr); } catch { threw = true; }
      expect(threw).toBe(true);
    }
  });

  test("does not touch the transient status message slot", async () => {
    const editor = await createStartedEditor();
    executeTlisp(editor, '(minor-mode-register "testslot" "slot" "S")');
    executeTlisp(editor, '(editor-set-status "transient-msg")');
    executeTlisp(editor, '(minor-mode-set-lighter "testslot" "S2")');
    // The lighter changed; the transient status message is unaffected.
    expect(String(executeTlisp(editor, '(minor-mode-lighter "testslot")').value)).toBe("S2");
    expect(editor.getEditorState().statusMessage).toBe("transient-msg");
  });
});
