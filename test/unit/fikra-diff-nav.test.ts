import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
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
    // r50/SPEC-218: turn 2 also touched app.txt — the content diverged
    // from turn 1's completion, so the revert REFUSES (no overwrite of
    // later work) and stashes the divergent content.
    e(ed, "(fikra/diff/fikra-diff-revert-turn)");
    e(ed, '(fikra/diff/fikra-diff-revert-completed-accept "revert")');
    expect(readFileSync(join(repoDir, "app.txt"), "utf8")).toBe("line1\nfeature-a\nfeature-b\n");
    // Unique per attempt (timestamped) — assert SOME stash exists.
    const stashDir = join(repoDir, ".tmax/fikra/stash");
    const stashes = existsSync(stashDir) ? readdirSync(stashDir).filter(f => f.startsWith("revert-nav-1-")) : [];
    expect(stashes.length).toBeGreaterThan(0);
    // The cancel path leaves everything untouched.
    e(ed, "(fikra/diff/fikra-diff-revert-completed 2)");
    e(ed, '(fikra/diff/fikra-diff-revert-completed-accept "cancel")');
    expect(readFileSync(join(repoDir, "app.txt"), "utf8")).toBe("line1\nfeature-a\nfeature-b\n");
    // The LATEST turn's content matches its completion: reverting turn 2
    // (the current view after cancel is still 1; arm via exec directly)
    // restores turn 2's baseline == turn 1's completion.
    e(ed, "(fikra/diff/fikra-diff-revert-completed 2)");
    e(ed, '(fikra/diff/fikra-diff-revert-completed-accept "revert")');
    expect(readFileSync(join(repoDir, "app.txt"), "utf8")).toBe("line1\nfeature-a\n");
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

  test("a path EDITED after the turn is refused, not overwritten (SPEC-218 guard)", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/adapter")');
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, '(require-module "fikra/thread")');
    e(ed, '(fikra-thread-focus "nav")');
    e(ed, '(fikra-thread-set-field "turn-count" 1)');
    ref("nav", 1, "baseline", "line1\n");
    ref("nav", 1, "completion", "line1\nfeature-a\n");
    // The user edits the file AFTER the turn: content no longer matches
    // the completion ref -> the guard must refuse.
    writeFileSync(join(repoDir, "app.txt"), "line1\nfeature-a\nLATER-EDIT\n");
    e(ed, '(require-module "fikra/diff")');
    e(ed, "(fikra/diff/fikra-diff-revert-completed 1)");
    e(ed, '(fikra/diff/fikra-diff-revert-completed-accept "revert")');
    // The later edit survives untouched.
    expect(readFileSync(join(repoDir, "app.txt"), "utf8")).toBe("line1\nfeature-a\nLATER-EDIT\n");
    // The divergent content was stashed for manual re-application.
    // Unique per attempt (timestamped) — assert SOME stash exists.
    const stashDir = join(repoDir, ".tmax/fikra/stash");
    const stashes = existsSync(stashDir) ? readdirSync(stashDir).filter(f => f.startsWith("revert-nav-1-")) : [];
    expect(stashes.length).toBeGreaterThan(0);
  });

  test("a turn-DELETED file the user RECREATED is refused (the untracked blind spot, r51)", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/adapter")');
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, '(require-module "fikra/thread")');
    e(ed, '(fikra-thread-focus "nav")');
    e(ed, '(fikra-thread-set-field "turn-count" 1)');
    // Baseline HAS gone.txt; the turn's completion DELETED it.
    writeFileSync(join(repoDir, "gone.txt"), "original\n");
    writeFileSync(join(repoDir, "app.txt"), "line1\n");
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    const baseTree = execFileSync("git", ["write-tree"], { cwd: repoDir }).toString().trim();
    const baseC = execFileSync("git", ["commit-tree", baseTree, "-m", "b"], { cwd: repoDir }).toString().trim();
    execFileSync("git", ["update-ref", "refs/fikra/nav/1-baseline", baseC], { cwd: repoDir });
    // Turn 1: completion deletes gone.txt.
    const compTree = execFileSync("git", ["write-tree"], { cwd: repoDir }).toString().trim(); // still has it — write a tree WITHOUT it:
    // (simplest: temp index not needed — commit a tree where gone.txt is absent via git rm)
    execFileSync("git", ["rm", "-q", "--cached", "gone.txt"], { cwd: repoDir });
    const compTree2 = execFileSync("git", ["write-tree"], { cwd: repoDir }).toString().trim();
    const compC = execFileSync("git", ["commit-tree", compTree2, "-m", "c"], { cwd: repoDir }).toString().trim();
    execFileSync("git", ["update-ref", "refs/fikra/nav/1", compC], { cwd: repoDir });
    execFileSync("git", ["reset", "-q"], { cwd: repoDir });
    // The user recreates gone.txt as an UNTRACKED file.
    writeFileSync(join(repoDir, "gone.txt"), "user recreated\n");
    e(ed, '(require-module "fikra/diff")');
    e(ed, "(fikra/diff/fikra-diff-revert-completed 1)");
    e(ed, '(fikra/diff/fikra-diff-revert-completed-accept "revert")');
    // REFUSED: the recreation survives (the old guard passed diff --quiet
    // here and checkout clobbered it).
    expect(readFileSync(join(repoDir, "gone.txt"), "utf8")).toBe("user recreated\n");
  });

  test("an ERROR last turn is skipped — the target stays the last COMPLETED (r60)", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/adapter")');
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, '(require-module "fikra/thread")');
    e(ed, '(fikra-thread-focus "nav")');
    ref("nav", 1, "baseline", "line1\n");
    ref("nav", 1, "completion", "line1\nfeature-a\n");
    ref("nav", 2, "baseline", "line1\nfeature-a\n");
    ref("nav", 2, "completion", "line1\nfeature-a\nfeature-b\n");
    // Turn 3 FAILED: count 3, status error, NO ref — target must be 2.
    e(ed, '(fikra-thread-set-field "turn-count" 3)');
    e(ed, '(fikra-thread-set-field "status" "error")');
    e(ed, '(require-module "fikra/diff")');
    expect(String(e(ed, "(fikra/diff/fikra-last-completed-turn)").value)).toBe("2");
  });

  test("the completed-turn view carries the file-summary block (r75)", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/adapter")');
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, '(require-module "fikra/thread")');
    e(ed, '(fikra-thread-focus "nav")');
    e(ed, '(fikra-thread-set-field "turn-count" 1)');
    ref("nav", 1, "baseline", "line1\n");
    ref("nav", 1, "completion", "line1\nfeature-a\n");
    e(ed, '(require-module "fikra/diff")');
    e(ed, "(fikra/diff/fikra-turn-diff-for 1)");
    const text = String(e(ed, "(buffer-text)").value);
    expect(text).toContain("turn 1");
    // The summary block: 1 file, +1 −0, the ± row.
    expect(text).toContain("1 file(s)");
    expect(text).toContain("+1");
    expect(text).toContain("feature-a");
  });
});

describe("#8.4 binary numstat (r76 — codex r75 P1)", () => {
  test("a turn containing a BINARY file renders, counts parse as 0, no crash", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/adapter")');
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, '(require-module "fikra/thread")');
    e(ed, '(fikra-thread-focus "nav")');
    e(ed, '(fikra-thread-set-field "turn-count" 1)');
    // baseline: app.txt only; completion: text change + a binary addition.
    ref("nav", 1, "baseline", "line1\n");
    writeFileSync(join(repoDir, "bin.o"), Buffer.from([0x00, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    writeFileSync(join(repoDir, "app.txt"), "line1\nfeature-a\n");
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    const tree = execFileSync("git", ["write-tree"], { cwd: repoDir }).toString().trim();
    const commit = execFileSync("git", ["commit-tree", tree, "-m", "bin"], { cwd: repoDir }).toString().trim();
    execFileSync("git", ["update-ref", "refs/fikra/nav/1", commit], { cwd: repoDir });
    e(ed, '(require-module "fikra/diff")');
    e(ed, "(fikra/diff/fikra-turn-diff-for 1)");
    const text = String(e(ed, "(buffer-text)").value);
    // The viewer RENDERS: header, both ± rows (binary counted 0/0).
    expect(text).toContain("turn 1");
    expect(text).toContain("2 file(s)");
    expect(text).toContain("bin.o");
    expect(text).toContain("feature-a");
    // Exactly ONE keys line (r76: the completed view doubled the hint).
    expect(text.split("n/N file").length - 1).toBe(1);
  });
});

describe("#8.4 summary block (r96 — status letters + tool tally)", () => {
  test("M/A letters ride the rows; the header carries the per-turn tool tally", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/adapter")');
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, '(require-module "fikra/thread")');
    e(ed, '(require-module "fikra/event")');
    e(ed, '(fikra-thread-focus "nav")');
    e(ed, '(fikra-thread-set-field "turn-count" 1)');
    // Seed the turn's events (tool tally): turn-start, 2× buffer-edit,
    // 1× bash, turn-end.
    e(ed, '(fikra/event/fikra-event-log-set "/tmp/fikra-nav-r96-events.jsonl")');
    e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "turn-start")))');
    e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "tool-call") (list "tool" "buffer-edit")))');
    e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "tool-call") (list "tool" "bash")))');
    e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "tool-call") (list "tool" "buffer-edit")))');
    e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "turn-end") (list "status" "completed")))');
    // Baseline: app.txt only. Completion: app.txt MODIFIED + new.txt ADDED.
    ref("nav", 1, "baseline", "line1\n");
    writeFileSync(join(repoDir, "app.txt"), "line1\nfeature-a\n"); // MODIFIED
    writeFileSync(join(repoDir, "new.txt"), "added\n");
    execFileSync("git", ["add", "-A"], { cwd: repoDir }); // write-tree reads the INDEX
    const tree = execFileSync("git", ["write-tree"], { cwd: repoDir }).toString().trim();
    const commit = execFileSync("git", ["commit-tree", tree, "-m", "t1c"], { cwd: repoDir }).toString().trim();
    execFileSync("git", ["update-ref", "refs/fikra/nav/1", commit], { cwd: repoDir });
    e(ed, '(require-module "fikra/diff")');
    e(ed, "(fikra/diff/fikra-turn-diff-for 1)");
    const text = String(e(ed, "(buffer-text)").value);
    // The mockup's status letters on the ± rows.
    expect(text).toMatch(/M app\.txt /);
    expect(text).toMatch(/A new\.txt /);
    // The per-turn tool tally (first-use order, counts).
    expect(text).toContain("tools: buffer-edit ×2, bash ×1");
    rmSync("/tmp/fikra-nav-r96-events.jsonl", { force: true });
  });
});

describe("#8.4 rename letter (r97 — codex r96 P2)", () => {
  test("a RENAMED file renders R (numstat's 'old => new' resolves to the new path)", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/adapter")');
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, '(require-module "fikra/thread")');
    e(ed, '(fikra-thread-focus "nav")');
    e(ed, '(fikra-thread-set-field "turn-count" 1)');
    // Baseline: app.txt + old-renamed.txt (write it BEFORE the ref so the
    // baseline TREE carries it — a rename needs its source in the base).
    writeFileSync(join(repoDir, "old-renamed.txt"), "renamed content\n");
    ref("nav", 1, "baseline", "line1\n");
    // Completion: the source GONE, the target added (git reads R).
    rmSync(join(repoDir, "old-renamed.txt"));
    writeFileSync(join(repoDir, "renamed.txt"), "renamed content\n");
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    const tree = execFileSync("git", ["write-tree"], { cwd: repoDir }).toString().trim();
    const commit = execFileSync("git", ["commit-tree", tree, "-m", "ren"], { cwd: repoDir }).toString().trim();
    execFileSync("git", ["update-ref", "refs/fikra/nav/1", commit], { cwd: repoDir });
    e(ed, '(require-module "fikra/diff")');
    e(ed, "(fikra/diff/fikra-turn-diff-for 1)");
    const text = String(e(ed, "(buffer-text)").value);
    // The rename row carries R (not ±).
    expect(text).toMatch(/R (old-renamed\.txt => renamed\.txt|.*=> renamed\.txt)/);
  });
});

describe("#8.4 brace-compressed renames (r98 — codex r97 P2)", () => {
  test("a SAME-DIRECTORY rename renders R (git's src/{old => new}.txt decompresses)", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/adapter")');
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, '(require-module "fikra/thread")');
    e(ed, '(fikra-thread-focus "nav")');
    e(ed, '(fikra-thread-set-field "turn-count" 1)');
    // Baseline: src/old-dir.txt in the tree.
    mkdirSync(join(repoDir, "src"), { recursive: true });
    writeFileSync(join(repoDir, "src", "old-dir.txt"), "content\n");
    ref("nav", 1, "baseline", "line1\n");
    // Completion: renamed within the SAME dir (brace compression).
    rmSync(join(repoDir, "src", "old-dir.txt"));
    writeFileSync(join(repoDir, "src", "new-dir.txt"), "content\n");
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    const tree = execFileSync("git", ["write-tree"], { cwd: repoDir }).toString().trim();
    const commit = execFileSync("git", ["commit-tree", tree, "-m", "rd"], { cwd: repoDir }).toString().trim();
    execFileSync("git", ["update-ref", "refs/fikra/nav/1", commit], { cwd: repoDir });
    e(ed, '(require-module "fikra/diff")');
    e(ed, "(fikra/diff/fikra-turn-diff-for 1)");
    const text = String(e(ed, "(buffer-text)").value);
    expect(text).toMatch(/R .*old-dir\.txt => new-dir\.txt/);
  });
});

describe("#8.4 directory renames (r99 — codex r98 P2)", () => {
  test("a DIRECTORY rename '{old => new}/file.txt' renders R (the leading brace at index 0)", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/adapter")');
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, '(require-module "fikra/thread")');
    e(ed, '(fikra-thread-focus "nav")');
    e(ed, '(fikra-thread-set-field "turn-count" 1)');
    mkdirSync(join(repoDir, "olddir"), { recursive: true });
    writeFileSync(join(repoDir, "olddir", "file.txt"), "content\n");
    ref("nav", 1, "baseline", "line1\n");
    rmSync(join(repoDir, "olddir"), { recursive: true });
    mkdirSync(join(repoDir, "newdir"), { recursive: true });
    writeFileSync(join(repoDir, "newdir", "file.txt"), "content\n");
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    const tree = execFileSync("git", ["write-tree"], { cwd: repoDir }).toString().trim();
    const commit = execFileSync("git", ["commit-tree", tree, "-m", "dr"], { cwd: repoDir }).toString().trim();
    execFileSync("git", ["update-ref", "refs/fikra/nav/1", commit], { cwd: repoDir });
    e(ed, '(require-module "fikra/diff")');
    e(ed, "(fikra/diff/fikra-turn-diff-for 1)");
    const text = String(e(ed, "(buffer-text)").value);
    expect(text).toMatch(/R .*olddir.*=>.*newdir.*file\.txt/);
  });
});

describe("#8.4 SPC a n (r100 — the mockup footer command)", () => {
  test("SPC a n is registered and opens the LATEST completed turn from outside the viewer", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/adapter")');
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, '(require-module "fikra/thread")');
    e(ed, "(require-module fikra/mode)");
    e(ed, '(fikra-thread-focus "nav")');
    e(ed, '(fikra-thread-set-field "turn-count" 1)');
    ref("nav", 1, "baseline", "line1\n");
    ref("nav", 1, "completion", "line1\nfeature-a\n");
    e(ed, '(require-module "fikra/diff")');
    expect(JSON.stringify(e(ed, '(key-binding "SPC a n" "normal")').value)).toContain("fikra-diff-turn-cmd-next");
    e(ed, "(fikra/diff/fikra-diff-turn-cmd-next)");
    expect(String(e(ed, "(buffer-text)").value)).toContain("turn 1");
    // Inside the viewer it steps turns (the mockup's 'next turn').
    e(ed, "(fikra/diff/fikra-diff-turn-cmd-prev)");
    expect(String(e(ed, "(editor-status)").value)).toContain("turn");
  });
});
