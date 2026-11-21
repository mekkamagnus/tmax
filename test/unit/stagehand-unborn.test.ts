import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file stagehand-unborn.test.ts
 * @description #287 codex r1 #2 — `u` on an UNBORN repo: git restore
 * --staged cannot resolve HEAD, so the index-only `git rm --cached`
 * path serves (worktree preserved). Lives in its own file: the
 * helper-mediated variant inside stagehand-stage.test.ts hit a
 * bun/T-Lisp module-state quirk (the symbol resolved undefined in
 * exactly that file) while this minimal shape passes deterministically.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const git = (...args: string[]) => execFileSync("git", args, { cwd: process.cwd() }).toString().trim();
const file = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i287u-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  executeTlisp(editor, "(require-module stagehand/status)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("#287 — unborn unstage", () => {
  test("the AM SPLIT row unstages on an unborn repo (rm --cached -f; worktree survives) + header-wide U", () => {
    writeFileSync(join(process.cwd(), "n.txt"), "staged content\n");
    execFileSync("git", ["add", "n.txt"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "n.txt"), "modified after staging\n"); // the AM row
    executeTlisp(editor, "(stagehand/status/stagehand-status)");
    // The AM row appears in BOTH sections — target the STAGED copy
    // (the row directly under the Staged header).
    const lines = strip(bufferText(editor)).split("\n");
    const sHdr = lines.findIndex((l) => l.startsWith("Staged ("));
    const row = sHdr + 1;
    expect(lines[row]).toContain("n.txt");
    executeTlisp(editor, `(cursor-move ${row} 0)`);
    executeTlisp(editor, "(stagehand/stage/stagehand-unstage-file)");
    expect(git("diff", "--cached", "--name-only")).toBe("");
    expect(file("n.txt")).toBe("modified after staging\n"); // worktree SURVIVES
    // And header-wide U on a second AM file.
    writeFileSync(join(process.cwd(), "m.txt"), "m1\n");
    execFileSync("git", ["add", "m.txt"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "m.txt"), "m2\n");
    executeTlisp(editor, "(stagehand/status/stagehand-status-refresh)") ;
    executeTlisp(editor, "(stagehand/status/stagehand-status)");
    const lines2 = strip(bufferText(editor)).split("\n");
    const hdr = lines2.findIndex((l) => l.startsWith("Staged ("));
    executeTlisp(editor, `(cursor-move ${hdr} 0)`);
    executeTlisp(editor, "(stagehand/stage/stagehand-unstage-section)");
    expect(git("diff", "--cached", "--name-only")).toBe("");
    expect(file("m.txt")).toBe("m2\n");
    expect(String(executeTlisp(editor, "(editor-status)").value)).toContain("applied 1 of 1 visited");
  });

  test("u works on an UNBORN repo (rm --cached; worktree preserved)", () => {
    writeFileSync(join(process.cwd(), "n.txt"), "content\n");
    execFileSync("git", ["add", "n.txt"], { cwd: process.cwd() });
    executeTlisp(editor, "(stagehand/status/stagehand-status)");
    const lines = strip(bufferText(editor)).split("\n");
    const row = lines.findIndex((l) => l.includes("A  n.txt"));
    expect(row).toBeGreaterThanOrEqual(0);
    executeTlisp(editor, `(cursor-move ${row} 0)`);
    executeTlisp(editor, "(stagehand/stage/stagehand-unstage-file)");
    expect(git("diff", "--cached", "--name-only")).toBe("");
    expect(file("n.txt")).toBe("content\n"); // worktree preserved
    expect(git("rev-list", "--count", "--all")).toBe("0");
  });
});
