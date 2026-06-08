# Chore: tmax Workflow Hardening

## Chore Description
Document and harden the tmax debugging workflow after the vim mode, `find-file`, and tmux session investigation.

The work addressed a process problem: manual debugging created extra tmux sessions, stale harness sessions were left running, and the workflow drifted away from the daemon/client architecture already documented in the project. The hardened workflow makes the daemon API the first debugging surface, keeps manual observation in the existing `tmax` tmux session, reserves `tmax-ui-*` sessions for isolated renderer tests, and provides an audit/cleanup command for stale harness sessions.

This artifact is created after the changes as a maintenance record for what was done and how to validate it.

## Relevant Files
Use these files to resolve and verify the chore:

- `.gitignore` — Adds a narrow exception so the tmux audit script is tracked despite the broad `tmax-*` ignore pattern.
- `docs/learnings.md` — Records the workflow lesson: debug through `tmaxclient` and the daemon first, then use tmux only when renderer observation is needed.
- `package.json` — Adds `tmux:audit` and `tmux:cleanup-stale` scripts for repeatable workflow checks.
- `rules/ui-testing.md` — Updates UI testing rules so key input goes through `tmaxclient --key`, tmux remains a renderer surface, and manual debugging starts with a tmux audit.
- `scripts/tmax-tmux-audit.sh` — Audits tmax-related tmux resources and optionally cleans detached stale `tmax-ui-*` shell sessions.

### New Files

- `scripts/tmax-tmux-audit.sh` — New operational script for tmux resource inventory and safe stale harness cleanup.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Audit the Current tmax tmux State

- Run `bun run tmux:audit`.
- Confirm the canonical `tmax` session is visible.
- Confirm active windows and panes are listed with command and cwd.
- Confirm detached stale `tmax-ui-*` sessions are reported separately from user sessions.

### Step 2: Clean Only Owned Stale Harness Sessions

- Run `bun run tmux:cleanup-stale` when stale detached harness shell sessions are reported.
- Verify it kills only detached `tmax-ui-*` sessions whose panes are shell commands.
- Do not kill non-tmax sessions, attached sessions, or sessions with non-shell commands.

### Step 3: Preserve the Canonical Manual Debugging Surface

- Use the existing `tmax` tmux session for manual daemon/TUI observation.
- Avoid creating ad hoc sessions such as `tmax-test` unless an isolated manual repro is explicitly needed.
- Start diagnosis with `tmaxclient --status`, `tmaxclient --frames`, `tmaxclient --messages`, `tmaxclient --key`, and `tmaxclient --eval`.

### Step 4: Keep UI Harness Responsibilities Clear

- Use daemon-only tests for editor logic and workflow behavior.
- Use `daemon-tmux` only when terminal rendering itself must be verified.
- Drive test input through `tmaxclient --key` instead of `tmux send-keys`.
- Use tmux capture only to prove the renderer surface is visible and correct.

### Step 5: Run Validation Commands

- Execute every command in the Validation Commands section.
- Fix any script, JSON, or workflow failure before treating the chore as complete.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bash -n scripts/tmax-tmux-audit.sh` - Validate audit script shell syntax.
- `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json ok')"` - Validate `package.json` remains parseable.
- `bun run tmux:audit` - Verify tmax tmux resources can be audited without mutating sessions.
- `bun run tmux:cleanup-stale` - Verify stale detached harness shell sessions can be cleaned safely.
- `git status --short .gitignore docs/learnings.md package.json rules/ui-testing.md scripts/tmax-tmux-audit.sh specs/CHORE-14-tmax-workflow-hardening.md` - Confirm the expected workflow-hardening files are the files involved in this chore.

## Notes
The audit during this work found one canonical attached `tmax` session, one manually created `tmax-test` scratch session, and nine detached stale `tmax-ui-*` harness sessions with only shell panes. The stale harness sessions and the scratch session were cleaned, leaving the canonical `tmax` session intact.

The repository still tracks Python `__pycache__` files under `test/ui/`; ordinary UI test runs can dirty those files. That should be handled as a separate cleanup chore by untracking the cache files and adding an ignore rule.
