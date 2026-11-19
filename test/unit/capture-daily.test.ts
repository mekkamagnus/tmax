import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";
import type { Editor } from "../../src/editor/editor.ts";

/**
 * #278: SPC r d — direct capture to today's daily note
 * (org-roam-dailies-capture-today parity). Compose in *Capture*, C-c C-c
 * appends a timestamped entry to markdown-journal-path, C-c C-k / C-g abort,
 * prior buffer/mode/point restored exactly. Key delivery follows the
 * mx-nested-describe-status pattern: handleKey(" ") is SPC.
 */

/** Stringify a T-Lisp eval result for assertions (wiki-link-complete shape). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tl(editor: Editor, form: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = executeTlisp(editor, form) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const render = (v: any): string => {
    if (Array.isArray(v)) return `(${v.map(render).join(" ")})`;
    if (v && v.type === "list") return render(v.value);
    if (v && v.type === "string") return String(v.value);
    if (v && (v.type === "number" || v.type === "boolean")) return String(v.value);
    if (v && v.type === "nil") return "nil";
    return String(v);
  };
  return render(r);
}

describe("#278: capture-daily (SPC r d)", () => {
  test("SPC r d opens a fresh *Capture* buffer in insert mode and restores on C-c C-c", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("hello world");
      // Park the cursor somewhere specific to prove point restoration
      executeTlisp(editor, "(cursor-move 0 4)");
      const before = { buf: tl(editor, "(buffer-current)"), line: tl(editor, "(cursor-line)"), col: tl(editor, "(cursor-column)") };

      await editor.handleKey(" "); // SPC
      await editor.handleKey("r");
      await editor.handleKey("d");

      expect(tl(editor, "(buffer-current)")).toBe("*Capture*");
      expect(tl(editor, "(editor-mode)")).toBe("insert");
      executeTlisp(editor, '(buffer-insert "first thought")');
      // second capture later must not see stale text — covered by fresh-buffer test below

      await editor.handleKey("C-c");
      await editor.handleKey("C-c");

      // Context restored exactly
      expect(tl(editor, "(buffer-current)")).toBe(before.buf);
      expect(tl(editor, "(cursor-line)")).toBe(before.line);
      expect(tl(editor, "(cursor-column)")).toBe(before.col);
      expect(tl(editor, "(editor-mode)")).toBe("normal");

      // Entry appended to today's note under the default daily/ layout
      const files = readdirSync(join(vault, "daily")).filter((f) => f.endsWith(".md"));
      expect(files).toHaveLength(1);
      const content = readFileSync(join(vault, "daily", files[0]!), "utf-8");
      expect(content).toMatch(/^# 2026-\d\d-\d\d/m);
      expect(content).toMatch(/- \[2026-\d\d-\d\d \d\d:\d\d\] first thought\n$/);
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("C-c C-k aborts: existing note untouched, no note created", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("hello world");
      executeTlisp(editor, "(capture-daily)");
      executeTlisp(editor, '(buffer-insert "throwaway")');
      await editor.handleKey("C-c");
      await editor.handleKey("C-k");
      expect(tl(editor, "(buffer-current)")).toBe("test");
      // No journal file was created by the aborted capture
      expect(readdirSync(vault).includes("daily")).toBe(false);
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("commit appends to an EXISTING daily note (no clobber, no duplicate header)", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const today = new Date().toLocaleDateString("sv-SE");
      mkdirSync(join(vault, "daily"));
      writeFileSync(join(vault, "daily", `${today}.md`), "# PRECIOUS\n");
      const editor = await createStartedEditor("x");
      executeTlisp(editor, "(capture-daily)");
      executeTlisp(editor, '(buffer-insert "second thought")');
      executeTlisp(editor, "(capture-commit)");
      const content = readFileSync(join(vault, "daily", `${today}.md`), "utf-8");
      expect(content.startsWith("# PRECIOUS\n")).toBe(true);
      expect(content).toContain("second thought");
      expect((content.match(/^# /gm) ?? []).length).toBe(1);
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("journal home honored: markdown-journal-dir-set \".\" lands flat", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("x");
      executeTlisp(editor, '(markdown-journal-dir-set ".")');
      executeTlisp(editor, "(capture-daily)");
      executeTlisp(editor, '(buffer-insert "flat capture")');
      executeTlisp(editor, "(capture-commit)");
      expect(readdirSync(vault).includes("daily")).toBe(false);
      const flat = readdirSync(vault).filter((f) => /^\d{4}-\d\d-\d\d\.md$/.test(f));
      expect(flat).toHaveLength(1);
      expect(readFileSync(join(vault, flat[0]!), "utf-8")).toContain("flat capture");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("repeat capture starts from an empty compose buffer (no stale text)", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("x");
      executeTlisp(editor, "(capture-daily)");
      executeTlisp(editor, '(buffer-insert "first")');
      executeTlisp(editor, "(capture-commit)");
      executeTlisp(editor, "(capture-daily)");
      expect(tl(editor, "(buffer-text)")).toBe("");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("empty compose text commits nothing", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("x");
      executeTlisp(editor, "(capture-daily)");
      executeTlisp(editor, "(capture-commit)");
      expect(readdirSync(vault).includes("daily")).toBe(false);
      expect(tl(editor, "(buffer-current)")).toBe("test");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });
});
