/**
 * @file vim-yank-text-objects.test.ts
 * @description SPEC-069 Phase 2 — yank text-objects (yiw/yaw/yi"/yi'/ya)/ya{/ya[/ya</yit).
 *
 * Phase 1 unified operator×motion dispatch through vim-apply-region. Phase 2
 * does the same for text-objects: vim-operator-apply-text-object now computes
 * the region once via the text-object-region primitive and hands it to
 * vim-apply-region. The `y` operator path therefore yanks every text-object
 * class without a per-combo branch — it just sets register " and leaves the
 * buffer untouched.
 *
 * These tests assert the two yank invariants: the buffer is unchanged after
 * the yank, and register " holds exactly the text-object's region. Cursor
 * placement after yank is not asserted (vim moves it to region start; that is
 * covered indirectly by the change/delete suites).
 */

import { describe, expect, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import {
  bufferText,
  createStartedEditor,
  executeTlisp,
} from "../helpers/editor-fixture.ts";

async function press(editor: Editor, keys: string): Promise<void> {
  for (const key of keys) {
    await editor.handleKey(key);
  }
}

function getRegister(editor: Editor, name: string = '"'): string {
  const escaped = name === '"' ? '\\"' : name;
  const value = executeTlisp(editor, `(get-register "${escaped}")`);
  if (value.type === "nil") return "";
  if (value.type === "string") return value.value as string;
  throw new Error(`Register ${name} held unexpected type: ${value.type}`);
}

function moveTo(editor: Editor, line: number, column: number): void {
  executeTlisp(editor, `(cursor-move ${line} ${column})`);
}

describe("SPEC-069 Phase 2 — yank text-objects (buffer unchanged, register set)", () => {
  describe("word text-objects", () => {
    test("yiw yanks the inner word", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "yiw");
      expect(bufferText(editor)).toBe("hello world");
      expect(getRegister(editor)).toBe("hello");
    });

    test("yaw yanks the word with trailing space", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "yaw");
      expect(bufferText(editor)).toBe("hello world");
      expect(getRegister(editor)).toBe("hello ");
    });

    test("y3iw yanks three inner words (count composes)", async () => {
      const editor = await createStartedEditor("aa bb cc dd");
      await press(editor, "y3iw");
      expect(bufferText(editor)).toBe("aa bb cc dd");
      expect(getRegister(editor)).toBe("aa bb cc");
    });
  });

  describe("quote text-objects", () => {
    test("yi\" yanks inside double quotes", async () => {
      const editor = await createStartedEditor(`say "hi" there`);
      moveTo(editor, 0, 5); // on 'h' inside the quotes
      await press(editor, "yi\"");
      expect(bufferText(editor)).toBe(`say "hi" there`);
      expect(getRegister(editor)).toBe("hi");
    });

    test("ya\" yanks the quoted string including quotes", async () => {
      const editor = await createStartedEditor(`say "hi" there`);
      moveTo(editor, 0, 5); // on 'h'
      await press(editor, "ya\"");
      expect(bufferText(editor)).toBe(`say "hi" there`);
      expect(getRegister(editor)).toBe('"hi"');
    });

    test("yi' yanks inside single quotes", async () => {
      const editor = await createStartedEditor(`val 'xy' end`);
      moveTo(editor, 0, 5); // on 'x'
      await press(editor, "yi'");
      expect(bufferText(editor)).toBe(`val 'xy' end`);
      expect(getRegister(editor)).toBe("xy");
    });
  });

  describe("paired-delimiter text-objects", () => {
    test("ya) yanks the parenthesized group including parens", async () => {
      const editor = await createStartedEditor("(xy) tail");
      moveTo(editor, 0, 1); // on 'x'
      await press(editor, "ya)");
      expect(bufferText(editor)).toBe("(xy) tail");
      expect(getRegister(editor)).toBe("(xy)");
    });

    test("ya} yanks the braced group including braces", async () => {
      const editor = await createStartedEditor("{xy} tail");
      moveTo(editor, 0, 1); // on 'x'
      await press(editor, "ya}");
      expect(bufferText(editor)).toBe("{xy} tail");
      expect(getRegister(editor)).toBe("{xy}");
    });

    test("ya] yanks the bracketed group including brackets", async () => {
      const editor = await createStartedEditor("[xy] tail");
      moveTo(editor, 0, 1); // on 'x'
      await press(editor, "ya]");
      expect(bufferText(editor)).toBe("[xy] tail");
      expect(getRegister(editor)).toBe("[xy]");
    });

    test("ya< yanks the angle group including angles", async () => {
      const editor = await createStartedEditor("<xy> tail");
      moveTo(editor, 0, 1); // on 'x'
      await press(editor, "ya<");
      expect(bufferText(editor)).toBe("<xy> tail");
      expect(getRegister(editor)).toBe("<xy>");
    });
  });

  describe("tag text-object", () => {
    test("yit yanks the content between html tags", async () => {
      const editor = await createStartedEditor("<p>content</p>");
      moveTo(editor, 0, 3); // on 'c'
      await press(editor, "yit");
      expect(bufferText(editor)).toBe("<p>content</p>");
      expect(getRegister(editor)).toBe("content");
    });
  });
});
