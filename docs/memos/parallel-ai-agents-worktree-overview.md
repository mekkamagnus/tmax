# Parallel AI Agents & Git Worktrees — Community Landscape Overview

> **Date:** 2026-06-22
> **Source:** `/last30days` research (Reddit, GitHub, blogs) + WebSearch supplements, saved to `~/Documents/Last30Days/running-multiple-ai-coding-agents-in-parallel-on-the-same-codebase-raw-v3.md`.
> **Purpose:** Capture what the developer community has settled on for running multiple AI coding agents on the same codebase concurrently, so the adw pipeline's worktree isolation design is grounded in proven patterns rather than reinvented.

---

## TL;DR

**Git worktrees are the settled 2026 answer for isolating parallel AI coding agents on a single codebase.** Every source — practitioner blogs, real-team GitHub PRs, and the emergent tooling ecosystem — converges on the same shape: one worktree per agent, one branch per worktree, isolated working trees sharing a single `.git`. The tooling layer (Worktrunk, native editor support, worktree-aware hooks) matured around it in the first half of 2026. Specs layered on top solve *what* each agent does; worktrees solve *where*.

---

## 1. The Core Pattern: Worktree-Per-Task

The atomic unit of isolation across every source is **one worktree per task, one branch per worktree**. Two agents never share a working tree.

- [r/ClaudeAI — "I've been running 5+ Claude Code instances in parallel"](https://www.reddit.com/r/ClaudeAI/comments/1rbtmfd/ive_been_running_5_claude_code_instances_in/): a setup that "automatically creates a git branch + worktree per task, spawning an agent inside each — fully isolated and parallel."
- [r/ClaudeAI — "Running two Claude Code agents on the same repo simultaneously"](https://www.reddit.com/r/ClaudeAI/comments/1t9tolw/running_two_claude_code_agents_on_the_same_repo/): create a worktree per branch, open a Claude Code session in each directory, let them run.
- [incident.io — "How we're shipping faster with Claude Code and Git Worktrees"](https://incident.io/blog/shipping-faster-with-claude-code-and-git-worktrees): team-scale workflow creating worktrees via `git worktree add ../feature-branch`, then navigating into each directory.
- [Google Cloud / Medium — "Run multiple coding agents safely with git worktrees"](https://medium.com/google-cloud/run-multiple-coding-agents-safely-with-git-worktrees-c2d237dbd6b2): worktrees let you work on multiple branches simultaneously without context-switching overhead; each worktree is an isolated working directory.

**The key property:** each worktree has its own working files but shares one `.git`. So two processes editing two worktrees cannot collide on files, and they remain cheap (no re-clone, no duplicate history).

---

## 2. Coordination Layer: Specs on Top of Worktrees

Worktrees solve *where*; specs solve *what*. You can only safely fan out to N agents if tasks are pre-decomposed into N non-overlapping specs.

- [Drew Breunig — "The Spec-Driven Development Triangle"](https://www.dbreunig.com/2026/03/04/the-spec-driven-development-triangle.html) (March 2026): "Architectures that allow parallel development are incredibly valuable — what it allows you to do is move fast with multiple agents."
- [Augment Code — "What Is Spec-Driven Development?"](https://www.augmentcode.com/guides/what-is-spec-driven-development): specs are "executable contracts that constrain what AI agents generate."
- [Developers Digest — "How to Coordinate Multiple AI Agents"](https://www.developersdigest.tech/blog/how-to-coordinate-multiple-ai-agents): the **fan-out / fan-in** pattern — deploy N agents on independent subtasks, then merge outputs — is the standard coordination architecture.
- [Augment Code — "How to Run a Multi-Agent Coding Workspace"](https://www.augmentcode.com/guides/how-to-run-a-multi-agent-coding-workspace): six coordination patterns — spec-driven decomposition, git worktrees, role splits (Writer/Reviewer), and safe merge strategies.

**The decomposition is the hard part, not the isolation.** The tmax adw pipeline already produces this decomposition (`docs/specs/{SPEC,BUG,CHORE}-*.md` per pipeline); the isolation layer is what's missing.

---

## 3. The Tooling Layer (Matured in 2026)

A dedicated tooling ecosystem emerged specifically for parallel-agent worktree workflows:

- **[Worktrunk](https://crates.io/crates/worktrunk)** (Maximilian Roos, [@max_sixty](https://x.com/max_sixty)) — a Rust CLI purpose-built for managing git worktrees for parallel AI agents. Three core commands. [Laurent Kempé's writeup](https://laurentkempe.com/2026/03/31/from-3-worktrees-to-n-ai-powered-parallel-development-on-windows/) frames the inflection point: "from 3 worktrees to N."
- **[Nimbalyst — "Best Git Worktree Tools for AI Coding in 2026"](https://nimbalyst.com/blog/best-git-worktree-tools-ai-coding-2026/)** — a comparison surveying the landscape.
- **Editor integration is catching on.** [openchamber/openchamber PR #1499](https://github.com/openchamber/openchamber/pull/1499) added a "Create Worktrees as Siblings" git preference *explicitly to match the `wt`/worktrunk CLI convention* — worktrees placed at `<repoDir>.<slug>` next to the repo, not buried in a hidden dir.
- **Claude Code has native worktree support** ([code.claude.com common workflows](https://code.claude.com/docs/en/common-workflows)): "Work on a feature in one terminal while Claude fixes a bug in another, without the edits colliding. Each worktree is a separate checkout on its own branch."

---

## 4. The Hidden Gotcha: Automation Must Become Worktree-Aware

The most telling signal from the corpus: a real team had to make their **git hooks worktree-aware** because parallel agents broke their pre-PR validation gate.

- [rjmurillo/ai-agents PR #2251](https://github.com/rjmurillo/ai-agents/pull/2251) — `fix(validation): make git-hooks gate worktree-aware in pre_pr`. The PR description shows the six-agent parallel review process. This is the *exact class of bug* any pipeline hits when it assumes a single checkout: hooks, test runners, state files, build artifacts that key off `PROJECT_ROOT` all break when multiple worktrees exist.
- [rjmurillo/ai-agents PR #2412](https://github.com/rjmurillo/ai-agents/pull/2412) — `fix(workflow-local-test): detect linked git worktree and exit 3 with precise error`. The follow-up: detect when you're inside a worktree and behave correctly rather than failing opaquely.

**Implication for adw:** every stage currently runs with `cwd: PROJECT_ROOT` (`adw-build.ts`, `adw-plan-review-build-patch.ts` `spawnStage`). Making the pipeline worktree-isolated is not just "add `git worktree add`" — it requires threading a per-worktree `cwd` through every subprocess spawn and every internal `cwd:` reference. The env-var handoff pattern (`ADW_WORKTREE=<path>`) is the cleanest injection point.

---

## 5. Remote / Offload Targets (VPS, Pi): Git Is the Transport

For offloading agents to a remote machine (the "dispatch to mekkapi / a VPS" use case), two proven shapes exist — and a git remote already gives you the second one for free.

**Shape 1 — Agent runs entirely on the remote box.** SSH in, run Claude Code (or the pipeline) in tmux on the remote, sync results back via git push/pull.
- [MindStudio — "How to Run Claude Code on a VPS"](https://www.mindstudio.ai/blog/run-claude-code-on-vps-always-on-workflows)
- [Virtarix — VPS setup walkthrough](https://virtarix.com/guides/run-claude-code-on-vps/): SSH + official installer + tmux + git push/pull config.
- [r/ClaudeCode — "Anyone else using a VPS instead of buying a Mac Mini?"](https://www.reddit.com/r/ClaudeCode/comments/1rtrq8l/): Claude Code is API-bound, not compute-bound — the real benefit of a VPS is keeping a working environment alive between sessions.

**Shape 2 — Clone-fork-work-push-back.** The agent on the remote clones the repo, works in its own branch, pushes back via git. This is what a Pi-as-runner looks like.
- [crowdhaller — "Running my agents in a VPS"](https://crowdhaller.me/2026-05-11/running-my-agents-in-a-vps/): "The agents clone the fork, work locally on the VPS, and push back." Interacts through GitHub, VSCode, and SSH.

**Shape 3 (lighter) — Offload execution only.** Keep the agent brain local, redirect Bash execution to the remote.
- [torarnv/claude-remote-shell](https://github.com/torarnv/claude-remote-shell) — single-script CLI that redirects Claude Code's Bash tool to a remote machine over SSH with optional Mutagen bidirectional file sync.

**Key takeaway for tmax:** `mekkapi` is already a git remote on the repo. Dispatching a spec to the Pi is fundamentally `git push mekkapi adw/<id>` → run the pipeline in a worktree on the Pi → `git fetch mekkapi adw/<id>` back. The adw workspace id becomes the branch name, which becomes the sync key across machines. No new protocol is required.

---

## 6. Persistence Substrate: tmux + SSH Is Universal

Every remote-agent writeup converges on **tmux** for session survival — long-running agent pipelines must survive laptop sleep and SSH disconnects. The tmax adw pipeline already standardized on this in `adw-launch.ts` (the `tmax` tmux session, named windows, `--resume` via workspace id). Worktrees + remote remotes extend the same principle from *processes* to *files and branches*.

---

## 7. What This Means for the adw Pipeline

The research points to a specific, well-trodden path for adw worktree isolation:

1. **Sibling worktrees, not buried.** The community (Worktrunk, `wt`, openchamber PR #1499) converged on placing worktrees *beside* the repo as `<repo>.<branch>/` rather than buried in a hidden `.worktrees/` dir — `ls` shows them, they're easy to `cd` into, and they don't pollute the repo's own directory. adw adopts the sibling layout (`<repo>.<adw-id>/`); the buried `.worktrees/<id>/` layout used by `tmax-spec-loop` remains supported as a fallback.
2. **Specs land on main first** (the user's visibility requirement). Plan stage runs in `main`, commits the spec it created to `main`, *then* the worktree is created from `main` for build/test/patch. Every agent sees every spec; only code work is isolated.
3. **Thread per-worktree cwd via env-var handoff.** Orchestrator passes `ADW_WORKTREE=<path>` to children; children read it and use it as `cwd` for every subprocess spawn and internal `PROJECT_ROOT` reference. Single injection point, every stage covered.
4. **A status dashboard makes the fleet observable.** RFC-020 (adw observability) deferred `adw-status.ts` as a standalone follow-up; with concurrent worktrees it becomes essential. The dashboard reads `agents/*/adw-state.json` + `git worktree list` and renders idle/working/done state per run — the "check on all runs without attaching tmux" need that single-run observability can't meet.
5. **Remote dispatch via SSH config.** Once each pipeline is a branch, offloading to `mekkapi` or a droplet is `git push <host> adw/<id>` → run on remote → `git fetch <host> adw/<id>`. The hosts already in `~/.ssh/config` (`mekkapi`, `mekaelturner`, `phrzr`, `mkstudio`) are the targets. The workspace id is the sync key across machines.
6. **Make the worktree-aware lesson explicit.** Test runners, e2e gates, state files, and git capture (`captureGitTrace`) all need to key off the worktree `cwd`, not `PROJECT_ROOT` — the rjmurillo PRs are the cautionary tale.
7. **Fikra is the future T-Lisp consumer.** SPEC-042 Phase 4 (`fikra-worktree.tlisp`) implements worktree isolation in T-Lisp for concurrent AI chat threads. The conventions established for adw here (sibling layout, status dashboard shape) carry over to Fikra's `SPC a T` thread-list buffer.

The full implementation plan is captured in `docs/specs/SPEC-065-adw-worktree-isolation.md`.

---

## 8. Raw Source Inventory

**Blogs & guides:**
- [How to Run a Multi-Agent Coding Workspace (Augment Code, 2026)](https://www.augmentcode.com/guides/how-to-run-a-multi-agent-coding-workspace)
- [From 3 Worktrees to N (Laurent Kempé)](https://laurentkempe.com/2026/03/31/from-3-worktrees-to-n-ai-powered-parallel-development-on-windows/)
- [Git Worktree Isolation in Claude Code (Towards AI)](https://pub.towardsai.net/git-worktree-isolation-in-claude-code-parallel-development-without-the-chaos-262e12b85cc5)
- [Parallel Vibe Coding with Git Worktrees (dandoescode)](https://www.dandoescode.com/blog/parallel-vibe-coding-with-git-worktrees)
- [The Spec-Driven Development Triangle (Drew Breunig)](https://www.dbreunig.com/2026/03/04/the-spec-driven-development-triangle.html)
- [How we're shipping faster with Claude Code and Git Worktrees (incident.io)](https://incident.io/blog/shipping-faster-with-claude-code-and-git-worktrees)
- [Git worktrees for parallel AI coding agents (Upsun Developer)](https://developer.upsun.com/posts/ai/git-worktrees-for-parallel-ai-coding-agents)
- [How to Coordinate Multiple AI Agents (Developers Digest)](https://www.developersdigest.tech/blog/how-to-coordinate-multiple-ai-agents)
- [Best Git Worktree Tools for AI Coding in 2026 (Nimbalyst)](https://nimbalyst.com/blog/best-git-worktree-tools-ai-coding-2026/)

**Tools:**
- [Worktrunk (crates.io)](https://crates.io/crates/worktrunk) — Rust CLI for parallel-agent worktree management.
- [torarnv/claude-remote-shell](https://github.com/torarnv/claude-remote-shell) — redirect Bash tool to a remote machine over SSH.
- [Claude Code native worktree docs](https://code.claude.com/docs/en/common-workflows)

**Real-team PRs (the cautionary tales):**
- [rjmurillo/ai-agents #2251 — make git-hooks gate worktree-aware](https://github.com/rjmurillo/ai-agents/pull/2251)
- [rjmurillo/ai-agents #2412 — detect linked git worktree](https://github.com/rjmurillo/ai-agents/pull/2412)
- [openchamber/openchamber #1499 — Create Worktrees as Siblings preference](https://github.com/openchamber/openchamber/pull/1499)

**Community threads:**
- [r/ClaudeAI — Running 5+ Claude Code instances in parallel](https://www.reddit.com/r/ClaudeAI/comments/1rbtmfd/ive_been_running_5_claude_code_instances_in/)
- [r/ClaudeAI — Running two Claude Code agents on the same repo simultaneously](https://www.reddit.com/r/ClaudeAI/comments/1t9tolw/running_two_claude_code_agents_on_the_same_repo/)
- [r/git — Used Git Worktrees with Parallel AI Agents to Cut Down Dev Time](https://www.reddit.com/r/git/comments/1o2lk8p/used_git_worktrees_with_parallel_ai_agents_to_cut/)
- [r/ClaudeCode — Claude Code via VPS](https://www.reddit.com/r/ClaudeCode/comments/1u8kqfq/claude_code_via_vps/)
- [crowdhaller — Running my agents in a VPS](https://crowdhaller.me/2026-05-11/running-my-agents-in-a-vps/)
