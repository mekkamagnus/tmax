# Feature: GitHub Issue-Driven adw Trigger

## Feature Description

**GitHub issue-driven adw** adds a cron-based trigger that watches GitHub issues on a configured repository, automatically converts submitted issues into adw specs, manages the spec approval flow via labels, launches the full adw pipeline on approval, and posts all progress back to the issue as comments. Every run is tracked by its GitHub issue number from triage through build completion to PR creation.

Today the adw pipeline is triggered manually: a developer types `bun adws/adw-launch.ts "<description>"` or `bun adws/adw-launch.ts docs/specs/SPEC-XXX.md` in a terminal. There is no way to submit work to the pipeline from outside the machine, no way to track progress from GitHub, and no automation around the spec→build lifecycle. This spec adds that automation layer: issues are the input, labels are the state machine, the issue thread is the log, and PRs are the output.

Three new modules power this: `adws/adws-modules/github.ts` (GitHub API via `gh` CLI), `adws/adws-modules/git-ops.ts` (git operations consolidating worktree.ts), and `adw-triggers/trigger-cron.ts` (the long-lived poll daemon). The GitHub module is shared by two entry points: the **trigger-cron daemon** watches issues and launches pipelines, and the **`/adw-plan` and `/adw-implement` skills** create tracking issues on GitHub when invoked directly from the CLI.

## User Story

As a **developer who submits GitHub issues as feature requests or launches pipelines directly from the CLI**
I want to **have each pipeline run tracked by a GitHub issue — whether the issue was submitted on GitHub (and auto-triaged by the trigger) or created automatically when I run `/adw-plan` or `/adw-implement`**
So that **every pipeline run has a single GitHub issue as its thread of truth for progress, approval, and the resulting PR — regardless of how it was started.**

## Problem Statement

The adw pipeline has four gaps that GitHub issue integration fills:

1. **No external input.** The pipeline only accepts CLI arguments. Submitting work requires SSH access to the machine, knowledge of the CLI, and manual `adw-launch.ts` invocation. Contributors who file GitHub issues have no automated path from issue to implementation.

2. **No GitHub visibility.** Pipeline progress lives in `agents/<id>/` event files and tmux panes — invisible to anyone who doesn't SSH into the machine. There's no way to see what the pipeline is doing from the GitHub issue.

3. **No spec lifecycle management.** The plan stage creates a spec, but the human approval gate is manual (inspect the file, then run the build). There's no label-based workflow, no structured feedback loop, and no automation around "spec ready → approve → build."

4. **Scattered git operations.** Git operations (branch creation, commits, worktree management, merge, push) are spread across `worktree.ts` (540 lines), the orchestrator, and `remote.ts`. There's no single module that owns the full git lifecycle, and GitHub-facing operations (create PR, link issue) don't exist anywhere.

5. **No issue tracking from CLI launches.** When a developer runs `/adw-plan` or `/adw-implement` directly, the pipeline runs in tmux with no GitHub artifact. There's no tracking issue, no PR linked to an issue, and no way for collaborators to see what's being built from the GitHub UI. The trigger-cron path creates issues automatically, but the direct-CLI path is invisible on GitHub.

## Solution Statement

Four parts:

**1. GitHub API module (`adws/adws-modules/github.ts`).** A dependency-injected module wrapping the `gh` CLI for all GitHub operations: list issues by label, read an issue, create an issue, post comments, add/remove labels, create PRs, close issues. Zero new dependencies — everything via `gh` (already installed on the system per AGENTS.md). Follows the existing `Deps` interface convention (like `remote.ts`, `worktree.ts`). Shared by both the trigger-cron daemon and the `/adw-plan`/`/adw-implement` skills.

**2. Git operations module (`adws/adws-modules/git-ops.ts`).** Consolidates all git operations currently in `worktree.ts` into a single module, plus adds GitHub-facing operations: push a branch to origin, create a PR linked to an issue, and link the issue to the PR. `worktree.ts` becomes a thin re-export shim for backward compatibility. This is the module the trigger and orchestrator both import.

**3. Bidirectional GitHub integration.** Two entry points create and track GitHub issues:

- **GitHub → pipeline (trigger-cron):** A long-lived daemon (`adw-triggers/trigger-cron.ts`) that polls GitHub issues on a cadence (default 60s). Submitted issues are triaged, converted to specs, approved via labels, built by the pipeline, and delivered as PRs — all tracked on the issue.

- **Pipeline → GitHub (skills):** When `/adw-plan` or `/adw-implement` is invoked directly, the skill creates a GitHub issue as a tracking artifact before launching the pipeline. The issue gets `adw:building` and the workspace state records `issue_number` + `issue_url`. On completion, the issue gets a progress comment and a PR is created and linked. This gives every pipeline run — whether started from GitHub or from the CLI — a single GitHub issue as its thread of truth.

Both paths converge on the same label scheme, the same `github.ts` module, and the same `issue_number` field in `adw-state.json`. The trigger-cron treats skill-created issues identically to human-submitted ones.

**4. Issue-tracked state.** Each adw workspace records the originating `issue_number` and `issue_url` in `adw-state.json`. The spec filename includes the issue number (`SPEC-###-issue-<number>-<slug>.md`) when created from an issue (or a generated tracking issue). The trigger posts structured comments on the issue at every state transition.

The label state machine is the same regardless of entry point:

```
  GitHub issue submitted ─────────────────────┐
  OR                                           │
  /adw-plan or /adw-implement invoked ──────►  │
       │                                       │
  [create issue if not from GitHub]            │
       │                                       │
       ▼                                       │
  opened → [adw:triage]  (skipped if skill-created)
           │
     classify + plan (via agent.ts)
     (skipped if /adw-implement on existing spec)
           │
     spec created → [adw:ready-for-review]
                     │
         human adds [adw:approved]
         (or auto-approved for skill-launched runs)
                     │
     launch adw-launch.ts → [adw:building]
                     │
     pipeline completes → [adw:done] or [adw:failed]
                     │
     PR created + linked to issue
```

### Design decisions (from interview)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | State tracking | **Labels only** | Every state is a label (`adw:triage`, `adw:ready-for-review`, `adw:approved`, `adw:building`, `adw:done`, `adw:failed`). Queryable via `gh issue list --label`. Clean, visible in GitHub UI. |
| 2 | Delivery mechanism | **Cron poll** | `trigger-cron.ts` polls every 60s. Follows the `adw-watchdog.ts` pattern. No server needed. 30-60s lag is acceptable for a build pipeline. |
| 3 | Spec naming | **Issue in filename** | `SPEC-068-issue-42-better-search.md`. Issue number baked into the filename — unambiguous link. Spec number is sequential as normal. |
| 4 | Approval flow | **Label `adw:approved`** | Human adds the label. Trigger checks for `adw:ready-for-review` + `adw:approved`. Simple, unambiguous, no parsing. |
| 5 | Progress output | **Issue comments only** | All stage transitions, build results, and PR links posted as comments on the issue. Single thread of truth. |
| 6 | Module split | **Separate github.ts + git-ops.ts** | `github.ts` = GitHub API layer (issues, PRs, comments, labels via `gh`). `git-ops.ts` = git operations (branches, commits, push, merge). `worktree.ts` functions move into `git-ops.ts`. |
| 7 | Resume guard | **Both label + state** | `adw:building` label = fast gate (cron skips). `adw-state.json` = source of truth for progress reporting. Belt and suspenders. |

## Relevant Files

Use these files to implement the feature:

### Existing Files to Read (reference)

- **`adws/adws-modules/agent.ts`** — The LLM interface for classify + dispatch. The trigger reuses `classify()` and `dispatch()` to turn an issue title+body into a spec. No changes to this file.
- **`adws/adw-plan-review-build-patch.ts`** — The orchestrator. The trigger calls `adw-launch.ts` (which calls this) as a subprocess, exactly like a human would. No changes to this file.
- **`adws/adw-launch.ts`** — The tmux launcher. The trigger calls this to launch the full pipeline for an approved issue. No changes.
- **`adws/adws-modules/workspace.ts`** — `findWorkspaceBySpecPath` + `normalizeSpecPath`. The trigger queries workspaces by issue number (new `findWorkspaceByIssueNumber`), not spec path. No changes.
- **`adws/adw-status.ts`** — The dashboard. Issue-driven workspaces show up as additional rows — no changes needed.
- **`adws/adw-watchdog.ts`** — The poll-loop pattern the trigger mirrors. Same structure: `parseArgs`, `main`, `import.meta.main`, long-lived `setInterval` loop.
- **`adws/adws-modules/worktree.ts`** — Git operations to be consolidated into `git-ops.ts`. After migration, `worktree.ts` re-exports from `git-ops.ts` for backward compatibility.
- **`adws/adws-modules/remote.ts`** — SSH config parsing pattern. The GitHub module follows the same dependency-injected `Deps` pattern.
- **`docs/specs/SPEC-066-adw-watchdog.md`** — Reference spec for the cron-poll daemon pattern. The trigger follows the same structure.

### Existing Files to Modify

- **`adws/adws-modules/worktree.ts`** — Migrate all exports to `git-ops.ts`. Replace function bodies with re-exports: `export { createWorktree, removeWorktree, commitSpecToMain, ... } from "./git-ops.ts"`. Keep the file as a backward-compat shim so existing imports (`adw-launch.ts`, `adw-plan-review-build-patch.ts`, `adw-status.ts`) continue to work without modification.
- **`adws/adw-plan-review-build-patch.ts`** — Add optional `issue_number?: number` and `issue_url?: string` fields to `WorkspaceState` (line ~262). Written by the trigger (or the skills) when launching the pipeline; read by the trigger for progress reporting. The orchestrator itself ignores these fields — they're metadata for the trigger.
- **`.zcode/skills/adw-plan/SKILL.md`** — Add a pre-launch step that creates a GitHub tracking issue before launching the pipeline. The issue is created with `adw:building` (auto-approved — skips the triage and approval gates). The issue number and URL are passed to the launcher via env vars (`ADW_ISSUE_NUMBER`, `ADW_ISSUE_URL`) so the orchestrator records them in `WorkspaceState`. A `--no-issue` flag opts out for offline usage.
- **`.zcode/skills/adw-implement/SKILL.md`** — Same modification as `adw-plan`: create a GitHub tracking issue before launching, auto-add `adw:building`, pass issue metadata via env vars, support `--no-issue`.

### New Files

- **`adws/adws-modules/github.ts`** — GitHub API module via `gh` CLI. Dependency-injected: `GithubDeps { run }`. Exports: `listIssuesByLabel`, `getIssue`, `addLabel`, `removeLabel`, `commentOnIssue`, `createPR`, `closeIssue`, `createIssue`, `findIssueByNumber`.
- **`adws/adws-modules/git-ops.ts`** — Consolidated git operations module. Moves all functions from `worktree.ts` here, plus adds: `pushBranch`, `createPRForIssue` (combines push + GitHub PR creation + issue link).
- **`adw-triggers/trigger-cron.ts`** — Long-lived poll daemon. Watches GitHub issues, drives the label state machine, creates specs, launches pipelines, posts progress, creates PRs. Follows the `adw-watchdog.ts` dispatcher structure.
- **`test/unit/github.test.ts`** — Unit tests for the GitHub module (issue parsing, comment formatting, label operations) against a fake `run`.
- **`test/unit/git-ops.test.ts`** — Unit tests for the git-ops module (consolidated from existing `worktree.test.ts` plus new PR-push operations).
- **`test/unit/trigger-cron.test.ts`** — Unit tests for the trigger's state machine (issue triage, approval detection, pipeline launch guard, progress reporting).

## Implementation Plan

### Phase 1: GitHub API module

Build `adws/adws-modules/github.ts` — the dependency-injected GitHub interface. All operations via `gh` CLI. Zero new dependencies. This is the foundation the trigger calls for every GitHub interaction.

### Phase 2: Git operations consolidation

Build `adws/adws-modules/git-ops.ts` by moving all functions from `worktree.ts` and adding PR/push operations. Convert `worktree.ts` to a re-export shim. This consolidates all git operations into one module and adds the GitHub-facing operations the trigger needs.

### Phase 3: Cron trigger

Build `adw-triggers/trigger-cron.ts` — the long-lived poll daemon that drives the issue→spec→approve→build→PR lifecycle. Follows the `adw-watchdog.ts` pattern: `parseArgs`, `main`, `import.meta.main`, long-lived poll loop.

### Phase 4: Skill integration

Modify `/adw-plan` and `/adw-implement` skills to create GitHub tracking issues before launching the pipeline. Skill-created issues are auto-approved (skip triage/approval gates). Add env var passthrough (`ADW_ISSUE_NUMBER`, `ADW_ISSUE_URL`) so the orchestrator records issue metadata in `WorkspaceState`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: GitHub API module — types and interface

- Create `adws/adws-modules/github.ts`.
- Define the injectable interface:
  ```ts
  export interface GithubDeps {
    run: (cmd: string, args: string[]) => TaskEither<string, string>;
  }
  ```
- Define the GitHub types:
  ```ts
  export interface GithubIssue {
    number: number;
    title: string;
    body: string;
    state: "open" | "closed";
    labels: string[];
    html_url: string;
  }
  export interface GithubPR {
    number: number;
    html_url: string;
    state: "open" | "closed";
  }
  ```
- Define the ADW label constants:
  ```ts
  export const LABEL_TRIAGE = "adw:triage";
  export const LABEL_READY_FOR_REVIEW = "adw:ready-for-review";
  export const LABEL_APPROVED = "adw:approved";
  export const LABEL_BUILDING = "adw:building";
  export const LABEL_DONE = "adw:done";
  export const LABEL_FAILED = "adw:failed";
  export const ADW_LABELS = [LABEL_TRIAGE, LABEL_READY_FOR_REVIEW, LABEL_APPROVED, LABEL_BUILDING, LABEL_DONE, LABEL_FAILED];
  ```

### Step 2: GitHub API module — core functions

- Implement `listIssuesByLabel(deps, owner, repo, label, state?)` — `gh issue list --repo <owner>/<repo> --label <label> --json number,title,body,labels,state,html_url --state <state>`. Returns `TaskEither<string, GithubIssue[]>`.
- Implement `getIssue(deps, owner, repo, number)` — `gh issue view <number> --repo <owner>/<repo> --json number,title,body,labels,state,html_url`. Returns `TaskEither<string, GithubIssue>`.
- Implement `addLabel(deps, owner, repo, number, label)` — `gh issue edit <number> --repo <owner>/<repo> --add-label <label>`. Returns `TaskEither<string, void>`.
- Implement `removeLabel(deps, owner, repo, number, label)` — `gh issue edit <number> --repo <owner>/<repo> --remove-label <label>`. Returns `TaskEither<string, void>`.
- Implement `commentOnIssue(deps, owner, repo, number, body)` — `gh issue comment <number> --repo <owner>/<repo> --body <body>`. Returns `TaskEither<string, void>`.
- Implement `createPR(deps, owner, repo, head, base, title, body)` — `gh pr create --repo <owner>/<repo> --head <head> --base <base> --title <title> --body <body>`. Returns `TaskEither<string, GithubPR>`.
- Implement `closeIssue(deps, owner, repo, number)` — `gh issue close <number> --repo <owner>/<repo>`. Returns `TaskEither<string, void>`.
- Implement `createIssue(deps, owner, repo, title, body, labels?)` — `gh issue create --repo <owner>/<repo> --title <title> --body <body> [--label <label>...]`. Returns `TaskEither<string, GithubIssue>`. Used by the skills to create tracking issues before pipeline launch.
- All functions parse `gh --json` output. Handle `gh` errors (non-zero exit, missing fields) with clear Left messages.

### Step 3: GitHub API module — unit tests

- Create `test/unit/github.test.ts`.
- Inject a fake `run` that returns fixture JSON for each `gh` command.
- Test cases:
  - `listIssuesByLabel`: parses `--json` output, filters by label, handles empty result.
  - `getIssue`: parses issue fields, handles 404 (non-zero exit).
  - `addLabel` / `removeLabel`: verifies correct `gh issue edit` argv.
  - `commentOnIssue`: verifies correct `gh issue comment` argv, handles body with special chars.
  - `createPR`: parses PR output, verifies correct `gh pr create` argv.
  - `closeIssue`: verifies correct `gh issue close` argv.
  - `createIssue`: parses created issue output, verifies correct `gh issue create` argv with title, body, and optional labels.
- Run `bun test test/unit/github.test.ts` — all green.

### Step 4: Git operations consolidation — migrate worktree.ts to git-ops.ts

- Create `adws/adws-modules/git-ops.ts`.
- Move ALL function implementations from `worktree.ts` into `git-ops.ts`:
  - `detectWorktree`, `createWorktree`, `removeWorktree`
  - `commitSpecToMain`, `commitWorktreeChanges`, `mergeBranchToMain`
  - `withPlanningLock`, `listWorktrees`
  - `siblingWorktreePath`, `defaultLockPath`
  - `runGitCmd` (the real subprocess runner)
  - All types: `GitRun`, `WorktreeDeps`, `WorktreeEntry`, `CommitResult`
- Keep the exact same function signatures and exports.
- No behavior changes — pure relocation.

### Step 5: Git operations consolidation — new PR/push operations

- Add to `adws/adws-modules/git-ops.ts`:
  ```ts
  export function pushBranch(deps: WorktreeDeps, rootPath: string, branch: string): TaskEither<string, string>
  ```
  — `git push origin <branch>`. Returns Right(branch) on success.
  ```ts
  export function createPRForIssue(
    gitDeps: WorktreeDeps,
    githubDeps: GithubDeps,
    rootPath: string,
    owner: string,
    repo: string,
    branch: string,
    issueNumber: number,
    specPath: string,
  ): TaskEither<string, GithubPR>
  ```
  — Pushes the branch to origin, then creates a PR via the GitHub module with title derived from the spec filename and body referencing the issue (`Closes #<issueNumber>`). Returns the PR.

### Step 6: Git operations consolidation — worktree.ts backward-compat shim

- Replace `worktree.ts`'s function bodies with re-exports from `git-ops.ts`:
  ```ts
  // worktree.ts — backward-compatibility shim.
  // All git operations have been consolidated into git-ops.ts.
  // This file re-exports everything so existing imports continue to work.
  export {
    detectWorktree,
    createWorktree,
    removeWorktree,
    commitSpecToMain,
    commitWorktreeChanges,
    mergeBranchToMain,
    withPlanningLock,
    listWorktrees,
    siblingWorktreePath,
    defaultLockPath,
    runGitCmd,
    defaultGitRun,
    type GitRun,
    type WorktreeDeps,
    type WorktreeEntry,
    type CommitResult,
  } from "./git-ops.ts";
  ```
- Run `bun run typecheck` — verify no breakage. All existing imports resolve through the shim.

### Step 7: Git operations unit tests

- Create `test/unit/git-ops.test.ts` by copying the existing `test/unit/worktree.test.ts` tests.
- Add tests for new operations:
  - `pushBranch`: verifies correct `git push origin <branch>` argv.
  - `createPRForIssue`: verifies push + gh pr create sequence, title/body formatting, issue link in PR body.
- Run `bun test test/unit/git-ops.test.ts` — all green.
- Run `bun run test:unit` — verify existing worktree tests still pass through the shim.

### Step 8: Cron trigger — skeleton

- Create `adw-triggers/trigger-cron.ts` mirroring the dispatcher structure:
  - File header comment (purpose, usage, exit codes).
  - `USAGE` constant documenting `--repo <owner/repo>`, `--poll-ms <ms>`, `--agents-root <path>`, `--once` (dry-run single scan then exit, no side effects).
  - `parseArgs`, `main`, `import.meta.main` guard.
- Define the trigger-specific types:
  ```ts
  export interface TriggerArgs {
    owner: string;
    repo: string;
    pollMs: number;
    agentsRoot: string;
    once: boolean;
  }
  ```

### Step 9: Cron trigger — issue triage (opened → spec creation)

- Implement the triage scan: `gh issue list --label <none of the adw: labels> --state open`.
- For each unlabeled open issue:
  1. Add `adw:triage` label.
  2. Comment: `🤖 **[ADW]** Triage started — classifying issue...`
  3. Call `classify()` from `agent.ts` with the issue title + body.
  4. Call `dispatch()` from `agent.ts` to create the spec (or edit an existing one).
  5. On success: remove `adw:triage`, add `adw:ready-for-review`, comment with the spec path and a link to the spec file.
  6. On failure: remove `adw:triage`, comment with the error, do NOT add `adw:ready-for-review` (human must investigate).
- The spec filename follows the pattern `SPEC-###-issue-<number>-<slug>.md` where `###` is the next sequential spec number and `<slug>` is derived from the issue title.
- Record `issue_number` and `issue_url` in the workspace state for tracking.

### Step 10: Cron trigger — approval gate (ready-for-review + approved → pipeline launch)

- Implement the approval scan: `gh issue list --label "adw:approved" --label "adw:ready-for-review" --state open`.
- For each issue with both labels:
  1. Read the workspace state (find by issue number — new `findWorkspaceByIssueNumber` helper scanning `agents/*/adw-state.json` for matching `issue_number`).
  2. Remove `adw:approved` and `adw:ready-for-review` labels.
  3. Add `adw:building` label.
  4. Comment: `🤖 **[ADW]** Pipeline launched — building spec [SPEC-XXX](path)...`
  5. Spawn `bun adws/adw-launch.ts --foreground <spec-path>` as a subprocess. The trigger manages the subprocess lifecycle — it doesn't delegate to tmux (the trigger IS the long-lived process).
  6. On pipeline success (exit 0): remove `adw:building`, add `adw:done`, create a PR via `createPRForIssue`, comment with the PR link: `✅ **[ADW]** Build complete — PR: #<pr-number>`.
  7. On pipeline failure (exit non-zero): remove `adw:building`, add `adw:failed`, comment with the error: `❌ **[ADW]** Build failed — <error summary>`.
- The `adw:building` label is the fast guard: the triage scan and approval scan both skip issues with this label.

### Step 11: Cron trigger — progress reporting

- Implement a progress scan that polls building issues: `gh issue list --label "adw:building" --state open`.
- For each building issue, read `agents/<id>/adw-state.json` and `orchestrator/events.jsonl`.
- If the workspace status changed since the last comment (e.g., stage transition from build to test), post a progress comment: `🤖 **[ADW]** Stage update: build → test...`
- Track the last reported stage in a local map (in-memory, resets on restart — acceptable because duplicate comments are harmless).
- If the workspace status is `completed` or `failed` (pipeline subprocess exited), handle the result per Step 10 (create PR or report failure). This is the fallback path in case the subprocess exit handler in Step 10 doesn't fire cleanly.

### Step 12: Cron trigger — helper functions

- Implement `findWorkspaceByIssueNumber(agentsDir, issueNumber)`: scan `agents/*/adw-state.json` for `issue_number === issueNumber`. Returns the workspace id. Mirrors `findWorkspaceBySpecPath` from `workspace.ts`.
- Implement `buildSpecFilename(issueNumber, issueTitle)`: `SPEC-<next>-issue-<number>-<slug>.md`. Calls the same spec-numbering logic used by the plan stage. Slug is kebab-cased from the issue title, truncated to 50 chars.
- Implement `buildComment(parts)`: format structured adw comments with emoji prefix and markdown sections.

### Step 13: Cron trigger — poll loop and main

- In `main`, assemble the poll loop:
  1. Every `pollMs`: run triage scan, approval scan, progress scan.
  2. Each scan is independent — a failure in one doesn't block the others.
  3. `--once` mode: run a single scan of all three phases, print results and intended actions, then exit. No labels modified, no specs created, no pipelines launched, no comments posted.
- Long-lived mode: runs forever (like `adw-watchdog.ts`). The `--once` flag is the dry-run path.

### Step 14: Trigger unit tests

- Create `test/unit/trigger-cron.test.ts`.
- Test cases:
  - **Triage scan:** unlabeled issue → `adw:triage` added → classify + dispatch called → `adw:ready-for-review` added.
  - **Triage failure:** classify fails → `adw:triage` removed, error comment posted, no `adw:ready-for-review`.
  - **Approval scan:** issue with both `adw:ready-for-review` + `adw:approved` → labels removed, `adw:building` added, pipeline launched.
  - **Building guard:** issue with `adw:building` → skipped by triage and approval scans.
  - **Progress scan:** workspace transitions stages → progress comment posted only on change.
  - **Pipeline success:** exit 0 → `adw:building` removed, `adw:done` added, PR created, comment with PR link.
  - **Pipeline failure:** exit non-zero → `adw:building` removed, `adw:failed` added, error comment posted.
  - **findWorkspaceByIssueNumber:** finds workspace by issue_number field, returns null when not found.
  - **buildSpecFilename:** correct slug generation, truncation, special chars sanitized.
  - **parseArgs:** `--repo`, `--poll-ms`, `--agents-root`, `--once`, defaults.
  - **Skill-initiated issue (auto-approved):** issue created with `adw:building` label (no `adw:triage` or `adw:approved`) → skipped by triage scan → picked up by progress scan → handled like trigger-launched builds.
  - **`--no-issue` flag:** skill invocation with `--no-issue` skips issue creation, pipeline launches without issue metadata in state.
- All tests use fake `run` (for `gh` and `bun`) and fake filesystem (temp `agents/` dir). No real GitHub calls, no real pipeline launches.

### Step 15: Workspace state extension

- In `adws/adw-plan-review-build-patch.ts`, add to `WorkspaceState` (line ~262):
  ```ts
  /** SPEC-068: originating GitHub issue number (set by trigger or skill). */
  issue_number?: number;
  /** SPEC-068: originating GitHub issue URL (set by trigger or skill). */
  issue_url?: string;
  ```
- These fields are written by the trigger (or skills) before launching the pipeline (as env vars `ADW_ISSUE_NUMBER` / `ADW_ISSUE_URL` that the orchestrator records in state). The orchestrator itself does not use them — they're metadata for the trigger's progress reporting.

### Step 16: Skill modification — `/adw-plan` creates a GitHub tracking issue

- Modify `.zcode/skills/adw-plan/SKILL.md` to add a pre-launch step:
  - **Before Step 2** (the tmux launch), add a new step:
    1. If `--no-issue` is in the arguments, skip issue creation.
    2. Detect the repo from `git remote get-url origin` (parse owner/repo).
    3. Call `createIssue(deps, owner, repo, title, body, [LABEL_BUILDING])` where:
       - `title` is derived from the argument (e.g., `"adw: <description>"` or `"adw: <spec-filename>"`)
       - `body` includes the pipeline type (`plan → spec-review`), the argument, and a timestamp
       - Labels: `["adw:building"]` (auto-approved — skips triage and approval gates)
    4. Parse the returned `GithubIssue` for `number` and `html_url`.
    5. Pass these as env vars to the launcher: `ADW_ISSUE_NUMBER=<number> ADW_ISSUE_URL=<url> bun adws/adw-launch.ts --script adw-plan-reviewspec.ts $ARGUMENTS`
  - Update Step 2's bash command to include the env vars when issue creation succeeded.
  - Update Step 3's report to include the GitHub issue link: `GitHub issue: <url>`

### Step 17: Skill modification — `/adw-implement` creates a GitHub tracking issue

- Modify `.zcode/skills/adw-implement/SKILL.md` with the same pattern as Step 16:
  - Same pre-launch step: detect repo, create issue with `adw:building` label, parse result.
  - `title`: `"adw: <description>"` or `"adw: <spec-filename>"`.
  - `body` includes the pipeline type (`plan → spec-review → build → patch-review`), the argument, and a timestamp.
  - Pass `ADW_ISSUE_NUMBER` and `ADW_ISSUE_URL` as env vars to the launcher.
  - Update report to include the GitHub issue link.

### Step 18: Orchestrator reads issue env vars into state

- In `adws/adw-launch.ts` (or the orchestrator's state initialization), read `process.env.ADW_ISSUE_NUMBER` and `process.env.ADW_ISSUE_URL`.
- If present, parse `ADW_ISSUE_NUMBER` as a number and set `issue_number` and `issue_url` on the initial `WorkspaceState`.
- This is a small change: 2–3 lines in the state initialization path. No behavioral change when the env vars are absent.

### Step 19: Typecheck + build + test validation

- Run `bun run typecheck:src` — zero errors.
- Run `bun run typecheck:test` — zero errors.
- Run `bun run typecheck` — full project typecheck, zero errors.
- Run `bun run build` — build succeeds.
- Run `bun test test/unit/github.test.ts` — new GitHub module tests pass.
- Run `bun test test/unit/git-ops.test.ts` — consolidated git-ops tests pass.
- Run `bun test test/unit/trigger-cron.test.ts` — new trigger tests pass.
- Run `bun test test/unit/` — full unit suite, no regressions.

### Step 20: Manual smoke tests

- `bun adw-triggers/trigger-cron.ts --help` — prints USAGE, exits 0.
- `bun adw-triggers/trigger-cron.ts --repo mekael/tmax --once` — single scan of the configured repo, prints what it would do, exits 0. No labels modified, no specs created, no pipelines launched.
- Create a test issue on the repo with a known title. Run the trigger in `--once` mode. Verify the issue gets `adw:triage`, then `adw:ready-for-review` (or the triage-failure comment).

## Testing Strategy

### Unit Tests

- **`test/unit/github.test.ts`** — GitHub module: issue parsing, label operations, comment formatting, PR creation. All against a fake `run` — no real `gh` calls.
- **`test/unit/git-ops.test.ts`** — Consolidated git operations: existing worktree tests plus new pushBranch/createPRForIssue. Against a temp git fixture.
- **`test/unit/trigger-cron.test.ts`** — Trigger state machine: triage, approval, building guard, progress reporting, pipeline success/failure. Against fake `run` + fake filesystem.

### Integration Tests

- **Trigger end-to-end:** Create a real GitHub issue, run the trigger, verify the issue gets triaged and a spec is created. Manual — too slow for CI.
- **Pipeline launch from trigger:** Approve a triaged issue, verify the pipeline launches and completes. The trigger reports this on the issue.
- **PR creation:** After a successful build, verify the PR is created and linked to the issue.

### Edge Cases

- **`gh` not installed:** The GitHub module's `run` returns Left. The trigger logs an error and skips the scan. Does not crash.
- **`gh` auth expired:** Same as above — non-zero exit from `gh` → Left → skip.
- **Issue with no body:** `classify()` receives only the title. Works — classify handles short descriptions.
- **Issue body contains spec-like content:** The dispatch step may edit an existing spec or create a new one. The `agent.ts` logic handles both.
- **Pipeline subprocess hangs:** The trigger manages the pipeline as a foreground subprocess. If it hangs, the trigger is blocked on that issue. Mitigation: the trigger runs the pipeline via `adw-launch.ts --foreground`, which has its own timeout/stall detection via the watchdog. The trigger could add a wall-clock timeout on the subprocess and report a failure.
- **Trigger restart while pipeline is running:** The `adw:building` label persists on the issue. On restart, the progress scan finds the building issue and monitors its workspace state. The already-running pipeline is NOT re-launched because the trigger only launches when it transitions the labels itself.
- **Multiple issues approved simultaneously:** The trigger processes them sequentially (one pipeline at a time). The approval scan queues issues; the triage scan skips them while building. Future work: parallel pipeline dispatch.
- **Spec number collision:** The next spec number is determined by scanning `docs/specs/` for existing files — the same logic the plan stage uses. No collision possible.
- **Issue closed before build completes:** The trigger should check issue state before posting results. If the issue is closed, post the result anyway (it's still useful context) but skip PR creation (closed issues can't be linked to open PRs cleanly).
- **`gh` not available when skill creates issue:** If the skill can't create the issue (gh missing, auth expired, network error), log a warning and proceed without issue metadata. The pipeline still runs — issue creation is best-effort, not blocking.
- **Skill creates issue but pipeline fails immediately:** The issue has `adw:building` and never gets a successful build result. The trigger's progress scan detects the `failed` workspace state and swaps the label to `adw:failed` with an error comment. No orphaned `adw:building` issues persist.
- **`--no-issue` with trigger:** The `--no-issue` flag only applies to the skills. The trigger always works from existing GitHub issues — it never creates them.

## Acceptance Criteria

1. **`github.ts` exists and is injectable:** exports `GithubDeps`, all GitHub operations (`listIssuesByLabel`, `getIssue`, `addLabel`, `removeLabel`, `commentOnIssue`, `createPR`, `closeIssue`, `createIssue`), and all ADW label constants. Imports no `child_process` directly — uses injected `run`.
2. **`git-ops.ts` consolidates all git operations:** contains all functions previously in `worktree.ts` plus `pushBranch` and `createPRForIssue`. All existing imports through `worktree.ts` still resolve.
3. **`worktree.ts` is a backward-compat shim:** re-exports everything from `git-ops.ts`. All existing code compiles and tests pass without modification.
4. **`trigger-cron.ts` exists** with the dispatcher structure (USAGE, parseArgs, main, `import.meta.main`) and the `--repo`, `--poll-ms`, `--agents-root`, and `--once` flags.
5. **Triage creates a spec from an issue:** an unlabeled open issue gets `adw:triage`, then `adw:ready-for-review`, a spec file is created with the issue number in the filename, and the issue gets a comment with the spec path.
6. **Approval launches the pipeline:** an issue with both `adw:ready-for-review` + `adw:approved` gets labels swapped to `adw:building`, the adw pipeline is launched, and the issue gets a comment.
7. **Building guard prevents re-triggering:** issues with `adw:building` are skipped by both triage and approval scans. The state file is read for progress reporting.
8. **Pipeline success creates a PR:** on exit 0, `adw:building` is swapped to `adw:done`, a PR is created linked to the issue, and the issue gets a comment with the PR link.
9. **Pipeline failure reports the error:** on non-zero exit, `adw:building` is swapped to `adw:failed`, and the issue gets an error comment.
10. **`--once` mode is deterministic:** runs a single scan, prints intended actions, exits 0. No labels modified, no specs created, no pipelines launched, no comments posted.
11. **`WorkspaceState` has `issue_number` and `issue_url`:** the orchestrator records these when set by the trigger or the skills (via `ADW_ISSUE_NUMBER` / `ADW_ISSUE_URL` env vars). Existing orchestrator behavior is unchanged when env vars are absent.
12. **`/adw-plan` creates a GitHub tracking issue:** when invoked without `--no-issue`, the skill creates a GitHub issue with `adw:building` label before launching the pipeline. The issue number and URL are passed to the orchestrator and recorded in `WorkspaceState`.
13. **`/adw-implement` creates a GitHub tracking issue:** same behavior as `/adw-plan` — creates an issue with `adw:building` label before launching, records issue metadata in state.
14. **Skill-created issues are auto-approved:** issues created by the skills have `adw:building` directly (no `adw:triage` or `adw:approved` phase). The trigger's triage and approval scans skip these issues; the progress scan monitors them.
15. **`--no-issue` flag opts out:** when `--no-issue` is passed to `/adw-plan` or `/adw-implement`, no GitHub issue is created and the pipeline launches without issue metadata. Useful for offline usage or when GitHub tracking is not needed.
16. **Typecheck/build/tests pass:** `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`, `bun run build`, `bun run test:unit` all exit 0. All new tests pass, no regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run typecheck:src` — Source typecheck, zero errors.
- `bun run typecheck:test` — Test typecheck, zero errors.
- `bun run typecheck` — Full project typecheck, zero errors.
- `bun run build` — Build succeeds.
- `bun test test/unit/github.test.ts` — New GitHub module tests pass.
- `bun test test/unit/git-ops.test.ts` — Consolidated git-ops tests pass (includes former worktree tests).
- `bun test test/unit/trigger-cron.test.ts` — New trigger tests pass.
- `bun test test/unit/worktree.test.ts` — Existing worktree tests pass through the shim (no regressions).
- `bun test test/unit/` — Full unit test suite, no regressions.
- `bun adw-triggers/trigger-cron.ts --help` — Prints USAGE, exits 0.
- `bun adw-triggers/trigger-cron.ts --repo mekael/tmax --once` — Single scan against the configured repo, prints intended actions, exits 0. No side effects.

## Notes

- **Why `adw-triggers/` as a separate directory.** The existing `adws/` directory contains single-run dispatchers and orchestrators. A trigger is a long-lived daemon with a different lifecycle: it runs forever, manages its own poll loop, and is started once. Separating it into `adw-triggers/` makes the distinction clear and avoids polluting the `adws/` directory listing.

- **Why `gh` CLI over a GitHub SDK.** The project has zero external dependencies (AGENTS.md: "Zero external dependencies"). `gh` is already installed and used for GitHub interaction. Wrapping it as an injected module keeps the dependency count at zero while providing full GitHub API access. The `--json` flag gives structured output.

- **Why consolidate worktree.ts into git-ops.ts.** The user's explicit requirement: all git functionality in one module. `worktree.ts` is 540 lines and growing; `git-ops.ts` centralizes git operations (branch, commit, push, merge, worktree, PR) while `github.ts` centralizes GitHub API operations (issues, labels, comments). Clean separation of concerns.

- **Why labels only (no comments for state).** Labels are queryable (`gh issue list --label`), visible in the GitHub UI at a glance, and survive bot restarts. Comments are for details and progress — not for state tracking. The user chose labels-only during the interview.

- **Why not parallel pipeline dispatch.** The first version processes one approved issue at a time. Parallel dispatch adds complexity (subprocess management, resource contention, concurrent workspace coordination) that can be added later when there's a concrete need. The sequential approach matches the watchdog's pattern of one-action-per-poll-cycle.

- **Relationship to existing pipeline.** The trigger is a new **consumer** of the existing pipeline, not a modification to it. `adw-launch.ts` is called as a subprocess exactly as a human would type it. The orchestrator, stage dispatchers, watchdog, and status dashboard are all unchanged. The only orchestrator change is two optional fields in `WorkspaceState`.

- **Bidirectional GitHub integration.** The system has two entry points that converge on the same label-based state machine: (1) GitHub issues submitted by users are triaged by `trigger-cron` and follow the full `adw:triage → adw:ready-for-review → adw:approved → adw:building → adw:done` lifecycle. (2) Skills (`/adw-plan`, `/adw-implement`) create tracking issues with `adw:building` directly, skipping triage and approval because the developer already approved the work by invoking the skill. Both entry points use the same `github.ts` module, the same label constants, and the same `WorkspaceState` fields. The trigger's progress scan monitors all `adw:building` issues regardless of origin.

- **Why skill-created issues are auto-approved.** When a developer runs `/adw-plan` or `/adw-implement`, they've already decided to do the work — the approval is implicit in the invocation. Requiring manual GitHub label approval would add friction to a workflow the developer initiated themselves. The `adw:building` label is applied directly, and the trigger's progress scan takes over monitoring. Issues from GitHub submissions (external input) still require explicit human approval via the `adw:approved` label.

- **Why `--no-issue` flag.** Not every pipeline run needs GitHub tracking. Local experiments, offline work, or runs on private repos where `gh` auth isn't configured should work without issue creation. The `--no-issue` flag preserves the existing behavior as the default opt-out path.

- **Future: webhook delivery.** The cron poll has 30-60s lag. A GitHub App webhook would be real-time but requires a server. This spec uses polling as the pragmatic first step; webhook support can be added later as a separate module that replaces the poll scan with webhook handlers.

- **Future: revision flow.** When the spec reviewer (human or automated) wants changes before approving, they could comment on the issue with feedback. The trigger could parse structured feedback comments, update the spec, and re-add `adw:ready-for-review`. This is not in scope for the first version — the approval flow is binary (approved or not). The revision flow can be added as a follow-up spec.

- **Future: project board integration.** GitHub project boards could show a Kanban-style view of adw issues by label. This is out of scope — the label-based state machine is the foundation, and project boards are a view layer on top.
