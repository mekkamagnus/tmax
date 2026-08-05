import { describe, expect, it } from "bun:test";
import type { Editor } from "../../src/editor/editor.ts";
import { createEditorFixture, executeTlisp } from "../helpers/editor-fixture.ts";

// BUG-59 regression guard. The C-w window chords (split/cycle/delete) dispatch
// correctly through the editor's keymap prefix path: pressing C-w (byte \x17)
// sets the which-key prefix, then the trailing key resolves the chord via
// keymap-ref. The original report misread a tmax-use playbook tokenization
// quirk (bare "C-w w" vs the angle-bracket "<C-w>w" form) as an editor defect.
// This test drives the real handleKey path so a future regression fails loudly.

function windowCount(editor: Editor): number {
  return executeTlisp(editor, "(window-count)").value as number;
}

function windowCurrent(editor: Editor): number {
  return executeTlisp(editor, "(window-current)").value as number;
}

async function chord(editor: Editor, trailing: string): Promise<void> {
  await editor.handleKey("\x17"); // C-w
  await editor.handleKey(trailing);
}

describe("BUG-59 C-w window chords dispatch via handleKey", () => {
  it("C-w s splits the window (count 1 -> 2)", async () => {
    const fixture = await createEditorFixture({ initialContent: "line one\nline two\nline three" });
    try {
      executeTlisp(fixture.editor, '(editor-set-mode "normal")');
      expect(windowCount(fixture.editor)).toBe(1);
      await chord(fixture.editor, "s");
      expect(windowCount(fixture.editor)).toBe(2);
    } finally {
      fixture.dispose();
    }
  });

  it("C-w v vertically splits the window (count grows)", async () => {
    const fixture = await createEditorFixture({ initialContent: "line one\nline two\nline three" });
    try {
      executeTlisp(fixture.editor, '(editor-set-mode "normal")');
      expect(windowCount(fixture.editor)).toBe(1);
      await chord(fixture.editor, "v");
      expect(windowCount(fixture.editor)).toBe(2);
    } finally {
      fixture.dispose();
    }
  });

  it("C-w w cycles the current window (current index advances)", async () => {
    const fixture = await createEditorFixture({ initialContent: "line one\nline two\nline three" });
    try {
      executeTlisp(fixture.editor, '(editor-set-mode "normal")');
      await chord(fixture.editor, "s"); // now two windows, current 0
      expect(windowCurrent(fixture.editor)).toBe(0);
      await chord(fixture.editor, "w");
      expect(windowCurrent(fixture.editor)).toBe(1);
    } finally {
      fixture.dispose();
    }
  });

  it("C-w q deletes the current window (count decreases)", async () => {
    const fixture = await createEditorFixture({ initialContent: "line one\nline two\nline three" });
    try {
      executeTlisp(fixture.editor, '(editor-set-mode "normal")');
      await chord(fixture.editor, "s");
      expect(windowCount(fixture.editor)).toBe(2);
      await chord(fixture.editor, "q");
      expect(windowCount(fixture.editor)).toBe(1);
    } finally {
      fixture.dispose();
    }
  });
});
