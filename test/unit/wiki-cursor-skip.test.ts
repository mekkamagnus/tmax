/**
 * @file wiki-cursor-skip.test.ts
 * @description #333 — h/l never rest inside the wiki-link display
 *   transform's zero-width delimiter zones. The h/l bindings run a
 *   post-move skip (cursor-skip-hidden → scan-visible-column): a
 *   horizontal move that lands on a hidden column (inside ]] or [[, or an
 *   alias's `target|` prefix) snaps the BUFFER cursor to the nearest
 *   visible column in the move direction, so the cursor never appears
 *   frozen crossing a link boundary.
 */

import { describe, expect, test } from "bun:test";
import type { Editor } from "../../src/editor/editor.ts";
import { executeTlisp, setupMdEditor } from "../helpers/editor-fixture.ts";

/** The #333 reproduction line. Raw columns: `[[` 10-11, "wiki-link" 12-20
 *  (the visible span), `]]` 21-22, "." 23. Hidden zones: {10,11} {21,22}. */
const LINE = "Some text [[wiki-link]]. next";

async function setup(content: string, filename = "note.md"): Promise<Editor> {
  const editor = await setupMdEditor(content, filename);
  // Production parity: find-file runs major-mode-auto-detect after
  // set-buffer-filename; the fixture's createBuffer path does not.
  executeTlisp(editor, "(major-mode-auto-detect)");
  return editor;
}

async function press(editor: Editor, keys: string): Promise<void> {
  for (const key of keys) await editor.handleKey(key);
}

function cursor(editor: Editor): [number, number] {
  const line = executeTlisp(editor, "(cursor-line)");
  const col = executeTlisp(editor, "(cursor-column)");
  return [line.value as number, col.value as number];
}

describe("#333 — h/l skip zero-width wiki-link delimiter zones", () => {
  test("h from after ]] lands on the last visible char, not inside the delimiters", async () => {
    const editor = await setup(LINE);
    executeTlisp(editor, "(cursor-move 0 23)"); // on "."
    await press(editor, "h");
    // Without the fix the buffer cursor rests on a hidden "]" (cols 21/22)
    // whose display column equals col 20's — the cursor looks frozen.
    expect(cursor(editor)).toEqual([0, 20]); // "k" — last visible char
  });

  test("every h press moves the cursor — no frozen keypresses crossing the boundary", async () => {
    const editor = await setup(LINE);
    executeTlisp(editor, "(cursor-move 0 24)"); // on the space after "."
    await press(editor, "h");
    expect(cursor(editor)).toEqual([0, 23]); // "." — plain step
    await press(editor, "h");
    expect(cursor(editor)).toEqual([0, 20]); // skips ]] entirely
    await press(editor, "h");
    expect(cursor(editor)).toEqual([0, 19]); // "n" — plain step again
  });

  test("l from before [[ lands on the first visible char", async () => {
    const editor = await setup(LINE);
    executeTlisp(editor, "(cursor-move 0 9)"); // on the space before "[["
    await press(editor, "l");
    expect(cursor(editor)).toEqual([0, 12]); // "w" — first visible char
  });

  test("h from the first visible char skips the whole [[ prefix to before the link", async () => {
    const editor = await setup(LINE);
    executeTlisp(editor, "(cursor-move 0 12)"); // on "w"
    await press(editor, "h");
    expect(cursor(editor)).toEqual([0, 9]); // space before the link
  });

  test("alias links: h lands on the last display char and skips the target| prefix", async () => {
    const editor = await setup("see [[goals|the note]] x");
    executeTlisp(editor, "(cursor-move 0 22)"); // space after "]]"
    await press(editor, "h");
    expect(cursor(editor)).toEqual([0, 19]); // "e" of "note" — last visible
    executeTlisp(editor, "(cursor-move 0 12)"); // "t" of "the" — first visible
    await press(editor, "h");
    expect(cursor(editor)).toEqual([0, 3]); // space before the whole link
  });

  test("visual mode: h/l skip the zone too", async () => {
    const editor = await setup(LINE);
    executeTlisp(editor, "(cursor-move 0 23)");
    await press(editor, "v");
    await press(editor, "h");
    expect(cursor(editor)).toEqual([0, 20]);
  });

  test("no regression: non-markdown file steps into the visible brackets unchanged", async () => {
    const editor = await setup(LINE, "note.txt"); // transform inactive
    executeTlisp(editor, "(cursor-move 0 23)");
    await press(editor, "h");
    expect(cursor(editor)).toEqual([0, 22]); // on "]" — visible raw text
  });

  test("no regression: plain lines and line boundaries unchanged", async () => {
    const editor = await setup("hello world");
    executeTlisp(editor, "(cursor-move 0 6)");
    await press(editor, "h");
    expect(cursor(editor)).toEqual([0, 5]);
    executeTlisp(editor, "(cursor-move 0 4)");
    await press(editor, "l");
    expect(cursor(editor)).toEqual([0, 5]);
    executeTlisp(editor, "(cursor-move 0 0)");
    await press(editor, "h");
    expect(cursor(editor)).toEqual([0, 0]);
  });
});
