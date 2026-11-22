import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file stagehand-pick.test.ts
 * @description #330 — cherry-pick + revert in the log view: the
 * n-first y/n confirm, non-conflicting outcomes (worktree + HEAD
 * asserted on real git), the conflict route to the Conflicted
 * section with the named abort advice, and the no-commit row guard.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const git = (...args: string[]) => execFileSync("git", args, { cwd: process.cwd() }).toString().trim();

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i330-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module stagehand/status)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const commit = (msg: string) => {
  execFileSync("git", ["add", "."], { cwd: process.cwd() });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg], { cwd: process.cwd() });
};

const openLog = async (expectCommits = 1) => {
  e(editor, "(require-module stagehand/log)");
  e(editor, "(stagehand/status/stagehand-status)"); // l runs FROM the status buffer (the root source)
  e(editor, "(stagehand/log/stagehand-log-open)");
  // The log fills asynchronously (git log via make-process).
  for (let i = 0; i < 200; i++) {
    const n = Number(e(editor, "(stagehand/log/stagehand-log-commit-count)").value);
    if (n >= expectCommits) return;
    await new Promise((r) => setTimeout(r, 25));
  }
};

/** The view line of the Nth commit (0 = newest, first row). */
const commitRow = (n: number) => {
  const lines = strip(bufferText(editor)).split("\n");
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^[*| \\/]*[0-9a-f]{7,} /.test(lines[i]!) || lines[i]!.includes(" ")) {
      // The log renders art rows too; rely on sha-at-line instead.
    }
    if (String(e(editor, `(stagehand/log/stagehand-log-sha-at-line ${i})`).value) !== "null") {
      seen++;
      if (seen === n) return i;
    }
  }
  return -1;
};

describe("#330 — cherry-pick + revert (the log view)", () => {
  test("cherry-pick of an ALREADY-APPLIED ancestor: the named failure, HEAD unmoved, cancel-first", async () => {
    // The log lists HEAD's ancestors — a cherry-pick from THIS view
    // targets an already-applied commit: git refuses (empty result).
    writeFileSync("a.txt", "base\n"); commit("base");
    writeFileSync("b.txt", "feature\n"); commit("feature");
    await openLog(2);
    const row = commitRow(1); // base (the ancestor)
    e(editor, `(cursor-move ${row} 0)`);
    e(editor, "(stagehand/log/stagehand-log-cherry-pick)");
    await editor.handleKey("Enter"); // the n-first default = cancel
    expect(String(e(editor, "(editor-status)").value)).toContain("cancelled");
    expect(git("log", "-1", "--format=%s")).toContain("feature"); // HEAD unmoved
    e(editor, "(stagehand/log/stagehand-log-cherry-pick)");
    e(editor, '(stagehand/log/stagehand-log-pick-accept "y")');
    const st = String(e(editor, "(editor-status)").value);
    // An empty pick: git exits non-zero WITHOUT conflicts (a clean
    // porcelain) — the NAMED-FAILURE branch, never the conflict
    // route (gate r1: the 'possibly due to conflict resolution'
    // stderr used to hijack this case).
    expect(st).toContain("cherry-pick failed (");
    expect(st).not.toContain("conflict —");
    expect(git("status", "--porcelain")).toBe(""); // structurally clean
    expect(git("log", "-1", "--format=%s")).toContain("feature"); // HEAD still unmoved
  });


  test("a NON-CONFLICTING revert: the change un-applies", async () => {
    writeFileSync("a.txt", "base\n"); commit("base");
    writeFileSync("a.txt", "base\nchanged\n"); commit("change");
    await openLog(2);
    const row = commitRow(0); // the change commit (newest)
    e(editor, `(cursor-move ${row} 0)`);
    e(editor, "(stagehand/log/stagehand-log-revert)");
    e(editor, '(stagehand/log/stagehand-log-pick-accept "y")');
    expect(String(e(editor, "(editor-status)").value)).toContain("reverted");
    expect(readFileSync(join(process.cwd(), "a.txt"), "utf8")).toBe("base\n");
    // The status DATA refreshed but the VIEW returned to the log
    // (gate r1: the ensure-buffer switch used to yank the user out).
    expect(String(e(editor, "(buffer-current)").value)).toContain("Stagehand-Log");
  });

  test("a CONFLICTING revert routes to the Conflicted section with the abort advice", async () => {
    // Reverting an EARLIER change whose lines a LATER commit also
    // changed → conflict; the Conflicted section + the named advice.
    writeFileSync("a.txt", "line\n"); commit("base");
    writeFileSync("a.txt", "first-change\n"); commit("first");
    writeFileSync("a.txt", "second-change\n"); commit("second");
    await openLog(3);
    const row = commitRow(1); // first (row 0 = second)
    e(editor, `(cursor-move ${row} 0)`);
    e(editor, "(stagehand/log/stagehand-log-revert)");
    e(editor, '(stagehand/log/stagehand-log-pick-accept "y")');
    const st = String(e(editor, "(editor-status)").value);
    expect(st).toContain("conflict");
    expect(st).toContain("--abort");
    expect(strip(bufferText(editor))).toContain("Conflicted");
    expect(String(e(editor, "(buffer-current)").value)).toContain("Stagehand"); // the status view
    expect(String(e(editor, "(buffer-current)").value)).not.toContain("Stagehand-Log");
    expect(git("status", "--porcelain")).toContain("UU");
    execFileSync("git", ["revert", "--abort"], { cwd: process.cwd() });
  });


  test("a non-commit row refuses with the named status", async () => {
    writeFileSync("a.txt", "base\n"); commit("base");
    await openLog(1);
    // The BLANK trailing row below the log (deterministically
    // non-commit — the gate found the old guard vacuous).
    const lines = strip(bufferText(editor)).split("\n");
    let blank = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim() === "" && String(e(editor, `(stagehand/log/stagehand-log-sha-at-line ${i})`).value) === "null") { blank = i; break; }
    }
    expect(blank).toBeGreaterThanOrEqual(0);
    e(editor, `(cursor-move ${blank} 0)`);
    e(editor, "(stagehand/log/stagehand-log-cherry-pick)");
    expect(String(e(editor, "(editor-status)").value)).toContain("no commit on this row");
  });
});
