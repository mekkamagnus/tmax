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

describe("SPEC-044 Phase 1.B.3 — word-change text objects", () => {
  describe("ciw — change inner word", () => {
    test("deletes word under cursor, enters insert mode, yanks to \"", async () => {
      const editor = await createStartedEditor("hello world foo");
      await press(editor, "ciw");
      expect(bufferText(editor)).toBe(" world foo");
      expect(getRegister(editor)).toBe("hello");
      expect(editor.getState().mode).toBe("insert");
    });
  });

  describe("caw — change around word", () => {
    test("deletes word with trailing space, enters insert mode, yanks to \"", async () => {
      const editor = await createStartedEditor("word1 word2 word3");
      await press(editor, "caw");
      expect(bufferText(editor)).toBe("word2 word3");
      expect(getRegister(editor)).toBe("word1 ");
      expect(editor.getState().mode).toBe("insert");
    });
  });
});

describe("SPEC-044 Phase 1.B.4 — paren around-variants", () => {
  describe("da) — delete around paren", () => {
    test("deletes parens and their contents, yanks to \"", async () => {
      const editor = await createStartedEditor("foo(inner)outer");
      await press(editor, "fi");
      await press(editor, "da)");
      expect(bufferText(editor)).toBe("fooouter");
      expect(getRegister(editor)).toBe("(inner)");
    });
  });

  describe("ca) — change around paren", () => {
    test("deletes parens and contents, enters insert mode, yanks to \"", async () => {
      const editor = await createStartedEditor("foo(inner)outer");
      await press(editor, "fi");
      await press(editor, "ca)");
      expect(bufferText(editor)).toBe("fooouter");
      expect(getRegister(editor)).toBe("(inner)");
      expect(editor.getState().mode).toBe("insert");
    });
  });
});

// SPEC-044 Phase 1.B (continued) — completes the around-brace/bracket/angle/tag
// matrix. Each pair (delete + change) follows the same shape as the paren
// around-variants above. Inner change variants for these delimiters land here
// too because they share the same primitive pattern.
describe("SPEC-044 Phase 1.B.5 — brace around-variants", () => {
  describe("da} / da{ — delete around brace", () => {
    test("deletes braces and their contents, yanks to \"", async () => {
      const editor = await createStartedEditor("const x = {value};");
      await press(editor, "fv");
      await press(editor, "da}");
      expect(bufferText(editor)).toBe("const x = ;");
      expect(getRegister(editor)).toBe("{value}");
    });
  });

  describe("ca} / ca{ — change around brace", () => {
    test("deletes braces and contents, enters insert mode, yanks to \"", async () => {
      const editor = await createStartedEditor("const x = {value};");
      await press(editor, "fv");
      await press(editor, "ca}");
      expect(bufferText(editor)).toBe("const x = ;");
      expect(getRegister(editor)).toBe("{value}");
      expect(editor.getState().mode).toBe("insert");
    });
  });
});

describe("SPEC-044 Phase 1.B.6 — bracket inner/around change + around delete", () => {
  describe("da] / da[ — delete around bracket", () => {
    test("deletes brackets and their contents, yanks to \"", async () => {
      const editor = await createStartedEditor("arr[item]");
      await press(editor, "fi");
      await press(editor, "da]");
      expect(bufferText(editor)).toBe("arr");
      expect(getRegister(editor)).toBe("[item]");
    });
  });

  describe("ci] / ci[ — change inner bracket", () => {
    test("clears bracket contents and enters insert mode", async () => {
      const editor = await createStartedEditor("arr[item]");
      await press(editor, "fi");
      await press(editor, "ci]");
      expect(bufferText(editor)).toBe("arr[]");
      expect(getRegister(editor)).toBe("item");
      expect(editor.getState().mode).toBe("insert");
    });
  });

  describe("ca] / ca[ — change around bracket", () => {
    test("deletes brackets and contents, enters insert mode, yanks to \"", async () => {
      const editor = await createStartedEditor("arr[item]");
      await press(editor, "fi");
      await press(editor, "ca]");
      expect(bufferText(editor)).toBe("arr");
      expect(getRegister(editor)).toBe("[item]");
      expect(editor.getState().mode).toBe("insert");
    });
  });
});

describe("SPEC-044 Phase 1.B.7 — angle inner/around change + around delete", () => {
  describe("da< / da> — delete around angle", () => {
    test("deletes angle brackets and their contents, yanks to \"", async () => {
      const editor = await createStartedEditor("<tag>");
      await press(editor, "ft");
      await press(editor, "da<");
      expect(bufferText(editor)).toBe("");
      expect(getRegister(editor)).toBe("<tag>");
    });
  });

  describe("ci< / ci> — change inner angle", () => {
    test("clears angle bracket contents and enters insert mode", async () => {
      const editor = await createStartedEditor("<tag>");
      await press(editor, "ft");
      await press(editor, "ci<");
      expect(bufferText(editor)).toBe("<>");
      expect(getRegister(editor)).toBe("tag");
      expect(editor.getState().mode).toBe("insert");
    });
  });

  describe("ca< / ca> — change around angle", () => {
    test("deletes angle brackets and contents, enters insert mode", async () => {
      const editor = await createStartedEditor("<tag>");
      await press(editor, "ft");
      await press(editor, "ca<");
      expect(bufferText(editor)).toBe("");
      expect(getRegister(editor)).toBe("<tag>");
      expect(editor.getState().mode).toBe("insert");
    });
  });
});

describe("SPEC-044 Phase 1.B.8 — tag around delete + inner/around change", () => {
  describe("dat — delete around tag", () => {
    test("deletes opening and closing tags and their contents", async () => {
      const editor = await createStartedEditor("<div>content</div>");
      await press(editor, "fc");
      await press(editor, "dat");
      expect(bufferText(editor)).toBe("");
    });
  });

  describe("cit — change inner tag", () => {
    test("clears tag contents and enters insert mode", async () => {
      const editor = await createStartedEditor("<div>content</div>");
      await press(editor, "fc");
      await press(editor, "cit");
      expect(bufferText(editor)).toBe("<div></div>");
      expect(editor.getState().mode).toBe("insert");
    });
  });

  describe("cat — change around tag", () => {
    test("deletes opening+closing tags and contents, enters insert mode", async () => {
      const editor = await createStartedEditor("<div>content</div>");
      await press(editor, "fc");
      await press(editor, "cat");
      expect(bufferText(editor)).toBe("");
      expect(editor.getState().mode).toBe("insert");
    });
  });
});

// SPEC-044 Phase 1.C — count multiplier on text objects. Per spec Open
// Question #6, d2iw must compose the operator count with the text-object
// motion and delete N consecutive words.vim-operator-total-count formula
// (operators.tlisp:218-220) is the assumed mechanism.
describe("SPEC-044 Phase 1.C — count × text-object multiplier", () => {
  describe("d2iw — delete two inner words", () => {
    test("deletes two consecutive words without trailing space", async () => {
      const editor = await createStartedEditor("hello world foo bar");
      await press(editor, "d2iw");
      expect(bufferText(editor)).toBe(" foo bar");
      expect(getRegister(editor)).toBe("hello world");
    });
  });

  describe("d3iw — delete three inner words", () => {
    test("deletes three consecutive words", async () => {
      const editor = await createStartedEditor("alpha beta gamma delta");
      await press(editor, "d3iw");
      expect(bufferText(editor)).toBe(" delta");
    });
  });
});

// SPEC-044 Step 1.1 acceptance: "u after diw restores the deleted text AND
// cursor position (undo bookend works)." The original diw test asserts only
// text restoration; these around-variant cases close the cursor-position
// acceptance gap flagged by the adw-patch-review audit (2026-06-21).
describe("SPEC-044 Phase 1 — undo restores cursor for around-* variants", () => {
  test("u after da} restores cursor to the brace region start", async () => {
    const editor = await createStartedEditor("const x = {value};");
    await press(editor, "fv");
    const beforeLine = executeTlisp(editor, "(cursor-line)").value as number;
    const beforeCol = executeTlisp(editor, "(cursor-column)").value as number;
    await press(editor, "da}");
    await press(editor, "u");
    expect(bufferText(editor)).toBe("const x = {value};");
    const afterLine = executeTlisp(editor, "(cursor-line)").value as number;
    const afterCol = executeTlisp(editor, "(cursor-column)").value as number;
    expect([afterLine, afterCol]).toEqual([beforeLine, beforeCol]);
  });

  test("u after da] restores cursor to the bracket region start", async () => {
    const editor = await createStartedEditor("arr[item]");
    await press(editor, "fi");
    const beforeLine = executeTlisp(editor, "(cursor-line)").value as number;
    const beforeCol = executeTlisp(editor, "(cursor-column)").value as number;
    await press(editor, "da]");
    await press(editor, "u");
    expect(bufferText(editor)).toBe("arr[item]");
    const afterLine = executeTlisp(editor, "(cursor-line)").value as number;
    const afterCol = executeTlisp(editor, "(cursor-column)").value as number;
    expect([afterLine, afterCol]).toEqual([beforeLine, beforeCol]);
  });

  test("u after dat restores cursor to the tag start", async () => {
    const editor = await createStartedEditor("<div>content</div>");
    await press(editor, "fc");
    const beforeLine = executeTlisp(editor, "(cursor-line)").value as number;
    const beforeCol = executeTlisp(editor, "(cursor-column)").value as number;
    await press(editor, "dat");
    await press(editor, "u");
    expect(bufferText(editor)).toBe("<div>content</div>");
    const afterLine = executeTlisp(editor, "(cursor-line)").value as number;
    const afterCol = executeTlisp(editor, "(cursor-column)").value as number;
    expect([afterLine, afterCol]).toEqual([beforeLine, beforeCol]);
  });
});
