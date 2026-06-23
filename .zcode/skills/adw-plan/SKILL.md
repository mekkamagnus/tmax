---
name: adw-plan
description: "Run the planning half of the adw pipeline (plan → spec-review) via the tmux launcher, leaving a reviewed, revised spec and a resumable workspace. Takes a spec path or free-text description as the argument. Hand off to /adw-implement --resume <id> to build. Triggers on: adw-plan, adw plan, /adw-plan."
argument-hint: '<spec-path-or-description>'
allowed-tools: Bash
user-invocable: true
---

# adw-plan

Run the 2-stage planning pipeline in a detached tmux window:

```
plan → spec-review (stop — revised spec on disk + resumable workspace)
```

The pipeline runs in the `tmax` tmux session, surviving agent timeouts and terminal disconnects. After review the workspace is left with `status: planned` and `completed_stages: [plan, review]` — ready for `/adw-implement` to pick up at build.

## Usage

```
/adw-plan "add a URL bar to the status line"        # free-text → plan → spec-review
/adw-plan docs/specs/SPEC-064-adw-plan-skill.md     # existing spec → spec-review only (plan skipped)
/adw-plan --chore "rename adw-build-dispatcher"      # chore classification
```

## What it does

Runs `bun adws/adw-launch.ts --script adw-plan-reviewspec.ts <arg>` which:

1. **Plan** — classifies the arg (feature/bug/chore), dispatches to matching skill, produces a spec in `docs/specs/`. (Skipped when the arg is an existing spec path.)
2. **Spec review** — reviews the spec via codex, upgrades in place if issues found.

Stops after review. The workspace is left with `status: planned` and `completed_stages: [plan, review]`.

All stages share one workspace id (`agents/<id>/`) with event streams for observability.

## Invocation protocol

**Step 1 — Validate the argument.** The argument must be a spec path (e.g. `docs/specs/SPEC-064-adw-plan-skill.md`) or a free-text description in quotes. If empty, report usage and stop.

**Step 2 — Launch via the tmux launcher.** Run:

```bash
bun adws/adw-launch.ts --script adw-plan-reviewspec.ts $ARGUMENTS
```

This launches the pipeline in a detached tmux window named `adw-<HHMMSS>` inside the `tmax` session. The launcher returns immediately.

**Step 3 — Report launch details.** Print the tmux window name and attach instructions:

```
Pipeline launched in tmux session 'tmax', window 'adw-<name>'.
Attach: tmux attach -t tmax
```

**Step 4 — STOP.** Do not wait for the pipeline to complete. The user can attach to tmux to watch progress or check `agents/<id>/` artifacts later.

## Handoff to implementation

After `/adw-plan` completes, the workspace is ready to build. Resume it with the full pipeline — plan and review are auto-detected as completed and skipped. You can hand off two ways:

```
# By workspace id (explicit):
/adw-implement --resume <id>

# By spec path (no id needed — the workspace is discovered automatically):
/adw-implement docs/specs/SPEC-###.md
```

Both run `build → test → patch-review`. The spec-path form finds the most recent resumable workspace for that spec (the `status: planned` one `/adw-plan` just wrote) via spec-anchored discovery, so you don't need to copy the id. If you pass a spec whose workspace is `completed` (a finished build), a fresh workspace is minted and the full pipeline re-runs from spec-review.

## Workspace artifacts

After the pipeline runs, the workspace contains:

```
agents/<id>/
├── adw-state.json              — pipeline state (status: planned, spec path)
├── orchestrator/events.jsonl   — stage transitions
├── planner/events.jsonl        — plan stage events
├── reviewer/events.jsonl       — spec review events
└── upgrader/events.jsonl       — written by spec-review (if upgrade runs)
```

## Prerequisites

- `tmux` installed and the `tmax` tmux session available.
- `bun` on PATH.
- `claude` CLI on PATH (used by plan stage).
- `codex` CLI on PATH (used by spec-review stage).

## See also

- `adw-launch.ts` — tmux launcher (ADR-0094)
- `adw-plan-reviewspec.ts` — 2-stage planning orchestrator
- `/adw-implement` — resume the workspace here (`--resume <id>` or by spec path) to run build → test → patch-review
