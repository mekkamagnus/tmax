import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file stagehand-status.test.ts
 * @description #286 — Stagehand T0: the *Stagehand* status buffer. The
 * porcelain -z parsing matrix (every status class → its section; renames;
 * odd names structurally safe), the four sections, fold persistence across
 * refresh, n/p/TAB/g/q/RET behaviors, and the repo/error states (unborn,
 * empty, detached, no-upstream, git-failure, non-repo).
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i286-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module stagehand/status)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const Z = (s: string) => `(hex-decode "${hex(s)}")`;
const statusText = (ed: Editor) => strip(bufferText(ed));
const rowsOf = (ed: Editor, zhex: string) =>
  String(e(ed, `(string-join "|" (stagehand/status/stagehand-status-rows-of (stagehand/status/stagehand-status-sections (stagehand/status/stagehand-status-parse (hex-decode "${zhex}")))))`).value);
// The joined rows of section IDX (0=Untracked .. 3=Conflicted).
const secRows = (ed: Editor, zhex: string, idx: number) =>
  String(e(ed, `(string-join "|" (car (cdr (nth ${idx} (stagehand/status/stagehand-status-sections (stagehand/status/stagehand-status-parse (hex-decode "${zhex}")))))))`).value);

function statusOf(ed: Editor): string {
  e(ed, "(stagehand/status/stagehand-status)");
  return strip(bufferText(ed));
}

describe("#286 — the porcelain -z parsing matrix", () => {
  test("every status class lands in its section; renames render 'new (from orig)'", () => {
    const z = [
      "?? untracked.txt",
      " M modified.txt",
      "D  deleted.txt",
      "A  added.txt",
      "R  renamed.txt",
      "orig.txt",
      "C  copied.txt",
      "orig2.txt",
      "UU both.txt",
      "DD del-both.txt",
      "AU au.txt",
      "UD ud.txt",
      "UA ua.txt",
      "DU du.txt",
      "AA aa.txt",
    ].join("\0") + "\0";
    expect(rowsOf(editor, hex(z))).toContain("renamed.txt (from orig.txt)");
    // Untracked in section 1; modified/deleted/added/renamed in 2+3; the
    // conflict codes in section 4.
    expect(secRows(editor, hex(z), 0)).toContain("untracked.txt");
    expect(secRows(editor, hex(z), 1)).toContain("modified.txt");
    expect(secRows(editor, hex(z), 2)).toContain("deleted.txt");
    expect(secRows(editor, hex(z), 2)).toContain("added.txt");
    expect(secRows(editor, hex(z), 2)).toContain("renamed.txt (from orig.txt)");
    // Copy pairs ride the same next-NUL-field shape as renames.
    expect(secRows(editor, hex(z), 2)).toContain("C  copied.txt (from orig2.txt)");
    // ALL seven conflict codes land in the fourth section.
    const conf = secRows(editor, hex(z), 3);
    expect(conf).toContain("both.txt");
    expect(conf).toContain("del-both.txt");
    expect(conf).toContain("AU au.txt");
    expect(conf).toContain("UD ud.txt");
    expect(conf).toContain("UA ua.txt");
    expect(conf).toContain("DU du.txt");
    expect(conf).toContain("AA aa.txt");
  });

  test("odd names (spaces, unicode, leading dash) are structurally safe", () => {
    const z = ["?? with space.txt", "?? uni-éè.txt", "?? -dashy.txt"].join("\0") + "\0";
    const rows = rowsOf(editor, hex(z));
    expect(rows).toContain("with space.txt");
    expect(rows).toContain("uni-éè.txt");
    expect(rows).toContain("-dashy.txt");
  });

  test("a WORKTREE-SIDE rename record consumes its origin field (either column)", () => {
    // git emits R/C in the index column today, but a worktree-side
    // record must not leave its origin to be mis-parsed as a record.
    const z = [" R wt.txt", "wt-orig.txt", " M mod.txt"].join("\0") + "\0";
    const n = Number(String(e(editor, `(length (stagehand/status/stagehand-status-parse ${Z(z)}))`).value));
    expect(n).toBe(2); // the origin was CONSUMED, mod.txt still parses
  });

  test("an EMPTY -z stream → four empty sections", () => {
    const n = String(e(editor, `(length (stagehand/status/stagehand-status-sections (stagehand/status/stagehand-status-parse ${Z("")})))`).value);
    expect(n).toBe("4");
  });
});

describe("#286 — the live buffer (temp repos)", () => {
  test("the normal repo: the header + sections render; RET opens a file", () => {
    writeFileSync(join(process.cwd(), "hello.txt"), "content\n");
    const t = statusOf(editor);
    expect(t).toContain("Stagehand: ");
    expect(t).toContain("Untracked (1)");
    expect(t).toContain("hello.txt");
    // RET on the first file row opens it.
    e(editor, "(cursor-move 3 0)"); // header(2) + section header = row 3 = the file
    e(editor, "(stagehand/status/stagehand-status-open-file)");
    expect(strip(bufferText(editor))).toContain("content");
  });

  test("the EMPTY repo: three empty sections + the clean line (no Conflicted with zero entries? — the 4th renders too)", () => {
    const t = statusOf(editor);
    expect(t).toContain("Untracked (0)");
    expect(t).toContain("nothing to commit, working tree clean");
  });

  test("the UNBORN repo: the unborn header + all sections", () => {
    const dir = mkdtempSync(join(tmpdir(), "i286u-"));
    dirs.push(dir);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    process.chdir(dir);
    editor.setClientLaunchDir(dir);
    const t = statusOf(editor);
    expect(t).toContain("unborn: main");
  });

  test("DETACHED HEAD: the detached header", () => {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd() }).toString().trim();
    execFileSync("git", ["checkout", "-q", "--detach"], { cwd: process.cwd() });
    const t = statusOf(editor);
    expect(t).toContain(`HEAD detached at ${sha}`);
  });

  test("NO UPSTREAM: the suffix (a branch with no upstream configured)", () => {
    execFileSync("git", ["checkout", "-q", "-b", "feature-x"], { cwd: process.cwd() });
    const t = statusOf(editor);
    expect(t).toContain("feature-x no upstream");
  });

  test("NOT a repository → the status, no buffer", () => {
    const dir = mkdtempSync(join(tmpdir(), "i286n-"));
    dirs.push(dir);
    process.chdir(dir);
    editor.setClientLaunchDir(dir);
    const before = String(e(editor, "(buffer-current)").value);
    e(editor, "(stagehand/status/stagehand-status)");
    const after = String(e(editor, "(buffer-current)").value);
    expect(before).toBe(after); // no buffer switch
    // The spec-normative status message.
    expect(String(e(editor, "(editor-status)").value)).toContain("not in a repository");
  });

  test("GIT FAILURE → the status names the exit + stderr; no buffer", () => {
    const before = String(e(editor, "(buffer-current)").value);
    writeFileSync(join(process.cwd(), ".git", "HEAD"), "garbage\n");
    e(editor, "(stagehand/status/stagehand-status)");
    // The failure path: a status message, NO buffer switch.
    const after = String(e(editor, "(buffer-current)").value);
    expect(after).toBe(before);
    expect(after).not.toContain("Stagehand");
    // The spec-normative failure text: exit + first stderr line.
    const st = String(e(editor, "(editor-status)").value);
    expect(st).toContain("git status failed");
    expect(st).toContain("fatal:");
  });

  test("the CONFLICTED repo: the fourth section carries UU rows", () => {
    const p = join(process.cwd(), "f.txt");
    writeFileSync(p, "base\n");
    execFileSync("git", ["add", "."], { cwd: process.cwd() });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base"], { cwd: process.cwd() });
    execFileSync("git", ["checkout", "-q", "-b", "side"], { cwd: process.cwd() });
    writeFileSync(p, "side\n");
    execFileSync("git", ["add", "."], { cwd: process.cwd() });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "side"], { cwd: process.cwd() });
    execFileSync("git", ["checkout", "-q", "main"], { cwd: process.cwd() });
    writeFileSync(p, "main\n");
    execFileSync("git", ["add", "."], { cwd: process.cwd() });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "main"], { cwd: process.cwd() });
    try {
      execFileSync("git", ["merge", "side"], { cwd: process.cwd(), stdio: "ignore" });
    } catch { /* merge exits 1 on conflict — expected */ }
    const t = statusOf(editor);
    expect(t).toContain("Conflicted (1)");
    expect(t).toContain("UU f.txt");
  });

  test("odd names + a RENAME (with spaces) in a real repo", () => {
    const c = process.cwd();
    writeFileSync(join(c, "with space.txt"), "a\n");
    writeFileSync(join(c, "uni-éè.txt"), "b\n");
    writeFileSync(join(c, "-dashy.txt"), "c\n");
    writeFileSync(join(c, "old name.txt"), "d\n");
    // Stage ONLY the rename source — the other three stay untracked.
    execFileSync("git", ["add", "old name.txt"], { cwd: c });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base"], { cwd: c });
    execFileSync("git", ["mv", "old name.txt", "new name.txt"], { cwd: c });
    const t = statusOf(editor);
    expect(t).toContain("with space.txt");
    expect(t).toContain("uni-éè.txt");
    expect(t).toContain("-dashy.txt");
    expect(t).toContain("R  new name.txt (from old name.txt)");
  });
});

describe("#286 — folding + navigation", () => {
  test("TAB folds a section; n/p skip folded rows; fold state SURVIVES refresh (g)", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    writeFileSync(join(process.cwd(), "b.txt"), "b\n");
    statusOf(editor);
    // Fold Untracked (cursor on its header — row 2).
    e(editor, "(cursor-move 2 0)");
    e(editor, "(stagehand/status/stagehand-status-fold-toggle)");
    expect(String(e(editor, '(stagehand/status/stagehand-status-folded-p "Untracked")').value)).toBe("true");
    // The visible rows skip the folded files (headers only for the
    // folded section: 4 headers + 0 files = 4 visible rows here).
    const vis = Number(String(e(editor, "(length (stagehand/status/stagehand-visible-rows))").value));
    expect(vis).toBe(4);
    // Fold state SURVIVES refresh (g re-renders; the name-keyed map holds).
    e(editor, "(stagehand/status/stagehand-status-refresh)");
    expect(String(e(editor, '(stagehand/status/stagehand-status-folded-p "Untracked")').value)).toBe("true");
    // Unfold.
    e(editor, "(cursor-move 2 0)");
    e(editor, "(stagehand/status/stagehand-status-fold-toggle)");
    expect(String(e(editor, '(stagehand/status/stagehand-status-folded-p "Untracked")').value)).toBe("null");
  });

  test("n/p navigate the visible rows and WRAP", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    statusOf(editor);
    const line = () => Number(String(e(editor, "(cursor-line)").value));
    const n = Number(String(e(editor, "(length (stagehand/status/stagehand-visible-rows))").value));
    // Render places the cursor on visible row 0 → buffer line 2 (the
    // 2-line header block).
    expect(line()).toBe(2);
    // p from row 0 WRAPS to the last visible row; n wraps back.
    e(editor, "(stagehand/status/stagehand-status-prev)");
    expect(line()).toBe(2 + n - 1);
    e(editor, "(stagehand/status/stagehand-status-next)");
    expect(line()).toBe(2);
    // n steps through every visible row without skipping.
    e(editor, "(stagehand/status/stagehand-status-next)");
    expect(line()).toBe(3);
  });

  test("q closes the buffer (recency restore)", () => {
    writeFileSync(join(process.cwd(), "hello.txt"), "content\n");
    e(editor, `(find-file "${join(process.cwd(), "hello.txt")}")`);
    statusOf(editor);
    expect(String(e(editor, "(buffer-current)").value)).toContain("Stagehand");
    e(editor, "(stagehand/status/stagehand-status-quit)");
    expect(String(e(editor, "(buffer-current)").value)).toContain("hello");
  });

  test("a file literally named 'X (from Y).txt' opens THE right file on RET (codex r1 #1)", () => {
    const tricky = "notes (from Alice).txt";
    writeFileSync(join(process.cwd(), tricky), "tricky content\n");
    statusOf(editor);
    const line = () => Number(String(e(editor, "(cursor-line)").value));
    e(editor, "(cursor-move 3 0)"); // row 1 = the tricky file
    e(editor, "(stagehand/status/stagehand-status-open-file)");
    expect(strip(bufferText(editor))).toContain("tricky content");
    expect(String(e(editor, "(buffer-current)").value)).toContain("notes (from Alice)");
    expect(line()).toBeGreaterThanOrEqual(0); // no crash; opened
  });

  test("a FAILED re-open keeps the displayed status's root (codex r1 #2)", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    statusOf(editor); // success — root committed
    const rootA = String(e(editor, "(stagehand/status/stagehand-status-root)").value);
    expect(rootA).toContain(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd() }).toString().trim());
    // Corrupt the repo; a re-open FAILS — the root must NOT flip.
    writeFileSync(join(process.cwd(), ".git", "HEAD"), "garbage\n");
    e(editor, "(stagehand/status/stagehand-status)");
    expect(String(e(editor, "(stagehand/status/stagehand-status-root)").value)).toBe(rootA);
    expect(String(e(editor, "(editor-status)").value)).toContain("git status failed");
  });

  test("n/p follow j/k cursor moves; folding KEEPS the cursor on the toggled header (codex r1 #3)", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    writeFileSync(join(process.cwd(), "b.txt"), "b\n");
    writeFileSync(join(process.cwd(), "c.txt"), "c\n");
    execFileSync("git", ["add", "c.txt"], { cwd: process.cwd() });
    statusOf(editor);
    const line = () => Number(String(e(editor, "(cursor-line)").value));
    // Layout: 2 U-hdr | 3 a | 4 b | 5 Unstaged-hdr | 6 S-hdr | 7 c | 8 G | 9 C.
    // j-style move to line 4 (?? b.txt), then n continues FROM THERE.
    e(editor, "(cursor-move 4 0)");
    e(editor, "(stagehand/status/stagehand-status-next)");
    expect(line()).toBe(5); // Unstaged header — n resumed at the cursor
    // Fold Staged AT its header (line 6): its file row vanishes and the
    // cursor STAYS on the toggled header — no reset to the first section.
    e(editor, "(cursor-move 6 0)");
    e(editor, "(stagehand/status/stagehand-status-fold-toggle)");
    expect(line()).toBe(6);
    expect(statusText(editor)).not.toContain("A  c.txt");
    // Unfold: the row returns, position still on the header.
    e(editor, "(stagehand/status/stagehand-status-fold-toggle)");
    expect(line()).toBe(6);
    expect(statusText(editor)).toContain("A  c.txt");
  });

  test("the KEYS: SPC g opens; n/p/TAB/g/q/RET dispatch in the buffer", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    // SPC g dispatches the status command from anywhere.
    await editor.handleKey(" ");
    await editor.handleKey("g");
    expect(String(e(editor, "(buffer-current)").value)).toContain("Stagehand");
    expect(String(e(editor, "(major-mode-get)").value)).toBe("stagehand-status");
    const line = () => Number(String(e(editor, "(cursor-line)").value));
    expect(line()).toBe(2);
    // n moves down a visible row; p moves back.
    await editor.handleKey("n");
    expect(line()).toBe(3);
    await editor.handleKey("p");
    expect(line()).toBe(2);
    // TAB on the Untracked header folds it (the file rows vanish).
    await editor.handleKey("Tab");
    expect(statusText(editor)).not.toContain("?? a.txt");
    expect(String(e(editor, '(stagehand/status/stagehand-status-folded-p "Untracked")').value)).toBe("true");
    // g refreshes; the fold state SURVIVES.
    await editor.handleKey("g");
    expect(statusText(editor)).not.toContain("?? a.txt");
    // TAB unfolds; RET on the file row opens the file.
    await editor.handleKey("Tab");
    await editor.handleKey("n"); // row 1 = ?? a.txt
    await editor.handleKey("Enter");
    expect(String(e(editor, "(buffer-current)").value)).toContain("a.txt");
    // q from the file buffer is vim-record etc. — reopen and quit there.
    await editor.handleKey(" ");
    await editor.handleKey("g");
    await editor.handleKey("q");
    expect(String(e(editor, "(buffer-current)").value)).toContain("a.txt");
  });
});
