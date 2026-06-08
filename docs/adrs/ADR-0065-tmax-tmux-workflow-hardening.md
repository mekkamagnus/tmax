# tmax tmux Workflow Hardening

## Status

Accepted

## Context

During debugging, the tmux server accumulated 9 stale `tmax-ui-*` sessions from previous UI harness runs and 1 ad-hoc `tmax-test` session from manual debugging. These were never cleaned up because:

1. The UI harness creates isolated `tmax-ui-<uuid>` sessions per test run, but interrupted runs or direct invocations left detached shell sessions behind.
2. There was no tool to audit which tmax tmux sessions were live vs stale.
3. The debugging workflow didn't specify when to use the existing `tmax` tmux session vs creating a new one.

The `rules/ui-testing.md` troubleshooting section still recommended tmux-centric key injection for debugging, rather than the more reliable `tmaxclient --key` API.

## Decision

1. **`scripts/tmax-tmux-audit.sh`** — New audit tool that lists all tmax tmux sessions, their panes, commands, and CWDs. Classifies sessions as live (active editor process) or stale (detached shell-only). Supports `--cleanup-stale-shells` to remove stale detached `tmax-ui-*` sessions with shell-only panes.
2. **`bun run tmux:audit` / `bun run tmux:cleanup-stale`** — Package.json scripts for the audit tool.
3. **`.gitignore` exception** — Added `!scripts/tmax-tmux-audit.sh` so the script is tracked despite the existing `tmax-*` ignore rule.
4. **`docs/learnings.md`** — Added workflow lesson: debug through daemon API first, use existing `tmax` session for observation, create isolated sessions only through the harness.
5. **`rules/ui-testing.md`** — Updated troubleshooting to prefer `tmaxclient --key` over tmux key injection, and added `bun run tmux:audit` as a pre-debugging step.

## Consequences

- Stale tmux sessions can be discovered and cleaned with a single command.
- The debugging workflow is documented: daemon API → existing tmux → new session.
- The audit tool never kills the canonical `tmax` session or non-tmax sessions — it only targets detached `tmax-ui-*` sessions with shell panes.
