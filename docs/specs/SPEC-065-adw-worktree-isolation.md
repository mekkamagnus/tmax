# Feature: adw Worktree Isolation, Status Dashboard & Remote Dispatch

## Feature Description

**adw worktree isolation** gives each adw pipeline run its own git worktree on its own branch, so multiple pipelines can run concurrently on the same machine without clobbering each other's files. **A live status dashboard** (`adw-status.ts`) shows every active worktree and its current stage/idle state. **Remote dispatch** lets a pipeline be offloaded to a machine in `~/.ssh/config` (the `mekkapi` Pi, a DigitalOcean droplet) by pushing its branch and running it there.

Today every adw stage runs with `cwd: PROJECT_ROOT` (the single checkout on `main`). Launching two pipelines simultaneously means two agents editing the same working tree — collision is guaranteed, not theoretical. This spec adds a worktree layer: the plan stage, spec-review stage, and spec commit are serialized in `main` (so the reviewed spec lands visibly on main, per the user requirement), then the orchestrator creates a sibling worktree on branch `adw/<adw-id>`, and build/test/patch-review all execute inside that worktree. A new `adw-status.ts` dashboard reads every workspace's `adw-state.json` + latest event and renders an at-a-glance table of all concurrent runs. A `--remote <host>` flag runs local setup through this same serialized plan/spec-review/spec-commit/worktree phase, pushes the created branch to a configured SSH git remote, and starts the resumed pipeline remotely via tmux.

This is the settled 2026 community pattern for parallel AI coding agents — see `docs/memos/parallel-ai-agents-worktree-overview.md` for the landscape. It is also already proven in this repo by `tmax-spec-loop`, which uses git worktrees on dedicated branches. adw adopts the same convention with three differences: **(1) sibling worktrees** placed beside the repo rather than buried in a hidden dir (matching the Worktrunk/`wt` CLI convention and `openchamber/openchamber` PR #1499), **(2) specs land on `main` first** (per the user visibility requirement), and **(3) the status dashboard** makes the fleet of concurrent runs observable from any terminal (RFC-020 item D, promoted into this spec).

## User Story

As a **developer running multiple adw pipelines at once, dispatching one to a remote machine, and watching them all from one terminal**
I want **each pipeline in its own sibling git worktree, a dashboard showing every run's stage and idle/working state, and the ability to push a pipeline to a configured SSH host**
So that **concurrent agents never clobber each other, I can see what's happening across local + remote runs without attaching tmux, main stays reviewable, and I can offload compute to `mekkapi` or a droplet.**

## Problem Statement

The adw pipeline has process isolation (one tmux window per pipeline via `adw-launch.ts`) but **no file isolation**. Every stage subprocess is spawned with `cwd: PROJECT_ROOT`:

- `adw-plan-review-build-patch.ts:360` — `spawnStage` sets `cwd: PROJECT_ROOT` for every child stage.
- `adw-build.ts:487,509,519,539` — `ensureAvailable`, `build`, `captureGitTrace`, and `runE2eGate` all pass `PROJECT_ROOT` as `cwd`.
- The same pattern repeats in `adw-spec-review.ts`, `adw-test.ts`, and `adw-patch-review.ts`.

Four concrete consequences:

1. **Concurrent pipelines collide.** Two `adw-launch.ts "<desc>"` runs in parallel both edit the same working tree on `main`. Whichever commits first, the second sees a dirty tree and may commit the first's half-finished work.
2. **Pipelines dirty `main` directly.** A build that fails mid-`/implement` leaves uncommitted edits on `main` that the user must clean up by hand.
3. **No fleet view.** RFC-020 item D (deferred there as a standalone follow-up) identified the operator need: "check on a run without taking over the tmux pane." With concurrent runs this becomes "check on *all* runs." Today there is no way to see, from one terminal, which worktrees exist, which stage each is in, and which are idle vs actively working.
4. **No offload path.** Dispatching a pipeline to `mekkapi` or a droplet requires a branch to push; today there is no per-run branch, and no SSH-aware dispatch.
5. **The hidden worktree-awareness bug class.** As the rjmurillo/ai-agents PRs (#2251, #2412) demonstrate, any automation that assumes a single checkout — git hooks, test runners keyed off `PROJECT_ROOT`, state-file paths — breaks the moment multiple worktrees exist. The fix must thread a per-worktree `cwd` through every subprocess, not just add `git worktree add`.

## Solution Statement

Four parts, each independently valuable:

**1. Plan + spec-review run in `main`; the reviewed spec lands on `main` first.** The plan stage already creates `docs/specs/{SPEC,BUG,CHORE}-*.md`, and spec-review may mutate that spec before implementation. The orchestrator takes a repo-local lock before planning, reviewing/upgrading the spec, committing the reviewed spec, and creating the worktree; concurrent fresh launches wait for this critical section rather than racing in the shared checkout. After spec-review succeeds (or is skipped for spec-path input), the orchestrator commits *only that spec file* to `main` (never the user's other dirty files) before creating the worktree. This satisfies the user's requirement that specs stay visible in the main directory and avoids a split-brain where spec-review edits a worktree copy that main never sees. **Stage ordering is explicit:** plan and spec-review ALWAYS run in the main checkout (they mutate the spec, which must land on main). Only build, test, and patch-review run inside the worktree — they operate on the code, not the spec.

**2. Sibling worktrees — one per workspace id, placed beside the repo.** The orchestrator creates `<repo>.<adw-id>/` (sibling of the repo, e.g. `/Users/mekael/Documents/programming/typescript/tmax.01KVE7NV2P/`) on branch `adw/<adw-id>` after the spec lands and review completes. This matches the Worktrunk/`wt` convention and the `openchamber/openchamber` "Create Worktrees as Siblings" preference (PR #1499): worktrees sit next to the repo where `ls` shows them, rather than buried in a hidden `.worktrees/` dir that's easy to forget and hard to `cd` into. A `.worktrees/`-style buried layout remains supported as a fallback for users who prefer it. **The worktree is created for ALL fresh runs** — both description-mode (plan creates a new spec) and spec-path-mode (the spec already exists). In both cases, build/test/patch-review need isolation from concurrent runs.

**3. Commit lifecycle — build results land on the branch, not as dirt.** When a pipeline run succeeds (patch-review returns `pass`), the orchestrator commits ALL changes in the worktree to the `adw/<id>` branch via `commitWorktreeChanges(deps, worktreePath, "adw <id>: <spec> — build complete")`. This ensures `mergeBranchToMain()` and remote `git fetch` see committed history, not uncommitted dirt. Without this step, a successful build's changes would be invisible to merge and remote fetch. The commit happens in `finalize()` before any merge or worktree removal.

**4. Status dashboard — `bun adws/adw-status.ts`.** A new script (RFC-020 item D, promoted into this spec) that scans `agents/*/adw-state.json` + each workspace's latest orchestrator event, joins with `git worktree list`, and prints a live table: workspace id, spec, current stage, elapsed since last event, and an **idle/working state** derived from event timestamps (working = a structured event or heartbeat event in the last 2 minutes; idle = older; done = `status: completed`). `--watch` re-renders every few seconds. This is the fleet view that makes concurrent runs observable.

**5. Remote dispatch — `--remote <host>` with a defined `--setup-only` API.** A flag on `adw-launch.ts` that reads the SSH host from `~/.ssh/config`, runs the local plan/spec-review/spec-commit/worktree setup first (via a new `--setup-only` orchestrator flag that exits after worktree creation), then pushes the committed `adw/<id>` branch to a configured git remote URL for the host, copies the gitignored `agents/<id>/` state over SSH/scp/rsync, and runs `adw-launch.ts --resume <id>` there inside tmux over SSH. The `--setup-only` flag is the concrete API: `bun adws/adw-plan-review-build-patch.ts --setup-only <spec>` runs plan + review + spec-commit + worktree-creation, writes `adw-state.json` with `status: setup-complete`, and exits with stdout `<id> <spec-path>`. The `--remote` flag in `adw-launch.ts` calls `--setup-only`, then pushes + dispatches. `--remote-dry-run` validates the push/dispatch commands without executing them (for CI/testability).

**Env-var handoff** is the single injection point for worktree isolation: the orchestrator passes `ADW_WORKTREE=<absolute-path>` to every child stage subprocess; children read `process.env.ADW_WORKTREE ?? PROJECT_ROOT` as their execution `cwd`. Workspace state stores `spec_path` as a repo-relative path such as `docs/specs/SPEC-065-adw-worktree-isolation.md`; when `ADW_WORKTREE` is set, the orchestrator passes the worktree-local absolute spec path (`join(ADW_WORKTREE, state.spec_path)`) to child subprocess argv and agent prompts. `PROJECT_ROOT` remains the home for `agents/` state and id lookup. One env var covers every stage and composes with remote dispatch (the orchestrator on the remote sets the same env var).

## Relevant Files

Use these files to implement the feature:

### New Files

- **`adws/adws-modules/worktree.ts`** — worktree lifecycle module. Pure functions over an injected `gitRun` (same `TaskEither` shape as `captureGitTrace`'s `gitRun`). Exports: `createWorktree(deps, rootPath, branch, worktreePath)`, `removeWorktree(deps, worktreePath)`, `commitSpecToMain(deps, rootPath, specRelPath, message)`, `commitWorktreeChanges(deps, worktreePath, message)` (commits successful implementation dirt on `adw/<id>` before merge/fetch), `mergeBranchToMain(deps, rootPath, branch)`, `detectWorktree(deps, rootPath)` predicate (true when `GIT_DIR != GIT_COMMON_DIR`, per the `using-git-worktrees` skill's Step 0, with the submodule guard), `withPlanningLock(deps, rootPath, fn)` (serializes plan + spec-review + spec commit + worktree creation), and `listWorktrees(deps, rootPath)` (parses `git worktree list --porcelain`). No CLI, no argv — mirrors the `builder.ts`/`agent.ts` module convention.
- **`adws/adw-status.ts`** — the status dashboard (RFC-020 item D, promoted here). Reads `agents/*/adw-state.json`, the latest line of each workspace's `orchestrator/events.jsonl`, and `git worktree list`; prints a table. Flags: `--id <id>` (single workspace), `--watch` (re-render every N seconds), `--remote` (also query configured SSH hosts via SSH/scp/rsync because `agents/` is gitignored). Pure rendering functions exported for unit testing.
- **`adws/adws-modules/remote.ts`** — remote dispatch module. Exports `listSshHosts()` (parses `~/.ssh/config` for `Host` + `HostName` pairs), `ensureGitRemote(deps, host, remoteRepoPath)`, `pushToRemote(deps, remoteName, branch)`, `dispatchToRemote(deps, host, id, repoPath)`, `fetchFromRemote(deps, remoteName, branch)`, and `queryRemoteStatus(deps, host, id, repoPath)` (SSH/scp/rsync state transport, not git). No CLI, no argv.
- **`test/unit/worktree.test.ts`** — worktree lifecycle against a temp git fixture (create sibling + buried layouts, detect, commit-spec, merge, remove, list, uncommitted-changes refusal guard).
- **`test/unit/adw-status.test.ts`** — dashboard rendering against fixture `agents/` + worktree list (idle/working/done state derivation, elapsed math, table format).
- **`test/unit/remote.test.ts`** — SSH config parsing + the dispatch/fetch command construction against a fake host list.

### Existing Files to Modify

- **`adws/adw-plan-review-build-patch.ts`** — the orchestrator. Four changes:
  - Wrap fresh planning, spec-review, spec commit, and worktree creation in `withPlanningLock`, so same-time launches cannot plan/review/commit specs in the shared main checkout concurrently.
  - After spec-review succeeds: store the reviewed spec as a repo-relative path, call `commitSpecToMain` to land the spec on main, then `createWorktree` to create the sibling worktree on `adw/<id>`.
  - In `spawnStage` (line 358-372): pass `ADW_WORKTREE` env var to children when a worktree exists, and pass the worktree-local absolute spec path to child argv/prompts. Change the `env` spread from `{ ...process.env, ADW_ORCHESTRATED: "1" }` to `{ ...process.env, ADW_ORCHESTRATED: "1", ...(worktreePath ? { ADW_WORKTREE: worktreePath } : {}) }`.
  - On successful completion before `finalize`: call `commitWorktreeChanges` in the worktree so implementation edits become committed history on `adw/<id>`. `mergeBranchToMain()` and remote `git fetch` must never be expected to see uncommitted worktree dirt. If there are no changes, record `implementation_commit: null` and continue.
  - On `finalize`: optionally merge (when `--merge` given), record `worktree_path` + `branch` + `host` (when remote) + `implementation_commit` in `adw-state.json` for resume + status dashboard.
  - Add structured heartbeat events at each stage boundary: when a stage is `working`, the orchestrator appends a `heartbeat` event to `orchestrator/events.jsonl` every 15-30s (RFC-020 item B, already approved in SPEC-062 for single runs; reused here so the dashboard's idle/working derivation has a signal). The existing `withHeartbeat` stderr lines are not sufficient for the dashboard.
- **`adws/adw-build.ts`** — resolve `cwd` from env. Hoist `const cwd = process.env.ADW_WORKTREE ?? PROJECT_ROOT;` near the top of `runBuild`. Replace the four `PROJECT_ROOT` execution-call sites at lines 487, 509, 519, 539 with `cwd`. Leave `resolveInput`, `AGENTS_DIR`, and `SPECS_DIR` on `PROJECT_ROOT`; the input spec should already be a worktree-local absolute path when `ADW_WORKTREE` is set, while state stores the repo-relative `spec_path`.
- **`adws/adw-spec-review.ts`**, **`adws/adw-test.ts`**, **`adws/adw-patch-review.ts`** — same `const cwd = process.env.ADW_WORKTREE ?? PROJECT_ROOT;` change for their execution spawns.
- **`adws/adw-launch.ts`** — add `--merge` pass-through, add `--remote <host>` flag (consumed by the launcher: perform local setup, push the created branch, copy/seed remote state, and SSH the resumed command to the remote), and document both in the USAGE comment.
- **`.gitignore`** — add the sibling-worktree pattern. Worktrees created at `<repo>.<id>/` sit *outside* the repo dir, so they don't need gitignoring; but if any are accidentally created inside (e.g. during testing), the existing `.worktrees/` line covers them. Add a comment documenting the sibling convention.
- **`docs/memos/parallel-ai-agents-worktree-overview.md`** — already written; add a note on the sibling-vs-buried decision (sibling chosen for this repo).

### Existing Files to Read (reference, not modify)

- **`.zcode/skills/tmax-spec-loop/scripts/run.ts`** — the proven worktree pattern in this repo. `git worktree add -b <branch> <wt> HEAD` (line 281), the "refuse to delete with uncommitted changes" guard, and the `WORKTREES_DIR` convention. Adapt, don't duplicate.
- **`adws/adws-modules/workspace.ts`** — `findWorkspaceBySpecPath` shows the existing agents-dir discovery pattern the worktree module and status dashboard should match.
- **`adws/adws-modules/builder.ts`** — the injected-`deps` + `TaskEither` module convention that `worktree.ts` and `remote.ts` must follow.
- **`docs/rfcs/RFC-020-adw-observability.md`** — the status dashboard (item D) and heartbeat (item B) designs that this spec promotes into implementation.
- **`docs/specs/SPEC-042-fikra-ai-harness.md`** — Fikra's Phase 4 worktree isolation (`fikra-worktree.tlisp`) is the future consumer of this module's primitives. The worktree module here is designed to be reusable by both adw (TypeScript) and Fikra (T-Lisp via `shell-command`).

## Implementation Plan

### Phase 1: Foundation — worktree module + detection + status dashboard

Build `worktree.ts` and `adw-status.ts` as pure, injectable modules before touching any orchestrator code. This isolates the git mechanics and makes them unit-testable against a temp repo, matching the `builder.ts`/`agent.ts` convention. The status dashboard is built here too because it reads the same `agents/*/adw-state.json` + `git worktree list` signals that the orchestrator will soon populate with `worktree_path` + `branch`. Land the dashboard first against current (worktree-less) state, then it lights up automatically once Phase 2 adds the worktree fields.

### Phase 2: Core Implementation — orchestrator integration

Thread the worktree through the orchestrator. A fresh run takes the planning lock, runs plan in main, runs spec-review in main against the main checkout's spec, commits the reviewed spec to main, creates the sibling worktree, then releases the lock before build/test/patch-review continue in the worktree. State stores `spec_path` repo-relative; build/test/patch-review subprocesses receive worktree-local absolute spec paths when `ADW_WORKTREE` is set. Spec-review never receives `ADW_WORKTREE` during fresh setup because it intentionally mutates the main spec that will be committed. Backward compatibility: when `ADW_WORKTREE` is unset (standalone `adw-build.ts <spec>` invocations), every stage falls back to `PROJECT_ROOT` and behaves exactly as today.

### Phase 3: Integration — merge-on-success + state recording

Record `worktree_path`, `branch`, `implementation_commit`, and `host` in `adw-state.json` so resume works correctly (resume re-uses the existing worktree rather than creating a new one) and the status dashboard can show remote runs. After build/test/patch-review all succeed, commit any remaining implementation changes in the worktree to `adw/<id>` before merge or remote fetch. Add the optional `--merge` flag for pipelines that should land on main automatically; default off so the user reviews every merge.

### Phase 4: Remote dispatch — SSH host offload

Build `remote.ts` and the `--remote <host>` flag. The launcher runs local setup first by invoking the orchestrator's `--setup-only` mode (plan/spec-review/spec commit/worktree/branch), ensures a git remote such as `adw-mekkapi` points at `<host>:<ADW_REMOTE_REPO_PATH>`, pushes `adw/<id>`, then SSHes the resumed pipeline command to the remote. The status dashboard's `--remote` mode queries gitignored state files explicitly over SSH/scp/rsync; it never assumes `agents/{id}/adw-state.json` travels in git.

## Step by Step Tasks

### 1. Worktree module: `adws/adws-modules/worktree.ts`

- Create the module with the injected-`deps` convention (import `TaskEither` from `../../src/utils/task-either.ts`; define `WorktreeDeps` with a `gitRun` matching `captureGitTrace`'s signature). Keep this separate from the orchestrator's existing `PipelineDeps`; the orchestrator will receive both `PipelineDeps` (stage runners) and `WorktreeDeps` (git/worktree operations) rather than pretending stage-runner mocks can run git.
- Implement `detectWorktree(deps, rootPath)`: returns `true` when `git rev-parse --git-dir` and `--git-common-dir` resolve to different paths (the `using-git-worktrees` Step 0 rule), AND `git rev-parse --show-superproject-working-tree` is empty (submodule guard). It uses injected `deps.gitRun`; do not shell out directly from this one function.
- Implement `createWorktree(deps, rootPath, branch, worktreePath)`: `git worktree add -b <branch> <worktreePath> HEAD` run with `cwd: rootPath`. Returns `TaskEither<string, string>` (Right = the worktree path). Left if the worktree already exists or git fails. Supports both sibling paths (`<repo>.<id>/`, outside the repo) and buried paths (`.worktrees/<id>/`, inside the repo) — the path is caller-chosen; the module doesn't care.
- Implement `commitSpecToMain(deps, rootPath, specRelPath, message)`: `git add -- <specRelPath>` (only the repo-relative spec file, never `git add .`), then `git commit -m <message>`. Returns `TaskEither`. Never touches other dirty files. Reject absolute paths or paths outside the repo.
- Implement `commitWorktreeChanges(deps, worktreePath, message)`: run `git status --porcelain` in the worktree. If clean, return Right with `{ committed: false }`. If dirty, run `git add -A` and `git commit -m <message>` in the worktree, then return Right with `{ committed: true, sha }`. This is the only step that turns implementation edits into branch history; `mergeBranchToMain()` and remote `fetchFromRemote()` consume this commit, not uncommitted files.
- Implement `mergeBranchToMain(deps, rootPath, branch)`: first guard that `git status --porcelain --untracked-files=no` has no tracked dirty files outside allowed spec-path changes; if main has unrelated dirty tracked files, return Left before checkout. Then record the current branch, run `git checkout main`, `git merge --no-ff <branch> -m <message>`, and restore the recorded branch only if checkout succeeded. On checkout/merge failure, return Left with the exact failed step and leave user files untouched; do not run `git checkout -`.
- Implement `withPlanningLock(deps, rootPath, fn)`: serialize plan + spec-review + spec commit + worktree creation using a repo-local lock such as `.git/adw-plan.lock` or another atomic lock under the git common dir. Stale lock handling must be explicit and conservative.
- Implement `removeWorktree(deps, worktreePath)`: `git worktree remove <worktreePath>`. Guard: refuse with a clear Left if the worktree has uncommitted changes.
- Implement `listWorktrees(deps, rootPath)`: parse `git worktree list --porcelain` into `{ path, branch, head, locked }[]`. Used by the status dashboard.

### 2. Worktree unit tests: `test/unit/worktree.test.ts`

- Fixture: `beforeEach` creates a temp dir, `git init`, configures user, writes a file, commits.
- Test `detectWorktree`: false on a normal repo, true inside a worktree.
- Test `createWorktree` sibling layout: path outside the repo (`<temp>/repo.<id>/`), the branch exists, `git worktree list --porcelain` includes it.
- Test `createWorktree` buried layout: path inside the repo (`.worktrees/<id>/`), same properties.
- Test `createWorktree` idempotency: second call with the same path returns a clear Left.
- Test `commitSpecToMain`: commits only the named file; a second dirty file remains unstaged.
- Test `commitWorktreeChanges`: dirty worktree edits are committed on the worktree branch and clean worktrees return `{ committed: false }`.
- Test `mergeBranchToMain`: branch commits land on main after merge, and unrelated dirty tracked files in main make it return Left before checkout/merge.
- Test `withPlanningLock`: two same-time callers run the critical section serially; the second does not enter until the first releases.
- Test `removeWorktree`: removes cleanly when clean; refuses with Left when there are uncommitted changes.
- Test `listWorktrees`: parses porcelain output correctly.
- Run `bun test test/unit/worktree.test.ts` — all green.

### 3. Status dashboard: `adws/adw-status.ts`

- Create the script. Flags: `--id <id>` (single workspace), `--watch` (re-render every N seconds, default N=5), `--remote` (also query SSH hosts).
- Implement `loadAllWorkspaces(agentsDir)`: scan `agents/*/adw-state.json`, return `{ id, state, latestEvent }[]` where `latestEvent` is the last line of `orchestrator/events.jsonl` (reuse `recoverSpecPathFromEvents`'s read-backward pattern from the orchestrator).
- Implement `deriveState(latestEventTs, status)`: returns `"working"` | `"idle"` | `"done"` | `"failed"`. Rule: `status === "completed"` → done; `status === "failed"` → failed; otherwise `Date.now() - latestEventTs < 2min` → working; else idle. The 2-minute window aligns with the RFC-020 heartbeat cadence (15-30s beat → working if any event in the last ~4 beats).
- Implement `renderTable(workspaces, worktrees)`: print a table with columns: `ID | SPEC | STAGE | STATE | ELAPSED | WHERE`. `WHERE` shows `local` or the remote host (from `state.host`). `STAGE` is derived from `completed_stages` + `latestEvent`. `ELAPSED` is humanized (`4m12s`).
- Join with `listWorktrees` so the table shows the worktree path for each workspace.
- `--remote` mode: for each host in `listSshHosts()`, use `queryRemoteStatus` over SSH/scp/rsync because `agents/` is gitignored. For `--id <id>`, read `<repo>/agents/<id>/adw-state.json`; without `--id`, list remote workspace ids with `find <repo>/agents -maxdepth 2 -name adw-state.json` and fetch those state files plus latest `orchestrator/events.jsonl`. Best-effort: a host that's unreachable is shown as `WHERE=<host> (unreachable)` and skipped.
- Document the output format in a comment block at the top of the file.

### 4. Status dashboard unit tests: `test/unit/adw-status.test.ts`

- Test `deriveState`: working/idle/done/failed transitions against fixture event timestamps.
- Test `renderTable` against a fixture `agents/` dir with 3 workspaces (one working, one idle, one done) and a fixture worktree list. Assert the table contains the expected rows and columns.
- Test `--id` filtering.
- Test `loadAllWorkspaces` skips corrupt state files gracefully (matches `workspace.ts`'s pattern).
- Run `bun test test/unit/adw-status.test.ts` — all green.

### 5. Orchestrator: commit reviewed spec to main + create worktree after spec-review

- Extend `runPipeline`'s dependency boundary explicitly:
  - Keep `PipelineDeps` for stage runners/spawn behavior.
  - Add a separate `WorktreeDeps`/`GitDeps` argument for git/worktree operations, e.g. `runPipeline(args, pipelineDeps = defaultPipelineDeps, worktreeDeps = defaultWorktreeDeps)`.
  - Existing mocked orchestrator tests must pass a fake `worktreeDeps` that records `withPlanningLock`, `commitSpecToMain`, `createWorktree`, `commitWorktreeChanges`, and `mergeBranchToMain` calls. Do not overload the existing stage-runner-only `PipelineDeps` with git methods unless the codebase already has a shared deps pattern that makes this cleaner.
- In the orchestrator, during a fresh run:
  - Compute `worktreePath = siblingPath(PROJECT_ROOT, id)` = `join(dirname(PROJECT_ROOT), basename(PROJECT_ROOT) + "." + id)` and `branch = \`adw/${id}\``.
  - Run this whole fresh-run setup inside `withPlanningLock(worktreeDeps, PROJECT_ROOT, async () => { ... })`: plan, spec-review, repo-relative spec-path normalization, spec commit, and worktree creation. Resume of an existing id does not take the planning lock unless it must recreate a missing worktree.
  - Guard: if `detectWorktree(worktreeDeps, PROJECT_ROOT)` is true, fail with a clear error ("already inside a worktree — refusing to nest").
  - Run plan in `PROJECT_ROOT`; normalize the plan result to `specRelPath` relative to `PROJECT_ROOT`, reject paths outside the repo, and store only `specRelPath` in state/events.
  - Run spec-review in `PROJECT_ROOT` with no `ADW_WORKTREE`, using the main-checkout absolute spec path `join(PROJECT_ROOT, specRelPath)`. Any review edits are applied to the main spec.
  - Call `commitSpecToMain(worktreeDeps, PROJECT_ROOT, specRelPath, \`spec: ${specRelPath} (adw ${id})\`)`. If Left, surface as a setup-stage error.
  - Call `createWorktree(worktreeDeps, PROJECT_ROOT, branch, worktreePath)`. If Left, surface as a setup-stage error.
  - Append a `worktree-created` event: `{ event: "worktree-created", path: worktreePath, branch, from_sha: <HEAD> }`.
  - Stash `worktreePath` in orchestrator state for the rest of the pipeline + `finalize`.
- Add a `--setup-only` flag to the orchestrator, not the launcher, with this contract:
  - It runs exactly the locked setup sequence above: mint/load id, plan if needed, spec-review, commit reviewed spec to main, create/reuse worktree, write/checkpoint state, append `setup-complete`, then exits before build/test/patch-review.
  - It sets `status: "setup"` (or equivalent explicit non-terminal status) in `adw-state.json`, with `completed_stages` including `plan` and `spec-review`, plus `spec_path`, `branch`, `worktree_path`, and `setup_completed_at`.
  - It prints one machine-readable final line to stdout: `ADW_SETUP_RESULT {"id":"<id>","spec_path":"docs/specs/...","branch":"adw/<id>","worktree_path":"/abs/path","state_path":"/abs/path/agents/<id>/adw-state.json"}`. Human logs may precede it; `adw-launch.ts --remote` parses only the final `ADW_SETUP_RESULT` line.
  - `--resume <id> --setup-only` verifies existing state has `branch` and either an existing `worktree_path` or enough recorded data to recreate it, then prints the same stdout contract without rerunning plan/spec-review.
- Add a `gitRun` helper to the orchestrator (copy the `run` from `adw-build.ts:240`). Inject it into the worktree module.

### 6. Orchestrator: pass `ADW_WORKTREE` to child stages

- In `spawnStage` (line 358-372), change the env to include `ADW_WORKTREE` when set:
  ```ts
  env: {
    ...process.env,
    ADW_ORCHESTRATED: "1",
    ...(worktreePath ? { ADW_WORKTREE: worktreePath } : {}),
  },
  ```
- `worktreePath` is a closure-scoped variable in `runPipeline`; initialize it `undefined` and set it after the plan stage in Step 5.
- Translate the spec path at the subprocess boundary: state keeps `specRelPath`, spec-review uses `join(PROJECT_ROOT, specRelPath)`, and build/test/patch-review use `worktreePath ? join(worktreePath, specRelPath) : join(PROJECT_ROOT, specRelPath)`. This prevents build/patch-review from reading or appending to the main checkout's spec while executing in a worktree.

### 7. Child stages: resolve `cwd` from env

- In `adw-build.ts`, hoist `const cwd = process.env.ADW_WORKTREE ?? PROJECT_ROOT;` near the top of `runBuild`. Replace the four `PROJECT_ROOT` execution-call sites at lines 487, 509, 519, 539 with `cwd`.
- Leave `resolveInput`, `AGENTS_DIR`, and `SPECS_DIR` on `PROJECT_ROOT`.
- When the input is an absolute spec path under `ADW_WORKTREE`, accept it as the file to read/edit but persist any state/event `spec_path` as the repo-relative path by stripping the worktree root prefix.
- Apply the same `cwd` hoist to `adw-spec-review.ts`, `adw-test.ts`, `adw-patch-review.ts` for their execution spawns. Fresh orchestrator setup intentionally calls spec-review without `ADW_WORKTREE`; the fallback preserves standalone spec-review behavior and supports any future reviewed-in-worktree resume path.

### 8. Orchestrator: record worktree + heartbeat in state

- Add `worktree_path?: string`, `branch?: string`, `implementation_commit?: string | null`, and `host?: string` to `WorkspaceState` and `OrchestratorState`.
- Write them to `adw-state.json` in `checkpoint()` and `finalize()`.
- Append a structured `heartbeat` event every 15-30s while a stage is running (RFC-020 item B). This is the signal the status dashboard's `deriveState` reads. Existing `withHeartbeat` output currently writes human-readable lines to stderr only; extend it with an injectable event callback or add an orchestrator-side `setInterval` cleared on stage resolve so `orchestrator/events.jsonl` receives `{ event: "heartbeat", stage, elapsed_ms, tee_file?, tee_delta_bytes? }`.
- In `loadWorkspace` (resume), recover `worktree_path` from state. If the worktree still exists on disk, re-use it; if gone, re-create from the recorded `from_sha` (or fail with a clear error pointing at `git worktree add`).
- Append `worktree-reused` or `worktree-recreated` events on resume.

### 9. Optional merge-on-success: `--merge` flag

- Add `merge?: boolean` to `OrchestratorArgs` and a `--merge` flag to `parseArgs`.
- Before `finalize` for a successful run, when `worktreePath` is set: call `commitWorktreeChanges(worktreeDeps, worktreePath, \`adw ${id}: implementation\`)`. Record the returned SHA in state/events as `implementation_commit`, or `null` when the worktree was clean. If committing fails, mark the run failed and leave the worktree intact; do not merge or tell the user to fetch an uncommitted result.
- In `finalize` for a successful run, when `args.merge` is true and `worktreePath` is set: call `mergeBranchToMain(worktreeDeps, PROJECT_ROOT, branch)`. Record the result in the finalize event. On conflict, leave the worktree intact and surface "merge conflict — resolve in worktree at <path>".
- Default off. The user explicitly approves every merge.
- Pass-through in `adw-launch.ts`: `--merge` is an unknown launcher flag → falls through to the target script via existing pass-through logic. Document it in USAGE.

### 10. Remote dispatch module: `adws/adws-modules/remote.ts`

- Implement `listSshHosts()`: parse `~/.ssh/config`, return `{ alias, hostname }[]` for every `Host <alias>` with a `HostName`. Skip wildcard hosts (`Host *`). For the current `~/.ssh/config`, this returns `mekkapi`, `mekkapi-ethernet`, `mekaelturner`, `phrzr`, `mkstudio`, `git.charm.sh`, `soft`.
- Implement `remoteNameForHost(host)`: deterministic local git remote name, e.g. `adw-${host}`. Do not pass a plain SSH config host alias to `git push` unless a git remote by that exact name already exists.
- Implement `ensureGitRemote(deps, host, remoteRepoPath)`: configure `adw-${host}` with URL `<host>:<remoteRepoPath>` (for example `mekkapi:~/src/tmax.git` or `mekkapi:/home/pi/tmax`). If the remote exists with a different URL, return Left with instructions rather than silently changing it.
- Implement `pushToRemote(deps, remoteName, branch)`: `git push <remoteName> <branch>`. Returns `TaskEither`. The remote must already have the repo cloned at a known path — the user configures `ADW_REMOTE_REPO_PATH` once per host (default `~/tmax`).
- Implement `dispatchToRemote(deps, host, id, repoPath)`: `ssh <host> 'cd <repoPath> && bun adws/adw-launch.ts --resume <id>'`. Runs in tmux on the remote (the remote's own `adw-launch.ts` handles tmux). Returns the remote tmux window id for status.
- Implement `fetchFromRemote(deps, remoteName, branch)`: `git fetch <remoteName> <branch>` to pull the result back.
- Implement `queryRemoteStatus(deps, host, id, repoPath)`: `ssh <host> 'cat <repoPath>/agents/<id>/adw-state.json && tail -n 1 <repoPath>/agents/<id>/orchestrator/events.jsonl'`. Used by `adw-status.ts --remote`.
- Implement `listRemoteStatuses(deps, host, repoPath)`: `ssh <host> 'find <repoPath>/agents -maxdepth 2 -name adw-state.json -print'`, then fetch each state file and latest orchestrator event. This is required because `agents/` is gitignored and branch push/fetch cannot sync runtime state.
- All SSH commands run through the injected `run` so they're testable with a mock.

### 11. Remote dispatch flag: `adw-launch.ts --remote <host>`

- Add `--remote <host>` and `--dry-run` to the launcher's arg parser (consumed by the launcher, not passed through). `--dry-run` is valid only with `--remote`.
- When `--remote` is set:
  1. If launching from a description, run the local orchestrator with `--setup-only`: mint id, run plan, run spec-review, commit the reviewed spec to main, create branch/worktree `adw/<id>`, write local `adw-state.json`, print the `ADW_SETUP_RESULT` line, then stop before build/test/patch-review. If `--resume <id>` is provided, call `adw-plan-review-build-patch.ts --resume <id> --setup-only` to load existing local state and verify `branch` exists.
  2. Resolve `remoteRepoPath` from `ADW_REMOTE_REPO_PATH` or per-host config and call `ensureGitRemote(host, remoteRepoPath)` to create/verify local remote `adw-${host}` with URL `<host>:<remoteRepoPath>`.
  3. `pushToRemote(\`adw-${host}\`, \`adw/${id}\`)` — push the branch after it exists locally. Do not attempt to push before the local setup phase has minted the id and created the branch.
  4. Copy or seed the minimal local state needed for remote resume (`agents/<id>/adw-state.json` and latest orchestrator metadata) to `<repoPath>/agents/<id>/` over SSH/scp/rsync because `agents/` is gitignored. Rewrite host-local absolute fields while seeding: keep `spec_path` repo-relative and `branch` unchanged, but clear `worktree_path` or replace it with the remote sibling path computed from `<repoPath>` + id so the remote resume never uses the local machine's absolute path.
  5. `dispatchToRemote(host, id, remoteRepoPath)` — SSH the `adw-launch.ts --resume <id>` command to the remote.
  6. Print the remote tmux window id and the local command to fetch the result back: `git fetch adw-${host} adw/<id> && git worktree add .worktrees/<id>-result FETCH_HEAD`.
- `--remote <host> --dry-run` must be runnable without the host being reachable. It still invokes the local `--setup-only` orchestrator and parses `ADW_SETUP_RESULT`, then prints the planned remote operations as JSON without running `ensureGitRemote`, `git push`, SSH, scp, rsync, or remote tmux. The final stdout line is `ADW_REMOTE_DRY_RUN {"id":"<id>","host":"<host>","remote_name":"adw-<host>","branch":"adw/<id>","remote_repo_path":"<path>","commands":[...]}`. This is the deterministic validation path for CI/local tests.
- Record `host` in the local `adw-state.json` so the status dashboard shows where the run lives.
- Document the remote workflow in the USAGE comment and in `AGENTS.md`.

### 12. Remote dispatch unit tests: `test/unit/remote.test.ts`

- Test `listSshHosts` against a fixture `~/.ssh/config` with several hosts + a wildcard + a host without `HostName`.
- Test `pushToRemote` / `fetchFromRemote` / `dispatchToRemote` / `queryRemoteStatus` command construction against a fake `run` (assert the exact `git`/`ssh` argv).
- Test launcher remote dry-run parsing with a fake setup-only orchestrator stdout containing the final `ADW_SETUP_RESULT` line. Assert it prints `ADW_REMOTE_DRY_RUN`, includes the branch/id/remote name, and does not invoke git push, SSH, scp, rsync, or tmux.
- Run `bun test test/unit/remote.test.ts` — all green.

### 13. AGENTS.md / CLAUDE.md workflow doc update

- Add a section to the adw Pipeline section of `AGENTS.md` and `CLAUDE.md`: sibling worktrees, specs-on-main, `adw-status.ts` fleet view, `--merge`, `--remote <host>`. Link to the overview memo.
- Document the remote-dispatch workflow: `bun adws/adw-launch.ts --remote mekkapi "..."` → local setup-only → push → run on Pi → fetch back. Note `ADW_REMOTE_REPO_PATH` per-host config and `--remote <host> --dry-run` for validation without touching the host.

### 14. Validation — full pipeline + concurrency + remote

- Run `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck` — fix every type error.
- Run `bun test test/unit/worktree.test.ts`, `test/unit/adw-status.test.ts`, `test/unit/remote.test.ts` — all green.
- Run `bun test test/unit/` — full unit suite, no regressions.
- Run a full pipeline end-to-end: `bun adws/adw-launch.ts --foreground "add a comment to README"`. Confirm: spec lands on main, sibling worktree created at `<repo>.<id>/`, build runs in the worktree, on completion the worktree is left on `adw/<id>`.
- Run `bun adws/adw-status.ts` — confirm the dashboard shows the run with correct stage + state.
- Run two pipelines concurrently in separate tmux windows; confirm via `adw-status.ts --watch` that both show as working, the plan/spec-review/spec-commit/worktree critical section is serialized, neither clobbers the other, and main receives both reviewed specs.
- Run `bun adws/adw-launch.ts --remote mekkapi --dry-run "add a comment to README"` — deterministic remote validation; confirm `ADW_SETUP_RESULT` is parsed, `ADW_REMOTE_DRY_RUN` is printed, no network commands execute, and planned push + SSH dispatch + local fetch-back instructions are correct.
- Optional live smoke test when the host is available: `bun adws/adw-launch.ts --remote mekkapi "..."` — confirm push + SSH dispatch + fetch-back instructions against the real host.
- Run `bun run test:tmax-use` to confirm e2e tests still pass with worktree isolation.

## Testing Strategy

### Unit Tests

- `test/unit/worktree.test.ts` — sibling + buried create, detect, commit-spec, merge, remove, list, uncommitted-changes refusal.
- `test/unit/adw-status.test.ts` — state derivation, table rendering, fixture agents dir + worktree list, `--id` filtering, corrupt-state graceful skip.
- `test/unit/remote.test.ts` — SSH config parsing, command construction for push/fetch/dispatch/query.
- Existing orchestrator tests in `test/unit/adw-pipeline.test.ts` and `test/unit/adw-pipeline-loop.test.ts` — extend with: (a) plan + spec-review run under `withPlanningLock` in `PROJECT_ROOT`, (b) reviewed spec commits to main, (c) `ADW_WORKTREE` is passed only to build/test/patch-review children, not fresh spec-review, (d) child argv/prompts use worktree-local absolute spec paths for build/test/patch-review while state stores repo-relative paths, (e) sibling worktree path computed, (f) resume reuses worktree, (g) successful worktree dirt is committed through `commitWorktreeChanges` before merge/fetch, (h) `--merge` merges with dirty-main guard, (i) same-time launches serialize plan/spec-review/spec commit/worktree creation, (j) `--setup-only` writes setup state and prints the `ADW_SETUP_RESULT` line, and (k) mocked tests use separate `PipelineDeps` and `WorktreeDeps`/`GitDeps`. If these cases do not fit the existing files cleanly, add a new `test/unit/adw-worktree-orchestrator.test.ts`; do not reference `test/unit/adw-plan-review-build-patch.test.ts` because that file does not exist.

### Integration Tests

- A full foreground pipeline run (Step 14): plan → spec-review → reviewed spec-on-main → sibling worktree → build → test → patch-review → implementation commit → completed, with assertions on the final `adw-state.json` (`worktree_path`, `branch`, `implementation_commit`, `status: completed`).
- Two concurrent foreground pipelines against disjoint specs, asserting the plan/spec-review/spec-commit/worktree critical section is serialized and both complete without cross-contamination. `adw-status.ts` shows both.
- `adw-status.ts --watch` against a live run, asserting state transitions working → done.

### Edge Cases

- **Sibling worktree path collision:** a directory already exists at `<repo>.<id>/`. `createWorktree` returns a clear Left.
- **Worktree already exists for this id** (interrupted prior run): clear "run --resume <id> or remove <path>" message.
- **User has dirty files on main when plan/spec-review runs:** `commitSpecToMain` commits only the reviewed spec file; other dirty files untouched. `--merge` refuses before checkout/merge if unrelated tracked dirty files are present.
- **Implementation leaves uncommitted worktree edits:** successful completion calls `commitWorktreeChanges` before `--merge`, remote dispatch fetch-back, or final success reporting. Failure leaves the dirty worktree intact and marks the run failed.
- **Pipeline fails mid-run:** worktree left in place on its branch; resume re-uses it.
- **Resume after worktree was manually deleted:** detect missing dir, re-create from recorded base SHA, or fail with a clear error.
- **Nested worktree attempt:** `detectWorktree(deps, PROJECT_ROOT)` true → refuse.
- **Submodule:** `detectWorktree` false (submodule guard) → worktree created normally.
- **Standalone `adw-build.ts <spec>` invocation (no orchestrator):** `ADW_WORKTREE` unset → falls back to `PROJECT_ROOT` → behaves exactly as today.
- **Status dashboard against corrupt state file:** skip gracefully, show `(corrupt)` in the row.
- **Status dashboard `--remote` against an unreachable host:** show `(unreachable)`, continue with other hosts.
- **Remote dry-run:** `--remote <host> --dry-run` does not require the host, does not run network commands, and still validates setup-only orchestration plus planned command rendering.
- **Remote dispatch to a host where the repo isn't cloned:** clear error pointing at `ADW_REMOTE_REPO_PATH` config.
- **Remote dispatch when the host's git remote for this repo isn't set:** `ensureGitRemote` adds `adw-<host>` with URL `<host>:<ADW_REMOTE_REPO_PATH>` before `pushToRemote`.

## Acceptance Criteria

1. **Concurrent pipelines do not collide.** Two `adw-launch.ts "<desc>"` runs in parallel complete successfully. Their plan/spec-review/spec-commit/worktree setup is serialized, and after the reviewed spec commits each run edits only its own sibling worktree. The pipeline does not add non-spec dirt to `main`; pre-existing user dirty files remain untouched.
2. **Reviewed specs land on main.** After a pipeline completes, `git log main -- docs/specs/` shows the reviewed spec file committed by `commitSpecToMain`.
3. **Each pipeline gets a sibling worktree.** `<repo>.<adw-id>/` exists on branch `adw/<adw-id>` for every run, visible in `ls` beside the repo.
4. **Stages execute in the worktree.** A stage's subprocess `cwd` is the worktree path when `ADW_WORKTREE` is set.
5. **Resume reuses the worktree.** `--resume <id>` reuses the existing worktree; workspace state records `worktree_path` + `branch`.
6. **Implementation edits are committed on `adw/<id>`.** A passing pipeline records implementation changes with `commitWorktreeChanges` before reporting success; `git log adw/<id>` contains the implementation commit when there were worktree edits.
7. **`--merge` lands on main.** With `--merge`, a passing pipeline first commits implementation changes on `adw/<id>`, then merges `adw/<id>` into `main` via `--no-ff`; without, the branch is left for manual review.
8. **Status dashboard shows the fleet.** `bun adws/adw-status.ts` lists every workspace with id, spec, current stage, idle/working/done state, elapsed, and where (local/host). `--watch` re-renders live.
9. **Setup-only has a stable API.** `bun adws/adw-plan-review-build-patch.ts --setup-only "..."` writes setup state and prints the final `ADW_SETUP_RESULT` line with id, repo-relative spec path, branch, worktree path, and state path.
10. **Remote dry-run is deterministic.** `bun adws/adw-launch.ts --remote mekkapi --dry-run "..."` runs local setup-only, parses `ADW_SETUP_RESULT`, prints `ADW_REMOTE_DRY_RUN`, and executes no network commands.
11. **Remote dispatch works.** `bun adws/adw-launch.ts --remote mekkapi "..."` runs local setup first, pushes `adw/<id>` to git remote `adw-mekkapi`, copies/seeds gitignored workspace state over SSH/scp/rsync, SSHes the resumed command to the Pi, and prints the fetch-back command. The dashboard's `--remote` mode shows the remote run's state by querying the remote filesystem, not by reading git.
12. **Backward compatibility.** Standalone `adw-build.ts <spec>` (no `ADW_WORKTREE`) behaves exactly as before.
13. **No regressions.** All existing adw unit tests pass; `bun run typecheck` clean; `bun run test:tmax-use` green.
14. **Remote dispatch is enabled by this spec.** `git push adw-mekkapi adw/<id>` succeeds after `ensureGitRemote` configures URL `mekkapi:<ADW_REMOTE_REPO_PATH>`; the branch is fetchable from the Pi.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions:

- `bun run typecheck:src` — typecheck src, zero errors.
- `bun run typecheck:test` — typecheck tests, zero errors.
- `bun run typecheck` — full typecheck, zero errors.
- `bun test test/unit/worktree.test.ts` — worktree module unit tests pass.
- `bun test test/unit/adw-status.test.ts` — dashboard unit tests pass.
- `bun test test/unit/remote.test.ts` — remote dispatch unit tests pass.
- `bun test test/unit/adw-pipeline.test.ts test/unit/adw-pipeline-loop.test.ts` — orchestrator unit tests pass, including new worktree/status/remote cases.
- `bun test test/unit/` — full unit test suite, no regressions.
- `bun adws/adw-launch.ts --foreground "add a one-line comment to docs/ROADMAP.md"` — full end-to-end pipeline; confirm spec lands on main, sibling worktree created, build runs in worktree, pipeline completes.
- `git log main --oneline -5` — confirm the spec commit is on main.
- `git worktree list` — confirm the sibling worktree exists on branch `adw/<id>`.
- `bun adws/adw-status.ts` — confirm the dashboard shows the run with correct stage + state.
- `bun adws/adw-status.ts --watch` — confirm live re-render.
- `bun adws/adw-launch.ts --remote mekkapi "..."` — confirm push + SSH dispatch + fetch-back instructions (dry-run acceptable if Pi is offline).
- `bun run test:tmax-use` — e2e tests pass with worktree isolation.

## Notes

- **Sibling vs buried worktrees.** The community (Worktrunk, `wt`, openchamber PR #1499) converged on **sibling** worktrees — placed beside the repo as `<repo>.<branch>/` — because `ls` shows them, they're easy to `cd` into, and they don't pollute the repo's own directory. This spec defaults to sibling layout (`<repo>.<adw-id>/`). The buried layout (`.worktrees/<id>/`, used by `tmax-spec-loop`) remains supported via the path argument to `createWorktree`. Sibling paths sit outside the repo dir so they need no `.gitignore` entry; if any are created inside during testing, the existing `.worktrees/` line covers them.
- **Status dashboard = RFC-020 item D promoted.** RFC-020 deferred `adw-status.ts` as a standalone follow-up. With concurrent worktrees it becomes essential (you need a fleet view, not a single-run view), so this spec promotes it. The idle/working/done state derivation requires structured heartbeat events in `orchestrator/events.jsonl`; stderr heartbeat text alone is not observable by the dashboard.
- **Remote dispatch via SSH config.** The user's `~/.ssh/config` already lists `mekkapi`, `mekkapi-ethernet`, `mekaelturner`, `phrzr`, `mkstudio`, `git.charm.sh`, `soft`. `listSshHosts()` parses these; `--remote <host>` accepts any of them. The remote must have the repo cloned at a known path (`ADW_REMOTE_REPO_PATH`, default `~/tmax`); the user configures this once per host. Git sync uses a local remote named `adw-<host>` with URL `<host>:<ADW_REMOTE_REPO_PATH>`, while `agents/` state is copied and queried explicitly over SSH/scp/rsync because it is gitignored. This is the "clone-fork-work-push-back" pattern from crowdhaller's writeup (see overview memo §5).
- **Why env-var handoff over a `--worktree` CLI flag.** Every stage already reads `process.env`; a flag would require touching every stage's arg parser. One env var, read once per stage, covers the whole pipeline and composes with remote dispatch.
- **Why specs land on main, not on the worktree branch.** The user requirement: specs must be visible in the main directory so the user (and other agents) can see what's going on. Specs are coordination inputs, not build artifacts.
- **Why `git add <spec-file>` and never `git add .`.** The repo often has 40+ dirty files. The orchestrator must commit only the spec the plan stage created.
- **Fikra handoff (future).** SPEC-042 Phase 4 (`fikra-worktree.tlisp`) implements worktree isolation in T-Lisp for concurrent AI chat threads. The `worktree.ts` module here is designed to be reusable by Fikra: the pure functions (`createWorktree`, `removeWorktree`, `listWorktrees`) map directly to the T-Lisp `shell-command` calls Fikra will make, and the sibling-worktree + status conventions established here carry over. When Fikra lands, `fikra-worktree.tlisp` can either call git directly (its current design) or share a single source of truth for the worktree layout convention via this spec. The status dashboard's design (read `agents/*/adw-state.json` + `git worktree list`) also informs Fikra's `SPC a T` thread-list buffer (SPEC-042 Step 4.1). This spec is the TypeScript-side foundation; Fikra is the T-Lisp-side consumer.
- **No new dependencies.** Pure git + ssh + the existing `TaskEither` machinery. No Worktrunk, no Mutagen, no external worktree manager — the tmax-spec-loop pattern is sufficient and already in-repo.
- **The `using-git-worktrees` skill's detection logic** (`GIT_DIR != GIT_COMMON_DIR`, plus the submodule guard) is implemented directly in `detectWorktree`.
- **Community pattern reference.** `docs/memos/parallel-ai-agents-worktree-overview.md` — worktree-per-task + specs-as-coordination-layer + git-as-remote-transport + status-dashboard need. The rjmurillo/ai-agents PRs (#2251, #2412) are the cautionary tale for the worktree-awareness bug class, addressed here by the single `ADW_WORKTREE` env-var injection point.
