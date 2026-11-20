import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// 8.4 (codex r48): completed-turn navigation + the history revert + the
// bounds-defensive rewrite. Real git refs per the checkpoint scheme.

let repoDir = "";
const dirs: string[] = [];
const originalCwd = process.cwd();
beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "fikra-nav-"));
  dirs.push(repoDir);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });
  writeFileSync(join(repoDir, ".gitignore"), ".tmax/\n");
  writeFileSync(join(repoDir, "app.txt"), "line1\n");
  execFileSync("git", ["add", "-A"], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repoDir });
  process.chdir(repoDir);
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const e = (ed: unknown, expr: string) => executeTlisp(ed as never, expr);

/** Materialize refs/fikra/<id>/{n,n-baseline} exactly as the checkpoint
 * scheme writes them (a tree per point). */
function ref(id: string, n: number, kind: "baseline" | "completion", content: string): void {
  writeFileSync(join(repoDir, "app.txt"), content);
  execFileSync("git", ["add", "-A"], { cwd: repoDir });
  const tree = execFileSync("git", ["write-tree"], { cwd: repoDir }).toString().trim();
  const commit = execFileSync("git", ["commit-tree", tree, "-m", `t${n}`], { cwd: repoDir }).toString().trim();
  execFileSync("git", ["update-ref", `refs/fikra/${id}/${n}${kind === "baseline" ? "-baseline" : ""}`, commit], { cwd: repoDir });
}

describe("#8.4 turn navigation + history revert (r48)", () => {
  test("[/] walks turns; the rewrite survives repeated renders", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/adapter")');
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, '(require-module "fikra/thread")');
    e(ed, '(fikra-thread-focus "nav")');
    e(ed, '(fikra-thread-set-field "turn-count" 2)');
    ref("nav", 1, "baseline", "line1\n");
    ref("nav", 1, "completion", "line1\nfeature-a\n");
    ref("nav", 2, "baseline", "line1\nfeature-a\n");
    ref("nav", 2, "completion", "line1\nfeature-a\nfeature-b\n");
    e(ed, '(require-module "fikra/diff")');
    e(ed, "(fikra/diff/fikra-diff-turn-step -1)"); // from count=2 -> 1
    expect(String(e(ed, "(buffer-text)").value)).toContain("turn 1");
    expect(String(e(ed, "(buffer-text)").value)).toContain("feature-a");
    e(ed, "(fikra/diff/fikra-diff-turn-next)"); // 1 -> 2
    expect(String(e(ed, "(buffer-text)").value)).toContain("turn 2");
    expect(String(e(ed, "(buffer-text)").value)).toContain("feature-b");
    // The rewrite is stable across a third render (the old bounds bug froze it).
    e(ed, "(fikra/diff/fikra-diff-turn-prev)");
    expect(String(e(ed, "(buffer-text)").value)).toContain("turn 1");
  });

  test("r on a COMPLETED-turn view reverts THE VIEWED TURN (not the live baseline)", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/adapter")');
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, '(require-module "fikra/thread")');
    e(ed, '(fikra-thread-focus "nav")');
    e(ed, '(fikra-thread-set-field "turn-count" 2)');
    ref("nav", 1, "baseline", "line1\n");
    ref("nav", 1, "completion", "line1\nfeature-a\n");
    ref("nav", 2, "baseline", "line1\nfeature-a\n");
    ref("nav", 2, "completion", "line1\nfeature-a\nfeature-b\n");
    e(ed, '(require-module "fikra/diff")');
    e(ed, "(fikra/diff/fikra-diff-turn-step -1)"); // view turn 1
    // r49: the confirm gate arms; the ACCEPT owns the work (the
    // modes-test pattern — the picker itself needs a live minibuffer).
    e(ed, "(fikra/diff/fikra-diff-revert-turn)");
    e(ed, '(fikra/diff/fikra-diff-revert-completed-accept "revert")');
    // Turn 1's changes restored to ITS baseline: feature-a gone...
    expect(readFileSync(join(repoDir, "app.txt"), "utf8")).not.toContain("feature-a");
    // ...while turn 2's content (still on disk via ref checkout) may remain —
    // the ASSERTION is the viewed-turn targeting: reverting from the turn-1
    // view must checkout refs/fikra/nav/1-baseline's app.txt ("line1\n").
    expect(readFileSync(join(repoDir, "app.txt"), "utf8")).toBe("line1\n");
    // The cancel path leaves everything untouched.
    e(ed, "(fikra/diff/fikra-diff-revert-completed 2)");
    e(ed, '(fikra/diff/fikra-diff-revert-completed-accept "cancel")');
    expect(readFileSync(join(repoDir, "app.txt"), "utf8")).toBe("line1\n");
  });

  test("reverting a turn that ADDED a file removes it (no baseline version)", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/adapter")');
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, '(require-module "fikra/thread")');
    e(ed, '(fikra-thread-focus "nav")');
    e(ed, '(fikra-thread-set-field "turn-count" 1)');
    ref("nav", 1, "baseline", "line1\n");
    // Turn 1 ADDS new-file.txt (absent from the baseline).
    writeFileSync(join(repoDir, "new-file.txt"), "added\n");
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    const tree = execFileSync("git", ["write-tree"], { cwd: repoDir }).toString().trim();
    const commit = execFileSync("git", ["commit-tree", tree, "-m", "t1"], { cwd: repoDir }).toString().trim();
    execFileSync("git", ["update-ref", "refs/fikra/nav/1", commit], { cwd: repoDir });
    e(ed, '(require-module "fikra/diff")');
    e(ed, "(fikra/diff/fikra-diff-revert-completed 1)");
    e(ed, '(fikra/diff/fikra-diff-revert-completed-accept "revert")');
    expect(existsSync(join(repoDir, "new-file.txt"))).toBe(false);
    expect(readFileSync(join(repoDir, "app.txt"), "utf8")).toBe("line1\n");
  });
});
