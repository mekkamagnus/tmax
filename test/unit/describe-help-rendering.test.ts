/**
 * @file describe-help-rendering.test.ts
 * @description #253/#254 — codex-found defects in the describe/help surface
 *   the M-x list invokes: (1) describe-mode's bindings section stringified
 *   the mapcar LIST into "[object Object],[object Object],…" (missing the
 *   codebase's string-join idiom); (2) switching to a special buffer left
 *   the STALE previous name in the status line (currentFilename became
 *   undefined for file-less buffers — now falls back to the buffer name);
 *   (3) the command table is now alphabetical (Emacs parity).
 */

import { describe, expect, it } from "bun:test";
import type { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

describe("#253: describe-mode help rendering", () => {
  it("binding lines render readably — no [object Object], real key → command lines", async () => {
    const editor = await createStartedEditor("");
    executeTlisp(editor, "(describe-mode)");
    const text = executeTlisp(editor, "(buffer-text)").value as string;
    expect(text).not.toContain("[object Object]");
    // A representative binding line: q is bound to macro-handle-q in normal mode.
    expect(text).toMatch(/q {2}→ {2}\[\(macro-handle-q\)\]/);
    expect(text).toContain("Key bindings:");
  });

  it("the help view is named *Help* in the status line after describe-mode", async () => {
    const editor = await createStartedEditor("");
    // The user flow: a prior file buffer (with a filename) → M-x describe-mode.
    executeTlisp(editor, '(buffer-create "notes")');
    executeTlisp(editor, '(buffer-switch "notes")');
    executeTlisp(editor, "(describe-mode)");
    const state = editor.getEditorState();
    // currentFilename stays undefined for special buffers (the :w guard and
    // mode-state key depend on that contract); the buffer NAME is what the
    // status line renders (#253).
    expect(state.currentFilename).toBeUndefined();
    expect(state.currentBufferName).toBe("*Help*");
    expect(executeTlisp(editor, "(buffer-name)").value).toBe("*Help*");
    // And the status line itself names *Help*:
    const { renderStatusLine } = await import("../../src/frontend/render/status-line.ts");
    const rendered = renderStatusLine(state, 100);
    const plain = rendered.replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain).toContain("*Help*");
  });
});

describe("#254: command table is alphabetical", () => {
  it("interactive-only candidates sort A→Z by name", async () => {
    const editor = await createStartedEditor("");
    const r = executeTlisp(editor, "(callable-command-details t)");
    const names = (r.value as any[]).map(
      (h: any) => (h.value as Map<string, any>).get("name")?.value as string,
    );
    expect(names.length).toBeGreaterThan(100);
    for (let i = 1; i < names.length; i++) {
      expect(names[i - 1]! <= names[i]!).toBe(true);
    }
  });
});
