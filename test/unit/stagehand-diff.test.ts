import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file stagehand-diff.test.ts
 * @description #289 — Stagehand T0: the diff GRAMMAR + faces. The pure
 * parser matrix (every class, multi-file, rename/copy, no-final-newline,
 * empty diffs), the class→face mapping, and the integration: staged +
 * unstaged views from real temp repos, the untracked refusal, the
 * section-level d, n/p hunk navigation, q, and the git-error path.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
const Z = (s: string) => `(hex-decode "${hex(s)}")`;

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i289-"));
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

// The classified (class text) pairs of a parse — as "class|text" rows.
const classesOf = (ed: Editor, text: string) =>
  String(e(ed, `(string-join "\n" (mapcar (lambda (p) (concat (car p) "|" (car (cdr p)))) (stagehand/diff/stagehand-diff-parse ${Z(text)})))`).value);

const SAMPLE = [
  "diff --git a/f.txt b/f.txt",
  "index 1111111..2222222 100644",
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -1,3 +1,4 @@",
  " context line",
  "-removed line",
  "+added line",
  "\\ No newline at end of file",
].join("\n");

describe("#289 — the pure grammar", () => {
  test("every class: file-header, hunk-header, add, remove, context, meta", () => {
    const rows = classesOf(editor, SAMPLE).split("\n");
    expect(rows[0]).toBe("file-header|diff --git a/f.txt b/f.txt");
    expect(rows[1]).toBe("file-header|index 1111111..2222222 100644");
    expect(rows[2]).toBe("file-header|--- a/f.txt");
    expect(rows[3]).toBe("file-header|+++ b/f.txt");
    expect(rows[4]).toBe("hunk-header|@@ -1,3 +1,4 @@");
    expect(rows[5]).toBe("context| context line");
    expect(rows[6]).toBe("remove|-removed line");
    expect(rows[7]).toBe("add|+added line");
    expect(rows[8]).toBe("meta|\\ No newline at end of file");
  });

  test("---/+++ are FILE headers (not remove/add) despite leading -/+", () => {
    const rows = classesOf(editor, "--- a/x\n+++ b/x\n-q\n+r").split("\n");
    expect(rows[0]).toBe("file-header|--- a/x");
    expect(rows[1]).toBe("file-header|+++ b/x");
    expect(rows[2]).toBe("remove|-q");
    expect(rows[3]).toBe("add|+r");
  });

  test("multi-file diffs classify every file's block", () => {
    const two = [
      "diff --git a/a.txt b/a.txt",
      "index 1..2 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/b.txt b/b.txt",
      "new file mode 100644",
      "index 0000000..3",
      "--- /dev/null",
      "+++ b/b.txt",
      "@@ -0,0 +1 @@",
      "+fresh",
    ].join("\n");
    const rows = classesOf(editor, two).split("\n");
    expect(rows.filter((r) => r.startsWith("file-header|diff --git")).length).toBe(2);
    expect(rows).toContain("meta|new file mode 100644");
    expect(rows).toContain("file-header|--- /dev/null");
    expect(rows.filter((r) => r === "hunk-header|@@ -1 +1 @@" || r === "hunk-header|@@ -0,0 +1 @@").length).toBe(2);
  });

  test("rename/copy headers are meta", () => {
    const ren = [
      "diff --git a/old b/new",
      "similarity index 95%",
      "rename from old",
      "rename to new",
      "index 1..2 100644",
    ].join("\n");
    const rows = classesOf(editor, ren).split("\n");
    expect(rows).toContain("meta|similarity index 95%");
    expect(rows).toContain("meta|rename from old");
    expect(rows).toContain("meta|rename to new");
    const cp = ["diff --git a/src b/dst", "similarity index 100%", "copy from src", "copy to dst"].join("\n");
    expect(classesOf(editor, cp).split("\n")).toContain("meta|copy from src");
  });

  test("'--- '/'++ '-SHAPED payloads after a hunk are remove/add, not file headers (gate r1)", () => {
    // SQL/Lua/Haskell '--' banners: a REMOVED line whose payload
    // starts '-- ' must not light up as a file header.
    const banner = [
      "diff --git a/q.sql b/q.sql",
      "index 1..2 100644",
      "--- a/q.sql",
      "+++ b/q.sql",
      "@@ -1,2 +1,2 @@",
      "--- old banner",
      "+++ new banner",
      "+real add",
    ].join("\n");
    const rows = classesOf(editor, banner).split("\n");
    expect(rows[5]).toBe("remove|--- old banner");
    expect(rows[6]).toBe("add|+++ new banner");
    expect(rows[7]).toBe("add|+real add");
    // And the header-region ---/+++ stay file headers (also across a
    // SECOND file's block after its diff --git resets the region).
    expect(rows[2]).toBe("file-header|--- a/q.sql");
    expect(rows[3]).toBe("file-header|+++ b/q.sql");
  });

  test("an EMPTY diff parses to a single empty context row", () => {
    const rows = classesOf(editor, "").split("\n");
    expect(rows.length).toBe(1);
    expect(rows[0]).toBe("context|");
  });
});

describe("#289 — faces (the one class → SGR source)", () => {
  test("each class emits its SGR open + reset; context is bare", () => {
    const faced = (pair: string) =>
      String(e(editor, `(stagehand/diff/stagehand-diff-face-line (list ${pair}))`).value);
    expect(faced('"file-header" "diff --git a/f b/f"')).toBe("\x1b[1;36mdiff --git a/f b/f\x1b[0m");
    expect(faced('"hunk-header" "@@ -1 +1 @@"')).toBe("\x1b[1;34m@@ -1 +1 @@\x1b[0m");
    expect(faced('"add" "+x"')).toBe("\x1b[32m+x\x1b[0m");
    expect(faced('"remove" "-x"')).toBe("\x1b[31m-x\x1b[0m");
    expect(faced('"meta" "rename from x"')).toBe("\x1b[2mrename from x\x1b[0m");
    expect(faced('"context" " ctx"')).toBe(" ctx");
  });
});

describe("#289 — the view (integration, real temp repos)", () => {
  const commit = (msg: string) => {
    execFileSync("git", ["add", "."], { cwd: process.cwd() });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg], { cwd: process.cwd() });
  };
  const statusOf = () => {
    e(editor, "(stagehand/status/stagehand-status)");
    return strip(bufferText(editor));
  };

  test("d on an UNSTAGED row → the worktree diff, faced", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "one\ntwo\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "one\nTWO\n");
    statusOf();
    e(editor, "(cursor-move 4 0)"); // the ' M f.txt' row
    e(editor, "(stagehand/status/stagehand-status-diff)");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Stagehand-Diff*");
    const t = bufferText(editor);
    expect(strip(t)).toContain("-two");
    expect(strip(t)).toContain("+TWO");
    expect(t).toContain("\x1b[31m-two"); // remove → red
    expect(t).toContain("\x1b[32m+TWO"); // add → green
    expect(t).toContain("\x1b[1;34m@@"); // hunk header → bold blue
    expect(t).toContain("\x1b[1;36mdiff --git"); // file header → bold cyan
  });

  test("d on a STAGED row → the --cached diff", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "base\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "base\nSTAGED CHANGE\n");
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "other.txt"), "untracked\n"); // keep U non-empty so layout differs
    statusOf();
    // Layout: 2 U-hdr | 3 other.txt | 4 Unstaged-hdr | 5 S-hdr | 6 row.
    e(editor, "(cursor-move 6 0)");
    e(editor, "(stagehand/status/stagehand-status-diff)");
    const raw = bufferText(editor);
    const t = strip(raw);
    expect(t).toContain("+STAGED CHANGE");
    // --cached shows the STAGED state only — the worktree-matching
    // content (base + staged change) means no unstaged delta leaks in.
    expect(t).toContain("Stagehand-Diff: f.txt");
    // The staged view faces through the SAME emission path (gate r1).
    expect(raw).toContain("\x1b[32m+STAGED CHANGE");
  });

  test("d on an UNTRACKED row → the refusal, no diff buffer", () => {
    writeFileSync(join(process.cwd(), "new.txt"), "n\n");
    statusOf();
    e(editor, "(cursor-move 3 0)");
    e(editor, "(stagehand/status/stagehand-status-diff)");
    expect(String(e(editor, "(buffer-current)").value)).toContain("Stagehand*"); // hmm — *Stagehand* stays
    expect(String(e(editor, "(editor-status)").value)).toContain("untracked file — no diff");
  });

  test("d on a SECTION header → the section's OWN files (same side)", () => {
    writeFileSync(join(process.cwd(), "a.txt"), "a\n");
    writeFileSync(join(process.cwd(), "b.txt"), "b\n");
    commit("base");
    writeFileSync(join(process.cwd(), "a.txt"), "A!\n");
    writeFileSync(join(process.cwd(), "b.txt"), "B!\n");
    statusOf();
    // U is empty: 2 U-hdr | 3 Unstaged-hdr | 4 a.txt | 5 b.txt.
    e(editor, "(cursor-move 3 0)");
    e(editor, "(stagehand/status/stagehand-status-diff)");
    const t = strip(bufferText(editor));
    expect(t).toContain("Stagehand-Diff: section: Unstaged");
    expect(t).toContain("-a");
    expect(t).toContain("-b"); // BOTH files — the whole section
  });

  test("d on the UNTRACKED section header → the refusal, no diff buffer (gate r1)", () => {
    writeFileSync(join(process.cwd(), "new.txt"), "n\n");
    writeFileSync(join(process.cwd(), "f.txt"), "f\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "F-modified\n");
    statusOf();
    // Layout: 2 U-hdr | 3 new.txt | 4 Unstaged-hdr | 5 f.txt.
    e(editor, "(cursor-move 2 0)"); // the Untracked HEADER
    e(editor, "(stagehand/status/stagehand-status-diff)");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Stagehand*");
    expect(String(e(editor, "(editor-status)").value)).toContain("untracked files — no diff");
  });

  test("d on the CONFLICTED section header → only the conflicted files (gate r1)", () => {
    const c = process.cwd();
    writeFileSync(join(c, "f.txt"), "base\n");
    writeFileSync(join(c, "clean.txt"), "stay\n");
    commit("base");
    execFileSync("git", ["checkout", "-q", "-b", "side"], { cwd: c });
    writeFileSync(join(c, "f.txt"), "side\n");
    commit("side");
    execFileSync("git", ["checkout", "-q", "main"], { cwd: c });
    writeFileSync(join(c, "f.txt"), "main\n");
    commit("main");
    try {
      execFileSync("git", ["merge", "side"], { cwd: c, stdio: "ignore" });
    } catch { /* conflict — expected */ }
    statusOf();
    // Layout: 2 U-hdr | 3 Unstaged-hdr (M f.txt etc.) | 4-5 headers | 6 C-hdr | 7 UU f.txt.
    const lines = strip(bufferText(editor)).split("\n");
    const confHdr = lines.findIndex((l) => l.startsWith("Conflicted ("));
    e(editor, `(cursor-move ${confHdr} 0)`);
    e(editor, "(stagehand/status/stagehand-status-diff)");
    const t = strip(bufferText(editor));
    expect(t).toContain("Stagehand-Diff: section: Conflicted");
    expect(t).toContain("f.txt");
    // clean.txt is NOT in the section — its diff must NOT leak in.
    expect(t).not.toContain("clean.txt");
  });

  test("d on a CONFLICTED FILE ROW → the worktree (combined) diff for that path (gate r1)", () => {
    const c = process.cwd();
    writeFileSync(join(c, "f.txt"), "base\n");
    commit("base");
    execFileSync("git", ["checkout", "-q", "-b", "side"], { cwd: c });
    writeFileSync(join(c, "f.txt"), "side\n");
    commit("side");
    execFileSync("git", ["checkout", "-q", "main"], { cwd: c });
    writeFileSync(join(c, "f.txt"), "main\n");
    commit("main");
    try {
      execFileSync("git", ["merge", "side"], { cwd: c, stdio: "ignore" });
    } catch { /* conflict — expected */ }
    statusOf();
    const lines = strip(bufferText(editor)).split("\n");
    const uuRow = lines.findIndex((l) => l.startsWith("UU "));
    e(editor, `(cursor-move ${uuRow} 0)`);
    e(editor, "(stagehand/status/stagehand-status-diff)");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Stagehand-Diff*");
    expect(strip(bufferText(editor))).toContain("f.txt");
  });

  test("n/p navigate hunk headers (wrap); q closes", () => {
    // A multi-hunk diff: two distant regions.
    const lines: string[] = [];
    for (let i = 1; i <= 30; i++) lines.push(`line${i}`);
    writeFileSync(join(process.cwd(), "f.txt"), lines.join("\n") + "\n");
    commit("base");
    lines[2] = "CHANGED-ONE";
    lines[25] = "CHANGED-TWO";
    writeFileSync(join(process.cwd(), "f.txt"), lines.join("\n") + "\n");
    statusOf();
    e(editor, "(cursor-move 4 0)");
    e(editor, "(stagehand/status/stagehand-status-diff)");
    const line = () => Number(String(e(editor, "(cursor-line)").value));
    // Cursor starts after the title (line 1). n → first hunk, n → second.
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    const h1 = line();
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    const h2 = line();
    expect(h2).toBeGreaterThan(h1);
    expect(strip(bufferText(editor)).split("\n")[h2]).toMatch(/^@@/);
    // p returns to the first; p again WRAPS to the last.
    e(editor, "(stagehand/diff/stagehand-diff-prev)");
    expect(line()).toBe(h1);
    e(editor, "(stagehand/diff/stagehand-diff-prev)");
    expect(line()).toBe(h2);
    // FORWARD wrap: n at the LAST hunk returns to the first.
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    expect(line()).toBe(h1);
    // q closes — the diff buffer is gone (recency survivor restored).
    e(editor, "(stagehand/diff/stagehand-diff-quit)");
    expect(String(e(editor, "(buffer-current)").value)).not.toContain("Stagehand-Diff");
    expect(String(e(editor, "(buffer-list)").value)).not.toContain("Stagehand-Diff");
  });

  test("the d KEY dispatches from the status buffer", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    e(editor, "(stagehand/status/stagehand-status)");
    e(editor, "(cursor-move 4 0)");
    await editor.handleKey("d");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Stagehand-Diff*");
    expect(strip(bufferText(editor))).toContain("+v2");
  });

  test("an EMPTY diff and a NO-HUNKS buffer → status paths, no switch (gate r1)", () => {
    const before = String(e(editor, "(buffer-current)").value);
    // Empty diff text → 'Stagehand: empty diff', no buffer switch.
    e(editor, '(stagehand/diff/stagehand-diff-open "" "nothing")');
    expect(String(e(editor, "(buffer-current)").value)).toBe(before);
    expect(String(e(editor, "(editor-status)").value)).toContain("empty diff");
    // A hunkless body (headers only) → 'no hunks' on n.
    e(editor, '(stagehand/diff/stagehand-diff-open "diff --git a/x b/x\nindex 1..2 100644" "hdr")');
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Stagehand-Diff*");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    expect(String(e(editor, "(editor-status)").value)).toContain("no hunks");
  });

  test("an APOSTROPHE filename quotes safely — no command injection (gate r2+r3)", () => {
    const c = process.cwd();
    // The exact injection shape the gate reproduced end-to-end on the
    // VULNERABLE code: the mangled separator let the trailing fragment
    // execute as a command when d routed the filename through shq.
    // The file must be TRACKED + MODIFIED (an UNSTAGED row) — an
    // untracked row is refused before quoting ever runs (gate r3
    // proved the untracked variant vacuous: it passed on vulnerable
    // code). The gate verified this strengthened form FAILS on
    // vulnerable code exactly at the PWNED assertion.
    writeFileSync(join(c, "evil';touch PWNED;'x.txt"), "evil content\n");
    commit("base");
    writeFileSync(join(c, "evil';touch PWNED;'x.txt"), "evil modified\n");
    statusOf();
    const lines = strip(bufferText(editor)).split("\n");
    const row = lines.findIndex((l) => l.includes("evil'"));
    e(editor, `(cursor-move ${row} 0)`);
    e(editor, "(stagehand/status/stagehand-status-diff)");
    expect(existsSync(join(c, "PWNED"))).toBe(false); // NO execution
    // The diff itself rendered (quoting held, not just refusal).
    expect(strip(bufferText(editor))).toContain("+evil modified");
    // And a plain apostrophe filename diff works at all.
    writeFileSync(join(c, "it's.txt"), "apostrophe\n");
    commit("more");
    writeFileSync(join(c, "it's.txt"), "apostrophe changed\n");
    statusOf();
    const lines2 = strip(bufferText(editor)).split("\n");
    const row2 = lines2.findIndex((l) => l.includes("it's"));
    e(editor, `(cursor-move ${row2} 0)`);
    e(editor, "(stagehand/status/stagehand-status-diff)");
    expect(strip(bufferText(editor))).toContain("+apostrophe changed");
  });

  test("git failure mid-diff → status names it; the buffer is unchanged", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "x\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "y\n");
    statusOf();
    writeFileSync(join(process.cwd(), ".git", "HEAD"), "garbage\n");
    e(editor, "(stagehand/status/stagehand-status-refresh)"); // root survives as the repo
    e(editor, "(cursor-move 4 0)");
    const before = String(e(editor, "(buffer-current)").value);
    e(editor, "(stagehand/status/stagehand-status-diff)");
    expect(String(e(editor, "(buffer-current)").value)).toBe(before);
    expect(String(e(editor, "(editor-status)").value)).toContain("git diff failed");
  });
});
