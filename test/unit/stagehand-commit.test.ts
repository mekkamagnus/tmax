import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file stagehand-commit.test.ts
 * @description #288 — Stagehand T0: commit. The *Commit-Message* compose
 * (c/C/R variants, C-c C-c / C-c C-k), `git commit -F` delivery with
 * always-removed temp files, the direct fixup invocation, failure
 * retention (hook rejection → retry), empty message, abort restore,
 * the nothing-staged refusal, and the unborn-repo guards.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const git = (...args: string[]) => execFileSync("git", args, { cwd: process.cwd() }).toString().trim();

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i288-"));
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
const statusOf = () => {
  e(editor, "(stagehand/status/stagehand-status)");
  return strip(bufferText(editor));
};
const tmpGone = () => {
  const t = String(e(editor, "(stagehand/commit/stagehand-commit-last-tmp)").value);
  return t === "null" || !existsSync(t);
};
const type = (text: string) => {
  for (const ch of text) e(editor, `(buffer-insert "${ch === '"' ? '\\"' : ch}")`);
};

describe("#288 — the commit flow", () => {
  test("c → compose → C-c C-c: the commit lands with the typed message; temp file GONE", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    commit("base");
    writeFileSync(join(process.cwd(), "b.txt"), "b\n");
    execFileSync("git", ["add", "b.txt"], { cwd: process.cwd() });
    statusOf();
    e(editor, "(stagehand/commit/stagehand-commit-new)");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Commit-Message*");
    type("feat: typed message");
    e(editor, "(stagehand/commit/stagehand-commit-dispatch)");
    expect(git("log", "-1", "--format=%B")).toContain("feat: typed message");
    expect(tmpGone()).toBe(true);
    // Compose closed; the prior buffer restored.
    expect(String(e(editor, "(buffer-current)").value)).not.toBe("*Commit-Message*");
    expect(String(e(editor, '(if (member "*Commit-Message*" (buffer-list)) 1 0)').value)).toBe("0");
  });

  test("c with NOTHING staged → the refusal, no compose", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    commit("base");
    statusOf();
    e(editor, "(stagehand/commit/stagehand-commit-new)");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Stagehand*");
    expect(String(e(editor, "(editor-status)").value)).toContain("nothing staged");
  });

  test("C → amend: message seeded + replaced; a newly staged file folds in", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    commit("first message");
    writeFileSync(join(process.cwd(), "b.txt"), "b\n");
    execFileSync("git", ["add", "b.txt"], { cwd: process.cwd() });
    statusOf();
    e(editor, "(stagehand/commit/stagehand-commit-amend)");
    // Seeded with the LAST message.
    expect(strip(bufferText(editor))).toContain("first message");
    // Replace it entirely.
    e(editor, "(stagehand/commit/stagehand-commit-clear)");
    type("amended message");
    e(editor, "(stagehand/commit/stagehand-commit-dispatch)");
    expect(git("log", "-1", "--format=%B")).toContain("amended message");
    // The staged file folded into the amended commit.
    expect(git("show", "--stat", "--format=", "HEAD")).toContain("b.txt");
    expect(tmpGone()).toBe(true);
  });

  test("C on NOTHING-STAGED still amends (message-only edit)", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    commit("original");
    statusOf();
    e(editor, "(stagehand/commit/stagehand-commit-amend)");
    e(editor, "(stagehand/commit/stagehand-commit-clear)");
    type("reworded via nothing-staged amend");
    e(editor, "(stagehand/commit/stagehand-commit-dispatch)");
    expect(git("log", "-1", "--format=%B")).toContain("reworded via nothing-staged amend");
    expect(git("show", "--stat", "--format=", "HEAD")).toContain("a.txt"); // original tree intact
  });

  test("R → reword at HEAD", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    commit("old subject");
    statusOf();
    e(editor, "(stagehand/commit/stagehand-commit-reword)");
    expect(strip(bufferText(editor))).toContain("old subject");
    e(editor, "(stagehand/commit/stagehand-commit-clear)");
    type("new subject");
    e(editor, "(stagehand/commit/stagehand-commit-dispatch)");
    expect(git("log", "-1", "--format=%s")).toBe("new subject");
    expect(git("rev-list", "--count", "HEAD")).toBe("1"); // reword, not a new commit
  });

  test("F → the DIRECT fixup: fixup! message, no compose, status shows the sha", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    commit("target subject");
    const sha = git("rev-parse", "HEAD");
    writeFileSync(join(process.cwd(), "a.txt"), "a2\n");
    execFileSync("git", ["add", "a.txt"], { cwd: process.cwd() });
    statusOf();
    // nil → no target.
    e(editor, "(stagehand/commit/stagehand-commit-fixup nil)");
    expect(String(e(editor, "(editor-status)").value)).toContain("no target");
    e(editor, `(stagehand/commit/stagehand-commit-fixup "${sha}")`);
    expect(git("log", "-1", "--format=%s")).toBe("fixup! target subject");
    expect(String(e(editor, "(editor-status)").value)).toMatch(/fixup created: [0-9a-f]+/);
    // No compose buffer was ever opened; no temp file.
    expect(String(e(editor, '(if (member "*Commit-Message*" (buffer-list)) 1 0)').value)).toBe("0");
  });

  test("hook REJECTION retains the buffer + message; retry then SUCCEEDS", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    commit("base");
    writeFileSync(join(process.cwd(), "b.txt"), "b\n");
    execFileSync("git", ["add", "b.txt"], { cwd: process.cwd() });
    mkdirSync(join(process.cwd(), ".git", "hooks"), { recursive: true });
    writeFileSync(join(process.cwd(), ".git", "hooks", "commit-msg"), "#!/bin/sh\nexit 1\n");
    chmodSync(join(process.cwd(), ".git", "hooks", "commit-msg"), 0o755);
    statusOf();
    e(editor, "(stagehand/commit/stagehand-commit-new)");
    type("will be rejected");
    e(editor, "(stagehand/commit/stagehand-commit-dispatch)");
    // RETAINED: buffer + message + the failure status.
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Commit-Message*");
    expect(strip(bufferText(editor))).toContain("will be rejected");
    expect(String(e(editor, "(editor-status)").value)).toContain("commit failed");
    expect(tmpGone()).toBe(true); // cleaned even on failure
    // Remove the hook; C-c C-c again commits the SAME message.
    rmSync(join(process.cwd(), ".git", "hooks", "commit-msg"));
    e(editor, "(stagehand/commit/stagehand-commit-dispatch)");
    expect(git("log", "-1", "--format=%B")).toContain("will be rejected");
    expect(tmpGone()).toBe(true);
  });

  test("EMPTY message → status, retained buffer, no commit", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    commit("base");
    writeFileSync(join(process.cwd(), "b.txt"), "b\n");
    execFileSync("git", ["add", "b.txt"], { cwd: process.cwd() });
    statusOf();
    e(editor, "(stagehand/commit/stagehand-commit-new)");
    e(editor, "(stagehand/commit/stagehand-commit-dispatch)"); // typed nothing
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Commit-Message*");
    expect(String(e(editor, "(editor-status)").value)).toContain("empty message");
    expect(git("rev-list", "--count", "HEAD")).toBe("1");
  });

  test("ABORT (C-c C-k): no commit, compose gone, prior buffer + status intact", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    commit("base");
    writeFileSync(join(process.cwd(), "b.txt"), "b\n");
    execFileSync("git", ["add", "b.txt"], { cwd: process.cwd() });
    statusOf();
    e(editor, "(stagehand/commit/stagehand-commit-new)");
    type("draft that will be abandoned");
    e(editor, "(stagehand/commit/stagehand-commit-abort)");
    expect(git("rev-list", "--count", "HEAD")).toBe("1"); // nothing committed
    // Buffer existence via member (T-Lisp lists stringify opaque).
    expect(String(e(editor, '(if (member "*Commit-Message*" (buffer-list)) 1 0)').value)).toBe("0");
    expect(String(e(editor, '(if (member "*Stagehand*" (buffer-list)) 1 0)').value)).toBe("1"); // never torn down
  });

  test("the UNBORN repo: c works (first commit); C and F refuse", () => {
    writeFileSync(join(process.cwd(), "first.txt"), "f\n");
    statusOf(); // no commits yet
    e(editor, "(stagehand/commit/stagehand-commit-amend)");
    expect(String(e(editor, "(editor-status)").value)).toContain("no commits to amend");
    e(editor, "(stagehand/commit/stagehand-commit-reword)");
    expect(String(e(editor, "(editor-status)").value)).toContain("no commits to amend");
    e(editor, "(stagehand/commit/stagehand-commit-fixup nil)");
    expect(String(e(editor, "(editor-status)").value)).toContain("no target");
    // c works: the first commit.
    execFileSync("git", ["add", "."], { cwd: process.cwd() });
    e(editor, "(stagehand/status/stagehand-status-refresh)");
    e(editor, "(stagehand/commit/stagehand-commit-new)");
    type("initial commit");
    e(editor, "(stagehand/commit/stagehand-commit-dispatch)");
    expect(git("log", "-1", "--format=%B")).toContain("initial commit");
  });

  test("the c KEY dispatches from the status buffer", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    commit("base");
    writeFileSync(join(process.cwd(), "b.txt"), "b\n");
    execFileSync("git", ["add", "b.txt"], { cwd: process.cwd() });
    e(editor, "(stagehand/status/stagehand-status)");
    await editor.handleKey("c");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Commit-Message*");
  });
});
