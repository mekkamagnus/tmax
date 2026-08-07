/**
 * @file markdown-comma-leader.test.ts
 * @description #157 gap 6 — the markdown `,`-leader keymap (`, b`/`, i`/…) must
 * dispatch in markdown mode. Before the fix, the global `,` binding
 * (vim-repeat-find-reverse) shadowed the major-mode leader, so `,`-prefixed
 * bindings never resolved. Also covers: `,` still = repeat-find-reverse outside
 * markdown (no regression), and `]`-prefix major-mode dispatch is unchanged.
 */

import { describe, test, expect } from "bun:test";
import { createStartedEditor, setupMdEditor, executeTlisp } from "../helpers/editor-fixture.ts";
import type { Editor } from "../../src/editor/editor.ts";

function txt(editor: Editor): string {
  const r = editor.getInterpreter().execute("(buffer-text)") as any;
  return r?._tag === "Right" ? r.right.value : "ERR";
}
async function mdEditor(content: string): Promise<Editor> {
  const editor = await setupMdEditor(content);
  // setupMdEditor does not auto-detect the major mode — activate it explicitly.
  executeTlisp(editor, '(major-mode-set "markdown")');
  return editor;
}
function status(editor: Editor): string {
  // Status line text lives on the model; read it via the interpreter-facing
  // message if available, else fall back to the rendered status row.
  const st = (editor as any).getModel?.()?.statusMessage;
  return typeof st === "string" ? st : "";
}

describe("#157 gap 6 — markdown comma-leader dispatches", () => {
  test(", b in a markdown buffer applies bold (markdown-toggle-bold)", async () => {
    const editor = await mdEditor("hello world");
    // cursor on "hello"
    await editor.handleKey(",");
    await editor.handleKey("b");
    // markdown-toggle-bold wraps the word/region in ** — the buffer must change
    // (it is NOT the unchanged "hello world" and NOT "Unbound key").
    expect(txt(editor)).toContain("**");
    expect(txt(editor)).not.toBe("hello world");
  });

  test(", b does not report 'Unbound key' in markdown mode", async () => {
    const editor = await mdEditor("hello world");
    await editor.handleKey(",");
    await editor.handleKey("b");
    expect(status(editor)).not.toMatch(/Unbound key: ,\s*b/);
  });

  test("regression: bracket-h still dispatches markdown-next-heading", async () => {
    // Two headings; `] h` jumps to the next heading. This exercises the same
    // isMajorModePrefix path my fix touched, for a key (`]`) with NO global
    // complete binding — behavior must be unchanged.
    const editor = await mdEditor("# one\nbody\n# two");
    await editor.handleKey("]");
    await editor.handleKey("h");
    // cursor should now be on the second heading line (line 2).
    const line = editor.getInterpreter().execute("(cursor-line)") as any;
    expect(line.right.value).toBe(2);
  });

  test("regression: , outside markdown is still vim-repeat-find-reverse (no leader prefix)", async () => {
    // In a fundamental (non-markdown) buffer, `,` must NOT start a leader —
    // isMajorModePrefix returns false (no major-mode `,` bindings) so the global
    // `,` binding (repeat-find-reverse) runs. We assert `,` does not produce a
    // which-key leader popup / "Unbound key" — it resolves to the global binding.
    const editor = await createStartedEditor("hello world");
    await editor.handleKey(",");
    // No exception, no "Unbound key" — the global binding executed.
    expect(status(editor)).not.toMatch(/Unbound key/);
  });
});
