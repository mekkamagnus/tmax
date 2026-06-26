/**
 * @file worktree.test.ts
 * @description Unit tests for adws/adws-modules/worktree.ts against a temp
 * git fixture. Covers detectWorktree, createWorktree (sibling + buried),
 * commitSpecToMain (never `git add .`), commitWorktreeChanges, mergeBranchToMain
 * (dirty-main guard), withPlanningLock (serialization), removeWorktree
 * (refuse-on-dirty), and listWorktrees (porcelain parsing).
 *
 * All git operations run through the production `runGitCmd` against a temp
 * repo created with `git init` + an initial commit. No mocked subprocess —
 * these tests exercise real git semantics against real (temp) state.
 */
import { spawn } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, test, expect } from "bun:test";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import {
  commitSpecToMain,
  commitWorktreeChanges,
  createWorktree,
  defaultLockPath,
  detectWorktree,
  listWorktrees,
  mergeBranchToMain,
  removeWorktree,
  runGitCmd,
  siblingWorktreePath,
  withPlanningLock,
  type WorktreeDeps,
} from "../../adws/adws-modules/worktree.ts";

// ---------------------------------------------------------------------------
// Fixture: temp git repo with initial commit
// ---------------------------------------------------------------------------

let tmpRoot: string;
let repoRoot: string;
let deps: WorktreeDeps;

function execGit(args: string[], cwd: string): string {
  // Synchronous helper for fixture setup; tests use the TaskEither api.
  const r = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdio: ["ignore", "pipe", "pipe"] });
  if (r.exitCode !== 0) {
    const err = r.stderr?.toString("utf8") ?? r.stdout?.toString("utf8") ?? "";
    throw new Error(`git ${args.join(" ")} (cwd ${cwd}) failed (exit ${r.exitCode}): ${err}`);
  }
  return (r.stdout?.toString("utf8") ?? "").trim();
}

beforeEach(() => {
  tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "adw-wt-")));
  repoRoot = join(tmpRoot, "repo");
  mkdirSync(repoRoot, { recursive: true });
  execGit(["init", "-b", "main"], repoRoot);
  execGit(["config", "user.email", "test@tmax.local"], repoRoot);
  execGit(["config", "user.name", "Test"], repoRoot);
  writeFileSync(join(repoRoot, "README.md"), "# repo\n");
  execGit(["add", "README.md"], repoRoot);
  execGit(["commit", "-m", "init"], repoRoot);
  deps = { gitRun: runGitCmd };
});

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// ---------------------------------------------------------------------------
// detectWorktree
// ---------------------------------------------------------------------------

describe("detectWorktree", () => {
  test("false in the main checkout", async () => {
    const r = await detectWorktree(deps, repoRoot).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right).toBe(false);
  });

  test("true inside a worktree", async () => {
    const wt = join(tmpRoot, "repo.wt-test");
    execGit(["worktree", "add", "-b", "adw/test", wt, "HEAD"], repoRoot);
    const r = await detectWorktree(deps, wt).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createWorktree — sibling + buried layouts, idempotency
// ---------------------------------------------------------------------------

describe("createWorktree", () => {
  test("sibling layout: creates worktree outside the repo on a new branch", async () => {
    const id = "01KVE7TEST";
    const wt = siblingWorktreePath(repoRoot, id);
    const branch = `adw/${id}`;
    const r = await createWorktree(deps, repoRoot, branch, wt).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right).toBe(wt);
      // Branch exists.
      const branches = execGit(["branch", "--list", branch], repoRoot);
      expect(branches).toContain(branch);
      // Worktree is listed.
      const porcelain = execGit(["worktree", "list", "--porcelain"], repoRoot);
      expect(porcelain).toContain(`worktree ${wt}`);
    }
  });

  test("buried layout: creates worktree inside the repo at .worktrees/<id>/", async () => {
    const id = "01KVE7BURR";
    const wt = join(repoRoot, ".worktrees", id);
    const branch = `adw/${id}`;
    const r = await createWorktree(deps, repoRoot, branch, wt).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right).toBe(wt);
      const porcelain = execGit(["worktree", "list", "--porcelain"], repoRoot);
      expect(porcelain).toContain(`worktree ${wt}`);
    }
  });

  test("idempotency: second call with the same path returns Left", async () => {
    const id = "01KVE7IDEM";
    const wt = siblingWorktreePath(repoRoot, id);
    const branch = `adw/${id}`;
    const first = await createWorktree(deps, repoRoot, branch, wt).run();
    expect(Either.isRight(first)).toBe(true);
    const second = await createWorktree(deps, repoRoot, branch, wt).run();
    expect(Either.isLeft(second)).toBe(true);
    if (Either.isLeft(second)) expect(second.left).toContain("createWorktree");
  });
});

// ---------------------------------------------------------------------------
// commitSpecToMain — never `git add .`, dirty unrelated files untouched
// ---------------------------------------------------------------------------

describe("commitSpecToMain", () => {
  test("commits only the named spec file; pre-existing dirty files remain untouched", async () => {
    // Add a spec file + a dirty unrelated file.
    mkdirSync(join(repoRoot, "docs", "specs"), { recursive: true });
    const specRel = "docs/specs/SPEC-9999-test.md";
    writeFileSync(join(repoRoot, specRel), "# spec\n");
    writeFileSync(join(repoRoot, "unrelated.txt"), "dirty\n");
    execGit(["add", specRel], repoRoot); // stage the spec

    const headBefore = execGit(["rev-parse", "HEAD"], repoRoot);
    const r = await commitSpecToMain(deps, repoRoot, specRel, "test spec commit").run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.committed).toBe(true);
      expect(r.right.sha).not.toBe(headBefore);

      // Spec is committed on main.
      const onMain = execGit(["log", "main", "--oneline", "--", specRel], repoRoot);
      expect(onMain).toContain("test spec commit");

      // unrelated.txt is NOT committed — still dirty.
      const status = execGit(["status", "--porcelain"], repoRoot);
      expect(status).toContain("unrelated.txt");
      const onMainUnrelated = execGit(["log", "main", "--oneline", "--", "unrelated.txt"], repoRoot);
      expect(onMainUnrelated).toBe("");
    }
  });

  test("unchanged already-committed spec returns committed:false", async () => {
    const specRel = "docs/specs/SPEC-9999-unch.md";
    mkdirSync(join(repoRoot, "docs", "specs"), { recursive: true });
    writeFileSync(join(repoRoot, specRel), "# spec\n");
    execGit(["add", specRel], repoRoot);
    execGit(["commit", "-m", "spec in"], repoRoot);

    const headBefore = execGit(["rev-parse", "HEAD"], repoRoot);
    const r = await commitSpecToMain(deps, repoRoot, specRel, "redundant commit").run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.committed).toBe(false);
      expect(r.right.sha).toBe(headBefore);
    }
  });

  test("rejects absolute paths and traversal paths", async () => {
    const absR = await commitSpecToMain(deps, repoRoot, "/abs/path/spec.md", "x").run();
    expect(Either.isLeft(absR)).toBe(true);
    if (Either.isLeft(absR)) expect(absR.left).toContain("repo-relative");

    const travR = await commitSpecToMain(deps, repoRoot, "../escape.md", "x").run();
    expect(Either.isLeft(travR)).toBe(true);
    if (Either.isLeft(travR)) expect(travR.left).toContain("escape");
  });
});

// ---------------------------------------------------------------------------
// commitWorktreeChanges — turn dirt into branch history
// ---------------------------------------------------------------------------

describe("commitWorktreeChanges", () => {
  test("dirty worktree edits are committed on the worktree branch", async () => {
    const id = "01KVE7WTCM";
    const wt = siblingWorktreePath(repoRoot, id);
    const branch = `adw/${id}`;
    await createWorktree(deps, repoRoot, branch, wt).run();

    // Make a dirty edit in the worktree.
    writeFileSync(join(wt, "new-file.txt"), "implementation\n");

    const headBefore = execGit(["rev-parse", "HEAD"], wt);
    const r = await commitWorktreeChanges(deps, wt, "impl").run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.committed).toBe(true);
      expect(r.right.sha).not.toBe(headBefore);
      // File is on the branch.
      const log = execGit(["log", branch, "--oneline", "--", "new-file.txt"], repoRoot);
      expect(log).toContain("impl");
    }
  });

  test("clean worktree returns committed:false", async () => {
    const id = "01KVE7WTCM2";
    const wt = siblingWorktreePath(repoRoot, id);
    const branch = `adw/${id}`;
    await createWorktree(deps, repoRoot, branch, wt).run();
    const headBefore = execGit(["rev-parse", "HEAD"], wt);
    const r = await commitWorktreeChanges(deps, wt, "noop").run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.committed).toBe(false);
      expect(r.right.sha).toBe(headBefore);
    }
  });
});

// ---------------------------------------------------------------------------
// mergeBranchToMain — dirty-main guard
// ---------------------------------------------------------------------------

describe("mergeBranchToMain", () => {
  test("branch commits land on main after merge", async () => {
    const id = "01KVE7MERG";
    const wt = siblingWorktreePath(repoRoot, id);
    const branch = `adw/${id}`;
    await createWorktree(deps, repoRoot, branch, wt).run();
    writeFileSync(join(wt, "merged.txt"), "x\n");
    await commitWorktreeChanges(deps, wt, "impl before merge").run();

    const r = await mergeBranchToMain(deps, repoRoot, branch, `merge ${branch}`).run();
    expect(Either.isRight(r)).toBe(true);
    const log = execGit(["log", "main", "--oneline"], repoRoot);
    expect(log).toContain(`merge ${branch}`);
    // merged.txt is on main now.
    expect(execGit(["ls-tree", "main", "--name-only"], repoRoot)).toContain("merged.txt");
  });

  test("refuses to checkout/merge when main has unrelated dirty tracked files", async () => {
    const id = "01KVE7DIRT";
    const wt = siblingWorktreePath(repoRoot, id);
    const branch = `adw/${id}`;
    await createWorktree(deps, repoRoot, branch, wt).run();
    writeFileSync(join(wt, "feature.txt"), "x\n");
    await commitWorktreeChanges(deps, wt, "impl").run();

    // Now dirty a TRACKED file on main.
    writeFileSync(join(repoRoot, "README.md"), "# dirty\n");

    const r = await mergeBranchToMain(deps, repoRoot, branch, `merge ${branch}`).run();
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) {
      expect(r.left).toContain("dirty tracked files");
    }
    // README is still the dirty version (no checkout happened).
    expect(readFileSync(join(repoRoot, "README.md"), "utf8")).toBe("# dirty\n");
  });
});

// ---------------------------------------------------------------------------
// removeWorktree — refuse-on-dirty guard
// ---------------------------------------------------------------------------

describe("removeWorktree", () => {
  test("removes cleanly when the worktree is clean", async () => {
    const id = "01KVE7RM1";
    const wt = siblingWorktreePath(repoRoot, id);
    const branch = `adw/${id}`;
    await createWorktree(deps, repoRoot, branch, wt).run();
    const r = await removeWorktree(deps, wt).run();
    expect(Either.isRight(r)).toBe(true);
  });

  test("refuses with Left when the worktree has uncommitted changes", async () => {
    const id = "01KVE7RM2";
    const wt = siblingWorktreePath(repoRoot, id);
    const branch = `adw/${id}`;
    await createWorktree(deps, repoRoot, branch, wt).run();
    writeFileSync(join(wt, "dirty.txt"), "x\n");
    const r = await removeWorktree(deps, wt).run();
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("uncommitted changes");
  });
});

// ---------------------------------------------------------------------------
// listWorktrees — porcelain parsing
// ---------------------------------------------------------------------------

describe("listWorktrees", () => {
  test("parses porcelain output correctly", async () => {
    const id = "01KVE7LIST";
    const wt = siblingWorktreePath(repoRoot, id);
    const branch = `adw/${id}`;
    await createWorktree(deps, repoRoot, branch, wt).run();
    const r = await listWorktrees(deps, repoRoot).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      const paths = r.right.map((e) => e.path);
      expect(paths).toContain(repoRoot);
      expect(paths).toContain(wt);
      const wtEntry = r.right.find((e) => e.path === wt);
      expect(wtEntry?.branch).toContain(branch);
    }
  });
});

// ---------------------------------------------------------------------------
// withPlanningLock — serialization
// ---------------------------------------------------------------------------

describe("withPlanningLock", () => {
  test("two concurrent callers run the critical section serially", async () => {
    const lockPath = defaultLockPath(repoRoot);
    // Short poll interval + hold time so the test stays under bun:test's 5s ceiling.
    const events: string[] = [];
    let inCriticalSection = false;
    let overlap = false;

    const critical = async (label: string): Promise<string> => {
      return withPlanningLock(
        deps,
        repoRoot,
        async () => {
          if (inCriticalSection) overlap = true;
          inCriticalSection = true;
          events.push(`enter ${label}`);
          await new Promise((r) => setTimeout(r, 50));
          events.push(`exit ${label}`);
          inCriticalSection = false;
          return label;
        },
        { lockPath, pollMs: 25 },
      );
    };

    const [a, b] = await Promise.all([critical("A"), critical("B")]);
    expect(a).toBe("A");
    expect(b).toBe("B");
    // The two callers did not overlap.
    expect(overlap).toBe(false);
    // The enter/exit events interleave correctly (no nested enters).
    const enterA = events.indexOf("enter A");
    const exitA = events.indexOf("exit A");
    const enterB = events.indexOf("enter B");
    const exitB = events.indexOf("exit B");
    expect(enterA).toBeGreaterThanOrEqual(0);
    expect(enterB).toBeGreaterThanOrEqual(0);
    // Either A fully before B, or B fully before A.
    const aBeforeB = exitA < enterB;
    const bBeforeA = exitB < enterA;
    expect(aBeforeB || bBeforeA).toBe(true);
  });

  test("releases the lock on success (next caller does not block)", async () => {
    const lockPath = defaultLockPath(repoRoot);
    await withPlanningLock(deps, repoRoot, async () => "first", { lockPath });
    // Should complete immediately (no contention). 5s catches a real deadlock
    // while tolerating scheduler jitter under full-suite load.
    const start = Date.now();
    await withPlanningLock(deps, repoRoot, async () => "second", { lockPath });
    expect(Date.now() - start).toBeLessThan(5000);
  });
});
