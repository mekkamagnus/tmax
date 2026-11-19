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

  test("codex r2: reopening a draft from ANOTHER pane never destroys the layout", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("hello world");
      executeTlisp(editor, "(capture-daily)");
      executeTlisp(editor, '(buffer-insert "draft")');
      // Focus moves to the TOP (original) pane, then the chord fires again
      executeTlisp(editor, "(windmove-up)");
      executeTlisp(editor, "(capture-daily)");
      // Focus landed on the EXISTING popup — and the top pane still shows
      // the ORIGINAL buffer (no second pane hijacked into *Capture*)
      expect(tl(editor, "(buffer-current)")).toBe("*Capture*");
      const panes = tl(editor, "(window-list)");
      expect(panes.match(/\*Capture\*/g)?.length).toBe(1);
      expect(panes.includes("test")).toBe(true);
      // Abort from here: the POPUP pane closes, the original pane survives
      executeTlisp(editor, "(capture-abort)");
      expect(tl(editor, "(window-count)")).toBe("1");
      expect(tl(editor, "(buffer-current)")).toBe("test");
      expect(readdirSync(vault).includes("daily")).toBe(false);
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("codex r3: compose lands in the LOWER pane (geometry, not just count)", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("hello world");
      executeTlisp(editor, "(capture-daily)");
      // Geometry by navigation: the compose pane is the LOWER one — moving
      // up from it lands on the ORIGINAL buffer (window-list is not
      // layout-ordered, so pane order cannot be read off it).
      expect(tl(editor, "(buffer-current)")).toBe("*Capture*");
      executeTlisp(editor, "(windmove-up)");
      expect(tl(editor, "(buffer-current)")).toBe("test");
      executeTlisp(editor, "(windmove-down)");
      expect(tl(editor, "(buffer-current)")).toBe("*Capture*");
      executeTlisp(editor, "(capture-abort)");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("codex r3: commit from ANOTHER pane files the DRAFT, not that pane's buffer", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("hello world");
      executeTlisp(editor, "(capture-daily)");
      executeTlisp(editor, '(buffer-insert "PRECIOUS DRAFT")');
      executeTlisp(editor, "(windmove-up)"); // now genuinely another pane
      executeTlisp(editor, "(capture-commit)");
      expect(tl(editor, "(window-count)")).toBe("1");
      expect(tl(editor, "(buffer-current)")).toBe("test");
      const files = readdirSync(join(vault, "daily")).filter((f) => f.endsWith(".md"));
      const content = readFileSync(join(vault, "daily", files[0]!), "utf-8");
      expect(content).toContain("PRECIOUS DRAFT");
      expect(content).not.toContain("hello world");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("codex r3: a Markdown task body keeps the open-time prefix (- [ ] is not an edited seed)", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("x");
      executeTlisp(editor, "(capture-daily)");
      const ts = (tl(editor, "(buffer-text)").match(/\[(\d{4}-\d\d-\d\d \d\d:\d\d)\]/) ?? [])[1]!;
      expect(tl(editor, '(capture-entry "- [ ] water the plants")')).toBe(`- [${ts}] - [ ] water the plants`);
      expect(tl(editor, '(capture-entry "- [1999-01-01 00:00] edited")')).toBe("- [1999-01-01 00:00] edited");
      executeTlisp(editor, "(capture-abort)");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("codex r4: hidden popup — pane switched away, commit still files the DRAFT", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("hello world");
      executeTlisp(editor, "(capture-daily)");
      executeTlisp(editor, '(buffer-insert "PRECIOUS DRAFT")');
      // The popup pane is switched to another buffer — *Capture* is hidden
      executeTlisp(editor, '(switch-to-buffer "test")');
      executeTlisp(editor, "(capture-commit)");
      const files = readdirSync(join(vault, "daily")).filter((f) => f.endsWith(".md"));
      const content = readFileSync(join(vault, "daily", files[0]!), "utf-8");
      expect(content).toContain("PRECIOUS DRAFT");
      expect(content).not.toContain("hello world");
      // Conservative restore: a HIDDEN popup's pane is unidentifiable after
      // the user switched its buffer away — abort/commit never delete a pane
      // they cannot identify; the compose buffer is gone and no user pane
      // was touched.
      const panes = tl(editor, "(window-list)");
      expect(panes.includes("*Capture*")).toBe(false);
      expect(tl(editor, "(buffer-current)")).toBe("test");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("codex r4: side-by-side layout — popup still lands BELOW, not hijacking a full-height pane", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("hello world");
      executeTlisp(editor, "(split-window-right)");
      expect(tl(editor, "(window-count)")).toBe("2");
      executeTlisp(editor, "(capture-daily)");
      expect(tl(editor, "(buffer-current)")).toBe("*Capture*");
      // The compose pane has a pane ABOVE it (a bottom split was created)
      executeTlisp(editor, "(windmove-up)");
      expect(tl(editor, "(buffer-current)")).not.toBe("*Capture*");
      executeTlisp(editor, "(windmove-down)");
      executeTlisp(editor, "(capture-abort)");
      // Layout back to the original two side-by-side panes
      expect(tl(editor, "(window-count)")).toBe("2");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("codex r4: a split of the compose pane — abort closes ALL *Capture* panes", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("hello world");
      executeTlisp(editor, "(capture-daily)");
      // The user splits the compose pane — two panes now show *Capture*
      executeTlisp(editor, "(split-window-below)");
      expect(tl(editor, "(window-count)")).toBe("3");
      executeTlisp(editor, "(capture-abort)");
      expect(tl(editor, "(window-count)")).toBe("1");
      const panes = tl(editor, "(window-list)");
      expect(panes.includes("*Capture*")).toBe(false);
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("codex r4: ts-shaped TYPED text after the untouched seed keeps the open-time prefix", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("x");
      executeTlisp(editor, "(capture-daily)");
      const ts = (tl(editor, "(buffer-text)").match(/\[(\d{4}-\d\d-\d\d \d\d:\d\d)\]/) ?? [])[1]!;
      // Typed PAST the untouched seed: first thought, then a ts-shaped line
      executeTlisp(editor, '(buffer-insert "note: then at - [1999-01-01 00:00] something happened")');
      executeTlisp(editor, "(capture-commit)");
      const files = readdirSync(join(vault, "daily")).filter((f) => f.endsWith(".md"));
      const content = readFileSync(join(vault, "daily", files[0]!), "utf-8");
      expect(content).toContain(`- [${ts}] note: then at - [1999-01-01 00:00] something happened`);
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("codex r5: hide popup, abort from the ORIGINAL pane — origin survives, layout back", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("hello world");
      executeTlisp(editor, "(capture-daily)");
      // Hide the compose: its pane switches to another buffer
      executeTlisp(editor, '(switch-to-buffer "test")');
      // Navigate to the ORIGINAL pane, then abort
      executeTlisp(editor, "(windmove-up)");
      executeTlisp(editor, "(capture-abort)");
      // The ORIGIN pane survived and is focused; the ex-popup pane (now
      // showing the user's chosen buffer) is left in place — conservative
      // restore never deletes an unidentifiable pane.
      expect(tl(editor, "(buffer-current)")).toBe("test");
      const panes2 = tl(editor, "(window-list)");
      expect(panes2.includes("*Capture*")).toBe(false);
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("codex r5: an ALREADY-OPEN journal buffer stays consistent — save cannot overwrite the entry", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("x");
      // Today's note is open in a buffer (markdown-daily-note opens it)
      executeTlisp(editor, "(markdown-daily-note)");
      const journalBuffer = tl(editor, "(buffer-current)");
      // Capture from the *scratch*-ish buffer
      executeTlisp(editor, '(switch-to-buffer "test")');
      executeTlisp(editor, "(capture-daily)");
      executeTlisp(editor, '(buffer-insert "must survive save")');
      executeTlisp(editor, "(capture-commit)");
      // The open journal buffer picked the entry up
      executeTlisp(editor, `(switch-to-buffer "${journalBuffer}")`);
      expect(tl(editor, "(buffer-text)")).toContain("must survive save");
      // Saving it afterwards keeps the entry (no overwrite data loss)
      executeTlisp(editor, "(save-buffer)");
      const files = readdirSync(join(vault, "daily")).filter((f) => f.endsWith(".md"));
      const content = readFileSync(join(vault, "daily", files[0]!), "utf-8");
      expect(content).toContain("must survive save");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("codex r6: journal opened via ABSOLUTE path — save still cannot overwrite the entry", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("x");
      // Today's note opened by ABSOLUTE path (different buffer name form
      // than the capture's relative target)
      const today = tmaxToday(editor);
      const absPath = join(vault, "daily", `${today}.md`);
      mkdirSync(join(vault, "daily"));
      writeFileSync(absPath, "# ABS\n");
      executeTlisp(editor, `(find-file-open "${absPath}")`);
      executeTlisp(editor, '(switch-to-buffer "test")');
      executeTlisp(editor, "(capture-daily)");
      executeTlisp(editor, '(buffer-insert "abs-path entry")');
      executeTlisp(editor, "(capture-commit)");
      // The absolute-path buffer picked the entry up; saving keeps it
      executeTlisp(editor, `(switch-to-buffer "${absPath}")`);
      expect(tl(editor, "(buffer-text)")).toContain("abs-path entry");
      executeTlisp(editor, "(save-buffer)");
      expect(readFileSync(join(vault, "daily", `${today}.md`), "utf-8")).toContain("abs-path entry");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("codex r6: side-by-side panes — focus returns to the ORIGIN pane (not the neighbor)", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("hello world");
      executeTlisp(editor, "(split-window-right)");
      // Put a DIFFERENT buffer in the right pane
      executeTlisp(editor, '(window-move-focus "right")');
      executeTlisp(editor, '(buffer-create "*RIGHT*")');
      executeTlisp(editor, '(switch-to-buffer "*RIGHT*")');
      // Chord from the LEFT pane
      executeTlisp(editor, '(window-move-focus "left")');
      executeTlisp(editor, "(capture-daily)");
      executeTlisp(editor, "(capture-abort)");
      // Focus is back on the LEFT pane showing the original buffer
      expect(tl(editor, "(buffer-current)")).toBe("test");
      expect(tl(editor, "(window-count)")).toBe("2");
      executeTlisp(editor, '(window-move-focus "right")');
      expect(tl(editor, "(buffer-current)")).toBe("*RIGHT*");
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

  test("codex r1/r2: only the EXACT seeded header line is stripped", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-capture-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await createStartedEditor("x");
      executeTlisp(editor, "(capture-daily)");
      // The exact seeded line (prefix + open-stamped target path)
      const seeded = tl(editor, "(buffer-text)").split("\n")[0]!;
      // A user/edited line with the prefix but a DIFFERENT path is NOT eaten
      expect(tl(editor, `(capture-strip-skeleton "capture -> /not/the/target.md\nbody")`))
        .toBe("capture -> /not/the/target.md\nbody");
      expect(tl(editor, '(capture-strip-skeleton "capture the flag")')).toBe("capture the flag");
      // The exact seed line IS dropped
      expect(tl(editor, `(capture-strip-skeleton "${seeded}\n- [t] body")`)).toBe("- [t] body");
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
      // header stripping drops the exact seeded line only
      const seeded = tl(editor, "(buffer-text)").split("\n")[0]!;
      expect(tl(editor, `(capture-strip-skeleton "${seeded}\n- [t] body")`)).toBe("- [t] body");
      expect(tl(editor, '(capture-strip-skeleton "- [t] no header")')).toBe("- [t] no header");
      executeTlisp(editor, "(capture-abort)");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });
});
