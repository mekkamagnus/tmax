import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file auto-revert.test.ts
 * @description #329 — the filesystem-watching primitive (file-watch-
 * start/stop on node:fs.watch — Bun 1.4.4 has no Bun.watch) and the
 * auto-revert integration: a changed-on-disk file reverts its buffer
 * (clean buffers only — dirty ones are never clobbered), watches
 * share per distinct path, and stop-all clears the registry.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i329-"));
  dirs.push(dir);
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module editor/modes/auto-revert)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Wait for pred(editor) — the watch events are async. */
const waitFor = async (pred: (ed: Editor) => boolean, ms = 5000) => {
  for (let i = 0; i < ms / 25; i++) {
    if (pred(editor)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
};

describe("#329 — the watch primitive", () => {
  test("start returns an id; events fire the callback; stop stops; list reflects", async () => {
    writeFileSync("w.txt", "v1\n");
    e(editor, '(defvar w329-events nil)');
    e(editor, '(defun w329-cb (path ev) (setq w329-events (append (or w329-events (list)) (list (concat ev ":" ev)))))');
    const id = Number(e(editor, '(file-watch-start "w.txt" "w329-cb")').value);
    expect(Number.isFinite(id)).toBe(true);
    expect(String(e(editor, '(if (member "w.txt" (file-watch-list)) "t" "nil")').value)).toContain("t");
    writeFileSync("w.txt", "v2\n");
    const fired = await waitFor(() => String(e(editor, "w329-events").value) !== "nil");
    expect(fired).toBe(true);
    expect(String(e(editor, '(file-watch-stop ' + id + ")").value)).toContain("t");
    // After stop: no further events.
    e(editor, "(setq w329-events nil)");
    writeFileSync("w.txt", "v3\n");
    await new Promise((r) => setTimeout(r, 400));
    expect(["nil", "null"].includes(String(e(editor, "w329-events").value))).toBe(true);
  });

  test("a bogus path refuses with a named error", () => {
    const r = e(editor, '(condition-case nil (file-watch-start "/nonexistent/dir-329/x" "w329-cb") (error (m) (concat "caught:" m)))');
    expect(String(r.value)).toContain("caught:");
    expect(String(r.value)).toContain("ENOENT");
  });
});

describe("#329 — auto-revert integration", () => {
  test("an external change reverts a CLEAN buffer", async () => {
    writeFileSync("f.txt", "original\n");
    e(editor, '(find-file "f.txt")');
    e(editor, "(auto-revert-mode t)");
    expect(String(e(editor, "(auto-revert-watched-p \"f.txt\")").value)).not.toBe("nil");
    // External change (outside the editor).
    writeFileSync("f.txt", "changed-on-disk\n");
    const reverted = await waitFor(() =>
      strip(String(bufferText(editor))).includes("changed-on-disk"));
    expect(reverted).toBe(true);
    expect(Number(e(editor, "(auto-revert-buffers-get)").value)).toBeGreaterThanOrEqual(1);
    e(editor, "(auto-revert-mode nil)");
  });

  test("a DIRTY buffer is NEVER clobbered", async () => {
    writeFileSync("g.txt", "original\n");
    e(editor, '(find-file "g.txt")');
    e(editor, "(auto-revert-mode t)");
    // Dirty the buffer (unsaved edit).
    e(editor, '(buffer-insert "unsaved")');
    writeFileSync("g.txt", "changed-on-disk\n");
    await new Promise((r) => setTimeout(r, 600));
    // The buffer keeps the unsaved content; the disk differs.
    expect(strip(String(bufferText(editor)))).toContain("unsaved");
    expect(readFileSync("g.txt", "utf8")).toBe("changed-on-disk\n");
    e(editor, "(auto-revert-mode nil)");
  });

  test("mode OFF stops all watches (the registry clears)", () => {
    writeFileSync("h.txt", "x\n");
    e(editor, '(find-file "h.txt")');
    e(editor, "(auto-revert-mode t)");
    expect(String(e(editor, '(if (member "h.txt" (file-watch-list)) "t" "nil")').value)).toContain("t");
    e(editor, "(auto-revert-mode nil)");
    expect(String(e(editor, '(if (member "h.txt" (file-watch-list)) "t" "nil")').value)).toContain("nil");
  });
});
