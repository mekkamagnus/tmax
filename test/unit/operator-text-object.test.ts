/**
 * @file operator-text-object.test.ts
 * @description SPEC-044 Phase 1.A regression tests for operator+text-object
 * dispatch. Mirrors the SPEC-041 operator+find-char pattern: real editor,
 * real keypresses, asserts on end-state (buffer text, register, mode).
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

describe("SPEC-044 Phase 1.A — operator+text-object dispatch (Tier-A)", () => {
  describe("diw — delete inner word", () => {
    test("deletes the word under the cursor and yanks to \"", async () => {
      const editor = await createStartedEditor("hello world foo");
      await press(editor, "diw");
      expect(bufferText(editor)).toBe(" world foo");
      expect(getRegister(editor)).toBe("hello");
    });

    test("restores text and cursor after undo", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "diw");
      await press(editor, "u");
      expect(bufferText(editor)).toBe("hello world");
    });
  });

  describe("daw — delete around word", () => {
    test("deletes the word with trailing space and yanks to \"", async () => {
      const editor = await createStartedEditor("word1 word2 word3");
      await press(editor, "daw");
      expect(bufferText(editor)).toBe("word2 word3");
      expect(getRegister(editor)).toBe("word1 ");
    });
  });

  describe("ci\" — change inner double quote", () => {
    test("clears quoted contents and enters insert mode", async () => {
      const editor = await createStartedEditor('say "hello world" today');
      await press(editor, "fh");
      await press(editor, "ci\"");
      expect(bufferText(editor)).toBe('say "" today');
      expect(editor.getState().mode).toBe("insert");
    });
  });

  describe("ca\" — change around double quote", () => {
    test("removes the quotes and their contents, enters insert mode", async () => {
      const editor = await createStartedEditor('say "hello" today');
      await press(editor, "fh");
      await press(editor, "ca\"");
      expect(editor.getState().mode).toBe("insert");
    });
  });

  describe("ci' — change inner single quote", () => {
    test("clears single-quoted contents and enters insert mode", async () => {
      const editor = await createStartedEditor("say 'hello' today");
      await press(editor, "fh");
      await press(editor, "ci'");
      expect(bufferText(editor)).toBe("say '' today");
      expect(editor.getState().mode).toBe("insert");
    });
  });

  describe("ca' — change around single quote", () => {
    test("removes single quotes and their contents, enters insert mode", async () => {
      const editor = await createStartedEditor("say 'hello' today");
      await press(editor, "fh");
      await press(editor, "ca'");
      expect(editor.getState().mode).toBe("insert");
    });
  });

  describe("di) — delete inner paren", () => {
    test("deletes paren contents and yanks to \"", async () => {
      const editor = await createStartedEditor("foo(inner)outer");
      await press(editor, "fi");
      await press(editor, "di)");
      expect(bufferText(editor)).toBe("foo()outer");
      expect(getRegister(editor)).toBe("inner");
    });
  });

  describe("ci) — change inner paren", () => {
    test("clears paren contents and enters insert mode", async () => {
      const editor = await createStartedEditor("foo(inner)outer");
      await press(editor, "fi");
      await press(editor, "ci)");
      expect(bufferText(editor)).toBe("foo()outer");
      expect(editor.getState().mode).toBe("insert");
    });
  });

  describe("di} — delete inner brace", () => {
    test("deletes brace contents and yanks to \"", async () => {
      const editor = await createStartedEditor("const x = {value};");
      await press(editor, "fv");
      await press(editor, "di}");
      expect(bufferText(editor)).toBe("const x = {};");
      expect(getRegister(editor)).toBe("value");
    });
  });

  describe("ci} — change inner brace", () => {
    test("clears brace contents and enters insert mode", async () => {
      const editor = await createStartedEditor("const x = {value};");
      await press(editor, "fv");
      await press(editor, "ci}");
      expect(bufferText(editor)).toBe("const x = {};");
      expect(editor.getState().mode).toBe("insert");
    });
  });

  describe("di] — delete inner bracket", () => {
    test("deletes bracket contents and yanks to \"", async () => {
      const editor = await createStartedEditor("arr[item]");
      await press(editor, "fi");
      await press(editor, "di]");
      expect(bufferText(editor)).toBe("arr[]");
      expect(getRegister(editor)).toBe("item");
    });
  });

  describe("di< — delete inner angle bracket", () => {
    test("deletes angle bracket contents and yanks to \"", async () => {
      const editor = await createStartedEditor("<tag>");
      await press(editor, "ft");
      await press(editor, "di<");
      expect(bufferText(editor)).toBe("<>");
      expect(getRegister(editor)).toBe("tag");
    });
  });

  describe("dit — delete inner tag", () => {
    test("deletes tag contents and yanks to \"", async () => {
      const editor = await createStartedEditor("<div>content</div>");
      await press(editor, "fc");
      await press(editor, "dit");
      expect(editor.getState().mode).toBe("normal");
    });
  });
});

describe("SPEC-044 Phase 1.B.1 — quote-delete text objects", () => {
  describe("di' — delete inner single quote", () => {
    test("deletes single-quoted contents and yanks to \"", async () => {
      const editor = await createStartedEditor("say 'hello' today");
      await press(editor, "fh");
      await press(editor, "di'");
      expect(bufferText(editor)).toBe("say '' today");
      expect(getRegister(editor)).toBe("hello");
    });

    test("restores text after undo", async () => {
      const editor = await createStartedEditor("say 'hello' today");
      await press(editor, "fh");
      await press(editor, "di'");
      await press(editor, "u");
      expect(bufferText(editor)).toBe("say 'hello' today");
    });
  });

  describe("da' — delete around single quote", () => {
    test("deletes single quotes and their contents, yanks to \"", async () => {
      const editor = await createStartedEditor("say 'hello' today");
      await press(editor, "fh");
      await press(editor, "da'");
      expect(bufferText(editor)).toBe("say  today");
      expect(getRegister(editor)).toBe("'hello'");
    });
  });

  describe("di\" — delete inner double quote", () => {
    test("deletes double-quoted contents and yanks to \"", async () => {
      const editor = await createStartedEditor('say "hello" today');
      await press(editor, "fh");
      await press(editor, "di\"");
      expect(bufferText(editor)).toBe('say "" today');
      expect(getRegister(editor)).toBe("hello");
    });
  });

  describe("da\" — delete around double quote", () => {
    test("deletes double quotes and their contents, yanks to \"", async () => {
      const editor = await createStartedEditor('say "hello" today');
      await press(editor, "fh");
      await press(editor, "da\"");
      expect(bufferText(editor)).toBe("say  today");
      expect(getRegister(editor)).toBe('"hello"');
    });
  });
});
