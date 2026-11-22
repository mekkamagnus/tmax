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
    if (st.includes("hunk applied") || st.includes("apply failed") || st.includes("no changes on this side")) return st;
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

describe("#291 — gate r1 regressions", () => {
  test("a staged NEW FILE's hunk unstages WITHOUT the phantom dev/null (the corruption repro)", async () => {
    // keep.txt commits; new.txt stages AFTER (a genuine A row).
    writeFileSync(join(process.cwd(), "keep.txt"), "k\n");
    commit("base");
    writeFileSync(join(process.cwd(), "new.txt"), "fresh content\n");
    execFileSync("git", ["add", "new.txt"], { cwd: process.cwd() });
    // Open the CACHED view for new.txt.
    e(editor, "(stagehand/status/stagehand-status)");
    const ls = strip(bufferText(editor)).split("\n");
    const row = ls.findIndex((l) => l.startsWith("A  new.txt"));
    e(editor, `(cursor-move ${row} 0)`);
    e(editor, "(stagehand/status/stagehand-status-diff)");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-unstage-hunk)");
    const st = await waitApply(editor);
    expect(st).toMatch(/hunk applied|no changes on this side/);
    // NO phantom dev/null entry in the index (the gate's corruption).
    expect(git("ls-files")).not.toContain("dev/null");
    expect(git("diff", "--cached", "--name-only")).not.toContain("new.txt");
  });

  test("a WORKTREE-DELETED file's hunk stages without the phantom", async () => {
    writeFileSync(join(process.cwd(), "gone.txt"), "v\n");
    commit("base");
    rmSync(join(process.cwd(), "gone.txt"));
    openDiff("gone.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied");
    expect(git("ls-files")).not.toContain("dev/null");
    // The deletion IS staged (the intended change).
    expect(git("diff", "--cached", "--name-only")).toContain("gone.txt");
  });

  test("the post-apply refresh RENDERS the updated view (same side, no 'refresh failed')", async () => {
    const lines: string[] = [];
    for (let i = 1; i <= 30; i++) lines.push(`line${i}`);
    writeFileSync(join(process.cwd(), "f.txt"), lines.join("\n") + "\n");
    commit("base");
    lines[2] = "CHANGED-A";
    lines[25] = "CHANGED-B";
    writeFileSync(join(process.cwd(), "f.txt"), lines.join("\n") + "\n");
    openDiff("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    await waitApply(editor);
    // The refreshed view still shows hunk B (A left the worktree diff).
    const t = strip(bufferText(editor));
    expect(t).toContain("CHANGED-B");
    expect(t).not.toContain("CHANGED-A");
    expect(String(e(editor, "(editor-status)").value)).not.toContain("refresh failed");
  });

  test("the last hunk's apply → the clean EMPTY notice (no stale state)", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    openDiff("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    await waitApply(editor);
    expect(strip(bufferText(editor))).toContain("no changes on this side");
    expect(String(e(editor, "(length (stagehand/diff/stagehand-diff-hunk-lines))").value)).toBe("0");
  });

  test("the failure message carries the apply's stderr line", async () => {
    const lines: string[] = [];
    for (let i = 1; i <= 10; i++) lines.push(`l${i}`);
    writeFileSync(join(process.cwd(), "f.txt"), lines.join("\n") + "\n");
    commit("base");
    lines[4] = "X";
    writeFileSync(join(process.cwd(), "f.txt"), lines.join("\n") + "\n");
    openDiff("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    // Diverge the index AFTER the render (stale).
    const other: string[] = [];
    for (let i = 1; i <= 10; i++) other.push(i === 5 ? "CONFLICT" : `l${i}`);
    writeFileSync(join(process.cwd(), "f.txt"), other.join("\n") + "\n");
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("apply failed");
    expect(st).toMatch(/apply failed \(\d+\) \S/); // a stderr line present
  });

  test("the REFUSAL scope: a rename on ANOTHER file does not block this file's hunk", async () => {
    writeFileSync(join(process.cwd(), "ren.txt"), "r\n");
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nv2\nv3\n");
    commit("base");
    // a-renamed.txt sorts BEFORE f.txt: the section's FIRST path is
    // the rename, so a refusal scan keyed on (car paths) — instead of
    // the hunk's OWNING file — would falsely refuse f.txt's hunk (the
    // r3 gate's finding; renamed.txt sorted after and hid it).
    execFileSync("git", ["mv", "ren.txt", "a-renamed.txt"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nCHANGED\nv3\n");
    // The r2 gate's exact shape: the STAGED section (the rename AND
    // f.txt's staged content hunk in ONE view — the Unstaged section
    // can never show a staged rename, making the old test vacuous).
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    e(editor, "(stagehand/status/stagehand-status)");
    const ls = strip(bufferText(editor)).split("\n");
    const hdr = ls.findIndex((l) => l.startsWith("Staged ("));
    e(editor, `(cursor-move ${hdr} 0)`);
    e(editor, "(stagehand/status/stagehand-status-diff)");
    // f.txt's staged content hunk is the ONLY hunk (the rename has
    // none) — unstage it; the unrelated rename must NOT refuse it.
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-unstage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied"); // NOT the rename refusal
    expect(git("diff", "--cached")).not.toContain("CHANGED");
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

describe("#291 — gate r4 regressions (quoted/space paths)", () => {
  /** Rename-WITH-CONTENT staged; the cached view opened via the Staged row. */
  const stagedRenameWithContent = (oldName: string, newName: string) => {
    writeFileSync(join(process.cwd(), oldName), "a\nb\n");
    commit("base");
    execFileSync("git", ["mv", oldName, newName], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), newName), "a\nB\n");
    execFileSync("git", ["add", newName], { cwd: process.cwd() });
    e(editor, "(stagehand/status/stagehand-status)");
    const ls = strip(bufferText(editor)).split("\n");
    const hdr = ls.findIndex((l) => l.startsWith("Staged ("));
    e(editor, `(cursor-move ${hdr} 0)`);
    e(editor, "(stagehand/status/stagehand-status-diff)");
    e(editor, "(cursor-move 0 0)");
  };

  // r4: git's trailing-tab space form and core.quotePath quoting made
  // every path-text keying miss — the refusal scope went EMPTY and
  // the rename-with-content hunk reached git apply unrefused.
  test("a SPACE path's rename-with-content hunk still refuses (u)", async () => {
    stagedRenameWithContent("old r.txt", "new spa.txt");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-unstage-hunk)");
    expect(String(e(editor, "(editor-status)").value)).toContain("rename hunks");
    expect(git("diff", "--cached")).toContain("+B"); // nothing applied
  });

  test("a QUOTED (non-ASCII) path's rename-with-content hunk still refuses (u)", async () => {
    stagedRenameWithContent("plain.txt", "café.txt");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-unstage-hunk)");
    expect(String(e(editor, "(editor-status)").value)).toContain("rename hunks");
    expect(git("diff", "--cached")).toContain("+B");
  });

  // r4 gap 2: the reconstructed header now carries the rename/copy
  // meta (defense in depth — the patch is git-apply-semantically
  // complete even for rename-with-content).
  test("the reconstructed patch carries the rename meta (never module-shaped)", () => {
    stagedRenameWithContent("old r.txt", "new spa.txt");
    const patch = String(e(editor, "(stagehand/diff/stagehand-diff-hunk-patch 0)").value);
    expect(patch).toContain("diff --git ");
    expect(patch).toContain("rename from ");
    expect(patch).toContain("rename to ");
    expect(patch).toContain("similarity index");
    expect(patch).toContain("@@");
  });

  // r4 gap 3: no hunk at point on a NORMAL file says so — never the
  // refusal mislabel; and a refusal-class BLOCK says the refusal —
  // never "no hunk at point".
  test("message ordering: refusal-class block → the named refusal; normal file → 'no hunk at point'", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    writeFileSync(join(process.cwd(), "ren.txt"), "r\n");
    commit("base");
    execFileSync("git", ["mv", "ren.txt", "a-renamed.txt"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    // STAGE both (the rename only appears in the CACHED view — a
    // staged rename is no worktree change, so the unstaged view
    // cannot show it) and open via the Staged section row.
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    e(editor, "(stagehand/status/stagehand-status)");
    const ls0 = strip(bufferText(editor)).split("\n");
    const hdr = ls0.findIndex((l) => l.startsWith("Staged ("));
    e(editor, `(cursor-move ${hdr} 0)`);
    e(editor, "(stagehand/status/stagehand-status-diff)");
    // Line 0: a-renamed.txt's diff --git (alphabetically first) — a
    // refusal-class BLOCK with no hunk at point in it.
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-unstage-hunk)");
    expect(String(e(editor, "(editor-status)").value)).toContain("rename hunks");
    // Into f.txt's block, on its diff --git line (no hunk at point).
    const ls = strip(bufferText(editor)).split("\n");
    const fhdr = ls.findIndex((l) => l.startsWith("diff --git a/f.txt"));
    e(editor, `(cursor-move ${fhdr} 0)`);
    e(editor, "(stagehand/diff/stagehand-diff-unstage-hunk)");
    expect(String(e(editor, "(editor-status)").value)).toContain("no hunk at point");
  });
});

describe("#291 — the cursor-line/raw-line seam", () => {
  test("a cursor on a block's LAST line scopes its OWN block (never the next)", async () => {
    // f1.txt (block 0, a normal hunk) sorts before the rename
    // (block 1); the cursor parks on f1's block-final line.
    writeFileSync(join(process.cwd(), "f1.txt"), "x\ny\n");
    writeFileSync(join(process.cwd(), "ren2.txt"), "r\n");
    commit("base");
    execFileSync("git", ["mv", "ren2.txt", "z-renamed.txt"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "f1.txt"), "x\nY\n");
    execFileSync("git", ["add", "f1.txt"], { cwd: process.cwd() });
    e(editor, "(stagehand/status/stagehand-status)");
    const ls0 = strip(bufferText(editor)).split("\n");
    const hdr = ls0.findIndex((l) => l.startsWith("Staged ("));
    e(editor, `(cursor-move ${hdr} 0)`);
    e(editor, "(stagehand/status/stagehand-status-diff)");
    // The line BEFORE the rename's diff --git = f1's block-final.
    const ls = strip(bufferText(editor)).split("\n");
    const rhdr = ls.findIndex((l) => l.startsWith("diff --git") && l.includes("z-renamed"));
    e(editor, `(cursor-move ${rhdr - 1} 0)`);
    e(editor, "(stagehand/diff/stagehand-diff-unstage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied"); // NOT the rename refusal
    expect(git("diff", "--cached")).not.toContain("+Y"); // f1's hunk unstaged
  });
});

describe("#291 — gate r5 residuals", () => {
  test("MODE+CONTENT: the content hunk stages; the mode change stays worktree-only", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nv2\nv3\n");
    commit("base");
    // A WORKTREE-only mode change (a plain chmod — update-index
    // would stage the mode into the index and ruin the shape).
    execFileSync("chmod", ["+x", "f.txt"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nCHANGED\nv3\n");
    openDiff("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied"); // NOT 'mode-only changes'
    expect(git("diff", "--cached")).toContain("CHANGED");
    expect(git("diff", "--cached")).not.toContain("new mode"); // content only
    // The index keeps mode 100644; the worktree keeps 755.
    expect(git("ls-files", "-s", "f.txt")).toMatch(/^100644 /);
  });

  test("END-TO-END on a SPACE path: the content hunk applies through git apply", async () => {
    writeFileSync(join(process.cwd(), "my file.txt"), "a\nb\n");
    commit("base");
    writeFileSync(join(process.cwd(), "my file.txt"), "a\nB\n");
    openDiff("my file.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied");
    expect(git("diff", "--cached")).toContain("+B");
    expect(file("my file.txt")).toBe("a\nB\n"); // worktree intact
  });

  test("END-TO-END on a QUOTED (non-ASCII) path: the content hunk applies", async () => {
    writeFileSync(join(process.cwd(), "café.txt"), "x\ny\n");
    commit("base");
    writeFileSync(join(process.cwd(), "café.txt"), "x\nY\n");
    openDiff("café.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied");
    expect(git("diff", "--cached")).toContain("+Y");
  });

  test("D refuses on a refusal-class block (binary) — no y/n prompt", async () => {
    writeFileSync(join(process.cwd(), "b.bin"), Buffer.from([0, 1, 2, 3]));
    commit("base");
    writeFileSync(join(process.cwd(), "b.bin"), Buffer.from([0, 1, 2, 9]));
    openDiff("b.bin");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-discard-hunk)");
    expect(String(e(editor, "(editor-status)").value)).toContain("binary files not supported");
    expect(git("diff", "--cached")).toBe(""); // nothing applied
  });
});

describe("#291 — valve r1 fixes", () => {
  /** Multi-file worktree view via the Unstaged section header. */
  const openUnstagedSection = () => {
    e(editor, "(stagehand/status/stagehand-status)");
    const ls0 = strip(bufferText(editor)).split("\n");
    const hdr = ls0.findIndex((l) => l.startsWith("Unstaged ("));
    e(editor, `(cursor-move ${hdr} 0)`);
    e(editor, "(stagehand/status/stagehand-status-diff)");
  };

  test("hunk selection is BLOCK-BOUNDED: a later file's header never stages the previous file's hunk", async () => {
    writeFileSync(join(process.cwd(), "f1.txt"), "a\n");
    writeFileSync(join(process.cwd(), "f2.txt"), "b\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f1.txt"), "A1\n");
    writeFileSync(join(process.cwd(), "f2.txt"), "B1\n");
    openUnstagedSection();
    // Cursor on f2's diff --git HEADER (above f2's @@, below f1's
    // hunk): the old global lookup grabbed F1's hunk — wrong file.
    const ls = strip(bufferText(editor)).split("\n");
    const f2hdr = ls.findIndex((l) => l.startsWith("diff --git a/f2.txt"));
    e(editor, `(cursor-move ${f2hdr} 0)`);
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    expect(String(e(editor, "(editor-status)").value)).toContain("no hunk at point");
    expect(git("diff", "--cached")).toBe(""); // NOTHING staged
    // And INSIDE f2's hunk it stages F2's hunk (not f1's).
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied");
    expect(git("diff", "--cached")).toContain("+B1");
    expect(git("diff", "--cached")).not.toContain("A1");
  });

  test("an apply IN FLIGHT blocks s/u/D (state not stomped)", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    openDiff("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    // Launch directly (no await — the sentinel cannot have landed).
    e(editor, '(stagehand/diff/stagehand-diff-apply-hunk-at 0 "stage")');
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    expect(String(e(editor, "(editor-status)").value)).toContain("an apply is still running");
  });

  test("a sentinel whose view CHANGED does not refresh the wrong view", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "v1\n");
    writeFileSync(join(process.cwd(), "b.txt"), "w1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "a.txt"), "v2\n");
    writeFileSync(join(process.cwd(), "b.txt"), "w2\n");
    openDiff("a.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    // Launch the apply against view A, then open view B (gen bump)
    // BEFORE the sentinel lands; drive the sentinel directly.
    e(editor, '(stagehand/diff/stagehand-diff-apply-hunk-at 0 "stage")');
    const genA = e(editor, "(stagehand/diff/stagehand-diff-side-get)");
    openDiff("b.txt");
    const bBefore = strip(bufferText(editor));
    e(editor, "(stagehand/diff/stagehand-diff-apply-sentinel 0 0)");
    expect(String(e(editor, "(editor-status)").value)).toContain("the view changed");
    // B's view is UNTOUCHED (never refreshed with A's targets).
    expect(strip(bufferText(editor))).toBe(bBefore);
    expect(String(genA.value)).toBe("worktree");
    // Drain the real sentinel before teardown.
    await waitApply(editor, 3000);
  });
});

describe("#291 — valve r2 fixes", () => {
  test("refresh pathspecs are LITERAL: a glob-shaped filename never sweeps siblings", async () => {
    writeFileSync(join(process.cwd(), "a*.txt"), "x\n");
    writeFileSync(join(process.cwd(), "ab.txt"), "y\n");
    commit("base");
    writeFileSync(join(process.cwd(), "a*.txt"), "X\n");
    writeFileSync(join(process.cwd(), "ab.txt"), "Y\n"); // the glob would match this
    openDiff("a*.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied");
    // The refresh ran BEFORE the status set: the view already shows
    // the empty notice scoped to :(literal)a*.txt — ab.txt NEVER
    // appears (a raw pathspec would glob it in).
    const view1 = strip(bufferText(editor));
    expect(view1).toContain("no changes on this side");
    expect(view1).not.toContain("ab.txt");
  });

  test("refresh carries rename ORIGINS: the view keeps the rename, not a bare add", async () => {
    // A rename's OWN hunks refuse by design (#287) — exercise the
    // origin through a SIBLING: unstage f.txt's hunk in a section
    // view that also holds a staged rename; the refresh must still
    // render the rename (both sides in the pathspec).
    writeFileSync(join(process.cwd(), "ren.txt"), "a\nb\n");
    writeFileSync(join(process.cwd(), "f.txt"), "x\ny\n");
    commit("base");
    execFileSync("git", ["mv", "ren.txt", "z-new.txt"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "f.txt"), "x\nY\n");
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    e(editor, "(stagehand/status/stagehand-status)");
    const ls0 = strip(bufferText(editor)).split("\n");
    const hdr = ls0.findIndex((l) => l.startsWith("Staged ("));
    e(editor, `(cursor-move ${hdr} 0)`);
    e(editor, "(stagehand/status/stagehand-status-diff)");
    // Cursor into f.txt's block (f sorts before z-new) onto its hunk.
    const ls = strip(bufferText(editor)).split("\n");
    const fh = ls.findIndex((l) => l.startsWith("diff --git a/f.txt"));
    e(editor, `(cursor-move ${fh} 0)`);
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-unstage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied");
    expect(git("diff", "--cached")).not.toContain("+Y"); // unstaged
    // The refreshed view keeps the RENAME — not a bare new-file add
    // (the pathspec carries z-new's origin ren.txt too).
    const view = strip(bufferText(editor));
    expect(view).toContain("rename from");
    expect(view).not.toContain("new file mode");
  });

  test("D no-ops while an apply is in flight (entry guard)", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    openDiff("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, '(stagehand/diff/stagehand-diff-apply-hunk-at 0 "stage")');
    e(editor, "(stagehand/diff/stagehand-diff-discard-hunk)");
    expect(String(e(editor, "(editor-status)").value)).toContain("an apply is still running");
  });

  test("the discard ACCEPT re-checks in-flight before launching", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "CHANGED\n");
    openDiff("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    // Open the confirm (pending set, no apply running)...
    e(editor, "(stagehand/diff/stagehand-diff-discard-hunk)");
    // ...then an apply starts before y lands.
    e(editor, '(stagehand/diff/stagehand-diff-apply-hunk-at 0 "stage")');
    e(editor, '(stagehand/diff/stagehand-diff-accept "y")');
    expect(String(e(editor, "(editor-status)").value)).toContain("an apply is still running");
    await waitApply(editor, 3000); // drain the stage apply
    // The DISCARD never ran: the worktree keeps CHANGED.
    expect(file("f.txt")).toBe("CHANGED\n");
  });

  test("a sentinel whose view was QUIT never recreates it", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    openDiff("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, '(stagehand/diff/stagehand-diff-apply-hunk-at 0 "stage")');
    e(editor, "(stagehand/diff/stagehand-diff-quit)");
    e(editor, "(stagehand/diff/stagehand-diff-apply-sentinel 0 0)");
    expect(String(e(editor, "(editor-status)").value)).toContain("the view changed");
    expect(String(e(editor, "(buffer-name)").value)).not.toContain("Stagehand-Diff");
  });
});

describe("#291 — valve r3 fixes", () => {
  test("a STALE discard confirm (view changed before y) cancels, never discards another view's hunk", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    writeFileSync(join(process.cwd(), "g.txt"), "w1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "CHANGED\n");
    writeFileSync(join(process.cwd(), "g.txt"), "w2\n");
    openDiff("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, "(stagehand/diff/stagehand-diff-discard-hunk)"); // pending, gen N
    openDiff("g.txt"); // gen N+1 — the pending idx is now wrong
    e(editor, '(stagehand/diff/stagehand-diff-accept "y")');
    expect(String(e(editor, "(editor-status)").value)).toContain("the view changed");
    // NOTHING discarded: f.txt keeps CHANGED.
    expect(file("f.txt")).toBe("CHANGED\n");
  });

  test("a SWITCHED-AWAY view still refreshes IN PLACE (no buffer steal)", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nv2\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nCHANGED\n");
    openDiff("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, '(stagehand/diff/stagehand-diff-apply-hunk-at 0 "stage")');
    // Switch away and let the REAL sentinel land (valve r4: driving
    // the sentinel directly raced the still-running git process).
    e(editor, '(buffer-switch "*scratch*")');
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied");
    // The current buffer is STILL the user's; the diff view refreshed in place.
    expect(String(e(editor, "(buffer-name)").value)).toBe("*scratch*");
    e(editor, '(buffer-switch "*Stagehand-Diff*")');
    const view = strip(bufferText(editor));
    expect(view).toContain("no changes on this side");
  });

  test("a FAILED refresh keeps its status (never overwritten with 'hunk applied')", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nv2\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nCHANGED\n");
    openDiff("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-next)");
    e(editor, '(stagehand/diff/stagehand-diff-apply-hunk-at 0 "stage")');
    // Kill the repo's git metadata BEFORE the sentinel lands — the
    // apply already ran (synchronous stdin write); the refresh's
    // git diff now fails.
    execFileSync("rm", ["-rf", join(process.cwd(), ".git")]);
    e(editor, "(stagehand/diff/stagehand-diff-apply-sentinel 0 0)");
    expect(String(e(editor, "(editor-status)").value)).toContain("refresh failed");
    expect(String(e(editor, "(editor-status)").value)).not.toContain("hunk applied");
  });
});
