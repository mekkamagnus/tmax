import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";
import type { Editor } from "../../src/editor/editor.ts";

/**
 * #278/#285: SPC r d — popup capture to today's daily note (org-capture
 * parity, verified against Emacs 30.1). Single window splits 50/50 bottom;
 * existing layout is reused. Skeleton (header + seeded open-time prefix) is
 * commit-stripped and never reaches the file. C-c C-c / C-c C-k close the
 * popup and restore buffer/mode/point exactly.
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

/** tmax's own local date via shell `date` — Bun's sv-SE locale returns the
 *  UTC date, which diverges from the local `date` between 00:00 and 08:00. */
function tmaxToday(editor: Editor): string {
  return tl(editor, '(string-trim (shell-command "date +%Y-%m-%d"))');
}

describe("#285: capture popup (SPC r d)", () => {
  test("SPC r d: popup split + skeleton; C-c C-c strips skeleton, restores exactly", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("hello world");
      executeTlisp(editor, "(cursor-move 0 4)");
      const before = { buf: tl(editor, "(buffer-current)"), line: tl(editor, "(cursor-line)"), col: tl(editor, "(cursor-column)") };

      await editor.handleKey(" "); // SPC
      await editor.handleKey("r");
      await editor.handleKey("d");

      // Popup: single window grew a 50/50 bottom split; compose buffer live
      expect(tl(editor, "(buffer-current)")).toBe("*Capture*");
      expect(tl(editor, "(editor-mode)")).toBe("insert");
      expect(tl(editor, "(length (window-list))")).toBe("2");
      // Skeleton: header names the target; seeded prefix carries open-time ts
      const skel = tl(editor, "(buffer-text)");
      expect(skel.startsWith("capture -> ")).toBe(true);
      expect(skel).toMatch(/\n- \[2026-\d\d-\d\d \d\d:\d\d\] $/);

      executeTlisp(editor, '(buffer-insert "first thought")');
      await editor.handleKey("C-c");
      await editor.handleKey("C-c");

      // Context restored exactly: buffer, point, mode, single window
      expect(tl(editor, "(buffer-current)")).toBe(before.buf);
      expect(tl(editor, "(cursor-line)")).toBe(before.line);
      expect(tl(editor, "(cursor-column)")).toBe(before.col);
      expect(tl(editor, "(editor-mode)")).toBe("normal");
      expect(tl(editor, "(length (window-list))")).toBe("1");

      // Entry appended; the skeleton never reached the file
      const files = readdirSync(join(vault, "daily")).filter((f) => f.endsWith(".md"));
      expect(files).toHaveLength(1);
      const content = readFileSync(join(vault, "daily", files[0]!), "utf-8");
      expect(content).toMatch(/^# 2026-\d\d-\d\d/m);
      expect(content).not.toContain("capture ->");
      expect(content).toMatch(/- \[2026-\d\d-\d\d \d\d:\d\d\] first thought\n$/);
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("C-c C-k aborts: popup closes, no note created", async () => {
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
      expect(tl(editor, "(length (window-list))")).toBe("1");
      expect(readdirSync(vault).includes("daily")).toBe(false);
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("an existing layout is reused — compose in the BOTTOM pane, pane + focus restored", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("hello world");
      executeTlisp(editor, "(split-window-below)");
      expect(tl(editor, "(length (window-list))")).toBe("2");
      // Focus the TOP pane when pressing the chord — the capture must take
      // the BOTTOM pane, not the focused one (codex r1: pane reuse claim)
      executeTlisp(editor, "(windmove-up)");
      const originWin = tl(editor, "(window-current)");
      executeTlisp(editor, "(capture-daily)");
      expect(tl(editor, "(buffer-current)")).toBe("*Capture*");
      expect(tl(editor, "(length (window-list))")).toBe("2");
      executeTlisp(editor, '(buffer-insert "reused")');
      executeTlisp(editor, "(capture-commit)");
      expect(tl(editor, "(length (window-list))")).toBe("2");
      // Focus returned to the chord's origin window
      expect(tl(editor, "(window-current)")).toBe(originWin);
      const files = readdirSync(join(vault, "daily")).filter((f) => f.endsWith(".md"));
      expect(readFileSync(join(vault, "daily", files[0]!), "utf-8")).toContain("reused");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("codex r1: an in-progress capture is re-focused, never discarded", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("x");
      executeTlisp(editor, "(capture-daily)");
      executeTlisp(editor, '(buffer-insert "precious draft")');
      // SPC r d again mid-capture: the draft survives
      executeTlisp(editor, "(capture-daily)");
      expect(tl(editor, "(buffer-current)")).toBe("*Capture*");
      expect(tl(editor, "(buffer-text)")).toContain("precious draft");
      executeTlisp(editor, "(capture-commit)");
      const files = readdirSync(join(vault, "daily")).filter((f) => f.endsWith(".md"));
      expect(readFileSync(join(vault, "daily", files[0]!), "utf-8")).toContain("precious draft");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("codex r1: commit files to the path the header SHOWS (target stamped at open)", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("x");
      executeTlisp(editor, "(capture-daily)");
      const header = tl(editor, "(buffer-text)").split("\n")[0]!;
      const shownPath = header.replace(/^capture -> /, "");
      executeTlisp(editor, '(buffer-insert "target test")');
      executeTlisp(editor, "(capture-commit)");
      // The entry lands exactly where the header said — even if the date
      // rolled over between open and commit.
      expect(existsSync(join(vault, shownPath))).toBe(true);
      expect(readFileSync(join(vault, shownPath), "utf-8")).toContain("target test");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("codex r1: a user line starting with \"capture\" is NOT stripped", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("x");
      executeTlisp(editor, "(capture-daily)");
      // Replace the whole compose content: no seeded header, a first line
      // that merely starts with "capture"
      executeTlisp(editor, "(cursor-move 0 0)");
      executeTlisp(editor, '(buffer-insert "capture the flag notes\n")');
      executeTlisp(editor, '(capture-strip-skeleton (buffer-text))');
      // Direct rule check: only the exact "capture -> " prefix is stripped
      expect(tl(editor, '(capture-strip-skeleton "capture the flag")')).toBe("capture the flag");
      expect(tl(editor, '(capture-strip-skeleton "capture -> /x.md\n- [t] body")')).toBe("- [t] body");
      executeTlisp(editor, "(capture-abort)");
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
      const editor = await createStartedEditor("x");
      const today = tmaxToday(editor);
      mkdirSync(join(vault, "daily"));
      writeFileSync(join(vault, "daily", `${today}.md`), "# PRECIOUS\n");
      executeTlisp(editor, "(capture-daily)");
      executeTlisp(editor, '(buffer-insert "second thought")');
      executeTlisp(editor, "(capture-commit)");
      const content = readFileSync(join(vault, "daily", `${today}.md`), "utf-8");
      expect(content.startsWith("# PRECIOUS\n")).toBe(true);
      expect(content).toContain("second thought");
      expect((content.match(/^# /gm) ?? []).length).toBe(1);
      expect(content).not.toContain("capture ->");
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
      const content = readFileSync(join(vault, flat[0]!), "utf-8");
      expect(content).toContain("- [");
      expect(content).toContain("flat capture");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("repeat capture seeds a fresh skeleton (no stale text)", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("x");
      executeTlisp(editor, "(capture-daily)");
      executeTlisp(editor, '(buffer-insert "first")');
      executeTlisp(editor, "(capture-commit)");
      executeTlisp(editor, "(capture-daily)");
      expect(tl(editor, "(buffer-text)")).toMatch(/^capture -> .+\n- \[\d{4}-\d\d-\d\d \d\d:\d\d\] $/);
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("skeleton-only commit writes nothing (empty-body abort)", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("x");
      executeTlisp(editor, "(capture-daily)");
      executeTlisp(editor, "(capture-commit)"); // nothing typed past the skeleton
      expect(readdirSync(vault).includes("daily")).toBe(false);
      expect(tl(editor, "(buffer-current)")).toBe("test");
      expect(tl(editor, "(length (window-list))")).toBe("1");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("strip + entry rules: edited prefix passes through; absent prefix re-added from open-time ts", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("x");
      executeTlisp(editor, "(capture-daily)"); // sets capture-opened-ts
      const ts = (tl(editor, "(buffer-text)").match(/\[(\d{4}-\d\d-\d\d \d\d:\d\d)\]/) ?? [])[1]!;
      // body without a prefix -> open-time prefix prepended
      expect(tl(editor, '(capture-entry "plain body")')).toBe(`- [${ts}] plain body`);
      // body with an edited prefix passes through verbatim
      expect(tl(editor, '(capture-entry "- [1999-01-01 00:00] edited")')).toBe("- [1999-01-01 00:00] edited");
      // header stripping drops the seeded line only
      expect(tl(editor, '(capture-strip-skeleton "capture -> /x/y.md\\n- [t] body")')).toBe("- [t] body");
      expect(tl(editor, '(capture-strip-skeleton "- [t] no header")')).toBe("- [t] no header");
      executeTlisp(editor, "(capture-abort)");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });
});
