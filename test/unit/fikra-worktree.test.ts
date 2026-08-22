import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// #221 (RFC-027 §D7) — worktree isolation per thread + patch-apply-or-refuse
// handoff. Fresh repo per test (the #218 fixture rule: .tmax/ gitignored).

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

let repoDir = "";
const repoDirs: string[] = [];
const originalCwd = process.cwd();

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "fikra-wt-"));
  repoDirs.push(repoDir);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });
  execFileSync("git", ["branch", "-M", "main"], { cwd: repoDir }); // #198: runner default is master
  writeFileSync(join(repoDir, ".gitignore"), ".tmax/\n");
  writeFileSync(join(repoDir, "shared.txt"), "original\n");
  execFileSync("git", ["add", "-A"], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repoDir });
  process.chdir(repoDir);
});

afterAll(() => {
  for (const d of repoDirs) {
    try { execFileSync("git", ["worktree", "remove", "--force", worktreePathFor(d, "a")], { cwd: d }); } catch { /* gone */ }
    try { execFileSync("git", ["worktree", "remove", "--force", worktreePathFor(d, "b")], { cwd: d }); } catch { /* gone */ }
    try { execFileSync("git", ["worktree", "prune"], { cwd: d }); } catch { /* gone */ }
    rmSync(d, { recursive: true, force: true });
  }
  process.chdir(originalCwd);
});

const worktreePathFor = (root: string, id: string) =>
  // realpathSync: git resolves macOS /var → /private/var; the module
  // reports the real path.
  realpathSync(join(dirname(root), `${basename(root)}.fikra-${id}`));

const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);
const git = (args: string[]) => execFileSync("git", args, { cwd: repoDir }).toString().trim();

/** Focus a thread id (lazy state init) + require the worktree module once. */
async function setupThread(id: string): Promise<Editor> {
  const editor = await createStartedEditor("");
  e(editor, "(require-module fikra/worktree)");
  // focus alone: fikra-thread-init RESETS the id to "main" — the focus
  // setter's lazy state init is the multi-thread path (#222 formalizes).
  e(editor, `(fikra/thread/fikra-thread-focus "${id}")`);
  return editor;
}

describe("#221 isolation — two threads, same file, no cross-contamination", () => {
  test("thread a and b edit shared.txt in their own worktrees; each handoff carries only its own edit", async () => {
    const a = await setupThread("a");
    const b = await setupThread("b");
    expect(String(e(a, "(fikra/worktree/fikra-worktree-enter)").value)).toContain(".fikra-a");
    expect(String(e(b, "(fikra/worktree/fikra-worktree-enter)").value)).toContain(".fikra-b");
    const wtA = worktreePathFor(repoDir, "a");
    const wtB = worktreePathFor(repoDir, "b");
    // Concurrent "agents" edit the SAME file in each worktree.
    writeFileSync(join(wtA, "shared.txt"), "edit from A\n");
    writeFileSync(join(wtB, "shared.txt"), "edit from B\n");
    // Working dirs are distinct and worktree-scoped.
    expect(String(e(a, "(fikra/thread/fikra-thread-working-dir)").value)).toBe(wtA + "/");
    expect(String(e(b, "(fikra/thread/fikra-thread-working-dir)").value)).toBe(wtB + "/");
    // Hand off A first: local gets A's edit only.
    expect(String(e(a, "(fikra/worktree/fikra-worktree-handoff)").value)).toBe("true");
    expect(readFileSync(join(repoDir, "shared.txt"), "utf8")).toBe("edit from A\n");
    // B's handoff now CONFLICTS (its base→snapshot patch still says
    // original→B-edit, but local shared.txt is A's edit): refused, patch
    // preserved, worktree intact.
    expect(String(e(b, "(fikra/worktree/fikra-worktree-handoff)").value)).toBe("null");
    expect(readFileSync(join(repoDir, "shared.txt"), "utf8")).toBe("edit from A\n"); // NOT B's
    expect(readFileSync(join(wtB, "shared.txt"), "utf8")).toBe("edit from B\n"); // intact
    const patch = join(repoDir, ".tmax/fikra/patches/b.patch");
    expect(existsSync(patch)).toBe(true);
    expect(readFileSync(patch, "utf8")).toContain("edit from B");
  });
});

describe("#221 local → worktree", () => {
  test("enter on a clean tree creates the sibling worktree on fikra/<id> from HEAD", async () => {
    const a = await setupThread("a");
    const path = String(e(a, "(fikra/worktree/fikra-worktree-enter)").value);
    expect(path).toBe(worktreePathFor(repoDir, "a") + "/");
    expect(existsSync(worktreePathFor(repoDir, "a"))).toBe(true);
    expect(git(["worktree", "list"])).toContain(".fikra-a");
    expect(git(["branch", "--list", "fikra/a"])).toContain("fikra/a");
    expect(String(e(a, "(fikra/worktree/fikra-worktree-active-p)").value)).toBe("true");
    // The worktree sees the repo's content.
    expect(readFileSync(join(worktreePathFor(repoDir, "a"), "shared.txt"), "utf8")).toBe("original\n");
  });

  test("REFUSES when the local tree is dirty beyond the latest checkpoint", async () => {
    const a = await setupThread("a");
    writeFileSync(join(repoDir, "uncommitted.txt"), "dirty\n");
    expect(String(e(a, "(fikra/worktree/fikra-worktree-enter)").value)).toBe("null");
    // never created (realpathSync throws on nonexistent — use the raw path)
    expect(existsSync(join(dirname(repoDir), `${basename(repoDir)}.fikra-a`))).toBe(false);
    expect(String(e(a, "(editor-status)").value)).toContain("dirty");
  });

  test("a NEW UNTRACKED file also refuses (never captured), but tmax's own .tmax/ does not", async () => {
    const a = await setupThread("a");
    // .tmax exists (thread init) and is ignored — enter still succeeds.
    expect(String(e(a, "(fikra/worktree/fikra-worktree-enter)").value)).toContain(".fikra-a");
    expect(String(e(a, "(editor-status)").value)).toContain("worktree");
  });
});

describe("#221 worktree → local (patch-apply-or-refuse)", () => {
  test("clean handoff applies the cumulative patch to the local tree", async () => {
    const a = await setupThread("a");
    e(a, "(fikra/worktree/fikra-worktree-enter)");
    const wt = worktreePathFor(repoDir, "a");
    writeFileSync(join(wt, "shared.txt"), "agent version\n");
    writeFileSync(join(wt, "new-file.txt"), "created by agent\n");
    expect(String(e(a, "(fikra/worktree/fikra-worktree-handoff)").value)).toBe("true");
    expect(readFileSync(join(repoDir, "shared.txt"), "utf8")).toBe("agent version\n");
    expect(readFileSync(join(repoDir, "new-file.txt"), "utf8")).toBe("created by agent\n");
  });

  test("conflict: handoff ABORTS, patch preserved, worktree intact, local untouched", async () => {
    const a = await setupThread("a");
    e(a, "(fikra/worktree/fikra-worktree-enter)");
    const wt = worktreePathFor(repoDir, "a");
    writeFileSync(join(wt, "shared.txt"), "agent version\n");
    // The user edits the SAME file locally after the worktree diverged.
    writeFileSync(join(repoDir, "shared.txt"), "user version\n");
    expect(String(e(a, "(fikra/worktree/fikra-worktree-handoff)").value)).toBe("null");
    expect(readFileSync(join(repoDir, "shared.txt"), "utf8")).toBe("user version\n"); // untouched
    expect(readFileSync(join(wt, "shared.txt"), "utf8")).toBe("agent version\n"); // intact
    const patch = join(repoDir, ".tmax/fikra/patches/a.patch");
    expect(existsSync(patch)).toBe(true);
    expect(readFileSync(patch, "utf8")).toContain("agent version");
    expect(String(e(a, "(editor-status)").value)).toContain("CONFLICT");
  });
});

describe("#221 close — snapshot + retention export + prune", () => {
  test("close prunes worktree, branch, refs; exports diffs; worktree list clean", async () => {
    const a = await setupThread("a");
    e(a, "(fikra/worktree/fikra-worktree-enter)");
    const wt = worktreePathFor(repoDir, "a");
    writeFileSync(join(wt, "shared.txt"), "final version\n");
    e(a, "(fikra/worktree/fikra-worktree-handoff)"); // apply + snapshot
    expect(String(e(a, "(fikra/worktree/fikra-worktree-close)").value)).toBe("true");
    expect(existsSync(wt)).toBe(false); // pruned
    expect(git(["worktree", "list"])).not.toContain(".fikra-a");
    expect(git(["branch", "--list", "fikra/a"])).toBe(""); // branch gone
    expect(git(["for-each-ref", "--format=%(refname)", "refs/fikra/a/"])).toBe(""); // refs gone
    // Retention: the turn diffs exported before the refs were deleted.
    expect(existsSync(join(repoDir, ".tmax/fikra/threads/a/diffs/0.patch"))).toBe(true);
    // State cleared.
    expect(String(e(a, "(fikra/worktree/fikra-worktree-active-p)").value)).toBe("null");
    // The applied content survives locally.
    expect(readFileSync(join(repoDir, "shared.txt"), "utf8")).toBe("final version\n");
  });

  test("close REFUSES when the worktree has changes beyond the snapshot", async () => {
    const a = await setupThread("a");
    e(a, "(fikra/worktree/fikra-worktree-enter)");
    const wt = worktreePathFor(repoDir, "a");
    writeFileSync(join(wt, "shared.txt"), "edit 1\n");
    e(a, "(fikra/worktree/fikra-worktree-handoff)"); // snapshot captures edit 1
    // Post-snapshot divergence: a NEW untracked file in the worktree.
    writeFileSync(join(wt, "post-snapshot.txt"), "appeared after\n");
    expect(String(e(a, "(fikra/worktree/fikra-worktree-close)").value)).toBe("null");
    expect(existsSync(wt)).toBe(true); // intact
    expect(String(e(a, "(editor-status)").value)).toContain("refused");
  });
});

describe("#221 modeline + binding", () => {
  test("lighter carries wt:<id> only in worktree mode", async () => {
    const a = await setupThread("a");
    e(a, "(require-module fikra/chat)");
    e(a, '(require-module fikra/adapter)');
    e(a, '(fikra/adapter/fikra-set-backend-forced "replay")');
    e(a, "(fikra/chat/fikra-refresh-lighter)");
    expect(String(e(a, '(minor-mode-lighter "fikra")').value)).not.toContain("wt:");
    e(a, "(fikra/worktree/fikra-worktree-enter)");
    e(a, "(fikra/chat/fikra-refresh-lighter)");
    expect(String(e(a, '(minor-mode-lighter "fikra")').value)).toContain("wt:a");
    e(a, "(fikra/worktree/fikra-worktree-close)");
    e(a, "(fikra/chat/fikra-refresh-lighter)");
    expect(String(e(a, '(minor-mode-lighter "fikra")').value)).not.toContain("wt:");
  });

  test("SPC a w is registered (the toggle entry point)", async () => {
    const a = await setupThread("a");
    e(a, "(require-module fikra/mode)");
    expect(JSON.stringify(e(a, '(key-binding "SPC a w" "normal")').value)).toContain("fikra-worktree-toggle");
  });
});
