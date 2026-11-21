import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file stagehand-hunk.test.ts
 * @description #291 — Stagehand T1: hunk-level staging. Whole-hunk
 * stage/unstage/discard via `git apply` on stdin, asserted on ACTUAL
 * index + worktree contents; the refusal classes; stale-diff failure
 * + hint; the no-final-newline round-trip; discard confirmation;
 * malformed-patch handling.
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
  const dir = mkdtempSync(join(tmpdir(), "i291-"));
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
/** Open the worktree diff view for PATH via the status row. */
const openDiff = (path: string) => {
  e(editor, "(stagehand/status/stagehand-status)");
  const lines = strip(bufferText(editor)).split("\n");
  const row = lines.findIndex((l) => l.includes(path));
  e(editor, `(cursor-move ${row} 0)`);
  e(editor, "(stagehand/status/stagehand-status-diff)");
};
/** Wait for the async apply sentinel to land. */
const waitApply = async (ed: Editor, ms = 6000) => {
  for (let i = 0; i < ms / 25; i++) {
    const st = String(e(ed, "(editor-status)").value);
    if (st.includes("hunk applied") || st.includes("apply failed")) return st;
    await new Promise((r) => setTimeout(r, 25));
  }
  return "TIMEOUT:" + String(e(ed, "(editor-status)").value);
};

describe("#291 — stage hunk (worktree view, s)", () => {
  test("ONLY the index changes; the worktree stays byte-identical", async () => {
    // Two hunks in one file (distant regions).
    const lines: string[] = [];
    for (let i = 1; i <= 30; i++) lines.push(`line${i}`);
    writeFileSync(join(process.cwd(), "f.txt"), lines.join("\n") + "\n");
    commit("base");
    lines[2] = "CHANGED-A";
    lines[25] = "CHANGED-B";
    writeFileSync(join(process.cwd(), "f.txt"), lines.join("\n") + "\n");
    const worktreeBefore = file("f.txt");
    openDiff("f.txt");
    // Cursor to the FIRST hunk header; s stages THAT hunk only.
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied");
    expect(file("f.txt")).toBe(worktreeBefore); // worktree UNTOUCHED
    // The index has ONLY hunk A.
    const cached = git("diff", "--cached");
    expect(cached).toContain("CHANGED-A");
    expect(cached).not.toContain("CHANGED-B");
    // The worktree diff still has hunk B.
    expect(git("diff")).toContain("CHANGED-B");
  });
});

describe("#291 — unstage hunk (cached view, u)", () => {
  test("ONLY the index changes (mirrored)", async () => {
    const lines: string[] = [];
    for (let i = 1; i <= 30; i++) lines.push(`line${i}`);
    writeFileSync(join(process.cwd(), "f.txt"), lines.join("\n") + "\n");
    commit("base");
    lines[2] = "CHANGED-A";
    lines[25] = "CHANGED-B";
    writeFileSync(join(process.cwd(), "f.txt"), lines.join("\n") + "\n");
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    const worktreeBefore = file("f.txt");
    // Open the CACHED view: the row is in the Staged section.
    e(editor, "(stagehand/status/stagehand-status)");
    const ls = strip(bufferText(editor)).split("\n");
    const row = ls.findIndex((l) => l.startsWith("M  f.txt"));
    e(editor, `(cursor-move ${row} 0)`);
    e(editor, "(stagehand/status/stagehand-status-diff)");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-unstage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied");
    expect(file("f.txt")).toBe(worktreeBefore);
    const cached = git("diff", "--cached");
    expect(cached).not.toContain("CHANGED-A");
    expect(cached).toContain("CHANGED-B"); // only hunk A unstaged
  });
});

describe("#291 — discard hunk (worktree view, D)", () => {
  test("ONLY the worktree changes; the index untouched; y-confirm", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nv2\nv3\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nCHANGED\nv3\n");
    const indexBefore = git("diff", "--cached"); // empty
    openDiff("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-discard-hunk)");
    await editor.handleKey("Enter"); // the n-first default = cancel
    expect(file("f.txt")).toContain("CHANGED"); // cancelled: untouched
    e(editor, "(stagehand/diff/stagehand-diff-discard-hunk)");
    e(editor, '(stagehand/diff/stagehand-diff-accept "y")');
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied");
    expect(file("f.txt")).toBe("v1\nv2\nv3\n"); // the hunk REVERTED
    expect(git("diff", "--cached")).toBe(indexBefore); // index untouched
  });
});

describe("#291 — refusals + failures", () => {
  test("BINARY hunks refuse with a named status", async () => {
    writeFileSync(join(process.cwd(), "b.bin"), Buffer.from([0, 1, 2, 3]));
    commit("base");
    writeFileSync(join(process.cwd(), "b.bin"), Buffer.from([0, 1, 2, 9]));
    openDiff("b.bin");
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    expect(String(e(editor, "(editor-status)").value)).toContain("binary files not supported");
    expect(git("diff", "--cached")).toBe(""); // nothing applied
  });

  test("RENAME hunks refuse (file-level ops pointed at #287)", async () => {
    writeFileSync(join(process.cwd(), "old.txt"), "body\n");
    commit("base");
    execFileSync("git", ["mv", "old.txt", "new.txt"], { cwd: process.cwd() });
    // The rename is STAGED → the cached view via the Staged row; u is
    // the valid key there, and the REFUSAL fires before any apply.
    e(editor, "(stagehand/status/stagehand-status)");
    const ls2 = strip(bufferText(editor)).split("\n");
    const row2 = ls2.findIndex((l) => l.includes("new.txt"));
    e(editor, `(cursor-move ${row2} 0)`);
    e(editor, "(stagehand/status/stagehand-status-diff)");
    e(editor, "(stagehand/diff/stagehand-diff-unstage-hunk)");
    expect(String(e(editor, "(editor-status)").value)).toContain("rename hunks");
    // No-op: the rename stays staged (file-level ops own it).
    expect(git("diff", "--cached")).toContain("rename to");
  });

  test("MODE-ONLY changes refuse", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    execFileSync("chmod", ["+x", join(process.cwd(), "f.txt")]);
    openDiff("f.txt");
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    expect(String(e(editor, "(editor-status)").value)).toContain("mode-only");
  });

  test("STALE DIFF: the file changed after the view rendered → apply fails with the retry hint", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nv2\nv3\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nCHANGED\nv3\n");
    openDiff("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    // The INDEX changes AFTER the render (the --cached apply targets
    // the INDEX — a worktree-only edit would not make it stale).
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nTOTALLY-OTHER\nv3\n");
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("apply failed");
    expect(st).toContain("refresh and retry");
  });

  test("a MALFORMED patch → git's named error; nothing applied", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    openDiff("f.txt");
    // Drive the module's OWN apply callbacks with a garbage patch on
    // stdin — the sentinel reports the NAMED failure; the index
    // stays untouched (nothing applied).
    const pid = Number(String(e(editor, `(make-process :command (list "git" "apply" "--cached" "-") :cwd "${process.cwd()}" :filter "stagehand/diff/stagehand-diff-apply-filter" :sentinel "stagehand/diff/stagehand-diff-apply-sentinel")`).value));
    e(editor, `(process-write ${pid} (hex-decode "${Buffer.from("total garbage\nnot a patch\n").toString("hex")}"))`);
    e(editor, `(process-close-stdin ${pid})`);
    const st = await waitApply(editor);
    expect(st).toContain("apply failed");
    expect(git("diff", "--cached")).toBe("");
  });
});

describe("#291 — the no-final-newline round-trip", () => {
  test("the marker carries with its hunk: stage + unstage round-trips", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nv2");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nCHANGED-NO-NL");
    openDiff("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied");
    // The INDEX has the no-final-newline state.
    const cached = git("show", ":f.txt");
    expect(cached).toBe("v1\nCHANGED-NO-NL"); // no trailing newline
    // Unstage it back: open the CACHED view (the Staged row) — the
    // worktree-view refresh keeps its own side by contract.
    const worktreeBefore = file("f.txt");
    e(editor, "(stagehand/status/stagehand-status)");
    const ls = strip(bufferText(editor)).split("\n");
    const srow = ls.findIndex((l) => l.startsWith("M  f.txt"));
    expect(srow).toBeGreaterThanOrEqual(0);
    e(editor, `(cursor-move ${srow} 0)`);
    e(editor, "(stagehand/status/stagehand-status-diff)");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-unstage-hunk)");
    const st2 = await waitApply(editor);
    expect(st2).toContain("hunk applied");
    expect(file("f.txt")).toBe(worktreeBefore);
    expect(git("diff", "--cached")).toBe("");
    expect(git("show", ":f.txt")).toBe("v1\nv2"); // the index restored
  });
});

describe("#291 — key availability + keys", () => {
  test("s in the CACHED view no-ops with a status; u in the worktree view likewise", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    // Cached view.
    e(editor, "(stagehand/status/stagehand-status)");
    const ls = strip(bufferText(editor)).split("\n");
    const row = ls.findIndex((l) => l.startsWith("M  f.txt"));
    e(editor, `(cursor-move ${row} 0)`);
    e(editor, "(stagehand/status/stagehand-status-diff)");
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    expect(String(e(editor, "(editor-status)").value)).toContain("s stages worktree hunks");
    // Worktree view (the unstaged side).
    writeFileSync(join(process.cwd(), "f.txt"), "v3\n");
    openDiff("f.txt");
    e(editor, "(stagehand/diff/stagehand-diff-unstage-hunk)");
    expect(String(e(editor, "(editor-status)").value)).toContain("u unstages cached hunks");
  });

  test("the s KEY dispatches in the diff view", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    openDiff("f.txt");
    e(editor, "(cursor-move 0 0)");
    await editor.handleKey("n");
    await editor.handleKey("s");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied");
    expect(git("diff", "--cached")).toContain("+v2");
  });
});
