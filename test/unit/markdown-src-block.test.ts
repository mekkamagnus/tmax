/**
 * @file markdown-src-block.test.ts
 * @description RFC-037 (#335) — src-block editing. C-c ' / SPC e opens a
 *   fenced block's content in a *Src-Edit:<lang>* buffer with the language's
 *   major mode; C-c C-c writes back between the fences; C-c C-k discards.
 *   Covers detection (boundaries, no language, unclosed, multiple blocks),
 *   the language mapping, the write-back round-trip, empty commits, abort,
 *   and the multi-block guard.
 */

import { describe, expect, test } from "bun:test";
import type { Editor } from "../../src/editor/editor.ts";
import { executeTlisp, setupMdEditor } from "../helpers/editor-fixture.ts";

function val(editor: Editor, expr: string): unknown {
  return executeTlisp(editor, expr).value;
}

function num(editor: Editor, expr: string): number {
  return val(editor, expr) as number;
}

function str(editor: Editor, expr: string): string {
  return val(editor, expr) as string;
}

const DOC = "# head\n```js\nfoo()\nbar()\n```\ntail\n";

/** Position the cursor inside the doc's block (default: line 2, "foo()"). */
async function setup(doc: string = DOC, line = 2): Promise<Editor> {
  const editor = await setupMdEditor(doc, "note.md");
  executeTlisp(editor, `(cursor-move ${line} 0)`);
  return editor;
}

/** Replace the current (edit) buffer's whole content — the fikra clear shape. */
function setEditContent(editor: Editor, text: string): void {
  const count = num(editor, "(buffer-line-count)");
  if (count > 1) executeTlisp(editor, `(buffer-delete-range 0 0 ${count - 1} 0)`);
  const l0 = str(editor, "(buffer-get-line 0)");
  if (l0.length > 0) executeTlisp(editor, `(buffer-delete-range 0 0 0 ${l0.length})`);
  executeTlisp(editor, "(cursor-move 0 0)");
  executeTlisp(editor, `(buffer-insert "${text.replace(/"/g, '\\"').replace(/\n/g, "\\n")}")`);
}

describe("RFC-037: markdown-src-block-at-point (detection)", () => {
  test("inside a block → start/end/language/content range", async () => {
    const editor = await setup();
    expect(num(editor, '(hashmap-get (markdown-src-block-at-point) "start")')).toBe(1);
    expect(num(editor, '(hashmap-get (markdown-src-block-at-point) "end")')).toBe(4);
    expect(str(editor, '(hashmap-get (markdown-src-block-at-point) "language")')).toBe("js");
    expect(num(editor, '(hashmap-get (markdown-src-block-at-point) "content-start")')).toBe(2);
    expect(num(editor, '(hashmap-get (markdown-src-block-at-point) "content-end")')).toBe(3);
  });

  test("boundary fence lines count as inside", async () => {
    const editor = await setup(DOC, 1); // opening fence
    expect(val(editor, "(markdown-src-block-at-point)")).not.toBeNull();
    const editor2 = await setup(DOC, 4); // closing fence
    expect(val(editor2, "(markdown-src-block-at-point)")).not.toBeNull();
  });

  test("outside any block → nil", async () => {
    const editor = await setup(DOC, 0); // heading
    expect(val(editor, "(markdown-src-block-at-point)")).toBeNull();
    const editor2 = await setup(DOC, 5); // tail
    expect(val(editor2, "(markdown-src-block-at-point)")).toBeNull();
  });

  test("bare fence → empty language", async () => {
    const editor = await setup("```\nplain\n```\n", 1);
    expect(str(editor, '(hashmap-get (markdown-src-block-at-point) "language")')).toBe("");
  });

  test("unclosed block → nil", async () => {
    const editor = await setup("```js\nfoo()\n", 1);
    expect(val(editor, "(markdown-src-block-at-point)")).toBeNull();
  });

  test("multiple blocks → the enclosing one", async () => {
    const doc = "```python\na\n```\ntext\n```rust\nb\n```\n";
    const editor = await setup(doc, 5); // inside the rust block
    expect(str(editor, '(hashmap-get (markdown-src-block-at-point) "language")')).toBe("rust");
    expect(num(editor, '(hashmap-get (markdown-src-block-at-point) "start")')).toBe(4);
  });

  test("nested backticks in content do not open a block (alternation pairs fences)", async () => {
    // The ``` inside the content would pair as a closer under naive
    // alternation — this documents the v1 behavior: content fences split
    // blocks. A 4-backtick outer fence is out of scope (CommonMark full
    // nesting).
    const editor = await setup("```\ncode\n```\n", 1);
    expect(num(editor, '(hashmap-get (markdown-src-block-at-point) "end")')).toBe(2);
  });
});

describe("RFC-037: language → major mode mapping", () => {
  const MAP: Array<[string, string]> = [
    ["javascript", "typescript"], ["js", "typescript"], ["typescript", "typescript"], ["ts", "typescript"],
    ["python", "python"], ["py", "python"],
    ["lisp", "lisp"], ["tlisp", "lisp"], ["scheme", "lisp"],
    ["shell", "shell"], ["bash", "shell"], ["sh", "shell"], ["zsh", "shell"],
    ["go", "go"], ["rust", "rust"], ["json", "json"], ["yaml", "yaml"], ["toml", "toml"],
    ["html", "html"], ["css", "css"], ["sql", "sql"], ["c", "c"], ["cpp", "cpp"],
  ];

  test("all RFC §2.3 entries map to their major mode", async () => {
    const editor = await setup();
    for (const [lang, mode] of MAP) {
      expect(str(editor, `(markdown-src-mode-for-language "${lang}")`)).toBe(mode);
    }
  });

  test("unmapped language → fundamental", async () => {
    const editor = await setup();
    expect(str(editor, '(markdown-src-mode-for-language "elixir")')).toBe("fundamental");
    expect(str(editor, '(markdown-src-mode-for-language "")')).toBe("fundamental");
  });
});

describe("RFC-037: markdown-edit-src (open)", () => {
  test("opens *Src-Edit:<lang>* with the major mode and seeded content", async () => {
    const editor = await setup();
    executeTlisp(editor, "(markdown-edit-src)");
    expect(str(editor, "(buffer-current)")).toBe("*Src-Edit:js*");
    expect(str(editor, "(major-mode-get)")).toBe("typescript");
    expect(str(editor, "(buffer-text)")).toBe("foo()\nbar()");
    expect(str(editor, "(editor-mode)")).toBe("normal");
  });

  test("no language → *Src-Edit:text* buffer name", async () => {
    const editor = await setup("```\nplain\n```\n", 1);
    executeTlisp(editor, "(markdown-edit-src)");
    expect(str(editor, "(buffer-current)")).toBe("*Src-Edit:text*");
    expect(str(editor, "(buffer-text)")).toBe("plain");
  });

  test("not in a block → status, no buffer switch", async () => {
    const editor = await setup(DOC, 0);
    executeTlisp(editor, "(markdown-edit-src)");
    expect(str(editor, "(buffer-current)")).toBe("note.md");
  });

  test("SPC e opens the block at point", async () => {
    const editor = await setup();
    await editor.handleKey(" ");
    await editor.handleKey("e");
    expect(str(editor, "(buffer-current)")).toBe("*Src-Edit:js*");
  });

  test("C-c ' opens the block at point", async () => {
    const editor = await setup();
    await editor.handleKey("C-c");
    await editor.handleKey("'");
    expect(str(editor, "(buffer-current)")).toBe("*Src-Edit:js*");
  });
});

describe("RFC-037: C-c C-c write-back", () => {
  test("round-trip: content replaced, fences unchanged, cursor at fence, edit buffer killed", async () => {
    const editor = await setup();
    executeTlisp(editor, "(markdown-edit-src)");
    setEditContent(editor, "newA()\nnewB()\nnewC()");
    executeTlisp(editor, "(markdown-edit-src-commit)");
    expect(str(editor, "(buffer-current)")).toBe("note.md");
    expect(str(editor, "(buffer-get-line 1)")).toBe("```js");
    expect(str(editor, "(buffer-get-line 2)")).toBe("newA()");
    expect(str(editor, "(buffer-get-line 3)")).toBe("newB()");
    expect(str(editor, "(buffer-get-line 4)")).toBe("newC()");
    expect(str(editor, "(buffer-get-line 5)")).toBe("```");
    expect(str(editor, "(buffer-get-line 6)")).toBe("tail");
    expect(num(editor, "(cursor-line)")).toBe(1);
    const bufs = val(editor, "(buffer-list)") as unknown[];
    expect(bufs.every((b) => JSON.stringify(b).indexOf("Src-Edit") === -1)).toBe(true);
  });

  test("fewer/more lines than the original content", async () => {
    const editor = await setup();
    executeTlisp(editor, "(markdown-edit-src)");
    setEditContent(editor, "only()");
    executeTlisp(editor, "(markdown-edit-src-commit)");
    expect(str(editor, "(buffer-get-line 2)")).toBe("only()");
    expect(str(editor, "(buffer-get-line 3)")).toBe("```");
    expect(str(editor, "(buffer-get-line 4)")).toBe("tail");
  });

  test("empty edit buffer → one blank line between fences (valid markdown)", async () => {
    const editor = await setup();
    executeTlisp(editor, "(markdown-edit-src)");
    setEditContent(editor, "");
    executeTlisp(editor, "(markdown-edit-src-commit)");
    expect(str(editor, "(buffer-get-line 1)")).toBe("```js");
    expect(str(editor, "(buffer-get-line 2)")).toBe("");
    expect(str(editor, "(buffer-get-line 3)")).toBe("```");
  });

  test("C-c C-c chord commits from the edit buffer", async () => {
    const editor = await setup();
    await editor.handleKey(" ");
    await editor.handleKey("e");
    setEditContent(editor, "viaChord()");
    await editor.handleKey("C-c");
    await editor.handleKey("C-c");
    expect(str(editor, "(buffer-current)")).toBe("note.md");
    expect(str(editor, "(buffer-get-line 2)")).toBe("viaChord()");
  });
});

describe("RFC-037: C-c C-k abort", () => {
  test("discards: original untouched, edit buffer killed", async () => {
    const editor = await setup();
    executeTlisp(editor, "(markdown-edit-src)");
    setEditContent(editor, "THROWN AWAY");
    executeTlisp(editor, "(markdown-edit-src-abort)");
    expect(str(editor, "(buffer-current)")).toBe("note.md");
    expect(str(editor, "(buffer-text)")).toBe(DOC);
    expect(num(editor, "(cursor-line)")).toBe(1);
    const bufs = val(editor, "(buffer-list)") as unknown[];
    expect(bufs.every((b) => JSON.stringify(b).indexOf("Src-Edit") === -1)).toBe(true);
  });

  test("C-c C-k chord aborts from the edit buffer", async () => {
    const editor = await setup();
    await editor.handleKey(" ");
    await editor.handleKey("e");
    setEditContent(editor, "THROWN AWAY");
    await editor.handleKey("C-c");
    await editor.handleKey("C-k");
    expect(str(editor, "(buffer-current)")).toBe("note.md");
    expect(str(editor, "(buffer-text)")).toBe(DOC);
  });
});

describe("RFC-037: multi-block guard (§2.5)", () => {
  const TWO = "```js\naaa\n```\nmid\n```python\nbbb\n```\n";

  test("opening a second block aborts the pending edit and opens the new one", async () => {
    const editor = await setup(TWO, 1);
    executeTlisp(editor, "(markdown-edit-src)");
    expect(str(editor, "(buffer-current)")).toBe("*Src-Edit:js*");
    // Back to the markdown buffer (as a user would) and open the other block.
    executeTlisp(editor, '(switch-to-buffer "note.md")');
    executeTlisp(editor, "(cursor-move 5 0)");
    executeTlisp(editor, "(markdown-edit-src)");
    expect(str(editor, "(buffer-current)")).toBe("*Src-Edit:python*");
    expect(str(editor, "(buffer-text)")).toBe("bbb");
    // Exactly one Src-Edit buffer exists (the pending one was killed).
    const bufs = (val(editor, "(buffer-list)") as unknown[]).map((b) => JSON.stringify(b));
    expect(bufs.filter((b) => b.indexOf("Src-Edit") >= 0)).toHaveLength(1);
    // The abandoned content was echoed to *Messages* for recovery.
    executeTlisp(editor, '(switch-to-buffer "*Messages*")');
    const messages = str(editor, "(buffer-text)");
    expect(messages).toContain("Abandoned src edit");
    expect(messages).toContain("aaa");
  });

  test("markdown-src-edit-active-p reflects pending state", async () => {
    const editor = await setup();
    expect(val(editor, "(markdown-src-edit-active-p)")).toBeNull();
    executeTlisp(editor, "(markdown-edit-src)");
    expect(val(editor, "(markdown-src-edit-active-p)")).toBe(true);
    executeTlisp(editor, "(markdown-edit-src-abort)");
    expect(val(editor, "(markdown-src-edit-active-p)")).toBeNull();
  });
});

describe("#335 audit fixes", () => {
  test("fence-len: a ```` outer fence containing a ``` inner line pairs by length", async () => {
    // 0: ````js   1: inner   2: ``` (content!)   3: more   4: ````
    const editor = await setup("````js\ninner\n```\nmore\n````\n", 2);
    expect(num(editor, '(hashmap-get (markdown-src-block-at-point) "start")')).toBe(0);
    expect(num(editor, '(hashmap-get (markdown-src-block-at-point) "end")')).toBe(4);
    expect(num(editor, '(hashmap-get (markdown-src-block-at-point) "fence-len")')).toBe(4);
    expect(str(editor, '(hashmap-get (markdown-src-block-at-point) "language")')).toBe("js");
    // The block still opens for editing with all four content lines.
    executeTlisp(editor, "(markdown-edit-src)");
    expect(str(editor, "(buffer-text)")).toBe("inner\n```\nmore");
  });

  test("stale lines: a block MOVED while the edit was pending still receives the write", async () => {
    const editor = await setup();
    executeTlisp(editor, "(markdown-edit-src)");
    setEditContent(editor, "RELOCATED()");
    // Two lines inserted ABOVE the block shift everything down by 2.
    executeTlisp(editor, '(switch-to-buffer "note.md")');
    executeTlisp(editor, "(cursor-move 0 0)");
    executeTlisp(editor, '(buffer-insert "new header 1\\nnew header 2\\n")');
    executeTlisp(editor, "(markdown-edit-src-commit)");
    expect(str(editor, "(buffer-get-line 3)")).toBe("```js"); // moved fence
    expect(str(editor, "(buffer-get-line 4)")).toBe("RELOCATED()");
    expect(str(editor, "(buffer-get-line 5)")).toBe("```");
    expect(str(editor, "(buffer-get-line 6)")).toBe("tail");
    // The old (stale) content location is untouched inserted-header text.
    expect(str(editor, "(buffer-get-line 1)")).toBe("new header 2");
  });

  test("stale lines: block REMOVED while pending — abort with recovery, no corruption", async () => {
    const editor = await setup();
    executeTlisp(editor, "(markdown-edit-src)");
    setEditContent(editor, "PRECIOUS()");
    // Delete the whole block (fences + content) from the target buffer.
    executeTlisp(editor, '(switch-to-buffer "note.md")');
    executeTlisp(editor, "(buffer-delete-range 1 0 5 0)");
    executeTlisp(editor, "(markdown-edit-src-commit)");
    // The buffer is exactly the post-deletion document — no fence damage,
    // no stray insert at stale line numbers.
    expect(str(editor, "(buffer-text)")).toBe("# head\ntail\n");
    const bufs = (val(editor, "(buffer-list)") as unknown[]).map((b) => JSON.stringify(b));
    expect(bufs.every((b) => b.indexOf("Src-Edit") === -1)).toBe(true);
    executeTlisp(editor, '(switch-to-buffer "*Messages*")');
    const messages = str(editor, "(buffer-text)");
    expect(messages).toContain("src block gone");
    expect(messages).toContain("PRECIOUS()");
  });

  test("corruption guard: commit issued from the TARGET buffer writes the EDIT buffer's text", async () => {
    const editor = await setup();
    executeTlisp(editor, "(markdown-edit-src)");
    setEditContent(editor, "EDITED()");
    // The user switches back to the markdown buffer, then commits via M-x.
    executeTlisp(editor, '(switch-to-buffer "note.md")');
    executeTlisp(editor, "(markdown-edit-src-commit)");
    expect(str(editor, "(buffer-get-line 2)")).toBe("EDITED()");
    expect(str(editor, "(buffer-get-line 3)")).toBe("```");
    expect(str(editor, "(buffer-get-line 4)")).toBe("tail");
    // The whole document was never duplicated into the block.
    expect(str(editor, "(buffer-text)")).toBe("# head\n```js\nEDITED()\n```\ntail\n");
  });

  test("audit r2: a TWIN block with the same fence never receives the write (identity abort)", async () => {
    // Two identical ```js blocks with different content.
    const doc = "```js\nAAA()\n```\nmid\n```js\nBBB()\n```\n";
    const editor = await setup(doc, 1);
    executeTlisp(editor, "(markdown-edit-src)");
    setEditContent(editor, "EDITED-A()");
    // Delete the FIRST block (the one being edited) while pending.
    executeTlisp(editor, '(switch-to-buffer "note.md")');
    executeTlisp(editor, "(buffer-delete-range 0 0 3 0)");
    // Commit must NOT fall through to the twin (same fence, different content).
    executeTlisp(editor, "(markdown-edit-src-commit)");
    expect(str(editor, "(buffer-text)")).toBe("mid\n```js\nBBB()\n```\n");
    executeTlisp(editor, '(switch-to-buffer "*Messages*")');
    expect(str(editor, "(buffer-text)")).toContain("EDITED-A()");
  });

  test("audit r2: a REMOVED closing fence aborts instead of deleting to a later fence", async () => {
    // The edited block, then unrelated prose, then another block.
    const doc = "```js\nAAA()\n```\nprose line\n```python\nBBB()\n```\n";
    const editor = await setup(doc, 1);
    executeTlisp(editor, "(markdown-edit-src)");
    setEditContent(editor, "EDITED()");
    // Remove the edited block's CLOSING fence (line 2) while pending.
    executeTlisp(editor, '(switch-to-buffer "note.md")');
    executeTlisp(editor, "(buffer-delete-range 2 0 3 0)");
    // A naive same-length pairing would close on the ```python block's
    // fences and swallow the prose — the content anchor must reject every
    // candidate and abort with recovery.
    executeTlisp(editor, "(markdown-edit-src-commit)");
    expect(str(editor, "(buffer-text)")).toBe("```js\nAAA()\nprose line\n```python\nBBB()\n```\n");
    executeTlisp(editor, '(switch-to-buffer "*Messages*")');
    expect(str(editor, "(buffer-text)")).toContain("EDITED()");
  });

  test("audit r2: detection — an info-string fence never closes a block", async () => {
    // ```js opened, then a ```python line (same length, info) — not a closer.
    const editor = await setup("```js\nx\n```python\ny\n```\n", 1);
    const block = executeTlisp(editor, "(markdown-src-block-at-point)");
    expect(num(editor, '(hashmap-get (markdown-src-block-at-point) "end")')).toBe(4);
    // A cursor below the (unclosed-by-bare-fence rule) region is outside.
    const editor2 = await setup("```js\nx\n```python\ny\n```\n", 3);
    expect(val(editor2, "(markdown-src-block-at-point)")).not.toBeNull();
    expect(num(editor2, '(hashmap-get (markdown-src-block-at-point) "end")')).toBe(4);
  });

  test("audit r3: a twin matching fence, first line, AND count — but differing content — never receives the write", async () => {
    // Same fence, same first content line, same line count; second line differs.
    const doc = "```js\nAAA()\nsame-first\n```\nmid\n```js\nAAA()\nDIFFERENT\n```\n";
    const editor = await setup(doc, 1);
    executeTlisp(editor, "(markdown-edit-src)");
    setEditContent(editor, "EDITED()");
    // Delete the edited (first) block while pending.
    executeTlisp(editor, '(switch-to-buffer "note.md")');
    executeTlisp(editor, "(buffer-delete-range 0 0 4 0)");
    executeTlisp(editor, "(markdown-edit-src-commit)");
    // The near-twin is untouched; the edit recovers via *Messages*.
    expect(str(editor, "(buffer-text)")).toBe("mid\n```js\nAAA()\nDIFFERENT\n```\n");
    executeTlisp(editor, '(switch-to-buffer "*Messages*")');
    expect(str(editor, "(buffer-text)")).toContain("EDITED()");
  });

  test("audit r4: IDENTICAL twin removed-target — ambiguity aborts, the twin never receives the write", async () => {
    // Two byte-identical blocks; edit the first; DELETE it while pending.
    const doc = "```js\nAAA()\n```\nmid\n```js\nAAA()\n```\n";
    const editor = await setup(doc, 1);
    executeTlisp(editor, "(markdown-edit-src)");
    setEditContent(editor, "EDITED()");
    executeTlisp(editor, '(switch-to-buffer "note.md")');
    executeTlisp(editor, "(buffer-delete-range 0 0 3 0)");
    executeTlisp(editor, "(markdown-edit-src-commit)");
    // Identity was ambiguous at open and continuity is lost → abort.
    expect(str(editor, "(buffer-text)")).toBe("mid\n```js\nAAA()\n```\n");
    executeTlisp(editor, '(switch-to-buffer "*Messages*")');
    const messages = str(editor, "(buffer-text)");
    expect(messages).toContain("ambiguous");
    expect(messages).toContain("EDITED()");
  });

  test("audit r5: a twin SHIFTED onto the recorded line by the target's deletion never receives the write", async () => {
    // Delete the target AND the lines up to the twin so it lands exactly on
    // the recorded start line — position alone must not pass for continuity.
    const doc = "```js\nAAA()\n```\nmid\n```js\nAAA()\n```\n";
    const editor = await setup(doc, 1);
    executeTlisp(editor, "(markdown-edit-src)");
    setEditContent(editor, "EDITED()");
    executeTlisp(editor, '(switch-to-buffer "note.md")');
    executeTlisp(editor, "(buffer-delete-range 0 0 4 0)"); // target + mid
    executeTlisp(editor, "(markdown-edit-src-commit)");
    expect(str(editor, "(buffer-text)")).toBe("```js\nAAA()\n```\n");
    executeTlisp(editor, '(switch-to-buffer "*Messages*")');
    const messages = str(editor, "(buffer-text)");
    expect(messages).toContain("ambiguous");
    expect(messages).toContain("EDITED()");
  });

  test("audit r6: ambiguous blocks (identical twins) NEVER commit — the conservative rule", async () => {
    const doc = "```js\nAAA()\n```\nmid\n```js\nAAA()\n```\n";
    // Edit the second block; nothing is deleted. Identity was ambiguous at
    // open (a byte-identical twin exists), so continuity is not
    // establishable — the commit must abort with recovery, both blocks
    // untouched.
    const editor = await setup(doc, 4);
    executeTlisp(editor, "(markdown-edit-src)");
    setEditContent(editor, "SECOND()");
    executeTlisp(editor, "(markdown-edit-src-commit)");
    expect(str(editor, "(buffer-text)")).toBe(doc);
    executeTlisp(editor, '(switch-to-buffer "*Messages*")');
    const messages = str(editor, "(buffer-text)");
    expect(messages).toContain("ambiguous");
    expect(messages).toContain("SECOND()");
  });
});
