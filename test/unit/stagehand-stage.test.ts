import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file stagehand-stage.test.ts
 * @description #287 — Stagehand T0: file-level stage/unstage/discard.
 * ACTUAL index + worktree contents asserted after every action (the
 * split staged+unstaged case, the index-preserving discard, the
 * rename two-path unstage), refusals (untracked-discard, conflicted,
 * ineligible sections), the y/n confirm + cancel, header-wide runs
 * with stop-at-failure reports and visited-only counting, argv-safety
 * fixtures, and fold-preserving refresh.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const git = (...args: string[]) => execFileSync("git", args, { cwd: process.cwd() }).toString().trim();
const file = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i287-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module stagehand/status)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) {
    // The partial-failure test may leave .git read-only mid-failure.
    try { chmodSync(join(d, ".git"), 0o755); } catch { /* no .git */ }
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const commit = (msg: string) => {
  execFileSync("git", ["add", "."], { cwd: process.cwd() });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg], { cwd: process.cwd() });
};
const statusOf = () => {
  e(editor, "(stagehand/status/stagehand-status)");
  return strip(bufferText(editor));
};
const cursorTo = (needle: string) => {
  const lines = strip(bufferText(editor)).split("\n");
  const row = lines.findIndex((l) => l.includes(needle));
  expect(row).toBeGreaterThanOrEqual(0);
  e(editor, `(cursor-move ${row} 0)`);
};

describe("#287 — per-row actions (index + worktree asserted)", () => {
  test("s on an UNTRACKED file stages it", () => {
    writeFileSync(join(process.cwd(), "new.txt"), "content\n");
    statusOf();
    cursorTo("?? new.txt");
    e(editor, "(stagehand/stage/stagehand-stage-file)");
    expect(git("diff", "--cached", "--name-only")).toBe("new.txt");
    expect(statusOf()).toContain("A  new.txt"); // re-rendered Staged
  });

  test("s on an UNSTAGED modification stages the NEW content", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    statusOf();
    cursorTo(" M f.txt");
    e(editor, "(stagehand/stage/stagehand-stage-file)");
    expect(git("diff", "--cached")).toContain("+v2");
  });

  test("D on an UNTRACKED file REFUSES (no clean -f)", () => {
    writeFileSync(join(process.cwd(), "n.txt"), "x\n");
    statusOf();
    cursorTo("?? n.txt");
    e(editor, "(stagehand/stage/stagehand-discard-file)");
    expect(String(e(editor, "(editor-status)").value)).toContain("refusing to discard untracked file");
    expect(existsSync(join(process.cwd(), "n.txt"))).toBe(true); // untouched
  });

  test("D+y on UNSTAGED restores the worktree AND PRESERVES THE INDEX (the split case)", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() }); // staged v2
    writeFileSync(join(process.cwd(), "f.txt"), "v3\n"); // + unstaged v3
    statusOf();
    cursorTo("MM f.txt"); // the combined staged+unstaged row
    e(editor, "(stagehand/stage/stagehand-discard-file)");
    // The confirm: answer y through the ACCEPT handler (the async
    // completing-read's delivery).
    e(editor, '(stagehand/stage/stagehand-discard-accept "y")');
    expect(file("f.txt")).toBe("v2\n"); // worktree = the STAGED content
    expect(git("diff", "--cached")).toContain("+v2"); // index untouched
    expect(statusOf()).toContain("M  f.txt"); // re-rendered staged-clean
  });

  test("D cancelled (n / empty) is a NO-OP", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    statusOf();
    cursorTo(" M f.txt");
    e(editor, "(stagehand/stage/stagehand-discard-file)");
    e(editor, '(stagehand/stage/stagehand-discard-accept "n")');
    expect(file("f.txt")).toBe("v2\n");
    expect(String(e(editor, "(editor-status)").value)).toContain("cancelled");
    // The empty/C-g path ("" answer) is also a no-op.
    e(editor, "(stagehand/stage/stagehand-discard-file)");
    e(editor, '(stagehand/stage/stagehand-discard-accept "")');
    expect(file("f.txt")).toBe("v2\n");
  });

  test("u on a STAGED ADD → back to Untracked", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "new.txt"), "n\n");
    execFileSync("git", ["add", "new.txt"], { cwd: process.cwd() });
    statusOf();
    cursorTo("A  new.txt");
    e(editor, "(stagehand/stage/stagehand-unstage-file)");
    expect(git("diff", "--cached", "--name-only")).toBe(""); // index empty
    expect(statusOf()).toContain("?? new.txt");
  });

  test("u on a STAGED DELETION → back to Unstaged-deleted", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    rmSync(join(process.cwd(), "f.txt"));
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() }); // staged deletion
    statusOf();
    cursorTo("D  f.txt");
    e(editor, "(stagehand/stage/stagehand-unstage-file)");
    expect(existsSync(join(process.cwd(), "f.txt"))).toBe(false); // worktree still missing
    expect(git("diff", "--cached", "--name-only")).toBe(""); // index restored
    expect(statusOf()).toContain(" D f.txt"); // unstaged-deleted row
  });

  test("u on a STAGED RENAME unstages BOTH paths in one invocation", () => {
    writeFileSync(join(process.cwd(), "old.txt"), "body\n");
    commit("base");
    execFileSync("git", ["mv", "old.txt", "new.txt"], { cwd: process.cwd() });
    statusOf();
    cursorTo("R  new.txt (from old.txt)");
    e(editor, "(stagehand/stage/stagehand-unstage-file)");
    // Index: old.txt back, new.txt absent.
    expect(git("ls-files")).toBe("old.txt");
    expect(existsSync(join(process.cwd(), "new.txt"))).toBe(true); // worktree kept
    expect(existsSync(join(process.cwd(), "old.txt"))).toBe(false);
    expect(statusOf()).toContain("old.txt"); // back in a section row
  });

  test("conflicted rows refuse s/u/D", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "base\n");
    commit("base");
    execFileSync("git", ["checkout", "-q", "-b", "side"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "f.txt"), "side\n");
    commit("side");
    execFileSync("git", ["checkout", "-q", "main"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "f.txt"), "main\n");
    commit("main");
    try { execFileSync("git", ["merge", "side"], { cwd: process.cwd(), stdio: "ignore" }); } catch { /* conflict */ }
    statusOf();
    cursorTo("UU ");
    for (const fn of ["stagehand-stage-file", "stagehand-unstage-file", "stagehand-discard-file"]) {
      e(editor, `(stagehand/stage/${fn})`);
      expect(String(e(editor, "(editor-status)").value)).toContain("resolve conflicts first");
    }
  });

  test("argv safety: spaces, leading dash, unicode stage AND unstage (incl. the dash restore path)", () => {
    writeFileSync(join(process.cwd(), "base.txt"), "base\n");
    commit("base"); // HEAD must exist: git restore --staged resolves it
    writeFileSync(join(process.cwd(), "with space.txt"), "a\n");
    writeFileSync(join(process.cwd(), "-dashy.txt"), "b\n");
    writeFileSync(join(process.cwd(), "uni-éè.txt"), "c\n");
    statusOf();
    for (const name of ["with space.txt", "-dashy.txt", "uni-éè.txt"]) {
      cursorTo(name);
      e(editor, "(stagehand/stage/stagehand-stage-file)");
      // core.quotePath=false: git quotes non-ASCII paths by default.
      expect(git("-c", "core.quotePath=false", "diff", "--cached", "--name-only")).toContain(name);
    }
    expect(git("-c", "core.quotePath=false", "diff", "--cached", "--name-only").split("\n").length).toBe(3);
    // The leading-dash path rides `git restore --staged --` too (the
    // u argv path; the gate caught this being unexercised).
    cursorTo("-dashy.txt");
    e(editor, "(stagehand/stage/stagehand-unstage-file)");
    expect(git("diff", "--cached", "--name-only")).not.toContain("-dashy.txt");
  });
});

describe("#287 — header-wide runs", () => {
  test("S on the UNSTAGED section stages all rows; visited-only report", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    writeFileSync(join(process.cwd(), "b.txt"), "b\n");
    commit("base");
    writeFileSync(join(process.cwd(), "a.txt"), "a2\n");
    writeFileSync(join(process.cwd(), "b.txt"), "b2\n");
    statusOf();
    cursorTo("Unstaged (2)");
    e(editor, "(stagehand/stage/stagehand-stage-section)");
    expect(git("diff", "--cached", "--name-only").split("\n").sort()).toEqual(["a.txt", "b.txt"]);
    expect(String(e(editor, "(editor-status)").value)).toContain("applied 2 of 2 visited");
  });

  test("S on an INELIGIBLE section no-ops", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    statusOf();
    cursorTo("Conflicted (0)");
    e(editor, "(stagehand/stage/stagehand-stage-section)");
    expect(String(e(editor, "(editor-status)").value)).toContain("nothing to do for Conflicted");
    expect(git("diff", "--cached", "--name-only")).toBe("");
  });

  test("U on the STAGED section unstages everything", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    writeFileSync(join(process.cwd(), "b.txt"), "b\n");
    commit("base");
    writeFileSync(join(process.cwd(), "a.txt"), "a2\n");
    writeFileSync(join(process.cwd(), "b.txt"), "b2\n");
    execFileSync("git", ["add", "."], { cwd: process.cwd() });
    statusOf();
    cursorTo("Staged (2)");
    e(editor, "(stagehand/stage/stagehand-unstage-section)");
    expect(git("diff", "--cached", "--name-only")).toBe("");
    expect(String(e(editor, "(editor-status)").value)).toContain("applied 2 of 2 visited");
  });

  test("PARTIAL FAILURE stops the run with the per-row report; applied rows stay", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    writeFileSync(join(process.cwd(), "b.txt"), "b\n");
    commit("base");
    writeFileSync(join(process.cwd(), "a.txt"), "a2\n");
    writeFileSync(join(process.cwd(), "b.txt"), "b2\n");
    // Break the index so `git add` fails (read-only .git objects dir).
    chmodSync(join(process.cwd(), ".git"), 0o555);
    statusOf();
    cursorTo("Unstaged (2)");
    e(editor, "(stagehand/stage/stagehand-stage-section)");
    const st = String(e(editor, "(editor-status)").value);
    expect(st).toContain("applied 0 of 1 visited, failed at a.txt"); // FIRST row top-to-bottom; the FAILED row counts as visited
    chmodSync(join(process.cwd(), ".git"), 0o755);
    // Idempotent re-run succeeds after the fix.
    cursorTo("Unstaged (2)");
    e(editor, "(stagehand/stage/stagehand-stage-section)");
    expect(git("diff", "--cached", "--name-only").split("\n").sort()).toEqual(["a.txt", "b.txt"]);
  });

  test("a section run EXCLUDES conflicted rows (they live in their own section)", () => {
    // Conflicted rows are structurally excluded: the run visits only
    // the named section's rows. A repo with a conflicted file AND an
    // unstaged change: S on Unstaged visits 1, ignores the conflict.
    writeFileSync(join(process.cwd(), "f.txt"), "base\n");
    writeFileSync(join(process.cwd(), "g.txt"), "keep\n");
    commit("base");
    execFileSync("git", ["checkout", "-q", "-b", "side"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "f.txt"), "side\n");
    commit("side");
    execFileSync("git", ["checkout", "-q", "main"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "f.txt"), "main\n");
    commit("main");
    try { execFileSync("git", ["merge", "side"], { cwd: process.cwd(), stdio: "ignore" }); } catch { /* conflict */ }
    writeFileSync(join(process.cwd(), "g.txt"), "keep2\n"); // unstaged
    statusOf();
    // f.txt shows as UU in the CONFLICTED section (S/U never visit
    // that section); the Unstaged section holds ONLY g.txt.
    cursorTo("Unstaged (1)");
    e(editor, "(stagehand/stage/stagehand-stage-section)");
    const st = String(e(editor, "(editor-status)").value);
    expect(st).toContain("applied 1 of 1 visited");
    expect(git("diff", "--cached", "--name-only")).toContain("g.txt");
    // The conflict stays UNRESOLVED (S never visited the Conflicted
    // section; f.txt's index stages are the merge's, not ours).
    expect(git("status", "--porcelain")).toContain("UU f.txt");
  });

  test("actions PRESERVE fold state (refresh contract)", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    writeFileSync(join(process.cwd(), "b.txt"), "b\n");
    commit("base");
    writeFileSync(join(process.cwd(), "a.txt"), "a2\n");
    writeFileSync(join(process.cwd(), "b.txt"), "b2\n");
    statusOf();
    // Fold Untracked (empty — no rows) via its header at line 2.
    e(editor, "(cursor-move 2 0)");
    e(editor, "(stagehand/status/stagehand-status-fold-toggle)");
    expect(String(e(editor, '(stagehand/status/stagehand-status-folded-p "Untracked")').value)).toBe("true");
    cursorTo(" M a.txt");
    e(editor, "(stagehand/stage/stagehand-stage-file)");
    expect(String(e(editor, '(stagehand/status/stagehand-status-folded-p "Untracked")').value)).toBe("true");
  });
});

describe("#287 — gate r1 coverage", () => {
  test("PER-ROW git failure: status names exit + stderr; buffer unchanged", () => {
    writeFileSync(join(process.cwd(), "n.txt"), "x\n");
    statusOf();
    chmodSync(join(process.cwd(), ".git"), 0o555); // break git
    cursorTo("?? n.txt");
    e(editor, "(stagehand/stage/stagehand-stage-file)");
    const st = String(e(editor, "(editor-status)").value);
    expect(st).toContain("git failed");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Stagehand*"); // unchanged
    chmodSync(join(process.cwd(), ".git"), 0o755);
  });

  test("D on an UNSTAGED-DELETED file RESTORES it (the worktree-D row)", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "committed content\n");
    commit("base");
    rmSync(join(process.cwd(), "f.txt"));
    statusOf();
    cursorTo(" D f.txt");
    e(editor, "(stagehand/stage/stagehand-discard-file)");
    e(editor, '(stagehand/stage/stagehand-discard-accept "y")');
    expect(file("f.txt")).toBe("committed content\n");
  });

  test("SPLIT row: s stages the worktree side; u unstages the index side", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() }); // staged v2
    writeFileSync(join(process.cwd(), "f.txt"), "v3\n"); // + unstaged v3
    statusOf();
    // s on the split row stages the WORKTREE side: index → v3.
    cursorTo("MM f.txt");
    e(editor, "(stagehand/stage/stagehand-stage-file)");
    expect(git("diff", "--cached")).toContain("+v3");
    expect(file("f.txt")).toBe("v3\n");
    // u on the (now single 'M ') row unstages: index → HEAD, worktree keeps v3.
    statusOf();
    cursorTo("M  f.txt");
    e(editor, "(stagehand/stage/stagehand-unstage-file)");
    expect(git("diff", "--cached")).toBe("");
    expect(file("f.txt")).toBe("v3\n");
  });

  test("BARE ENTER on the discard confirm CANCELS (the preselect is n — codex r2)", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    statusOf();
    cursorTo(" M f.txt");
    await editor.handleKey("D");
    await editor.handleKey("Enter"); // NO answer typed — must cancel
    expect(file("f.txt")).toBe("v2\n"); // worktree UNCHANGED
  });

  test("the REAL C-g minibuffer cancel is a no-op (pending goes stale)", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    statusOf();
    cursorTo(" M f.txt");
    await editor.handleKey("D");
    await editor.handleKey("C-g"); // minibuffer cancel — accept never fires
    expect(file("f.txt")).toBe("v2\n"); // untouched
  });
});

describe("#287 — codex r1 fixes", () => {
  test("a PATHSPEC-MAGIC filename cannot glob its siblings (:(literal) everywhere)", () => {
    writeFileSync(join(process.cwd(), "base.txt"), "base\n");
    commit("base");
    // The attack shape the grader reproduced: a file whose NAME is a
    // pathspec — without :(literal), add/checkout glob the siblings.
    writeFileSync(join(process.cwd(), ":(glob)*.txt"), "weird\n");
    writeFileSync(join(process.cwd(), "abc.txt"), "sibling\n");
    statusOf();
    cursorTo(":(glob)*.txt");
    e(editor, "(stagehand/stage/stagehand-stage-file)");
    const staged = git("diff", "--cached", "--name-only");
    expect(staged).toContain(":(glob)*.txt");
    expect(staged).not.toContain("abc.txt"); // the sibling untouched
  });


  test("s REFUSES on a Staged row (the split row's Staged copy)", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "f.txt"), "v3\n");
    statusOf();
    // The STAGED copy of the split row — both sections render "MM
    // f.txt"; target the row directly under the Staged header.
    const lines = strip(bufferText(editor)).split("\n");
    const sHdr = lines.findIndex((l) => l.startsWith("Staged ("));
    const row = sHdr + 1;
    expect(lines[row]).toContain("f.txt");
    e(editor, `(cursor-move ${row} 0)`);
    e(editor, "(stagehand/stage/stagehand-stage-file)");
    expect(String(e(editor, "(editor-status)").value)).toContain("s stages Untracked/Unstaged rows");
    expect(git("diff", "--cached")).toContain("+v2"); // index unchanged
    expect(file("f.txt")).toBe("v3\n");
  });
});

describe("#287 — key delivery", () => {
  test("the s KEY stages from the status buffer; D + y Enter discards", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    e(editor, "(stagehand/status/stagehand-status)");
    cursorTo(" M f.txt");
    await editor.handleKey("s");
    expect(git("diff", "--cached")).toContain("+v2");
    // Unstage it back, then D + the real y Enter through the minibuffer.
    cursorTo("M  f.txt");
    await editor.handleKey("u");
    expect(git("diff", "--cached")).toBe("");
    cursorTo(" M f.txt");
    await editor.handleKey("D");
    await editor.handleKey("y");
    await editor.handleKey("Enter");
    expect(file("f.txt")).toBe("v1\n");
  });
});
