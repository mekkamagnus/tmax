import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupMdEditor, executeTlisp } from "../helpers/editor-fixture.ts";

/**
 * #270: markdown-daily-note must mkdir daily/ and persist the file BEFORE
 * opening — find-file-open is a no-op for missing files, so the old version
 * left an unbacked buffer whose :w hit write-file-content ENOENT. Mirrors the
 * markdown-write-note-template write-then-open pattern (#185 gap 2).
 *
 * The command uses a RELATIVE "daily/<date>.md" path, so each test chdirs into
 * its own throwaway vault (restored on exit).
 */
describe("#270: markdown-daily-note", () => {
  test("creates daily/ + a file-backed note when nothing exists", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-daily-note-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await setupMdEditor("x\n", join(vault, "index.md"));
      executeTlisp(editor, "(markdown-daily-note)");

      // mkdir + write-then-open: the file EXISTS on disk with note content
      expect(readdirSync(vault)).toContain("daily");
      const files = readdirSync(join(vault, "daily")).filter((f) => f.endsWith(".md"));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^2026-\d\d-\d\d\.md$/);
      const content = readFileSync(join(vault, "daily", files[0]!), "utf-8");
      expect(content.length).toBeGreaterThan(0);

      // Buffer is file-backed: the user's exact #270 scenario — type an entry,
      // :w — must persist instead of ENOENT
      executeTlisp(editor, "(buffer-insert \"This is pretty nice.\\n\")");
      executeTlisp(editor, "(save-buffer)");
      expect(readFileSync(join(vault, "daily", files[0]!), "utf-8")).toContain("This is pretty nice.");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("opens the existing daily note without clobbering it", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-daily-note-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, local tz
      mkdirSync(join(vault, "daily"));
      writeFileSync(join(vault, "daily", `${today}.md`), "# PRECIOUS\n");
      const editor = await setupMdEditor("x\n", join(vault, "index.md"));
      executeTlisp(editor, "(markdown-daily-note)");
      expect(readFileSync(join(vault, "daily", `${today}.md`), "utf-8")).toBe("# PRECIOUS\n");
      const notes = readdirSync(join(vault, "daily")).filter((f) => f.endsWith(".md"));
      expect(notes).toEqual([`${today}.md`]);
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("#271: markdown-journal-dir-set \".\" writes flat (user's layout)", async () => {
    const vault = mkdtempSync(join(tmpdir(), "tmax-daily-note-"));
    const prevCwd = process.cwd();
    process.chdir(vault);
    try {
      const editor = await setupMdEditor("x\n", join(vault, "index.md"));
      executeTlisp(editor, '(markdown-journal-dir-set ".")');
      executeTlisp(editor, "(markdown-daily-note)");
      // Flat: dated note lands in the vault root, no daily/ dir created
      expect(readdirSync(vault)).not.toContain("daily");
      const flat = readdirSync(vault).filter((f) => /^\d{4}-\d\d-\d\d\.md$/.test(f));
      expect(flat).toHaveLength(1);
      expect(existsSync(join(vault, flat[0]!))).toBe(true);
      // :w still persists to the flat path
      executeTlisp(editor, "(buffer-insert \"flat entry\\n\")");
      executeTlisp(editor, "(save-buffer)");
      expect(readFileSync(join(vault, flat[0]!), "utf-8")).toContain("flat entry");
    } finally {
      process.chdir(prevCwd);
      rmSync(vault, { recursive: true, force: true });
    }
  });
});
