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
