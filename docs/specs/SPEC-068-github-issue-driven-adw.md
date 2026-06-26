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

4. **Scattered git operations.** Git operations (branch creation, commits, worktree management, merge, push) are spread across `worktree.ts` (657 lines), the orchestrator, and `remote.ts`. There's no single module that owns the full git lifecycle, and GitHub-facing operations (create PR, link issue) don't exist anywhere.

5. **No issue tracking from CLI launches.** When a developer runs `/adw-plan` or `/adw-implement` directly, the pipeline runs in tmux with no GitHub artifact. There's no tracking issue, no PR linked to an issue, and no way for collaborators to see what's being built from the GitHub UI. The trigger-cron path creates issues automatically, but the direct-CLI path is invisible on GitHub.

## Solution Statement

Four parts:

**1. GitHub API module (`adws/adws-modules/github.ts`).** A dependency-injected module wrapping the `gh` CLI for all GitHub operations: list issues by label, read an issue, create an issue, post comments, add/remove labels, create PRs, close issues. Zero new dependencies — everything via `gh` (already installed on the system per AGENTS.md). Follows the existing `Deps` interface convention (like `remote.ts`, `worktree.ts`). Shared by both the trigger-cron daemon and the `/adw-plan`/`/adw-implement` skills.

**2. Git operations module (`adws/adws-modules/git-ops.ts`).** Consolidates all git operations currently in `worktree.ts` into a single module, plus adds GitHub-facing operations: push a branch to origin, create a PR linked to an issue, and link the issue to the PR. `worktree.ts` becomes a thin re-export shim for backward compatibility. This is the module the trigger and orchestrator both import.

**3. Bidirectional GitHub integration.** Two entry points create and track GitHub issues:

- **GitHub → pipeline (trigger-cron):** A long-lived daemon (`adw-triggers/trigger-cron.ts`) that polls GitHub issues on a cadence (default 60s). Submitted issues are triaged, converted to specs, approved via labels, built by the pipeline, and delivered as PRs — all tracked on the issue.

- **Pipeline → GitHub (skills):** When `/adw-plan` or `/adw-implement` is invoked directly, the skill creates a GitHub issue as a tracking artifact before launching the pipeline. The issue gets `adw:building` and the workspace state records `issue_number` + `issue_url`. On completion, `/adw-implement` creates and links a PR; `/adw-plan` ends at `status: "planned"` and moves the issue back to `adw:ready-for-review` with a comment linking the planned spec. This gives every pipeline run — whether started from GitHub or from the CLI — a single GitHub issue as its thread of truth.

Both paths converge on the same label scheme, the same `github.ts` module, and the same `issue_number` field in `adw-state.json`. The trigger-cron treats skill-created issues identically to human-submitted ones.

**4. Issue-tracked state.** Each adw workspace records the originating `issue_number` and `issue_url` in `adw-state.json`. For GitHub-submitted issues, triage also writes a persistent issue-to-spec mapping before approval: `adw-triggers/issue-map.json` maps the issue number to the spec path and, once a workspace exists, the workspace id. This closes the handoff between direct `classify()`/`dispatch()` spec creation and the later approval launch. The generated spec filename includes the issue number and preserves the existing work-type prefix chosen by `agent.ts`/`dispatch()` (`SPEC-###-issue-<number>-<slug>.md`, `BUG-##-issue-<number>-<slug>.md`, or `CHORE-##-issue-<number>-<slug>.md`). The trigger posts structured comments on the issue at every state transition.

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
     full build completes → [adw:done] or [adw:failed]
     plan-only completes → [adw:ready-for-review] or [adw:failed]
                     │
     PR created + linked to issue (full build only)
```

### Design decisions (from interview)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | State tracking | **Labels only** | Every state is a label (`adw:triage`, `adw:ready-for-review`, `adw:approved`, `adw:building`, `adw:done`, `adw:failed`). Queryable via `gh issue list --label`. Clean, visible in GitHub UI. |
| 2 | Delivery mechanism | **Cron poll** | `trigger-cron.ts` polls every 60s. Follows the `adw-watchdog.ts` pattern. No server needed. 30-60s lag is acceptable for a build pipeline. |
| 3 | Spec naming | **Issue in filename, work-type prefix preserved** | `SPEC-068-issue-42-better-search.md`, `BUG-21-issue-42-crash-on-save.md`, or `CHORE-31-issue-42-cleanup.md`. Issue number is baked into the filename, while the `SPEC`/`BUG`/`CHORE` prefix and numbering stay consistent with the existing feature/bug/chore dispatch split. |
| 4 | Approval flow | **Label `adw:approved`** | Human adds the label. Trigger checks for `adw:ready-for-review` + `adw:approved`. Simple, unambiguous, no parsing. |
| 5 | Progress output | **Issue comments only** | All stage transitions, build results, and PR links posted as comments on the issue. Single thread of truth. |
| 6 | Module split | **Separate github.ts + git-ops.ts** | `github.ts` = GitHub API layer (issues, PRs, comments, labels via `gh`). `git-ops.ts` = git operations (branches, commits, push, merge). `worktree.ts` functions move into `git-ops.ts`. |
| 7 | Resume guard | **Both label + state** | `adw:building` label = fast gate (cron skips). `adw-state.json` = source of truth for progress reporting. Belt and suspenders. |

## Relevant Files

Use these files to implement the feature:

### Existing Files to Read (reference)

- **`adws/adws-modules/agent.ts`** — The LLM interface for classify + dispatch. The trigger reuses `classify()` and `dispatch()` to turn an issue title+body into a spec. No changes to this file.
- **`adws/adw-launch.ts`** — The tmux launcher. The trigger calls this to launch the full pipeline for an approved issue. Step 19 verifies it preserves `ADW_ISSUE_NUMBER`/`ADW_ISSUE_URL` when spawning the selected orchestrator.
- **`adws/adws-modules/workspace.ts`** — `findWorkspaceBySpecPath` + `normalizeSpecPath`. Add `findWorkspaceByIssueNumber` so the trigger can map `adw:building` issues back to `agents/<id>/adw-state.json` after the pipeline has created a workspace.
- **`adws/adw-status.ts`** — The dashboard. Issue-driven workspaces show up as additional rows — no changes needed.
- **`adws/adw-watchdog.ts`** — The poll-loop pattern the trigger mirrors. Same structure: `parseArgs`, `main`, `import.meta.main`, long-lived `setInterval` loop.
- **`adws/adws-modules/worktree.ts`** — Git operations to be consolidated into `git-ops.ts`. After migration, `worktree.ts` re-exports from `git-ops.ts` for backward compatibility.
- **`adws/adws-modules/remote.ts`** — SSH config parsing pattern. The GitHub module follows the same dependency-injected `Deps` pattern.
- **`docs/specs/SPEC-066-adw-watchdog.md`** — Reference spec for the cron-poll daemon pattern. The trigger follows the same structure.

### Existing Files to Modify

- **`adws/adws-modules/worktree.ts`** — Migrate all exports to `git-ops.ts`. Replace function bodies with re-exports: `export { createWorktree, removeWorktree, commitSpecToMain, ... } from "./git-ops.ts"`. Keep the file as a backward-compat shim so existing imports (`adw-launch.ts`, `adw-plan-review-build-patch.ts`, `adw-status.ts`) continue to work without modification.
- **`adws/adws-modules/workspace.ts`** — Add `findWorkspaceByIssueNumber(agentsDir, issueNumber)` beside `findWorkspaceBySpecPath`.
- **`adws/adw-plan-reviewspec.ts`** — Add optional `issue_number?: number` and `issue_url?: string` fields to both `WorkspaceState` and `OrchestratorState`, and initialize them from env vars in the initial state. This is the orchestrator actually used by `/adw-plan`.
- **`adws/adw-plan-reviewspec-build.ts`** — Add the same issue metadata fields to both state interfaces and state initialization for the intermediate plan→review→build orchestrator.
- **`adws/adw-plan-review-build-patch.ts`** — Add the same issue metadata fields to both state interfaces and state initialization for the full build orchestrator used by `/adw-implement`.
- **`.zcode/skills/adw-plan/SKILL.md`** — Update the tracked skill source. `.codex/skills` is gitignored local Codex runtime/cache state in this checkout and must not be part of committed acceptance criteria. Add a pre-launch step that creates a GitHub tracking issue before launching the pipeline. The issue is created with `adw:building` (auto-approved — skips the triage and approval gates). The issue number and URL are passed to the launcher via env vars (`ADW_ISSUE_NUMBER`, `ADW_ISSUE_URL`) so the orchestrator records them in state. A `--no-issue` flag opts out for offline usage.
- **`.zcode/skills/adw-implement/SKILL.md`** — Same modification as `adw-plan`: create a GitHub tracking issue before launching, auto-add `adw:building`, pass issue metadata via env vars, support `--no-issue`.
- **`.gitignore`** — Add ignore rules for trigger runtime state/log artifacts (`adw-triggers/issue-map.json` and `adw-triggers/runs/`) while allowing a committed directory placeholder if needed.

### New Files

- **`adws/adws-modules/github.ts`** — GitHub API module via `gh` CLI. Dependency-injected: `GithubDeps { run }`. Exports: `listIssuesByLabel`, `listOpenIssues`, `getIssue`, `addLabel`, `removeLabel`, `commentOnIssue`, `createPR`, `closeIssue`, `createIssue`.
- **`adws/adws-modules/git-ops.ts`** — Consolidated git operations module. Moves all functions from `worktree.ts` here, plus adds: `pushBranch`, `createPRForIssue` (combines push + GitHub PR creation + issue link).
- **`adws/adw-create-tracking-issue.ts`** — Small CLI wrapper used by Markdown skills. It detects `owner/repo`, creates the GitHub tracking issue via `github.ts`, then prints shell-safe `ADW_ISSUE_NUMBER=...` and `ADW_ISSUE_URL=...` assignments or JSON. Skills invoke this wrapper instead of trying to call TypeScript functions directly.
- **`adw-triggers/trigger-cron.ts`** — Long-lived poll daemon. Watches GitHub issues, drives the label state machine, creates specs, launches pipelines, posts progress, creates PRs. Follows the `adw-watchdog.ts` dispatcher structure.
- **`adw-triggers/.gitkeep`** — Optional committed placeholder so the ignored trigger state directory exists in fresh checkouts. Do not commit `issue-map.json` or `runs/` contents.
- **`test/unit/github.test.ts`** — Unit tests for the GitHub module (issue parsing, comment formatting, label operations) against a fake `run`.
- **`test/unit/git-ops.test.ts`** — Unit tests for the git-ops module (consolidated from existing `worktree.test.ts` plus new PR-push operations).
- **`test/unit/trigger-cron.test.ts`** — Unit tests for the trigger's state machine (issue triage, approval detection, pipeline launch guard, progress reporting).
- **`test/unit/adw-create-tracking-issue.test.ts`** — Unit tests for the tracking-issue wrapper: `--help`, repo parsing, JSON output, shell output, label forwarding, failure fallback contract, and `--no-issue`.

## Implementation Plan

### Phase 1: GitHub API module

Build `adws/adws-modules/github.ts` — the dependency-injected GitHub interface. All operations via `gh` CLI. Zero new dependencies. This is the foundation the trigger calls for every GitHub interaction.

### Phase 2: Git operations consolidation

Build `adws/adws-modules/git-ops.ts` by moving all functions from `worktree.ts` and adding PR/push operations. Convert `worktree.ts` to a re-export shim. This consolidates all git operations into one module and adds the GitHub-facing operations the trigger needs.

### Phase 3: Cron trigger

Build `adw-triggers/trigger-cron.ts` — the long-lived poll daemon that drives the issue→spec→approve→build→PR lifecycle. Follows the `adw-watchdog.ts` pattern: `parseArgs`, `main`, `import.meta.main`, long-lived poll loop.

### Phase 4: Skill integration

Modify `/adw-plan` and `/adw-implement` skills to create GitHub tracking issues before launching the pipeline. Skill-created issues are auto-approved (skip triage/approval gates). Add env var passthrough (`ADW_ISSUE_NUMBER`, `ADW_ISSUE_URL`) so the selected orchestrator records issue metadata in `adw-state.json`.

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
    url: string;
  }
  export interface GithubPR {
    number: number;
    url: string;
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
- Define label provisioning helpers:
  ```ts
  export interface GithubLabel {
    name: string;
    color?: string;
    description?: string;
  }
  export function listLabels(deps, owner, repo): TaskEither<string, GithubLabel[]>
  export function ensureLabels(deps, owner, repo): TaskEither<string, void>
  ```
  `ensureLabels` lists repository labels, creates any missing `ADW_LABELS` with deterministic colors/descriptions via `gh label create`, and treats "already exists" as success. The trigger calls this once at startup before any `gh issue edit --add-label` or `gh issue create --label` operation. Skill wrapper issue creation also calls it before creating the tracking issue.

### Step 2: GitHub API module — core functions

- Implement `listIssuesByLabel(deps, owner, repo, label, state?)` — `gh issue list --repo <owner>/<repo> --label <label> --json number,title,body,labels,state,url --state <state>`. Returns `TaskEither<string, GithubIssue[]>`.
- Implement `listOpenIssues(deps, owner, repo)` — `gh issue list --repo <owner>/<repo> --state open --json number,title,body,labels,state,url --limit 100`. Returns `TaskEither<string, GithubIssue[]>`. Used by triage to filter locally for issues with none of the `ADW_LABELS`.
- Implement `getIssue(deps, owner, repo, number)` — `gh issue view <number> --repo <owner>/<repo> --json number,title,body,labels,state,url`. Returns `TaskEither<string, GithubIssue>`.
- Implement `addLabel(deps, owner, repo, number, label)` — `gh issue edit <number> --repo <owner>/<repo> --add-label <label>`. Returns `TaskEither<string, void>`.
- Implement `removeLabel(deps, owner, repo, number, label)` — `gh issue edit <number> --repo <owner>/<repo> --remove-label <label>`. Returns `TaskEither<string, void>`.
- Implement `commentOnIssue(deps, owner, repo, number, body)` — `gh issue comment <number> --repo <owner>/<repo> --body <body>`. Returns `TaskEither<string, void>`.
- Implement `createPR(deps, owner, repo, head, base, title, body)` — first run `gh pr create --repo <owner>/<repo> --head <head> --base <base> --title <title> --body <body>` and parse the created PR URL from stdout, then run `gh pr view <url-or-number> --repo <owner>/<repo> --json number,url,state`. `gh pr create` does not support the same `--json` contract as `gh pr view/list`; do not pretend it returns JSON directly. Returns `TaskEither<string, GithubPR>`.
- Implement `closeIssue(deps, owner, repo, number)` — `gh issue close <number> --repo <owner>/<repo>`. Returns `TaskEither<string, void>`.
- Implement `createIssue(deps, owner, repo, title, body, labels?)` — first run `gh issue create --repo <owner>/<repo> --title <title> --body <body> [--label <label>...]` and parse the created issue URL from stdout, then run `gh issue view <url-or-number> --repo <owner>/<repo> --json number,title,body,labels,state,url`. `gh issue create` does not support the same `--json` contract as `gh issue view/list`; do not parse JSON from `issue create` stdout. Returns `TaskEither<string, GithubIssue>`. Used by the skills to create tracking issues before pipeline launch.
- Implement `listLabels` / `ensureLabels` — `gh label list --repo <owner>/<repo> --json name,color,description --limit 200`, then `gh label create <label> --repo <owner>/<repo> --color <hex> --description <text>` for any missing ADW label. Missing labels are a startup/configuration error for trigger operation if creation fails.
- Functions that read existing resources parse `gh --json` output. Creation functions parse the URL printed by `gh issue create` / `gh pr create`, then call `gh issue view` / `gh pr view` with `--json` to return normalized objects. Handle `gh` errors (non-zero exit, missing fields) with clear Left messages.

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
  - `createIssue`: parses the URL printed by `gh issue create`, follows it with `gh issue view --json ...`, and verifies correct `gh issue create` argv with title, body, and optional labels.
  - `listOpenIssues`: parses open issues and leaves ADW-label exclusion to the caller.
  - `ensureLabels`: creates missing ADW labels, skips existing labels, and reports label creation failures clearly.
- Run `bun test test/unit/github.test.ts` — all green.

### Step 4: Git operations consolidation — migrate worktree.ts to git-ops.ts

- Create `adws/adws-modules/git-ops.ts`.
- Move ALL function implementations from `worktree.ts` into `git-ops.ts`:
  - `detectWorktree`, `createWorktree`, `removeWorktree`
  - `branchExists`, `createWorktreeFromBase`, `validateWorktree`
  - `commitSpecToMain`, `commitWorktreeChanges`, `mergeBranchToMain`
  - `withPlanningLock`, `listWorktrees`
  - `siblingWorktreePath`, `defaultLockPath`
  - `runGitCmd` (the real subprocess runner)
  - All types: `GitRun`, `WorktreeDeps`, `WorktreeEntry`, `CommitResult`, `WorktreeValidation`
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
    base: string,
  issueNumber: number,
  specPath: string,
): TaskEither<string, GithubPR>
```
  — Pushes the branch to origin, then creates a PR via the GitHub module with title derived from the spec filename and body referencing the issue (`Closes #<issueNumber>`). The `base` parameter is required and must be passed through unchanged; `createPRForIssue` must not resolve or default the base branch. The trigger owns base branch resolution once at startup. Returns the PR.

### Step 6: Git operations consolidation — worktree.ts backward-compat shim

- Replace `worktree.ts`'s function bodies with re-exports from `git-ops.ts`:
  ```ts
  // worktree.ts — backward-compatibility shim.
  // All git operations have been consolidated into git-ops.ts.
  // This file re-exports everything so existing imports continue to work.
  export {
    detectWorktree,
    createWorktree,
    createWorktreeFromBase,
    branchExists,
    validateWorktree,
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
    type WorktreeValidation,
  } from "./git-ops.ts";
  ```
- Run `bun run typecheck` — verify no breakage. All existing imports resolve through the shim.

### Step 7: Git operations unit tests

- Create `test/unit/git-ops.test.ts` by copying the existing `test/unit/worktree.test.ts` tests.
- Add tests for new operations:
  - `pushBranch`: verifies correct `git push origin <branch>` argv.
  - `createPRForIssue`: verifies push + gh pr create sequence, required explicit base branch, title/body formatting, issue link in PR body, and no internal default-branch lookup.
- Run `bun test test/unit/git-ops.test.ts` — all green.
- Run `bun run test:unit` — verify existing worktree tests still pass through the shim.

### Step 8: Cron trigger — skeleton

- Create `adw-triggers/trigger-cron.ts` mirroring the dispatcher structure:
  - File header comment (purpose, usage, exit codes).
  - `USAGE` constant documenting `--repo <owner/repo>`, `--poll-ms <ms>`, `--agents-root <path>`, `--base <branch>` (PR target branch), `--max-concurrent <n>` (default `1`), `--once` (single real scan then exit), and `--dry-run` (print intended actions only; no labels, comments, specs, issue-map writes, or pipeline launches).
  - `parseArgs`, `main`, `import.meta.main` guard.
- Define the trigger-specific types:
  ```ts
  export interface TriggerArgs {
    owner: string;
    repo: string;
    pollMs: number;
    agentsRoot: string;
    baseBranch: string;
    maxConcurrent: number;
    once: boolean;
    dryRun: boolean;
  }
  ```
- Implement `resolveBaseBranch(deps, owner, repo, explicitBase?)`: if `explicitBase` is provided, return it; otherwise run `gh repo view <owner>/<repo> --json defaultBranchRef` once at startup and read `defaultBranchRef.name`; use `main` only as a documented warning fallback if the query fails.
- Call `ensureLabels(deps, owner, repo)` once at startup unless `--dry-run` is set. In `--dry-run`, call `listLabels` and print which ADW labels would be created, but do not create them.
- Maintain `activeLaunches: Map<number, ChildProcess>` and `pendingApprovals: number[]`. With the default `--max-concurrent 1`, launch at most one pipeline at a time. Higher values are accepted only if explicitly passed and must still honor the map/queue guard.
- Update `.gitignore` so trigger runtime state is not committed:
  ```gitignore
  # adw GitHub trigger runtime state and planner logs
  adw-triggers/issue-map.json
  adw-triggers/runs/
  ```
  If the implementation needs `adw-triggers/` to exist in fresh checkouts, commit only `adw-triggers/.gitkeep`.

### Step 9: Cron trigger — issue triage (opened → spec creation)

- Implement the triage scan by listing open issues and filtering locally:
  - Run `gh issue list --repo <owner>/<repo> --state open --json number,title,body,labels,state,url --limit 100` through `listOpenIssues`.
  - Keep only issues whose label set contains none of the `ADW_LABELS`.
  - Do not use `gh issue list --label <none of the adw: labels>`; `gh issue list` supports positive label filters, not that negative selector.
- For each unlabeled open issue:
  1. Add `adw:triage` label.
  2. Comment: `🤖 **[ADW]** Triage started — classifying issue...`
  3. Call `classify()` from `agent.ts` with the issue title + body.
  4. Create a trigger planner log path: `adw-triggers/runs/<issue-number>-<timestamp>/planner/raw-output.jsonl`.
  5. Call `dispatch()` from `agent.ts` with that planner log path to create the spec (or edit an existing one). Include an issue-context prefix in the description passed to `dispatch()`:
     `GitHub issue #<number>: <title>\n\n<body>\n\nThe resulting spec file must include issue-<number>-<slug> and preserve the classified work-type prefix (SPEC, BUG, or CHORE).`
     The resulting spec file must include `issue-<number>-<slug>` and must preserve the work-type prefix chosen by classification (`SPEC`, `BUG`, or `CHORE`). This prompt instruction is advisory only; the trigger must still normalize the returned path after `dispatch()` because `dispatch()` does not accept a filename or issue number.
  6. Handle every `DispatchOutcome` variant explicitly:
     - `created`: use `outcome.path` as the candidate spec path, then rename it to `docs/specs/<PREFIX>-<number>-issue-<number>-<slug>.md` if it does not already match. Preserve the existing prefix and number from the created file when possible (`SPEC-###`, `BUG-##`, or `CHORE-##`); otherwise allocate the next sequential number for that prefix.
     - `modified`: use `outcome.path` as the candidate spec path, then rename it to `docs/specs/<PREFIX>-<number>-issue-<number>-<slug>.md` if it does not already match. Preserve the existing prefix and number from the modified file; do not convert `BUG` or `CHORE` files to `SPEC`. This makes approval deterministic even when the skill edited an existing spec. The issue map records the final renamed path.
     - `noop`: treat as triage failure for GitHub automation because there is no spec path to approve. Remove `adw:triage`, comment with the noop summary and the planner log path, do not add `adw:ready-for-review`, and do not write an issue-map entry.
  7. On created/modified success: persist `adw-triggers/issue-map.json` with `{ "<issueNumber>": { "issue_number": <number>, "issue_url": <url>, "spec_path": "<repo-relative-spec-path>" } }`. This is the durable handoff from triage to approval because direct `classify()`/`dispatch()` does not create an `agents/<id>/adw-state.json` workspace.
  8. Remove `adw:triage`, add `adw:ready-for-review`, comment with the spec path and a link to the spec file.
  9. On classify/dispatch/rename failure: remove `adw:triage`, comment with the error and planner log path when available, do NOT add `adw:ready-for-review` and do NOT write an issue-map entry (human must investigate).
- The issue-derived filename follows the existing work-type split: feature work uses `SPEC-###-issue-<number>-<slug>.md`, bug work uses `BUG-##-issue-<number>-<slug>.md`, and chore work uses `CHORE-##-issue-<number>-<slug>.md`. Number allocation is prefix-specific and uses the same next-number logic as the existing feature/bug/chore planning flow.
- Workspace state is created later, when approval launches `adw-launch.ts`. At launch, pass `ADW_ISSUE_NUMBER`, `ADW_ISSUE_URL`, and the mapped spec path so the orchestrator records the issue metadata in `adw-state.json`.

### Step 10: Cron trigger — approval gate (ready-for-review + approved → pipeline launch)

- Implement the approval scan: `gh issue list --label "adw:approved" --label "adw:ready-for-review" --state open`.
- For each issue with both labels:
  1. Read `adw-triggers/issue-map.json` and resolve the issue number to a repo-relative `spec_path`. If no mapping exists, try a fallback search for `docs/specs/*issue-<number>-*.md`; if still missing, leave labels unchanged and comment with a clear error instead of launching.
  2. If `activeLaunches.size >= maxConcurrent`, leave labels unchanged, add the issue number to `pendingApprovals` if not already present, and do not launch in this scan.
  3. Remove `adw:approved` and `adw:ready-for-review` labels.
  4. Add `adw:building` label.
  5. Comment: `🤖 **[ADW]** Pipeline launched — building spec [SPEC-XXX](path)...`
  6. Spawn `bun adws/adw-launch.ts --foreground <spec-path>` as a subprocess with explicit environment options, not shell-style env assignments in argv and not a shell requirement. The contract is:
     ```ts
     Bun.spawn({
       cmd: ["bun", "adws/adw-launch.ts", "--foreground", specPath],
       env: {
         ...process.env,
         ADW_ISSUE_NUMBER: String(issue.number),
         ADW_ISSUE_URL: issue.url,
       },
     });
     ```
     The trigger does not delegate to tmux, but it must also not block the poll loop while waiting. Store the child process in `activeLaunches` keyed by issue number, register an exit handler that removes the entry, and return to the next scan.
  7. Once the spawned orchestrator has created `agents/<id>/adw-state.json`, call `findWorkspaceByIssueNumber(agentsDir, issueNumber)` and update the issue-map entry with `workspace_id: "<id>"`. This mapping is an optimization for progress reporting; if it is missing after a restart, the progress scan can rediscover it.
  8. On pipeline success (exit 0): do not rely only on the exit handler; let the progress scan read the final workspace status and apply the terminal label/comment behavior below.
  9. On pipeline failure (exit non-zero): remove `adw:building`, add `adw:failed`, comment with the error: `❌ **[ADW]** Build failed — <error summary>`.
- The `adw:building` label is the fast guard: the triage scan and approval scan both skip issues with this label.
- The first version is sequential by default: `--max-concurrent` defaults to `1`, so only one approved issue is actively building unless the operator explicitly raises the limit.

### Step 11: Cron trigger — progress reporting

- Implement a progress scan that polls building issues: `gh issue list --label "adw:building" --state open`.
- For each building issue, read `adw-triggers/issue-map.json` for `workspace_id`; if absent, call `findWorkspaceByIssueNumber(agentsDir, issueNumber)`. Once found, persist `workspace_id` back into the issue-map entry. Then read `agents/<id>/adw-state.json` and `orchestrator/events.jsonl`.
- If the workspace status changed since the last comment (e.g., stage transition from build to test), post a progress comment: `🤖 **[ADW]** Stage update: build → test...`
- Track the last reported stage in a local map (in-memory, resets on restart — acceptable because duplicate comments are harmless).
- If the workspace status is `completed`, first refresh the issue via `getIssue`. If the issue is closed, remove `adw:building`, add `adw:done`, record `terminal_status: "completed"` in the issue map, comment with the completion summary, and skip PR creation. If the issue is still open, read `branch` and `implementation_commit` from `agents/<id>/adw-state.json`; pass the recorded `branch` to `createPRForIssue` with the configured base branch and comment with the PR link: `✅ **[ADW]** Build complete — PR: #<pr-number>`. If `branch` is missing or `implementation_commit` is `undefined`, do not guess a branch or create a PR; leave the issue without `adw:done`, add `adw:failed`, and comment with a clear state-corruption error for human recovery. If `implementation_commit` is `null`, treat the completed run as having no implementation changes: remove `adw:building`, add `adw:done`, comment that no PR was created because there was no implementation commit, and record terminal completion in the issue map.
- If the workspace status is `planned`, treat it as a successful terminal state for `/adw-plan` tracking issues only: remove `adw:building`, add `adw:ready-for-review`, and comment with the planned spec path. Do not create a PR for `planned`.
- If the workspace status is `failed`, remove `adw:building`, add `adw:failed`, and comment with the error summary.
- Terminal handling is idempotent: before swapping labels or creating a PR, check whether the issue already has `adw:done`, `adw:failed`, or a recorded `pr_url` in the issue map. This avoids duplicate PRs/comments after trigger restarts.
- These fallbacks run during normal polling because Step 10 launches subprocesses asynchronously. They also cover trigger restarts where the original child-process exit handler is no longer registered.

### Step 12: Cron trigger — helper functions

- In `adws/adws-modules/workspace.ts`, implement `findWorkspaceByIssueNumber(agentsDir, issueNumber)`: scan `agents/*/adw-state.json` for `issue_number === issueNumber`. Returns the newest matching workspace id or `null`. Mirrors `findWorkspaceBySpecPath` and is exported for `trigger-cron.ts` and tests.
- In `adw-triggers/trigger-cron.ts`, implement private issue-map helpers:
  - `readIssueMap(mapPath)`: returns `{ [issueNumber: string]: { issue_number: number; issue_url: string; spec_path: string; workspace_id?: string } }`, treating a missing file as an empty map.
  - `writeIssueMap(mapPath, map)`: writes JSON atomically enough for this single-process trigger (temp file then rename).
  - `findSpecPathForIssue(issueNumber)`: read the map first, then fallback to scanning `docs/specs/*issue-<number>-*.md`.
- Extend issue-map entries with optional terminal metadata: `pr_url?: string`, `pr_number?: number`, `terminal_status?: "planned" | "completed" | "failed"`.
- Implement `buildIssueSpecFilename(issueNumber, issueTitle, existingSpecPath?)`: `<PREFIX>-<number>-issue-<issueNumber>-<slug>.md`. If `existingSpecPath` starts with `SPEC-###-`, `BUG-##-`, or `CHORE-##-`, preserve that prefix and number; otherwise use the classification result to choose the prefix and call the same prefix-specific numbering logic used by the plan stage. Slug is kebab-cased from the issue title, truncated to 50 chars.
- Implement `normalizeIssueSpecPath(issueNumber, issueTitle, dispatchOutcome)`: accepts only `created` and `modified` outcomes, renames the candidate spec to the prefix-preserving issue filename pattern when needed, and returns the final repo-relative path. For `noop`, return a typed failure with the noop summary.
- Implement `buildComment(parts)`: format structured adw comments with emoji prefix and markdown sections.

### Step 13: Cron trigger — poll loop and main

- In `main`, assemble the poll loop:
  1. Every `pollMs`: run triage scan, approval scan, progress scan.
  2. Each scan is independent — a failure in one doesn't block the others.
  3. Approval launches honor `maxConcurrent`; queued approvals remain labeled `adw:ready-for-review` + `adw:approved` until capacity is available.
  4. `--once` mode: run one pass of all three phases, applying real side effects unless `--dry-run` is also present, then exit. If capacity is full, `--once` reports queued approvals but does not wait for capacity.
  5. `--dry-run` mode: print results and intended actions only. No labels modified, no comments posted, no specs created, no issue-map writes, no PRs created, no pipelines launched, and no missing labels created. `--dry-run` can be combined with long-lived mode, but the smoke-test path is `--once --dry-run`.
- Long-lived mode: runs forever (like `adw-watchdog.ts`). The `--dry-run` flag is the no-side-effects path.

### Step 14: Trigger unit tests

- Create `test/unit/trigger-cron.test.ts`.
- Test cases:
  - **Triage scan:** unlabeled issue → `adw:triage` added → classify + dispatch called → `adw:ready-for-review` added.
  - **Triage mapping:** successful triage writes `adw-triggers/issue-map.json` with issue number, URL, and spec path before approval.
  - **Dispatch outcomes:** `created` and `modified` outcomes are normalized/renamed to the prefix-preserving issue filename pattern (`SPEC`, `BUG`, or `CHORE`); `noop` removes `adw:triage`, posts the noop summary, and writes no issue-map entry.
  - **Triage planner logs:** dispatch receives a planner log under `adw-triggers/runs/<issue>-<timestamp>/planner/raw-output.jsonl`.
  - **Triage failure:** classify fails → `adw:triage` removed, error comment posted, no `adw:ready-for-review`.
  - **Approval scan:** issue with both `adw:ready-for-review` + `adw:approved` → spec path resolved from issue-map, labels removed, `adw:building` added, pipeline launched with `ADW_ISSUE_NUMBER` and `ADW_ISSUE_URL`.
  - **Approval queue:** with `--max-concurrent 1` and one active launch, a second approved issue remains queued and is not launched until capacity is available.
  - **Approval missing mapping:** approved issue with no issue-map entry and no spec fallback gets an explanatory comment and is not launched.
  - **Building guard:** issue with `adw:building` → skipped by triage and approval scans.
  - **Progress scan:** workspace discovered by `findWorkspaceByIssueNumber`, issue-map updated with workspace id, workspace transitions stages → progress comment posted only on change.
  - **Pipeline success:** exit 0 for an open issue with recorded `branch` and non-null `implementation_commit` → `adw:building` removed, `adw:done` added, PR created with the recorded branch, comment with PR link.
  - **Closed issue completion:** completed workspace for a closed issue → result comment posted, `adw:done` recorded, and no PR created.
  - **PR creation guard:** completed workspace with missing `branch` or `implementation_commit === undefined` in `adw-state.json` → no PR created, `adw:failed` applied, and an explanatory comment posted. Completed workspace with `implementation_commit === null` → no PR created, `adw:done` applied, and a no-implementation-changes comment posted.
  - **Plan-only success:** workspace status `planned` → `adw:building` removed, `adw:ready-for-review` added, spec path commented, and no PR created.
  - **Pipeline failure:** exit non-zero → `adw:building` removed, `adw:failed` added, error comment posted.
  - **findWorkspaceByIssueNumber:** finds workspace by issue_number field, returns null when not found.
  - **buildIssueSpecFilename:** correct prefix preservation, prefix-specific numbering, slug generation, truncation, special chars sanitized.
  - **parseArgs:** `--repo`, `--poll-ms`, `--agents-root`, `--base`, `--max-concurrent`, `--once`, `--dry-run`, defaults.
  - **Base branch resolution:** explicit `--base` wins; omitted `--base` resolves the repo default once at startup; fallback to `main` is warning-only.
  - **Label provisioning:** startup creates missing ADW labels, skips existing labels, and fails clearly if label creation fails; dry-run reports missing labels without creating them.
  - **`--dry-run`:** suppresses labels, comments, specs, issue-map writes, PRs, and launches while still reporting intended actions.
  - **Skill-initiated issue (auto-approved):** issue created with `adw:building` label (no `adw:triage` or `adw:approved`) → skipped by triage scan → picked up by progress scan → handled like trigger-launched builds.
  - **`--no-issue` flag:** skill invocation with `--no-issue` skips issue creation, pipeline launches without issue metadata in state.
- All tests use fake `run` (for `gh` and `bun`) and fake filesystem (temp `agents/` dir). No real GitHub calls, no real pipeline launches.

### Step 15: Workspace state extension

- In each orchestrator that writes `agents/<id>/adw-state.json`, add to both the read-side `WorkspaceState` interface and the write-side `OrchestratorState` interface:
  - `adws/adw-plan-reviewspec.ts` (`/adw-plan` planning-only runs)
  - `adws/adw-plan-reviewspec-build.ts` (plan → review → build runs)
  - `adws/adw-plan-review-build-patch.ts` (`/adw-implement` full runs)
  ```ts
  /** SPEC-068: originating GitHub issue number (set by trigger or skill). */
  issue_number?: number;
  /** SPEC-068: originating GitHub issue URL (set by trigger or skill). */
  issue_url?: string;
  ```
- Add a shared small helper or duplicated local helper in each orchestrator state-initialization path that reads `process.env.ADW_ISSUE_NUMBER` and `process.env.ADW_ISSUE_URL`, parses the issue number, and includes the fields in the initial `OrchestratorState` when valid. The orchestrator itself does not use them for control flow — they're metadata for the trigger's progress reporting.

### Step 16: Tracking issue wrapper

- Implement `adws/adw-create-tracking-issue.ts` as the only executable used by Markdown skills for issue creation.
- Supported flags:
  - `--help`: prints usage and exits 0.
  - `--pipeline plan|implement`: required unless `--help`.
  - `--repo owner/repo`: optional; if omitted, parse `git remote get-url origin`.
  - `--label <label>`: repeatable; defaults to no labels, but skills pass `adw:building`.
  - `--format shell|json`: output mode. Default `shell` prints shell-safe `ADW_ISSUE_NUMBER=<n>` and `ADW_ISSUE_URL=<url>` lines. `json` prints `{"number":123,"url":"..."}`.
  - `--no-issue`: prints nothing in `shell` mode or `{"skipped":true}` in `json` mode, exits 0, and does not call `gh`.
  - `--`: all remaining text is the pipeline argument used for the issue title/body.
- Behavior:
  1. If `--no-issue` is present, exit 0 without creating an issue.
  2. Resolve `owner/repo` from `--repo` or `git remote get-url origin`; support HTTPS and SSH remotes.
  3. Call `ensureLabels` before `createIssue` when labels were requested.
  4. Create the issue with title/body derived from pipeline type, argument, and timestamp.
  5. On `gh`/auth/network failure, print a warning to stderr and exit 0 with no env assignments in `shell` mode or `{"skipped":true,"error":"..."}` in `json` mode. Issue creation is best-effort for direct skill launches; the pipeline must still run without issue metadata.
- Add `test/unit/adw-create-tracking-issue.test.ts` covering `--help`, explicit repo, origin parsing for HTTPS/SSH, shell output escaping, JSON output, label forwarding through `ensureLabels`, failure fallback, and `--no-issue`.

### Step 17: Skill modification — `/adw-plan` creates a GitHub tracking issue

- Modify `.zcode/skills/adw-plan/SKILL.md`, the tracked skill source. Do not force-add `.codex/skills/adw-plan/SKILL.md`: `.codex/` is gitignored local Codex runtime/cache state. If local tooling regenerates or syncs `.codex/skills` from `.zcode/skills`, that regeneration is allowed for local use but is not a committed acceptance criterion.
- Add a pre-launch step:
  - **Before Step 2** (the tmux launch), add a new step:
    1. If `--no-issue` is in the arguments, skip issue creation.
    2. Detect the repo from `git remote get-url origin` (parse owner/repo).
    3. Invoke the executable wrapper, not a TypeScript function from Markdown:
       ```bash
       bun adws/adw-create-tracking-issue.ts --pipeline plan --label adw:building -- "$ARGUMENTS"
       ```
       The skills use the wrapper's default `shell` output mode. If issue creation succeeds, evaluate only the two expected `ADW_ISSUE_NUMBER=...` and `ADW_ISSUE_URL=...` lines; if the wrapper prints no assignments, continue without issue metadata.
    4. The wrapper calls `createIssue(deps, owner, repo, title, body, [LABEL_BUILDING])` where:
       - `title` is derived from the argument (e.g., `"adw: <description>"` or `"adw: <spec-filename>"`)
       - `body` includes the pipeline type (`plan → spec-review`), the argument, and a timestamp
       - Labels: `["adw:building"]` (auto-approved — skips triage and approval gates)
    5. Parse the returned issue `number` and `url`.
    6. Pass these as environment variables to the launcher process when issue creation succeeds. Shell-style assignment is acceptable inside the Markdown skill's shell command, but the parsed values must be exported as environment variables rather than passed as launcher argv.
  - Update Step 2's bash command to include the env vars when issue creation succeeded.
  - Update Step 3's report to include the GitHub issue link: `GitHub issue: <url>`

### Step 18: Skill modification — `/adw-implement` creates a GitHub tracking issue

- Modify `.zcode/skills/adw-implement/SKILL.md` with the same pattern as Step 17. Do not force-add `.codex/skills/adw-implement/SKILL.md`; it remains gitignored local Codex runtime/cache state unless generated locally by tooling:
  - Same pre-launch step: detect repo, create issue with `adw:building` label, parse result.
  - Invoke the wrapper as:
    ```bash
    bun adws/adw-create-tracking-issue.ts --pipeline implement --label adw:building -- "$ARGUMENTS"
    ```
  - `title`: `"adw: <description>"` or `"adw: <spec-filename>"`.
  - `body` includes the pipeline type (`plan → spec-review → build → patch-review`), the argument, and a timestamp.
  - Pass `ADW_ISSUE_NUMBER` and `ADW_ISSUE_URL` as env vars to the launcher.
  - Update report to include the GitHub issue link.

### Step 19: Orchestrators read issue env vars into state

- In the state initialization for `adws/adw-plan-reviewspec.ts`, `adws/adw-plan-reviewspec-build.ts`, and `adws/adw-plan-review-build-patch.ts`, read `process.env.ADW_ISSUE_NUMBER` and `process.env.ADW_ISSUE_URL`.
- If present, parse `ADW_ISSUE_NUMBER` as a number and set `issue_number` and `issue_url` on the initial `OrchestratorState` that is written to `adw-state.json`.
- `adw-launch.ts` only needs to preserve the parent environment when spawning the selected script. If it constructs a custom env object, ensure these two variables are included. No behavioral change when the env vars are absent.

### Step 20: Typecheck + build + test validation

- Run `bun run typecheck:src` — zero errors.
- Run `bun run typecheck:test` — zero errors.
- Run `bun run typecheck` — full project typecheck, zero errors.
- Run `bun run build` — build succeeds.
- Run `bun test test/unit/github.test.ts` — new GitHub module tests pass.
- Run `bun test test/unit/git-ops.test.ts` — consolidated git-ops tests pass.
- Run `bun test test/unit/trigger-cron.test.ts` — new trigger tests pass.
- Run `bun test test/unit/adw-create-tracking-issue.test.ts` — wrapper behavior tests pass.
- Run `bun test test/unit/` — full unit suite, no regressions.

### Step 21: Manual smoke tests

- `bun adw-triggers/trigger-cron.ts --help` — prints USAGE, exits 0.
- `bun adw-triggers/trigger-cron.ts --repo mekael/tmax --once --dry-run` — single scan of the configured repo, prints what it would do, exits 0. No labels modified, no specs created, no issue-map writes, no comments posted, no pipelines launched.
- `bun adws/adw-create-tracking-issue.ts --help` — prints USAGE, documents `--format shell|json` and `--no-issue`, exits 0.
- `bun adws/adw-create-tracking-issue.ts --no-issue --pipeline plan -- "dry run"` — exits 0 without calling `gh`.
- `bun adws/adw-create-tracking-issue.ts --repo mekael/tmax --pipeline plan --format json -- "tracking smoke test"` — creates an issue and prints normalized JSON with `number` and `url`.
- Create a test issue on the repo with a known title. Run `bun adw-triggers/trigger-cron.ts --repo mekael/tmax --once` without `--dry-run`. Verify the issue gets `adw:triage`, then `adw:ready-for-review` (or the triage-failure comment), and verify `adw-triggers/issue-map.json` contains the issue number and spec path.

## Testing Strategy

### Unit Tests

- **`test/unit/github.test.ts`** — GitHub module: issue parsing, label operations, comment formatting, PR creation. All against a fake `run` — no real `gh` calls.
- **`test/unit/git-ops.test.ts`** — Consolidated git operations: existing worktree tests plus new pushBranch/createPRForIssue. Against a temp git fixture.
- **`test/unit/trigger-cron.test.ts`** — Trigger state machine: triage, approval, building guard, progress reporting, pipeline success/failure. Against fake `run` + fake filesystem.
- **`test/unit/adw-create-tracking-issue.test.ts`** — Wrapper CLI: output modes, repo parsing, `--no-issue`, label ensuring, and best-effort failure fallback. Against fake `run`.

### Integration Tests

- **Trigger end-to-end:** Create a real GitHub issue, run the trigger, verify the issue gets triaged and a spec is created. Manual — too slow for CI.
- **Pipeline launch from trigger:** Approve a triaged issue, verify the pipeline launches and completes. The trigger reports this on the issue.
- **PR creation:** After a successful build, verify the PR is created and linked to the issue.

### Edge Cases

- **`gh` not installed:** The GitHub module's `run` returns Left. The trigger logs an error and skips the scan. Does not crash.
- **`gh` auth expired:** Same as above — non-zero exit from `gh` → Left → skip.
- **Issue with no body:** `classify()` receives only the title. Works — classify handles short descriptions.
- **Issue body contains spec-like content:** The dispatch step may edit an existing spec or create a new one. The `agent.ts` logic handles both.
- **`dispatch()` returns `noop`:** Treat as triage failure for automation. Leave the issue open with an explanatory comment and planner log path, but do not add `adw:ready-for-review` because there is no spec path to approve.
- **Pipeline subprocess hangs:** The trigger launches the pipeline as an asynchronous foreground child process and continues polling other issues. If the child hangs, progress reporting can continue from workspace state, but the issue may remain `adw:building` until the orchestrator/watchdog reports failure or a trigger-level wall-clock timeout is added.
- **Trigger restart while pipeline is running:** The `adw:building` label persists on the issue. On restart, the progress scan finds the building issue, rediscovers the workspace via `findWorkspaceByIssueNumber`, updates the issue map if needed, and monitors its workspace state. The already-running pipeline is NOT re-launched because the trigger only launches when it transitions `ready-for-review` + `approved` to `building`.
- **Multiple issues approved simultaneously:** The trigger processes them sequentially (one pipeline at a time). The approval scan queues issues; the triage scan skips them while building. Future work: parallel pipeline dispatch.
- **Spec number collision:** The next feature/bug/chore number is determined by scanning `docs/specs/` for existing files with the same prefix — the same prefix-specific logic the plan stage uses. No collision possible.
- **Issue closed before build completes:** The trigger checks issue state before PR creation. If the issue is closed, post the result anyway, remove `adw:building`, add `adw:done`, record terminal completion in the issue map, and skip PR creation.
- **`gh` not available when skill creates issue:** If the skill can't create the issue (gh missing, auth expired, network error), log a warning and proceed without issue metadata. The pipeline still runs — issue creation is best-effort, not blocking.
- **Skill `/adw-plan` completes successfully:** The issue has `adw:building` while the plan/review run is active. When the workspace status becomes `planned`, the progress scan swaps it to `adw:ready-for-review` and comments with the spec path. No PR is created for plan-only completion.
- **Skill creates issue but pipeline fails immediately:** The issue has `adw:building` and never gets a successful build result. The trigger's progress scan detects the `failed` workspace state and swaps the label to `adw:failed` with an error comment. No orphaned `adw:building` issues persist.
- **`--no-issue` with trigger:** The `--no-issue` flag only applies to the skills. The trigger always works from existing GitHub issues — it never creates them.

## Acceptance Criteria

1. **`github.ts` exists and is injectable:** exports `GithubDeps`, all GitHub operations (`listIssuesByLabel`, `listOpenIssues`, `getIssue`, `addLabel`, `removeLabel`, `commentOnIssue`, `createPR`, `closeIssue`, `createIssue`, `listLabels`, `ensureLabels`), and all ADW label constants. Imports no `child_process` directly — uses injected `run`. Creation helpers parse the URL from `gh issue create` / `gh pr create`, then call `gh issue view` / `gh pr view --json ...` for normalized JSON.
2. **`git-ops.ts` consolidates all git operations:** contains all functions previously in `worktree.ts` plus `pushBranch` and `createPRForIssue`. All existing imports through `worktree.ts` still resolve.
3. **`worktree.ts` is a backward-compat shim:** re-exports everything from `git-ops.ts`. All existing code compiles and tests pass without modification.
4. **`trigger-cron.ts` exists** with the dispatcher structure (USAGE, parseArgs, main, `import.meta.main`) and the `--repo`, `--poll-ms`, `--agents-root`, `--base`, `--max-concurrent`, `--once`, and `--dry-run` flags.
5. **Labels are provisioned:** startup ensures all ADW labels exist before applying labels or creating labeled issues. Dry-run reports missing labels without creating them.
6. **Base branch ownership is single-source:** trigger startup resolves the base branch once via `resolveBaseBranch`; `createPRForIssue` requires an explicit `base` parameter and performs no default-branch lookup.
7. **Triage creates a spec from an issue:** an open issue with none of the ADW labels is found by local filtering, gets `adw:triage`, then `adw:ready-for-review`, a spec file is created or renamed to the prefix-preserving issue filename pattern (`SPEC-###-issue-<number>-<slug>.md`, `BUG-##-issue-<number>-<slug>.md`, or `CHORE-##-issue-<number>-<slug>.md`), `adw-triggers/issue-map.json` records the issue-to-spec mapping, and the issue gets a comment with the spec path.
8. **Triage handles all dispatch outcomes:** `created` and `modified` outcomes produce a normalized spec path and mapping; `noop` removes `adw:triage`, comments with the noop summary and planner log path, and writes no approval mapping.
9. **Triage logs are trigger-owned:** issue-only triage passes `dispatch()` a planner log path under `adw-triggers/runs/<issue>-<timestamp>/planner/raw-output.jsonl`.
10. **Approval launches the pipeline:** an issue with both `adw:ready-for-review` + `adw:approved` resolves its spec path from the issue map, gets labels swapped to `adw:building`, the adw pipeline is launched asynchronously with `Bun.spawn`/`spawn` env options containing `ADW_ISSUE_NUMBER` and `ADW_ISSUE_URL` (not shell assignments passed as argv), and the issue gets a comment.
11. **Approval is queued by default:** with default `--max-concurrent 1`, only one pipeline is active at a time; additional approved issues remain labeled `adw:ready-for-review` + `adw:approved` until capacity is available.
12. **Building guard prevents re-triggering:** issues with `adw:building` are skipped by both triage and approval scans. The state file is read for progress reporting.
13. **Full pipeline success creates a PR for open issues only:** when workspace status becomes `completed` and the issue is still open, `adw:building` is swapped to `adw:done`, a PR is created against the resolved explicit base branch using the `branch` recorded in `adw-state.json`, the PR is linked to the issue, and the issue gets a comment with the PR link. If the issue is closed, the trigger posts the completion comment and records `adw:done` but does not create a PR.
14. **PR creation never guesses state after restart:** progress reporting reads `branch` and `implementation_commit` from `agents/<id>/adw-state.json` before calling `createPRForIssue`. Missing `branch` or `implementation_commit === undefined` is treated as a failure requiring human recovery; no fallback branch is guessed and no PR is created. `implementation_commit === null` is handled explicitly as a completed run with no implementation changes, so no PR is created and the issue receives a no-implementation-changes comment.
15. **Plan-only success does not get stuck:** when workspace status becomes `planned`, `adw:building` is swapped to `adw:ready-for-review`, the issue gets a comment with the spec path, and no PR is created.
16. **Pipeline failure reports the error:** on non-zero exit or workspace status `failed`, `adw:building` is swapped to `adw:failed`, and the issue gets an error comment.
17. **`--once` and `--dry-run` are deterministic:** `--once` runs one real scan and exits. `--once --dry-run` runs one no-side-effects scan, prints intended actions, and exits 0 with no labels modified or created, no specs created, no issue-map writes, no pipelines launched, and no comments posted.
18. **Trigger runtime state is ignored:** `.gitignore` ignores `adw-triggers/issue-map.json` and `adw-triggers/runs/`. These runtime artifacts are not committed; if the directory must exist, only `adw-triggers/.gitkeep` is committed.
19. **Workspace state has `issue_number` and `issue_url`:** `WorkspaceState` and `OrchestratorState` in `adw-plan-reviewspec.ts`, `adw-plan-reviewspec-build.ts`, and `adw-plan-review-build-patch.ts` include these fields, and the initial state records them when set by the trigger or the skills (via `ADW_ISSUE_NUMBER` / `ADW_ISSUE_URL` env vars). Existing orchestrator behavior is unchanged when env vars are absent.
20. **`adw-create-tracking-issue.ts` is validated directly:** supports `--help`, `--repo`, origin parsing, `--format shell|json`, label forwarding, best-effort failure fallback, and `--no-issue`.
21. **`/adw-plan` creates a GitHub tracking issue:** when invoked without `--no-issue`, the tracked `.zcode` skill source creates a GitHub issue with `adw:building` label through the executable wrapper before launching the pipeline. The issue number and URL are passed to the orchestrator and recorded in state. `.codex/skills` is gitignored local runtime/cache state and is not force-added or required for committed acceptance.
22. **`/adw-implement` creates a GitHub tracking issue:** same behavior as `/adw-plan` — the tracked `.zcode` skill source creates an issue with `adw:building` label through the executable wrapper before launching, records issue metadata in state. `.codex/skills` remains excluded from committed acceptance.
23. **Skill-created issues are auto-approved:** issues created by the skills have `adw:building` directly (no `adw:triage` or `adw:approved` phase). The trigger's triage and approval scans skip these issues; the progress scan monitors them.
24. **`--no-issue` flag opts out:** when `--no-issue` is passed to `/adw-plan` or `/adw-implement`, no GitHub issue is created and the pipeline launches without issue metadata. Useful for offline usage or when GitHub tracking is not needed.
25. **Typecheck/build/tests pass:** `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`, `bun run build`, `bun run test:unit` all exit 0. All new tests pass, no regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run typecheck:src` — Source typecheck, zero errors.
- `bun run typecheck:test` — Test typecheck, zero errors.
- `bun run typecheck` — Full project typecheck, zero errors.
- `bun run build` — Build succeeds.
- `bun test test/unit/github.test.ts` — New GitHub module tests pass.
- `bun test test/unit/git-ops.test.ts` — Consolidated git-ops tests pass (includes former worktree tests).
- `bun test test/unit/trigger-cron.test.ts` — New trigger tests pass.
- `bun test test/unit/adw-create-tracking-issue.test.ts` — Tracking issue wrapper tests pass, including `--help`, JSON/shell output, repo parsing, failure fallback, and `--no-issue`.
- `bun test test/unit/worktree.test.ts` — Existing worktree tests pass through the shim (no regressions).
- `bun test test/unit/` — Full unit test suite, no regressions.
- `bun adw-triggers/trigger-cron.ts --help` — Prints USAGE, exits 0.
- `bun adw-triggers/trigger-cron.ts --repo mekael/tmax --once --dry-run` — Single scan against the configured repo, prints intended actions, exits 0. No side effects.
- `bun adws/adw-create-tracking-issue.ts --help` — Prints USAGE, exits 0.
- `bun adws/adw-create-tracking-issue.ts --no-issue --pipeline plan -- "local only"` — Exits 0 and does not call GitHub.

## Notes

- **Why `adw-triggers/` as a separate directory.** The existing `adws/` directory contains single-run dispatchers and orchestrators. A trigger is a long-lived daemon with a different lifecycle: it runs forever, manages its own poll loop, and is started once. Separating it into `adw-triggers/` makes the distinction clear and avoids polluting the `adws/` directory listing.

- **Why `gh` CLI over a GitHub SDK.** The project has zero external dependencies (AGENTS.md: "Zero external dependencies"). `gh` is already installed and used for GitHub interaction. Wrapping it as an injected module keeps the dependency count at zero while providing full GitHub API access. The `--json` flag gives structured output.

- **Why consolidate worktree.ts into git-ops.ts.** The user's explicit requirement: all git functionality in one module. `worktree.ts` is 657 lines and growing; `git-ops.ts` centralizes git operations (branch, commit, push, merge, worktree, PR) while `github.ts` centralizes GitHub API operations (issues, labels, comments). Clean separation of concerns.

- **Why labels only (no comments for state).** Labels are queryable (`gh issue list --label`), visible in the GitHub UI at a glance, and survive bot restarts. Comments are for details and progress — not for state tracking. The user chose labels-only during the interview.

- **Why not parallel pipeline dispatch.** The first version processes one approved issue at a time. Parallel dispatch adds complexity (subprocess management, resource contention, concurrent workspace coordination) that can be added later when there's a concrete need. The sequential approach matches the watchdog's pattern of one-action-per-poll-cycle.

- **Relationship to existing pipeline.** The trigger is a new **consumer** of the existing pipeline. `adw-launch.ts` is called as a subprocess and must preserve `ADW_ISSUE_NUMBER` / `ADW_ISSUE_URL` when spawning the selected orchestrator. The orchestrators that write `adw-state.json` gain two optional fields in both `WorkspaceState` and `OrchestratorState`. Stage dispatchers, watchdog, and status dashboard are otherwise unchanged.

- **Bidirectional GitHub integration.** The system has two entry points that converge on the same label-based state machine: (1) GitHub issues submitted by users are triaged by `trigger-cron` and follow the full `adw:triage → adw:ready-for-review → adw:approved → adw:building → adw:done` lifecycle. (2) Skills (`/adw-plan`, `/adw-implement`) create tracking issues with `adw:building` directly, skipping triage and approval because the developer already approved the work by invoking the skill. Both entry points use the same `github.ts` module, the same label constants, and the same workspace issue metadata fields. The trigger's progress scan monitors all `adw:building` issues regardless of origin.

- **Why skill-created issues are auto-approved.** When a developer runs `/adw-plan` or `/adw-implement`, they've already decided to do the work — the approval is implicit in the invocation. Requiring manual GitHub label approval would add friction to a workflow the developer initiated themselves. The `adw:building` label is applied directly, and the trigger's progress scan takes over monitoring. Issues from GitHub submissions (external input) still require explicit human approval via the `adw:approved` label.

- **Why `--no-issue` flag.** Not every pipeline run needs GitHub tracking. Local experiments, offline work, or runs on private repos where `gh` auth isn't configured should work without issue creation. The `--no-issue` flag preserves the existing behavior as the default opt-out path.

- **Future: webhook delivery.** The cron poll has 30-60s lag. A GitHub App webhook would be real-time but requires a server. This spec uses polling as the pragmatic first step; webhook support can be added later as a separate module that replaces the poll scan with webhook handlers.

- **Future: revision flow.** When the spec reviewer (human or automated) wants changes before approving, they could comment on the issue with feedback. The trigger could parse structured feedback comments, update the spec, and re-add `adw:ready-for-review`. This is not in scope for the first version — the approval flow is binary (approved or not). The revision flow can be added as a follow-up spec.

- **Future: project board integration.** GitHub project boards could show a Kanban-style view of adw issues by label. This is out of scope — the label-based state machine is the foundation, and project boards are a view layer on top.
