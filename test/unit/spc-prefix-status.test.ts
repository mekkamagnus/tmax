/**
 * @file spc-prefix-status.test.ts
 * @description #247 — the "SPC-" leader indicator (editor-handle-space) is
 *   transient input state: it must not survive the resolution of the leader
 *   sequence. Pre-fix it stayed in statusMessage through the whole M-x
 *   session (covered by the minibuffer while open) and resurfaced as a stale
 *   "SPC-" when the minibuffer closed; only a second Escape cleared it.
 *   Cleared now where the sequence resolves (the two lookup branches in
 *   normal-handler.ts, mirroring #125's spacePressed clearing), guarded to
 *   the bare indicator so a real status message always wins.
 */

import { describe, expect, it } from "bun:test";
import type { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

const status = (editor: Editor): string => editor.getEditorState().statusMessage ?? "";

describe("#247: SPC- leader indicator is transient", () => {
  it("clean exit: SPC ; → Escape leaves no stale SPC- indicator", async () => {
    const editor = await createStartedEditor("");
    await editor.handleKey(" ");
    expect(status(editor)).toBe("SPC-"); // the indicator itself still shows
    await editor.handleKey(";");
    expect(editor.getEditorState().mode).toBe("mx");
    expect(status(editor)).toBe(""); // consumed with the leader
    await editor.handleKey("Escape");
    expect(editor.getEditorState().mode).toBe("normal");
    expect(status(editor)).toBe("");
  });

  it("reported path: SPC ; → no-match filter → Enter → Escape leaves no stale indicator", async () => {
    const editor = await createStartedEditor("");
    await editor.handleKey(" ");
    await editor.handleKey(";");
    for (const key of "zzzzno") await editor.handleKey(key);
    await editor.handleKey("Enter"); // no match — minibuffer stays open
    await editor.handleKey("Escape");
    expect(editor.getEditorState().mode).toBe("normal");
    expect(status(editor)).not.toBe("SPC-");
    expect(status(editor)).toBe("");
  });

  it("SPC x b (whichKeyPrefix branch) → Escape leaves no stale indicator", async () => {
    const editor = await createStartedEditor("");
    await editor.handleKey(" ");
    await editor.handleKey("x");
    await editor.handleKey("b");
    // switch-buffer opens its minibuffer; escape it.
    expect(editor.getEditorState().mode).toBe("mx");
    await editor.handleKey("Escape");
    expect(editor.getEditorState().mode).toBe("normal");
    expect(status(editor)).not.toBe("SPC-");
  });

  it("guard: a real status message set between SPC and the next key survives", async () => {
    const editor = await createStartedEditor("");
    await editor.handleKey(" "); // indicator on, leader pending
    // An async command's feedback lands between keystrokes (e.g. save
    // completing) — the indicator clear must not clobber it.
    executeTlisp(editor, '(editor-set-status "Wrote /tmp/f.md")');
    await editor.handleKey(";");
    expect(status(editor)).toBe("Wrote /tmp/f.md");
  });

  it("unbound leader key still reports Unbound key: SPC z", async () => {
    const editor = await createStartedEditor("");
    await editor.handleKey(" ");
    await editor.handleKey("z");
    expect(status(editor)).toContain("Unbound key");
  });

  it("bare SPC still shows the indicator", async () => {
    const editor = await createStartedEditor("");
    await editor.handleKey(" ");
    expect(status(editor)).toBe("SPC-");
    await editor.handleKey("Escape"); // cleanup
  });
});
