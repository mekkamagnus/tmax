/**
 * @file wiki-link-complete.test.ts
 * @description SPEC-120 (#197): typing the second `[` of `[[` in insert mode
 *   instantly opens the fuzzy vault-note finder; pick an existing note or the
 *   + Create candidate and the link completes in place. Cancel restores
 *   insert mode with the bare `[[` as typed.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeTlisp,
  setupMdEditor,
} from "../helpers/editor-fixture.ts";
import type { Editor } from "../../src/editor/editor.ts";

/** Stringify a T-Lisp result for assertions (same shape as the SPEC-116 suite). */
function tl(editor: Editor, form: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = executeTlisp(editor, form) as any;
  const render = (v: any): string => {
    if (Array.isArray(v)) return `(${v.map(render).join(" ")})`;
    if (v && v.type === "list") return render(v.value);
    if (v && v.type === "string") return String(v.value);
    if (v && v.type === "hashmap") { const d = (v.value as Map<any, any>).get?.("display"); return d ? render(d) : "{}"; }
    if (v && (v.type === "number" || v.type === "boolean")) return String(v.value);
    if (v && v.type === "nil") return "nil";
    return String(v);
  };
  return render(r);
}

describe("SPEC-120: [[ fuzzy note finder", () => {
  let vault: string;

  beforeAll(() => {
    vault = mkdtempSync(join(tmpdir(), "tmax-vault-cap-"));
    writeFileSync(join(vault, "goals.md"), "# Goals\n");
    writeFileSync(join(vault, "gardening.md"), "# Gardening\n");
    mkdirSync(join(vault, "sub"));
    writeFileSync(join(vault, "sub", "deep.md"), "# Deep\n");
  });

  afterAll(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  /** Type the two brackets the way production does (insert mode, insert-char). */
  async function typeOpenBrackets(content: string, atCol: number, filename = join(vault, "index.md")): Promise<Editor> {
    const editor = await setupMdEditor(content, filename);
    // The fixture's createBuffer does not run auto-mode — markdown buffers
    // need the major mode set explicitly (production activates via file open).
    if (filename.endsWith(".md")) executeTlisp(editor, '(major-mode-set "markdown")');
    executeTlisp(editor, `(cursor-move 0 ${atCol})`);
    executeTlisp(editor, '(editor-set-mode "insert")');
    executeTlisp(editor, '(insert-char "[")');
    executeTlisp(editor, '(insert-char "[")');
    return editor;
  }

  describe("the completion table", () => {
    test("lists + Create first for non-empty input, then every vault note", async () => {
      const editor = await setupMdEditor("x\n", join(vault, "index.md"));
      executeTlisp(editor, '(major-mode-set "markdown")');
      executeTlisp(editor, "(markdown-complete-prepare)");
      const cands = tl(editor, '(markdown-complete-table "go" "candidates")');
      expect(cands).toContain("+ Create: go");
      expect(cands).toContain("goals");
      expect(cands).toContain("gardening");
      expect(cands).toContain("deep");
      // create candidate comes FIRST
      expect(cands.indexOf("+ Create: go")).toBeLessThan(cands.indexOf("goals"));
    });

    test("empty input omits the create candidate", async () => {
      const editor = await setupMdEditor("x\n", join(vault, "index.md"));
      executeTlisp(editor, "(markdown-complete-prepare)");
      const cands = tl(editor, '(markdown-complete-table "" "candidates")');
      expect(cands).not.toContain("+ Create:");
      expect(cands).toContain("goals");
    });

    test("metadata category", async () => {
      const editor = await setupMdEditor("x\n", join(vault, "index.md"));
      executeTlisp(editor, "(markdown-complete-prepare)");
      expect(tl(editor, '(hashmap-get (markdown-complete-table "" "metadata") "category")'))
        .toBe("tmax-note-complete");
    });
  });

  describe("the trigger (insert-char)", () => {
    test("second [ of [[ opens the finder (mode → mx, [[ in buffer)", async () => {
      const editor = await typeOpenBrackets("hello world\n", 6);
      expect(editor.getState().mode).toBe("mx");
      expect(tl(editor, "(buffer-text)")).toBe("hello [[world\n");
    });

    test("single [ after a non-[ char does NOT prompt", async () => {
      const editor = await setupMdEditor("hello world\n", join(vault, "index.md"));
      executeTlisp(editor, "(cursor-move 0 6)");
      executeTlisp(editor, '(editor-set-mode "insert")');
      executeTlisp(editor, '(insert-char "[")');
      expect(editor.getState().mode).toBe("insert");
      expect(tl(editor, "(buffer-text)")).toBe("hello [world\n");
    });

    test("non-markdown buffer never triggers", async () => {
      const editor = await typeOpenBrackets("plain text\n", 6, join(vault, "notes.txt"));
      expect(editor.getState().mode).toBe("insert");
      expect(tl(editor, "(buffer-text)")).toBe("plain [[text\n");
    });

    test("minor mode off never triggers", async () => {
      const editor = await setupMdEditor("plain text\n", join(vault, "index.md"));
      executeTlisp(editor, '(minor-mode-set "wiki-link-complete" nil)');
      executeTlisp(editor, "(cursor-move 0 6)");
      executeTlisp(editor, '(editor-set-mode "insert")');
      executeTlisp(editor, '(insert-char "[")');
      executeTlisp(editor, '(insert-char "[")');
      expect(editor.getState().mode).toBe("insert");
      executeTlisp(editor, '(minor-mode-set "wiki-link-complete" t)'); // restore default
    });

    test("[ at column 1 (the >= 2 guard, no underflow) stays insert", async () => {
      const editor = await setupMdEditor("ab\n", join(vault, "index.md"));
      executeTlisp(editor, "(cursor-move 0 0)");
      executeTlisp(editor, '(editor-set-mode "insert")');
      executeTlisp(editor, '(insert-char "[")'); // col 1, only one [
      expect(editor.getState().mode).toBe("insert");
      expect(tl(editor, "(buffer-text)")).toBe("[ab\n");
    });
  });

  describe("accept: existing note", () => {
    test("completes the link in place, cursor after ]], insert mode, NO buffer switch", async () => {
      const editor = await typeOpenBrackets("link: here\n", 6);
      expect(editor.getState().mode).toBe("mx");
      executeTlisp(editor, '(minibuffer-set-input "goals")');
      executeTlisp(editor, '(minibuffer-dispatch-key "Enter")');
      expect(tl(editor, "(buffer-text)")).toBe("link: [[goals]]here\n");
      expect(editor.getState().mode).toBe("insert");
      // cursor sits right after "]]"
      expect(tl(editor, "(cursor-column)")).toBe("15"); // 6 "link: " + 9 "[[goals]]"
      // no buffer switch — still the note we were writing
      expect(tl(editor, "(buffer-current)")).toContain("index.md");
    });
  });

  describe("accept: + Create", () => {
    test("completes the link AND writes the note WITHOUT opening it", async () => {
      const editor = await typeOpenBrackets("idea: \n", 6);
      executeTlisp(editor, '(minibuffer-set-input "fresh idea")');
      executeTlisp(editor, '(minibuffer-dispatch-key "Enter")');
      expect(tl(editor, "(buffer-text)")).toBe("idea: [[fresh idea]]\n");
      expect(editor.getState().mode).toBe("insert");
      expect(existsSync(join(vault, "fresh idea.md"))).toBe(true);
      // NOT opened — we are still writing our note
      expect(tl(editor, "(buffer-current)")).toContain("index.md");
    });
  });

  describe("cancel", () => {
    test("Escape leaves the bare [[, insert mode, cursor after it", async () => {
      const editor = await typeOpenBrackets("note \n", 5);
      expect(editor.getState().mode).toBe("mx");
      executeTlisp(editor, '(minibuffer-dispatch-key "Escape")');
      expect(editor.getState().mode).toBe("insert"); // return-mode restored
      expect(tl(editor, "(buffer-text)")).toBe("note [[\n");
      expect(tl(editor, "(cursor-column)")).toBe("7");
    });

    test("re-trigger after cancel works (state re-primed)", async () => {
      const editor = await setupMdEditor("note [[\nmore\n", join(vault, "index.md"));
      executeTlisp(editor, '(major-mode-set "markdown")');
      executeTlisp(editor, "(cursor-move 1 0)");
      executeTlisp(editor, '(editor-set-mode "insert")');
      executeTlisp(editor, '(insert-char "[")');
      executeTlisp(editor, '(insert-char "[")');
      expect(editor.getState().mode).toBe("mx"); // re-triggered
      expect(tl(editor, "(buffer-text)")).toBe("note [[\n[[more\n"); // inserted at line 1 col 0
    });
  });

  describe("SPEC-116 regression", () => {
    test("markdown-create-note-for still opens the created note", async () => {
      const editor = await setupMdEditor("x\n", join(vault, "index.md"));
      executeTlisp(editor, '(markdown-create-note-for "open-me")');
      expect(existsSync(join(vault, "open-me.md"))).toBe(true);
      expect(tl(editor, "(buffer-current)")).toContain("open-me.md"); // opened
    });
  });
});
