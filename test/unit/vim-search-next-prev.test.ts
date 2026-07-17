import { describe, expect, it } from "bun:test";
import type { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// SPEC-067 — n / N (repeat search forward / backward).
//
// The search pattern is seeded with the `search-forward` primitive (which sets
// the last-search pattern AND jumps to the first match), then the n / N
// keypresses drive search-next / search-previous through the real normal-mode
// keymap. The `/` key itself is exercised in vim-bindings-smoke.test.ts.

async function press(editor: Editor, keys: string): Promise<void> {
  for (const key of keys) {
    await editor.handleKey(key);
  }
}

function line(editor: Editor): number {
  return executeTlisp(editor, "(cursor-line)").value as number;
}

const BUFFER = "start\nfoo\nbar\nfoo\nbaz\nfoo";

describe("SPEC-067 n / N search next/previous", () => {
  it("search-forward seeds the first match", async () => {
    const editor = await createStartedEditor(BUFFER);
    executeTlisp(editor, '(search-forward "foo")');
    // line 0 ("start") has no foo; first match is line 1.
    expect(line(editor)).toBe(1);
  });

  it("n advances to the next match forward", async () => {
    const editor = await createStartedEditor(BUFFER);
    executeTlisp(editor, '(search-forward "foo")');
    await press(editor, "n");
    expect(line(editor)).toBe(3);
  });

  it("N reverses to the previous match", async () => {
    const editor = await createStartedEditor(BUFFER);
    executeTlisp(editor, '(search-forward "foo")');
    await press(editor, "n"); // line 3
    await press(editor, "N"); // back to line 1
    expect(line(editor)).toBe(1);
  });

  it("repeated n walks forward through every match", async () => {
    const editor = await createStartedEditor(BUFFER);
    executeTlisp(editor, '(search-forward "foo")'); // line 1
    await press(editor, "n"); // line 3
    await press(editor, "n"); // line 5
    expect(line(editor)).toBe(5);
  });
});
