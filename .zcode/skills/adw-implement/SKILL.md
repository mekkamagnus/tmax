---
name: adw-implement
description: "Run the full adw pipeline (plan → spec-review → build → patch-review) via the tmux launcher. Takes a spec path or free-text description as the argument. Triggers on: adw-implement, adw implement, /adw-implement."
argument-hint: '<spec-path-or-description>'
allowed-tools: Bash
user-invocable: true
---

# adw-implement

Run the full 4-stage adw pipeline in a detached tmux window:

```
plan → spec-review → build → patch-review (with build↔patch retry loop)
```

The pipeline runs in the `tmax` tmux session, surviving agent timeouts and terminal disconnects (30–90 min pipelines complete independently).

## Usage

```
/adw-implement docs/specs/SPEC-061-tmax-use.md        # run pipeline on existing spec
/adw-implement "add a URL bar to the status line"       # free-text → plan stage first
/adw-implement --chore "rename adw-build-dispatcher"     # chore classification
```

## What it does

Runs `bun adws/adw-launch.ts --script adw-plan-review-build-patch.ts <arg>` which:

1. **Plan** — classifies the arg (feature/bug/chore), dispatches to matching skill, produces a spec in `docs/specs/`.
2. **Spec review** — reviews the spec via codex, upgrades if issues found.
3. **Build** — dispatches `claude -p /implement` against the spec.
4. **Patch review** — audits the build against the spec's acceptance criteria, produces PASS or GAPS.
5. **On GAPS** — retries build → patch-review, up to `--max-retries` (default 1).

All stages share one workspace id (`agents/<id>/`) with event streams for observability.

## Invocation protocol

**Step 1 — Validate the argument.** The argument must be a spec path (e.g. `docs/specs/SPEC-061-tmax-use.md`) or a free-text description in quotes. If empty, report usage and stop.

**Step 2 — Launch via the tmux launcher.** Run:

```bash
bun adws/adw-launch.ts --script adw-plan-review-build-patch.ts $ARGUMENTS
```

This launches the pipeline in a detached tmux window named `adw-<HHMMSS>` inside the `tmax` session. The launcher returns immediately.

**Step 3 — Report launch details.** Print the tmux window name and attach instructions:

```
Pipeline launched in tmux session 'tmax', window 'adw-<name>'.
Attach: tmux attach -t tmax
```

**Step 4 — STOP.** Do not wait for the pipeline to complete. The user can attach to tmux to watch progress or check `agents/<id>/` artifacts later.

## Workspace artifacts

After the pipeline runs, the workspace contains:

```
agents/<id>/
├── adw-state.json              — pipeline state (status, spec path)
├── orchestrator/events.jsonl   — stage transitions
├── planner/events.jsonl        — plan stage events
├── reviewer/events.jsonl       — spec review events
├── builder/events.jsonl        — build stage events
└── patch-reviewer/events.jsonl — patch review events
```

## Prerequisites

- `tmux` installed and the `tmax` tmux session available.
- `bun` on PATH.
- `claude` CLI on PATH (used by build and patch-review stages).
- `codex` CLI on PATH (used by spec-review stage).

## See also

- `adw-launch.ts` — tmux launcher (ADR-0094)
- `adw-plan-review-build-patch.ts` — 4-stage orchestrator
- `.zcode/skills/tmax-spec-loop` — alternative: worktree-based spec implementation loop
