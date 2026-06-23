/**
 * worktree.ts — git worktree lifecycle for adw pipeline isolation.
 *
 * Pure functions over an injected `gitRun` (TaskEither shape matching
 * `captureGitTrace`'s `gitRun`). No CLI, no argv — mirrors the builder.ts /
 * agent.ts module convention.
 *
 * Exports:
 *   - detectWorktree(deps, rootPath)              — true when GIT_DIR != GIT_COMMON_DIR (with submodule guard)
 *   - createWorktree(deps, rootPath, branch, wt)  — git worktree add -b <branch> <wt> HEAD
 *   - removeWorktree(deps, worktreePath)          — git worktree remove (refuses dirty)
 *   - commitSpecToMain(deps, root, rel, msg)      — git commit --only <spec> (never `git add .`)
 *   - commitWorktreeChanges(deps, wt, msg)        — git add -A + commit (turns dirt into branch history)
 *   - mergeBranchToMain(deps, root, branch, msg)  — checkout main + merge --no-ff (refuses dirty main)
 *   - withPlanningLock(deps, root, fn)            — repo-local lock for plan/review/spec-commit/worktree
 *   - listWorktrees(deps, rootPath)               — parse `git worktree list --porcelain`
 *
 * Used by adw-plan-review-build-patch.ts (orchestrator) and adw-status.ts
 * (dashboard). Designed to be reusable by Fikra (T-Lisp via shell-command).
 */
import { spawn } from "child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { Either, TaskEither } from "../../src/utils/task-either.ts";

/** Injected subprocess runner: same shape as captureGitTrace's gitRun. */
export type GitRun = (
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> },
) => TaskEither<string, string>;

export interface WorktreeDeps {
  gitRun: GitRun;
  /** Injectable clock for `withPlanningLock` stale detection (default: Date.now). */
  now?: () => number;
}

/** One parsed row of `git worktree list --porcelain`. */
export interface WorktreeEntry {
  path: string;
  head?: string;
  branch?: string;
  locked?: boolean;
}

/** Result of a spec commit attempt: did it actually create a commit? */
export interface CommitResult {
  committed: boolean;
  sha?: string;
}

// ---------------------------------------------------------------------------
// Real subprocess runner (used by the orchestrator + dashboard in production)
// ---------------------------------------------------------------------------

interface RunOpts {
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Spawn, capture stdout/stderr. Returns TaskEither (lazy). Left = non-zero exit;
 * Right = trimmed stdout. Copied from adw-build.ts's run() — the canonical
 * helper for adws dispatchers. Exported so the orchestrator can construct a
 * default WorktreeDeps without duplicating the helper.
 */
export function runGitCmd(cmd: string, args: string[], opts: RunOpts = {}): TaskEither<string, string> {
  return TaskEither.from(async () => {
    return await new Promise<Either<string, string>>((resolve) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer | string) => {
        stdout += typeof c === "string" ? c : c.toString("utf8");
      });
      child.stderr.on("data", (c: Buffer | string) => {
        stderr += typeof c === "string" ? c : c.toString("utf8");
      });
      child.on("error", (e) => resolve(Either.left(`failed to spawn ${cmd}: ${e.message}`)));
      child.on("close", (code) => {
        if (code === 0) resolve(Either.right(stdout.trim()));
        else resolve(Either.left((stderr || stdout).trim() || `${cmd} exited with code ${code}`));
      });
    });
  });
}

// ---------------------------------------------------------------------------
// detectWorktree
// ---------------------------------------------------------------------------

/**
 * True when GIT_DIR and GIT_COMMON_DIR resolve to different paths (the
 * `using-git-worktrees` skill's Step 0 rule) AND the path is not a submodule
 * (show-superproject-working-tree is empty). Never throws — a git failure
 * returns false (the caller will then attempt a worktree creation and surface
 * any real error there).
 */
export function detectWorktree(deps: WorktreeDeps, rootPath: string): TaskEither<string, boolean> {
  return TaskEither.from(async () => {
    const gitDir = await runSafe(deps.gitRun("git", ["rev-parse", "--git-dir"], { cwd: rootPath }));
    const commonDir = await runSafe(deps.gitRun("git", ["rev-parse", "--git-common-dir"], { cwd: rootPath }));
    if (!gitDir || !commonDir) return Either.right(false);
    const gitDirAbs = safeRealpath(gitDir, rootPath);
    const commonAbs = safeRealpath(commonDir, rootPath);
    if (gitDirAbs === commonAbs) return Either.right(false);
    // Submodule guard: if there's a superproject working tree, this is a
    // submodule, not a worktree (the using-git-worktrees skill rule).
    const superproject = await runSafe(
      deps.gitRun("git", ["rev-parse", "--show-superproject-working-tree"], { cwd: rootPath }),
    );
    if (superproject && superproject.trim().length > 0) return Either.right(false);
    return Either.right(true);
  });
}

/** Run a TaskEither to completion and return its value or "" on Left. */
async function runSafe(t: TaskEither<string, string>): Promise<string> {
  const r = await t.run();
  return Either.isRight(r) ? r.right : "";
}

/** Resolve a possibly-relative git path against rootPath, returning the input on failure. */
function safeRealpath(p: string, rootPath: string): string {
  try {
    const abs = existsSync(p) ? p : join(rootPath, p);
    return realpathSync(abs);
  } catch {
    try { return realpathSync(join(rootPath, p)); } catch { return p; }
  }
}

// ---------------------------------------------------------------------------
// createWorktree
// ---------------------------------------------------------------------------

/**
 * `git worktree add -b <branch> <worktreePath> HEAD` run with cwd=rootPath.
 * Returns Right(worktreePath) on success. Left if the worktree already exists
 * or git fails. Path is caller-chosen — sibling (`<repo>.<id>/`) and buried
 * (`.worktrees/<id>/`) layouts both work.
 */
export function createWorktree(
  deps: WorktreeDeps,
  rootPath: string,
  branch: string,
  worktreePath: string,
): TaskEither<string, string> {
  return deps.gitRun("git", ["worktree", "add", "-b", branch, worktreePath, "HEAD"], { cwd: rootPath })
    .mapLeft((e) => `createWorktree(${branch} → ${worktreePath}): ${e}`)
    .map(() => worktreePath);
}

// ---------------------------------------------------------------------------
// removeWorktree
// ---------------------------------------------------------------------------

/**
 * `git worktree remove <worktreePath>`. Refuses with Left when the worktree
 * has uncommitted changes (the same guard tmax-spec-loop's run.ts uses). Force
 * is intentionally NOT applied — losing work silently is worse than refusing.
 */
export function removeWorktree(deps: WorktreeDeps, worktreePath: string): TaskEither<string, void> {
  return TaskEither.from(async () => {
    const statusR = await deps.gitRun("git", ["status", "--porcelain"], { cwd: worktreePath }).run();
    if (Either.isLeft(statusR)) {
      return Either.left(`removeWorktree(${worktreePath}): ${statusR.left}`);
    }
    if (statusR.right.trim().length > 0) {
      return Either.left(
        `removeWorktree(${worktreePath}): worktree has uncommitted changes; refusing to delete. Commit or stash first.`,
      );
    }
    const rmR = await deps.gitRun("git", ["worktree", "remove", worktreePath], { cwd: worktreePath }).run();
    if (Either.isLeft(rmR)) {
      return Either.left(`removeWorktree(${worktreePath}): ${rmR.left}`);
    }
    return Either.right(undefined);
  });
}

// ---------------------------------------------------------------------------
// commitSpecToMain — commit ONLY the named spec file (never `git add .`)
// ---------------------------------------------------------------------------

/**
 * Commit only the named spec file to the current branch (intended: main).
 *
 * - Reject absolute paths and paths that escape the repo.
 * - If the spec has no staged or unstaged diff against HEAD, return
 *   `{ committed: false, sha: <HEAD> }` (no-op, not an error).
 * - Otherwise run `git add -- <specRelPath>` for that path only, then
 *   `git commit --only -m <message> -- <specRelPath>`. The `--only` flag
 *   guarantees unrelated pre-staged files are not swept into the spec commit.
 *
 * Never runs `git add .`, never unstages the user's existing index, and never
 * fails merely because unrelated paths are dirty or pre-staged.
 */
export function commitSpecToMain(
  deps: WorktreeDeps,
  rootPath: string,
  specRelPath: string,
  message: string,
): TaskEither<string, CommitResult> {
  // Reject absolute paths or traversals outside the repo.
  if (specRelPath.startsWith("/")) {
    return TaskEither.left(`commitSpecToMain: spec path must be repo-relative (got "${specRelPath}")`);
  }
  if (specRelPath.includes("..")) {
    return TaskEither.left(`commitSpecToMain: spec path must not escape the repo (got "${specRelPath}")`);
  }
  const gitRun = deps.gitRun;
  const tag = (s: string) => `commitSpecToMain(${specRelPath}): ${s}`;
  return TaskEither.from(async () => {
    const headR = await gitRun("git", ["rev-parse", "HEAD"], { cwd: rootPath }).run();
    if (Either.isLeft(headR)) return Either.left(tag(`HEAD lookup failed: ${headR.left}`));
    const headSha = headR.right;

    // Diff vs HEAD (unstaged + staged in one).
    const diffR = await gitRun("git", ["diff", "--name-only", "HEAD", "--", specRelPath], { cwd: rootPath }).run();
    if (Either.isLeft(diffR)) return Either.left(tag(diffR.left));
    const diffName = diffR.right;

    const stagedR = await gitRun("git", ["diff", "--cached", "--name-only", "--", specRelPath], { cwd: rootPath }).run();
    if (Either.isLeft(stagedR)) return Either.left(tag(stagedR.left));
    const stagedName = stagedR.right;

    // Tracked check: ls-files --error-unmatch exits non-zero if the file isn't tracked.
    // We don't treat that as an error — it just means "untracked new file".
    const trackedR = await gitRun("git", ["ls-files", "--error-unmatch", specRelPath], { cwd: rootPath }).run();
    const isTracked = Either.isRight(trackedR);

    const hasUnstagedOrStaged = (diffName + stagedName).trim().length > 0;
    const isUntrackedNew = !isTracked && existsSync(join(rootPath, specRelPath));
    if (!hasUnstagedOrStaged && !isUntrackedNew) {
      return Either.right({ committed: false, sha: headSha });
    }
    // Add only this path, then commit --only (never `git add .`).
    const addR = await gitRun("git", ["add", "--", specRelPath], { cwd: rootPath }).run();
    if (Either.isLeft(addR)) return Either.left(tag(addR.left));
    const commitR = await gitRun("git", ["commit", "--only", "-m", message, "--", specRelPath], { cwd: rootPath }).run();
    if (Either.isLeft(commitR)) return Either.left(tag(commitR.left));
    const newShaR = await gitRun("git", ["rev-parse", "HEAD"], { cwd: rootPath }).run();
    if (Either.isLeft(newShaR)) return Either.left(tag(`post-commit HEAD lookup failed: ${newShaR.left}`));
    return Either.right({ committed: true, sha: newShaR.right });
  });
}

// ---------------------------------------------------------------------------
// commitWorktreeChanges — turn successful-build dirt into branch history
// ---------------------------------------------------------------------------

/**
 * Commit ALL changes in the worktree (git add -A + git commit). Returns
 * `{ committed: false }` when the worktree is clean. This is the only step
 * that turns implementation edits into branch history — mergeBranchToMain()
 * and remote fetchFromRemote() consume this commit, not uncommitted files.
 *
 * Unlike commitSpecToMain, this DOES use `git add -A` because the worktree is
 * the pipeline's own scratch space: every change in it was made by the build.
 */
export function commitWorktreeChanges(
  deps: WorktreeDeps,
  worktreePath: string,
  message: string,
): TaskEither<string, CommitResult> {
  const gitRun = deps.gitRun;
  return gitRun("git", ["status", "--porcelain"], { cwd: worktreePath }).flatMap((status) => {
    if (status.trim().length === 0) {
      return gitRun("git", ["rev-parse", "HEAD"], { cwd: worktreePath }).map((sha) => ({
        committed: false,
        sha,
      }));
    }
    return gitRun("git", ["add", "-A"], { cwd: worktreePath })
      .flatMap(() => gitRun("git", ["commit", "-m", message], { cwd: worktreePath }))
      .flatMap(() =>
        gitRun("git", ["rev-parse", "HEAD"], { cwd: worktreePath }).map((sha) => ({ committed: true, sha })),
      );
  }).mapLeft((e) => `commitWorktreeChanges(${worktreePath}): ${e}`);
}

// ---------------------------------------------------------------------------
// mergeBranchToMain — checkout main, merge --no-ff
// ---------------------------------------------------------------------------

/**
 * Guard that main has no unrelated dirty tracked files before a merge. Returns
 * the porcelain output (string) on Right, or Left with a clear message.
 *
 * Untracked files are allowed (they shouldn't block a merge). Pre-staged paths
 * are also allowed — the merge will commit on top of them as long as they
 * don't collide with the merged content.
 */
function assertMainCleanForMerge(gitRun: GitRun, rootPath: string): TaskEither<string, string> {
  return gitRun("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: rootPath }).flatMap((out) => {
    if (out.trim().length > 0) {
      return TaskEither.left(
        `mergeBranchToMain: main has dirty tracked files (run \`git status\` in ${rootPath}); refusing to checkout/merge: ${out.trim().split("\n").slice(0, 5).join(" | ")}`,
      );
    }
    return TaskEither.right(out);
  });
}

/** Get the current branch name (or detached-HEAD sha). Empty string on failure. */
function currentBranch(gitRun: GitRun, rootPath: string): TaskEither<string, string> {
  return gitRun("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: rootPath });
}

/**
 * Merge `branch` into main with --no-ff. Steps:
 *   1. Verify main is clean of unrelated tracked dirty files.
 *   2. Record the current branch.
 *   3. git checkout main
 *   4. git merge --no-ff <branch> -m <message>
 *   5. Restore the recorded branch.
 *
 * On checkout or merge failure, returns Left with the failed step. Does NOT
 * run `git checkout -` (which can fail and lose context). The recorded branch
 * is restored only when checkout succeeded; on merge failure the user is left
 * on `main` with the conflict surface intact for manual resolution.
 */
export function mergeBranchToMain(
  deps: WorktreeDeps,
  rootPath: string,
  branch: string,
  message: string,
): TaskEither<string, { sha: string }> {
  const gitRun = deps.gitRun;
  return assertMainCleanForMerge(gitRun, rootPath)
    .flatMap(() => currentBranch(gitRun, rootPath))
    .flatMap((originalBranch) =>
      gitRun("git", ["checkout", "main"], { cwd: rootPath })
        .mapLeft((e) => `mergeBranchToMain: git checkout main failed: ${e}`)
        .flatMap(() =>
          gitRun("git", ["merge", "--no-ff", branch, "-m", message], { cwd: rootPath })
            .mapLeft((e) => `mergeBranchToMain: git merge --no-ff ${branch} failed (conflict?): ${e}`)
            .flatMap(() =>
              // Restore the original branch only when both checkout and merge
              // succeeded. On merge failure we returned Left above (no restore).
              gitRun("git", ["checkout", originalBranch || "main"], { cwd: rootPath })
                .mapLeft((e) => `mergeBranchToMain: restore to ${originalBranch} failed: ${e}`)
                .flatMap(() =>
                  gitRun("git", ["rev-parse", "HEAD"], { cwd: rootPath }).map((sha) => ({ sha })),
                ),
            ),
        ),
    );
}

// ---------------------------------------------------------------------------
// listWorktrees — parse `git worktree list --porcelain`
// ---------------------------------------------------------------------------

/**
 * Parse `git worktree list --porcelain` into structured rows. Porcelain format:
 *
 *   worktree /abs/path
 *   HEAD <sha>
 *   branch refs/heads/<name>
 *   [locked]
 *   <blank line>
 *
 * Returns [] on git failure (best-effort — the dashboard tolerates this).
 */
export function listWorktrees(deps: WorktreeDeps, rootPath: string): TaskEither<string, WorktreeEntry[]> {
  return deps.gitRun("git", ["worktree", "list", "--porcelain"], { cwd: rootPath }).map((out) => {
    const entries: WorktreeEntry[] = [];
    let current: WorktreeEntry | null = null;
    for (const raw of out.split("\n")) {
      const line = raw.trimEnd();
      if (line.length === 0) {
        if (current) { entries.push(current); current = null; }
        continue;
      }
      if (line.startsWith("worktree ")) {
        if (current) entries.push(current);
        current = { path: line.slice("worktree ".length) };
      } else if (line.startsWith("HEAD ") && current) {
        current.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ") && current) {
        current.branch = line.slice("branch ".length);
      } else if (line === "locked" && current) {
        current.locked = true;
      }
    }
    if (current) entries.push(current);
    return entries;
  });
}

// ---------------------------------------------------------------------------
// withPlanningLock — serialize plan + spec-review + spec-commit + worktree
// ---------------------------------------------------------------------------

/**
 * Default stale-lock window: 10 minutes. Older locks are considered stale
 * (likely abandoned by a crashed process) and forcibly released. The window is
 * intentionally generous — the planning critical section rarely takes more than
 * a few minutes, but codex review on a large spec can take 5-10 minutes.
 */
const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1000;

/** Default lock file path under the repo's .git directory. */
export function defaultLockPath(rootPath: string): string {
  // .git/adw-plan.lock — survives as long as the repo's git dir does.
  // For worktrees, `git rev-parse --git-dir` returns the per-worktree path;
  // we want the COMMON dir so concurrent runs share one lock. Caller passes
  // rootPath; we use `<root>/.git/adw-plan.lock` and accept that on a worktree
  // it's per-worktree (the orchestrator only takes the lock from PROJECT_ROOT
  // which is always the main checkout).
  return join(rootPath, ".git", "adw-plan.lock");
}

/**
 * Run `fn` while holding a repo-local lock. Uses an O_EXCL atomic file create
 * on `<root>/.git/adw-plan.lock` — POSIX guarantees atomicity when O_CREAT and
 * O_EXCL are both set. The lock file records the holding pid + ms-since-epoch
 * so a stale lock from a crashed holder can be detected and forcibly released.
 *
 * Stale handling: if the lock exists and is older than `staleMs`, it is
 * unlinked and re-acquired. This is conservative: the only way a lock becomes
 * stale is if the holder crashed without unlinking, in which case the holder
 * is gone and the lock is safe to take.
 *
 * Returns fn's result. The lock is always released in finally.
 */
export async function withPlanningLock<T>(
  deps: WorktreeDeps,
  rootPath: string,
  fn: () => Promise<T>,
  opts: { lockPath?: string; staleMs?: number; pollMs?: number; deadlineMs?: number } = {},
): Promise<T> {
  const lockPath = opts.lockPath ?? defaultLockPath(rootPath);
  const staleMs = opts.staleMs ?? DEFAULT_STALE_LOCK_MS;
  const pollMs = opts.pollMs ?? 5000;
  const deadlineMs = opts.deadlineMs ?? 5 * 60 * 1000;
  const now = deps.now ?? (() => Date.now());

  // Ensure the parent dir exists (.git/ may not exist yet in a brand-new repo).
  try {
    mkdirSync(join(lockPath, ".."), { recursive: true });
  } catch { /* best-effort — the open() below will surface the real error */ }

  // Try to acquire. On failure, inspect the lock's mtime; if stale, unlink and
  // retry once. If still fresh, poll up to deadlineMs (pollMs backoff).
  await acquireLock(lockPath, now, staleMs, pollMs, deadlineMs);
  try {
    return await fn();
  } finally {
    try { unlinkSync(lockPath); } catch { /* already gone — fine */ }
  }
}

/** Atomic O_EXCL create. Throws on failure (caller decides retry/forfeit). */
function tryCreateLock(lockPath: string, holderPid: number, ms: number): boolean {
  try {
    // O_EXCL ensures only one process can create the file.
    const fd = openSync(lockPath, "wx" as const, 0o644);
    writeFileSync(fd, `${holderPid}\n${ms}\n`);
    closeSync(fd);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return false;
    throw e;
  }
}

/** Read the timestamp from an existing lock file. Returns null if unreadable. */
function readLockTimestamp(lockPath: string): number | null {
  try {
    const text = readFileSync(lockPath, "utf8");
    const lines = text.split("\n");
    const ms = parseInt(lines[1] ?? "", 10);
    return isNaN(ms) ? null : ms;
  } catch {
    return null;
  }
}

async function acquireLock(
  lockPath: string,
  now: () => number,
  staleMs: number,
  pollMs: number,
  deadlineMs: number,
): Promise<void> {
  const holderPid = process.pid;
  const deadline = now() + deadlineMs;
  while (now() < deadline) {
    if (tryCreateLock(lockPath, holderPid, now())) return;
    // Lock exists — check staleness.
    const ts = readLockTimestamp(lockPath);
    if (ts !== null && now() - ts > staleMs) {
      try {
        unlinkSync(lockPath);
        // Loop again — re-attempt the create immediately.
        continue;
      } catch { /* unlink failed — fall through to sleep */ }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`withPlanningLock: timed out waiting for ${lockPath} (stale lock? holder crashed?)`);
}

// ---------------------------------------------------------------------------
// Sibling path helper
// ---------------------------------------------------------------------------

/**
 * Compute the sibling worktree path for a given repo root + workspace id:
 *   <dirname(root)>/<basename(root)>.<id>
 *
 * Example:
 *   rootPath = /Users/mekael/Documents/programming/typescript/tmax
 *   id       = 01KVE7NV2P
 *   → /Users/mekael/Documents/programming/typescript/tmax.01KVE7NV2P
 *
 * Used by the orchestrator and the remote-dispatch seed step.
 */
export function siblingWorktreePath(rootPath: string, id: string): string {
  const parent = join(rootPath, "..");
  const base = rootPath.split("/").filter(Boolean).pop() ?? "repo";
  // join("..", base) — preserve the parent dir's resolution.
  const parentAbs = realpathSync(parent);
  return join(parentAbs, `${base}.${id}`);
}

// Re-export so callers don't import the runGitCmd helper from inside this module
// by inference. The orchestrator builds the default WorktreeDeps:
//   const worktreeDeps: WorktreeDeps = { gitRun: runGitCmd };
export { runGitCmd as defaultGitRun };
