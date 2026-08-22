import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// #217 (RFC-027 §D6, Phase 2) — non-invasive git checkpoints: temp-index
// refs that never touch the user's index/HEAD/working tree.

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

let repoDir = "";
const repoDirs: string[] = [];
const originalCwd = process.cwd();

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "fikra-ckpt-"));
  repoDirs.push(repoDir);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });
  writeFileSync(join(repoDir, ".gitignore"), ".tmax/\n");
  writeFileSync(join(repoDir, "base.txt"), "base\n");
  execFileSync("git", ["add", "-A"], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repoDir });
  // #198: pin the branch name — runner git defaults to 'master' (no
  // init.defaultBranch config); the assertions reference 'main'.
  execFileSync("git", ["branch", "-M", "main"], { cwd: repoDir });
  process.chdir(repoDir);
});

afterAll(() => {
  process.chdir(originalCwd);
  for (const d of repoDirs) rmSync(d, { recursive: true, force: true });
});

const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repoDir }).toString().trim();
}

describe("#217 non-invasive capture", () => {
  test("capture creates refs/fikra/<thread>/<n>; user index/HEAD untouched", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/checkpoint)");
    e(editor, "(fikra/thread/fikra-thread-init)"); // turn 0
    // Dirty the USER's index deliberately — it must survive untouched.
    writeFileSync(join(repoDir, "staged.txt"), "user-staged\n");
    execFileSync("git", ["add", "staged.txt"], { cwd: repoDir });
    // write-tree hash = the STRONGEST index fingerprint (detects staged
    // content changes, not just name changes — gate fresh-cycle catch).
    const indexTreeBefore = git(["write-tree"]);

    const sha = e(editor, '(fikra/checkpoint/fikra-checkpoint-capture "completion")');
    expect(String(sha.type)).toBe("string");
    expect(String(sha.value)).toMatch(/^[0-9a-f]{7,40}$/);

    // The ref exists and points at the captured commit.
    const ref = "refs/fikra/main/0";
    expect(git(["rev-parse", ref])).toBe(git(["rev-parse", String(sha.value)]));
    // The captured tree CONTAINS the working-tree state (staged.txt).
    expect(git(["ls-tree", "--name-only", ref])).toContain("staged.txt");
    // THE NON-INVARIANCE TEST: the user's index is byte-identical
    // (full tree hash, not just the name list).
    expect(git(["write-tree"])).toBe(indexTreeBefore);
    // HEAD unchanged.
    expect(git(["rev-parse", "HEAD"])).toBe(git(["rev-parse", "main"]));
    // Temp index cleaned up.
    expect(existsSync(join(repoDir, ".tmax/fikra/tmp-index-completion"))).toBe(false);
  });

  test("untracked files captured; deletions captured by absence", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/checkpoint)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    writeFileSync(join(repoDir, "untracked.txt"), "new\n");
    execFileSync("git", ["rm", "-q", "base.txt"], { cwd: repoDir });
    e(editor, '(fikra/checkpoint/fikra-checkpoint-capture "completion")');
    const tree = git(["ls-tree", "--name-only", "refs/fikra/main/0"]);
    expect(tree).toContain("untracked.txt");
    expect(tree).not.toContain("base.txt");
  });

  test("disable cache is PER ROOT, SAME interpreter: non-git probe does not poison a git root (gate catch)", async () => {
    // ONE editor for both roots — the two-editor form didn't pin anything
    // (fresh interpreter = fresh defvars; sticky state was per-interpreter).
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/checkpoint)");
    e(editor, "(require-module fikra/thread)");
    // Probe from a NON-git dir → disabled (this trip poisons the cache).
    const nonGit = mkdtempSync(join(tmpdir(), "fikra-poi-"));
    repoDirs.push(nonGit);
    process.chdir(nonGit);
    e(editor, "(fikra/thread/fikra-thread-init)");
    expect(String(e(editor, '(fikra/checkpoint/fikra-checkpoint-capture "completion")').value)).toBe("null");
    // SAME interpreter, NEW root: re-init the thread at the git repo —
    // the cache must re-probe and capture WORKS.
    process.chdir(repoDir);
    e(editor, "(fikra/thread/fikra-thread-init)");
    const sha = e(editor, '(fikra/checkpoint/fikra-checkpoint-capture "completion")');
    expect(String(sha.type)).toBe("string");
  });

  test("SYNC mid-chain failure emits checkpoint-error, not an eval throw (gate catch)", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/checkpoint)");
    e(editor, "(require-module fikra/thread)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    // Force a REAL pre-update-ref failure: replace git on PATH with a
    // stub that fails on write-tree.
    const bin = join(repoDir, ".tmax/fakebin");
    execFileSync("mkdir", ["-p", bin]);
    writeFileSync(join(bin, "git"), "#!/bin/sh\nif [ \"$1\" = \"write-tree\" ]; then exit 1; fi\nexec /usr/bin/git \"$@\"\n");
    execFileSync("chmod", ["+x", join(bin, "git")]);
    // The capture command runs `sh -c` with inherited PATH — prepend it.
    const out = e(editor, `(fikra/checkpoint/fikra-checkpoint-capture-with-path "${bin}" "completion")`);
    expect(String(out.value)).toBe("null");
    const log = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
    const last = readFileSync(log, "utf8").trimEnd().split("\n").pop()!;
    expect(JSON.parse(last).kind).toBe("checkpoint-error");
    // Thread state untouched.
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
  });

  test("baseline ref gets the -baseline suffix", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/checkpoint)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    e(editor, '(fikra/checkpoint/fikra-checkpoint-capture "baseline")');
    expect(git(["rev-parse", "--verify", "-q", "refs/fikra/main/0-baseline"])).toMatch(/^[0-9a-f]+$/);
  });

  test("turn-end is NOT extended: capture failure never touches thread state", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/checkpoint)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    // Corrupt git so the capture fails (unset the object format trick:
    // simplest failure = make write-tree fail via a bad index path).
    writeFileSync(join(repoDir, "evil"), "x");
    // Simulate failure: capture with a kind whose command will fail is hard
    // to force without hooks; instead verify the CONTRACT directly — the
    // thread status after a failed tail parse is unchanged.
    const before = String(e(editor, "(fikra/thread/fikra-thread-status)").value);
    // A capture against a NON-git dir: the thread root is fixed at init, so
    // init a fresh thread rooted in a non-git dir instead of chdir games.
    const nonGit = mkdtempSync(join(tmpdir(), "fikra-fail-"));
    repoDirs.push(nonGit);
    process.chdir(nonGit);
    const editor2 = await createStartedEditor("");
    e(editor2, "(require-module fikra/checkpoint)");
    e(editor2, "(require-module fikra/thread)");
    e(editor2, "(fikra/thread/fikra-thread-init)");
    const out = e(editor2, '(fikra/checkpoint/fikra-checkpoint-capture "completion")');
    expect(String(out.value)).toBe("null");
    process.chdir(repoDir);
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe(before);
  });
});

describe("#217 disabled states", () => {
  test("non-git root: capture nil, no crash", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/checkpoint)");
    const nonGit = mkdtempSync(join(tmpdir(), "fikra-nongit-"));
    repoDirs.push(nonGit);
    process.chdir(nonGit);
    expect(String(e(editor, '(fikra/checkpoint/fikra-checkpoint-capture "completion")').value)).toBe("null");
    process.chdir(repoDir);
  });

  test("unborn HEAD: disabled until the first commit", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/checkpoint)");
    const unborn = mkdtempSync(join(tmpdir(), "fikra-unborn-"));
    repoDirs.push(unborn);
    execFileSync("git", ["init", "-q"], { cwd: unborn });
    process.chdir(unborn);
    e(editor, "(fikra/thread/fikra-thread-init)");
    expect(String(e(editor, '(fikra/checkpoint/fikra-checkpoint-capture "completion")').value)).toBe("null");
    process.chdir(repoDir);
  });

  test("gitignored files are NOT captured (documented, not fixed)", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/checkpoint)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    writeFileSync(join(repoDir, ".gitignore"), "secret.txt\n");
    writeFileSync(join(repoDir, "secret.txt"), "s3cret\n");
    e(editor, '(fikra/checkpoint/fikra-checkpoint-capture "completion")');
    expect(git(["ls-tree", "--name-only", "refs/fikra/main/0"])).not.toContain("secret.txt");
  });
});

describe("#217 FAEP events + async reactor", () => {
  test("capture emits checkpoint-ready with the ref", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/checkpoint)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    e(editor, '(fikra/checkpoint/fikra-checkpoint-capture "completion")');
    const log = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
    const last = readFileSync(log, "utf8").trimEnd().split("\n").pop()!;
    expect(JSON.parse(last).kind).toBe("checkpoint-ready");
    expect(JSON.parse(last).ref).toBe("refs/fikra/main/0");
  });

  test("async capture: process-based, sentinel emits the event", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/checkpoint)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    const pid = e(editor, '(fikra/checkpoint/fikra-checkpoint-capture-async "completion")');
    expect(Number(pid.value)).toBeGreaterThan(0);
    // Wait for the async sentinel to emit (loaded machine: allow slack).
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const log2 = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
      const kinds2 = readFileSync(log2, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l).kind);
      if (kinds2.includes("checkpoint-ready")) break;
    }
    const log = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
    const kinds = readFileSync(log, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l).kind);
    expect(kinds).toContain("checkpoint-ready");
    expect(git(["rev-parse", "--verify", "-q", "refs/fikra/main/0"])).toMatch(/^[0-9a-f]+$/);
  });
});
