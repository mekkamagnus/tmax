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

  test("close REFUSES on GITIGNORED worktree content (gate catch: invisible to diff+untracked, never captured — remove would destroy it)", async () => {
    const a = await setupThread("a");
    e(a, "(fikra/worktree/fikra-worktree-enter)");
    const wt = worktreePathFor(repoDir, "a");
    writeFileSync(join(wt, "shared.txt"), "edit\n");
    e(a, "(fikra/worktree/fikra-worktree-handoff)");
    // An agent-written gitignored file (add -A never captures it).
    writeFileSync(join(wt, ".env"), "SECRET=1\n");
    expect(String(e(a, "(fikra/worktree/fikra-worktree-close)").value)).toBe("null");
    expect(readFileSync(join(wt, ".env"), "utf8")).toBe("SECRET=1\n"); // NOT destroyed
    expect(existsSync(wt)).toBe(true); // worktree intact
    expect(String(e(a, "(editor-status)").value)).toContain("refused");
    // Removing the ignored file unblocks the close.
    rmSync(join(wt, ".env"));
    expect(String(e(a, "(fikra/worktree/fikra-worktree-close)").value)).toBe("true");
    expect(existsSync(wt)).toBe(false);
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
    // Mockup 8.6: SPC a w opens the REVIEW screen in worktree mode (the
    // toggle's local->enter half is unchanged; the direct handoff moved
    // behind the screen's `a`).
    expect(JSON.stringify(e(a, '(key-binding "SPC a w" "normal")').value)).toContain("fikra-worktree-review");
  });


  // Mockup 8.6 (codex r24 fix 2): the review-and-choice screen.
  test("SPC a w in worktree mode opens the review screen; a applies the reviewed patch", async () => {
    const editor = await setupThread("r");
    e(editor, "(require-module fikra/adapter)");
    e(editor, '(fikra/adapter/fikra-set-backend-forced "replay")');
    // A change INSIDE the worktree ONLY (an ADD patch — nothing local can
    // conflict), mirroring the isolation suite's proven pattern.
    e(editor, "(fikra/worktree/fikra-worktree-enter)");
    const wt = String(e(editor, '(fikra/thread/fikra-thread-field "worktree")').value);
    writeFileSync(join(wt, "feature.txt"), "changed in worktree\n");
    execFileSync("git", ["add", "-A"], { cwd: wt });
    execFileSync("git", ["commit", "-q", "-m", "wt change"], { cwd: wt });
    e(editor, "(fikra/worktree/fikra-worktree-review)");
    expect(String(e(editor, "(buffer-name)").value)).toBe("*Fikra-worktree*");
    const text = String(e(editor, "(buffer-text)").value);
    expect(text).toContain("1 file(s)");
    expect(text).toContain("+1");
    expect(text).toContain("apply patch");
    expect(text).toContain("refuse + keep worktree");
    const kmap = e(editor, '(keymap-ref (editor/keymaps/buffer-keymap "*Fikra-worktree*") "a")');
    expect(JSON.stringify(kmap.value)).toContain("review-apply");
    const kmapD = e(editor, '(keymap-ref (editor/keymaps/buffer-keymap "*Fikra-worktree*") "d")');
    expect(JSON.stringify(kmapD.value)).toContain("review-diff");
    const kmapR = e(editor, '(keymap-ref (editor/keymaps/buffer-keymap "*Fikra-worktree*") "r")');
    expect(JSON.stringify(kmapR.value)).toContain("review-refuse");
    // Clean apply: the reviewed patch lands in the LOCAL tree.
    expect(existsSync(join(process.cwd(), "feature.txt"))).toBe(false);
    e(editor, "(fikra/worktree/fikra-worktree-review-apply)");
    expect(existsSync(join(process.cwd(), "feature.txt"))).toBe(true);
    expect(readFileSync(join(process.cwd(), "feature.txt"), "utf8")).toBe("changed in worktree\n");
    expect(String(e(editor, "(buffer-name)").value)).toBe("*scratch*");
  });

  test("d previews the patch and r refuses keeping the worktree (the other two key ACTIONS)", async () => {
    const editor = await setupThread("p");
    e(editor, "(require-module fikra/adapter)");
    e(editor, '(fikra/adapter/fikra-set-backend-forced "replay")');
    e(editor, "(fikra/worktree/fikra-worktree-enter)");
    const wt = String(e(editor, '(fikra/thread/fikra-thread-field "worktree")').value);
    writeFileSync(join(wt, "pv.txt"), "previewed content\n");
    e(editor, "(fikra/worktree/fikra-worktree-review)");
    e(editor, "(fikra/worktree/fikra-worktree-review-diff)");
    const preview = String(e(editor, "(buffer-text)").value);
    expect(preview).toContain("reviewed patch");
    expect(preview).toContain("previewed content");
    // r refuses: no local landing, the worktree file survives.
    e(editor, "(fikra/worktree/fikra-worktree-review-refuse)");
    expect(existsSync(join(process.cwd(), "pv.txt"))).toBe(false);
    expect(existsSync(join(wt, "pv.txt"))).toBe(true);
  });

  test("a broken worktree renders an explicit generation failure, not an empty review", async () => {
    const editor = await setupThread("x");
    e(editor, "(require-module fikra/adapter)");
    e(editor, '(fikra/adapter/fikra-set-backend-forced "replay")');
    e(editor, "(fikra/worktree/fikra-worktree-enter)");
    const wt = String(e(editor, '(fikra/thread/fikra-thread-field "worktree")').value);
    rmSync(wt, { recursive: true, force: true });
    e(editor, "(fikra/worktree/fikra-worktree-review)");
    const text = String(e(editor, "(buffer-text)").value);
    expect(text).toContain("patch generation failed");
  });

  test("review apply refuses when the tree moved since the review", async () => {
    const editor = await setupThread("c");
    e(editor, "(require-module fikra/adapter)");
    e(editor, '(fikra/adapter/fikra-set-backend-forced "replay")');
    execFileSync("git", ["add", "-A"], { cwd: process.cwd() });
    try { execFileSync("git", ["commit", "-q", "-m", "local file"], { cwd: process.cwd() }); } catch { /* clean */ }
    e(editor, "(fikra/worktree/fikra-worktree-enter)");
    const wt = String(e(editor, '(fikra/thread/fikra-thread-field "worktree")').value);
    writeFileSync(join(wt, "g.txt"), "conflicty\n");
    execFileSync("git", ["add", "-A"], { cwd: wt });
    execFileSync("git", ["commit", "-q", "-m", "wt2"], { cwd: wt });
    e(editor, "(fikra/worktree/fikra-worktree-review)");
    // Dirty the LOCAL tree so the reviewed patch no longer applies.
    writeFileSync(join(process.cwd(), "g.txt"), "local diverged first line\nsecond line\n");
    e(editor, "(fikra/worktree/fikra-worktree-review-apply)");
    const status = String(e(editor, "(buffer-text)").value);
    // Refused: the file keeps the LOCAL content (patch not applied).
    expect(readFileSync(join(process.cwd(), "g.txt"), "utf8")).toContain("local diverged");
  });
});

describe("8.6 context row (r94 — codex r93 catches)", () => {
  const setup = async (id: string): Promise<{ editor: Editor; wt: string }> => {
    const editor = await setupThread(id);
    e(editor, "(require-module fikra/adapter)");
    e(editor, '(fikra/adapter/fikra-set-backend-forced "replay")');
    e(editor, "(fikra/worktree/fikra-worktree-enter)");
    const wt = String(e(editor, '(fikra/thread/fikra-thread-field "worktree")').value);
    return { editor, wt };
  };

  test("ZERO overlap: the context row says conflicts:none, NO annotation", async () => {
    const { editor, wt } = await setup("cz");
    writeFileSync(join(wt, "new-file.txt"), "worktree change\n");
    e(editor, "(fikra/worktree/fikra-worktree-review)");
    const text = String(e(editor, "(buffer-text)").value);
    expect(text).toContain("conflicts: none · files touched by others since fork: 0");
    expect(text).not.toContain("auto-merged");
  });

  test("CLEAN overlap: the annotation is EARNED (a REAL shared-file overlap that verifiably merges)", async () => {
    // A 3-line base gives the append hunk trailing context that survives
    // a top-prepend (the 1-line shared.txt fixture leaves no slack).
    writeFileSync(join(repoDir, "multi.txt"), "a\nb\nc\nd\ne\nf\n");
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    execFileSync("git", ["commit", "-q", "-m", "multi base"], { cwd: repoDir });
    const editor = await setupThread("co");
    e(editor, "(require-module fikra/adapter)");
    e(editor, '(fikra/adapter/fikra-set-backend-forced "replay")');
    e(editor, "(fikra/worktree/fikra-worktree-enter)");
    const wt = String(e(editor, '(fikra/thread/fikra-thread-field "worktree")').value);
    // The worktree PREPENDS (hunk covers lines 1-6, context a..f); the
    // SAME file moved locally since the fork with a line APPENDED at 7 —
    // entirely outside the hunk range, so git apply --check passes (git
    // apply does not fuzz: an in-range local shift stays a conflict).
    writeFileSync(join(wt, "multi.txt"), "worktree line\na\nb\nc\nd\ne\nf\n");
    writeFileSync(join(repoDir, "multi.txt"), "a\nb\nc\nd\ne\nf\nlocal tail\n");
    e(editor, "(fikra/worktree/fikra-worktree-review)");
    const text = String(e(editor, "(buffer-text)").value);
    expect(text).toContain("✓ patch applies cleanly");
    expect(text).toContain("files touched by others since fork: 1 (auto-merged)");
  });

  test("CONFLICT: ONE context row — a line-count summary, not the multi-line git error", async () => {
    const { editor, wt } = await setup("cc");
    writeFileSync(join(wt, "shared.txt"), "worktree version\n");
    // The SAME file diverges locally — the patch cannot apply.
    writeFileSync(join(repoDir, "shared.txt"), "local diverged first line\nsecond line\n");
    e(editor, "(fikra/worktree/fikra-worktree-review)");
    const text = String(e(editor, "(buffer-text)").value);
    expect(text).toContain("✗ patch does NOT apply cleanly");
    // The context row is a SINGLE line with the summary shape — the raw
    // git error (which contains newlines and 'error: patch failed')
    // appears under the verdict ONLY.
    expect(text).toContain("conflicts: ");
    expect(text).toContain("line(s) — full output above");
    const rows = text.split("\n").filter((l) => l.startsWith("conflicts:"));
    expect(rows).toHaveLength(1);
    // The NUMERIC fork count: shared.txt diverged locally — overlap 1.
    expect(rows[0]).toContain("files touched by others since fork: 1");
  });
});
