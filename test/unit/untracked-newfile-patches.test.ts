import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file untracked-newfile-patches.test.ts
 * @description #305 A — untracked files render as NEW-FILE PATCHES in the
 * turn viewer (`git diff --no-index /dev/null <path>`): the diff grammar
 * (`diff --git a/x b/x`, `new file mode`, `--- /dev/null`, `+++ b/x`,
 * all-addition hunks) — incl. the edges: empty (header only), binary
 * (Binary files line, no content), odd names (spaces/unicode/dashes).
 * Tracked files keep the tree-diff source. Part B (the revert `r`
 * affordance: pre-turn-dirty restores byte-exact, turn-created untracked
 * removed, cancel no-ops) lives here too.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

const dirs: string[] = [];

async function setup(): Promise<{ editor: Editor; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "i305-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
  const editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module fikra/thread)");
  e(editor, "(require-module fikra/diff)");
  e(editor, "(fikra/thread/fikra-thread-init)");
  return { editor, dir };
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function viewerText(editor: Editor): string {
  e(editor, "(fikra/diff/fikra-turn-diff)");
  return strip(bufferText(editor));
}

describe("#305 A — untracked files as new-file patches", () => {
  let editor: Editor;
  let dir: string;
  beforeEach(async () => {
    ({ editor, dir } = await setup());
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
  });

  test("a text untracked file renders as a full new-file diff", () => {
    writeFileSync(join(dir, "hello.txt"), "line1\nline2\n");
    const t = viewerText(editor);
    expect(t).toContain("diff --git a/hello.txt b/hello.txt");
    expect(t).toContain("new file mode");
    expect(t).toContain("--- /dev/null");
    expect(t).toContain("+++ b/hello.txt");
    expect(t).toContain("+line1");
    expect(t).toContain("+line2");
    // NOT the old full-content blob form.
    expect(t).not.toContain("+++ new file: hello.txt");
  });

  test("an EMPTY untracked file renders the header only (no hunks)", () => {
    writeFileSync(join(dir, "empty.txt"), "");
    const t = viewerText(editor);
    expect(t).toContain("diff --git a/empty.txt b/empty.txt");
    expect(t).toContain("new file mode");
    // Header ONLY: no hunk header, no ---/+++ pair (git omits both for
    // empty new files).
    expect(t).not.toContain("@@");
    expect(t).not.toContain("--- /dev/null");
    expect(t).not.toContain("+++ b/empty.txt");
  });

  test("a BINARY untracked file renders the Binary-files line, no content", () => {
    writeFileSync(join(dir, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]));
    const t = viewerText(editor);
    expect(t).toContain("Binary files /dev/null and b/blob.bin differ");
    expect(t.indexOf("\u0000")).toBe(-1);
  });

  test("odd names (spaces, unicode, leading dash) are safe by construction", () => {
    writeFileSync(join(dir, "with space.txt"), "spaced\n");
    writeFileSync(join(dir, "uni-éè.txt"), "unicode\n");
    writeFileSync(join(dir, "-dashy.txt"), "dashed\n");
    // The viewer pages one file at a time; the PATCH SOURCE (the
    // function under test) carries all three — assert on it directly.
    const patch = String(e(editor, '(fikra/diff/fikra-diff-for-paths (fikra/thread/fikra-thread-working-dir) (list "with space.txt" "uni-éè.txt" "-dashy.txt") "HEAD")').value);
    expect(patch).toContain("diff --git a/with space.txt b/with space.txt");
    expect(patch).toContain("+spaced");
    expect(patch).toContain('diff --git "a/uni-'); // git quote-escapes non-ASCII (correct)
    expect(patch).toContain("+unicode");
    expect(patch).toContain("+unicode");
    expect(patch).toContain("diff --git a/-dashy.txt b/-dashy.txt");
    expect(patch).toContain("+dashed");
  });

  test("tracked files keep the tree-diff source alongside", () => {
    writeFileSync(join(dir, "tracked.txt"), "base\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: dir });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "add tracked"], { cwd: dir });
    writeFileSync(join(dir, "tracked.txt"), "base\nchanged\n");
    writeFileSync(join(dir, "fresh.txt"), "new\n");
    const t = viewerText(editor);
    // Tracked: a modification hunk against the baseline.
    expect(t).toContain("--- a/tracked.txt");
    expect(t).toContain("+changed");
    // Untracked: the new-file form.
    expect(t).toContain("new file mode");
    expect(t).toContain("+new");
  });
});

describe("#305 B — the revert affordance (r semantics)", () => {
  test("pre-turn-DIRTY tracked file restores its PRE-TURN dirty content (byte-exact); turn-created untracked removed; untracked-preexisting untouched", async () => {
    const { editor, dir } = await setup();
    // A TRACKED file, dirtied BEFORE the turn (committed base first).
    writeFileSync(join(dir, "dirty.txt"), "committed base\n");
    execFileSync("git", ["add", "dirty.txt"], { cwd: dir });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base"], { cwd: dir });
    writeFileSync(join(dir, "dirty.txt"), "pre-turn dirty content\n");
    // An UNTRACKED file that predates the turn (never committed).
    writeFileSync(join(dir, "kept-untracked.txt"), "preexisting\n");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    // The turn edits it AND creates an untracked file.
    writeFileSync(join(dir, "dirty.txt"), "pre-turn dirty content\n+ turn edit\n");
    writeFileSync(join(dir, "made-by-turn.txt"), "turn-made\n");

    // CANCEL no-ops: restore with an empty selection is a no-op path;
    // the confirm gate (completing-read) is interactive — drive the
    // restore directly (the gate's machinery has its own tests).
    e(editor, '(fikra/diff/fikra-diff-restore-turn (list))');
    expect(existsSync(join(dir, "made-by-turn.txt"))).toBe(true);
    expect(readFileSync(join(dir, "dirty.txt"), "utf8")).toContain("+ turn edit");

    // RESTORE: dirty.txt → its PRE-TURN dirty content (the baseline
    // snapshot — NOT HEAD, which lacks the file entirely); the
    // turn-created untracked file is REMOVED.
    e(editor, '(fikra/diff/fikra-diff-restore-turn (list "dirty.txt" "made-by-turn.txt" "kept-untracked.txt"))');
    expect(readFileSync(join(dir, "dirty.txt"), "utf8")).toBe("pre-turn dirty content\n");
    expect(existsSync(join(dir, "made-by-turn.txt"))).toBe(false);
    // Untracked-PREEXISTING: untouched (content intact).
    expect(readFileSync(join(dir, "kept-untracked.txt"), "utf8")).toBe("preexisting\n");
    // The dirty file's pre-turn UNSTAGED shape is restored too (the
    // checkout writes the index; --staged unwinds it — gate r1 catch 3).
    const staged = String(execFileSync("git", ["status", "--porcelain", "dirty.txt"], { cwd: dir }));
    expect(staged.trim()).toBe("M dirty.txt"); // worktree-only (unstaged) modification

    // STAGED-NEW-FILE escape (gate r1 catch 1): a turn-created file that
    // was `git add`ed reads "tracked" to ls-files but is ABSENT from the
    // baseline → removed by restore (the old checkout silently failed).
    writeFileSync(join(dir, "staged-new.txt"), "added mid-turn\n");
    execFileSync("git", ["add", "staged-new.txt"], { cwd: dir });
    e(editor, '(fikra/diff/fikra-diff-restore-turn (list "staged-new.txt"))');
    expect(existsSync(join(dir, "staged-new.txt"))).toBe(false);
    // The staged INDEX entry is gone too (gate r2: rm alone left an AD
    // entry that a plain commit resurrected) — status is clean for it.
    const st = String(execFileSync("git", ["status", "--porcelain", "staged-new.txt"], { cwd: dir })).trim();
    expect(st).toBe("");

    // NIL baseline → conservative no-op (the exported fn must not rm on
    // a missing baseline — gate r1 catch 2).
    e(editor, '(fikra/thread/fikra-thread-set-field "change-baseline" nil)');
    writeFileSync(join(dir, "nilbase.txt"), "x\n");
    e(editor, '(fikra/diff/fikra-diff-restore-turn (list "nilbase.txt"))');
    expect(existsSync(join(dir, "nilbase.txt"))).toBe(true);
  });
});
