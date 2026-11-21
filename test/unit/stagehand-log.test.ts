import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file stagehand-log.test.ts
 * @description #290 — Stagehand T0: the log buffer (streaming render,
 * SHA selection, art-row skipping), the show view + n/p walk, branch
 * checkout (branch + detached + dirty-tree both outcomes + cancel),
 * and the unborn/failure statuses.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const git = (...args: string[]) => execFileSync("git", args, { cwd: process.cwd() }).toString().trim();

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i290-"));
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
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", msg], { cwd: process.cwd() });
};

/** Open the log and WAIT for the sentinel to finish streaming. */
const openLog = async (ed: Editor) => {
  e(ed, "(stagehand/status/stagehand-status)"); // l runs FROM the status buffer
  e(ed, "(stagehand/log/stagehand-log-open)");
  for (let i = 0; i < 40; i++) {
    const n = Number(String(e(ed, "(stagehand/log/stagehand-log-commit-count)").value));
    if (n > 0) {
      const st = String(e(ed, "(editor-status)").value);
      if (st.includes("commits")) return st;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("log never finished streaming");
};

describe("#290 — the log buffer", () => {
  test("streams graph rows: sha + dimmed refs + subject; SHAs recorded", async () => {
    commit("first");
    commit("second");
    await openLog(editor);
    const t = strip(bufferText(editor));
    expect(t).toContain("second"); // newest first
    expect(t).toContain("first");
    // The raw buffer keeps the dim around refs on HEAD's row.
    const raw = bufferText(editor);
    expect(raw).toContain("\u001b[2m(HEAD -> main)\u001b[0m");
    expect(Number(String(e(editor, "(stagehand/log/stagehand-log-commit-count)").value))).toBe(2);
  });

  test("the UNBORN repo → 'no commits yet', no buffer", () => {
    e(editor, "(stagehand/status/stagehand-status)");
    e(editor, "(stagehand/log/stagehand-log-open)");
    expect(String(e(editor, "(editor-status)").value)).toContain("no commits yet");
    expect(String(e(editor, '(if (member "*Stagehand-Log*" (buffer-list)) 1 0)').value)).toBe("0");
  });

  test("a MERGE-GRAPH repo: art rows pass through; n/p skip them; SHA selection works", async () => {
    commit("base");
    execFileSync("git", ["checkout", "-q", "-b", "feature"], { cwd: process.cwd() });
    commit("feature work");
    execFileSync("git", ["checkout", "-q", "main"], { cwd: process.cwd() });
    commit("main work");
    execFileSync("git", ["merge", "-q", "--no-ff", "feature", "-m", "merge"], { cwd: process.cwd() });
    await openLog(editor);
    const t = strip(bufferText(editor));
    expect(t).toContain("merge");
    expect(t).toContain("feature work");
    // Art rows (|, \\, /) streamed through as text.
    expect(/\|/.test(t)).toBe(true);
    // 4 commits recorded (base, feature, main, merge).
    expect(Number(String(e(editor, "(stagehand/log/stagehand-log-commit-count)").value))).toBe(4);
    // n from line 0 lands on a COMMIT row (an art row is skipped).
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/log/stagehand-log-next)");
    const line = Number(String(e(editor, "(cursor-line)").value));
    const sha = String(e(editor, `(stagehand/log/stagehand-log-sha-at-line ${line})`).value);
    expect(sha).not.toBe("nil");
  });

  test("g RE-RUNS the stream (fresh generation; no duplicate rows)", async () => {
    commit("one");
    await openLog(editor);
    const before = strip(bufferText(editor)).split("\n").filter((l) => l.trim()).length;
    e(editor, "(stagehand/log/stagehand-log-rerun)");
    for (let i = 0; i < 40; i++) {
      const st = String(e(editor, "(editor-status)").value);
      if (st.includes("commits")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const after = strip(bufferText(editor)).split("\n").filter((l) => l.trim()).length;
    expect(after).toBe(before); // cleared + re-streamed, not appended
  });
});

describe("#290 — the show view", () => {
  test("RET shows the commit FACED (#289's grammar); n/p walk; q returns", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    execFileSync("git", ["add", "."], { cwd: process.cwd() });
    commit("add f");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    execFileSync("git", ["add", "."], { cwd: process.cwd() });
    commit("change f");
    await openLog(editor);
    // Cursor to the first commit row (newest = 'change f').
    const lines = strip(bufferText(editor)).split("\n");
    const row = lines.findIndex((l) => l.includes("change f"));
    e(editor, `(cursor-move ${row} 0)`);
    e(editor, "(stagehand/log/stagehand-log-show)");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Stagehand-Show*");
    const raw = bufferText(editor);
    expect(strip(raw)).toContain("+v2");
    expect(raw).toContain("\u001b[32m+v2"); // add → green (the grammar)
    // n walks DOWN the list to the older commit.
    e(editor, "(stagehand/log/stagehand-show-next)");
    expect(strip(bufferText(editor))).toContain("+v1");
    // p walks back up.
    e(editor, "(stagehand/log/stagehand-show-prev)");
    expect(strip(bufferText(editor))).toContain("+v2");
    // p clamps at the newest.
    e(editor, "(stagehand/log/stagehand-show-prev)");
    expect(String(e(editor, "(editor-status)").value)).toContain("newest commit");
    // q returns to the log buffer.
    e(editor, "(stagehand/log/stagehand-show-quit)");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Stagehand-Log*");
  });
});

describe("#290 — checkout", () => {
  test("b + y checks out the BRANCH ref (heads precedence; named in the status)", async () => {
    commit("base");
    execFileSync("git", ["branch", "topic"], { cwd: process.cwd() });
    commit("main-only");
    await openLog(editor);
    const lines = strip(bufferText(editor)).split("\n");
    const row = lines.findIndex((l) => l.includes("base")); // the topic tip
    e(editor, `(cursor-move ${row} 0)`);
    e(editor, "(stagehand/log/stagehand-log-checkout)");
    e(editor, '(stagehand/log/stagehand-log-checkout-accept "y")');
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("topic");
    expect(String(e(editor, "(editor-status)").value)).toContain("checked out topic");
  });

  test("no ref → DETACHED at the sha (a mid-branch commit)", async () => {
    commit("c1");
    commit("c2");
    commit("c3");
    await openLog(editor);
    const lines = strip(bufferText(editor)).split("\n");
    const row = lines.findIndex((l) => l.includes("c1"));
    e(editor, `(cursor-move ${row} 0)`);
    e(editor, "(stagehand/log/stagehand-log-checkout)");
    e(editor, '(stagehand/log/stagehand-log-checkout-accept "y")');
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
    expect(String(e(editor, "(editor-status)").value)).toContain("detached at");
  });

  test("DIRTY TREE: git decides — non-conflicting succeeds; conflicting refuses with git's message", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    execFileSync("git", ["add", "."], { cwd: process.cwd() });
    commit("base");
    execFileSync("git", ["branch", "other"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    execFileSync("git", ["add", "."], { cwd: process.cwd() });
    commit("main change");
    // Non-conflicting: an UNTRACKED edit to a different file rides along.
    writeFileSync(join(process.cwd(), "untracked.txt"), "dirty\n");
    await openLog(editor);
    const lines = strip(bufferText(editor)).split("\n");
    const row = lines.findIndex((l) => l.includes("base"));
    e(editor, `(cursor-move ${row} 0)`);
    e(editor, "(stagehand/log/stagehand-log-checkout)");
    e(editor, '(stagehand/log/stagehand-log-checkout-accept "y")');
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("other");
    expect(require("node:fs").readFileSync(join(process.cwd(), "untracked.txt"), "utf8")).toBe("dirty\n");
    // Conflicting: a tracked-local modification to the file the target
    // changes → git refuses; the status carries git's message.
    execFileSync("git", ["checkout", "-q", "main"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "f.txt"), "local dirty\n");
    e(editor, "(stagehand/log/stagehand-log-rerun)");
    for (let i = 0; i < 40; i++) {
      if (String(e(editor, "(editor-status)").value).includes("commits")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const lines2 = strip(bufferText(editor)).split("\n");
    const row2 = lines2.findIndex((l) => l.includes("base"));
    e(editor, `(cursor-move ${row2} 0)`);
    e(editor, "(stagehand/log/stagehand-log-checkout)");
    e(editor, '(stagehand/log/stagehand-log-checkout-accept "y")');
    expect(String(e(editor, "(editor-status)").value)).toContain("checkout failed");
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main"); // unchanged
  });

  test("CANCEL (n / bare Enter default) is a no-op", async () => {
    commit("c1");
    await openLog(editor);
    const lines = strip(bufferText(editor)).split("\n");
    const row = lines.findIndex((l) => l.includes("c1"));
    e(editor, `(cursor-move ${row} 0)`);
    e(editor, "(stagehand/log/stagehand-log-checkout)");
    e(editor, '(stagehand/log/stagehand-log-checkout-accept "n")');
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(String(e(editor, "(editor-status)").value)).toContain("cancelled");
  });
});
