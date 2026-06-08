# Feature: Demo Playbook Runner

## Feature Description
A YAML-based demo system that defines editor demos as declarative playbooks and executes them visually in the tmux TUI. Replaces the current bash-only approach with a structured, reusable format. Each playbook describes setup, steps (actions with narration and pacing), and cleanup. A Python runner interprets playbooks, ensures the daemon and TUI frame are running, and drives the editor through `tmaxclient` with configurable delays so the user can watch the demo unfold live in their tmux session.

## User Story
As a developer using Claude Code
I want to run `/demo show me *Messages*` and see the editor operating live in my tmux session
So that I can visually verify features work as expected without reading text logs.

## Problem Statement
The current `/demo` skill runs bash scripts that call `tmaxclient` and dump text output to Claude's terminal. The user reads about features instead of seeing them. Demo steps are hardcoded in bash with no reusable format. There's no TUI frame management, no keystroke pacing, and no visual verification.

## Solution Statement
Create a Python runner (`demos/demo-runner.py`) that reads YAML playbooks from `demos/`, ensures the daemon and TUI frame are connected in the tmux session, and executes each step with visual pacing. Playbooks define actions (open, eval, key, keys, insert, command, capture, pause), narration text, and timing. SKILL.md instructs Claude to pick or generate a playbook and run it, narrating what the user should see in tmux.

## Relevant Files

### New Files
- `demos/demo-runner.py` — Python playbook runner. Reads YAML, ensures daemon/TUI, executes steps with pacing.
- `demos/messages.yaml` — Playbook for *Messages* buffer demo.
- `demos/editing.yaml` — Playbook for basic editing demo.
- `demos/buffers.yaml` — Playbook for buffer management demo.
- `demos/tlisp.yaml` — Playbook for T-Lisp interpreter demo.

### Files to Modify
- `.claude/skills/demo/SKILL.md` — Rewrite with visual demo workflow using playbooks and Python runner.

### Reference Files (no changes needed)
- `bin/tmaxclient` — Client CLI. Already supports `--keys`, `--capture`, `--frames`, `--key`, `--eval`, `--open`, `--insert`, `--ping`.
- `.claude/skills/demo/scripts/demo-lib.sh` — Existing bash helper library. Kept as daemon/TUI startup reference.
- `.claude/skills/demo/scripts/demo-*.sh` — Existing bash demo scripts. Kept for backwards compatibility.

## Implementation Plan

### Phase 1: Runner
Build the Python runner with all action types, daemon/TUI lifecycle, variable templating, and CLI.

### Phase 2: Playbooks
Create the 4 YAML playbooks covering messages, editing, buffers, and T-Lisp.

### Phase 3: Integration
Update SKILL.md to instruct Claude to use the playbook system for visual demos.

## Step by Step Tasks

### Create demos/demo-runner.py

- Implement `ensure_daemon()`:
  - Run `tmaxclient --ping`, return if running
  - Check tmux session `tmax` exists
  - Ensure `tmax-daemon` window exists (create if needed)
  - Respawn pane with `cd PROJECT_DIR && bun src/server/server.ts`
  - Poll `--ping` up to 10s for readiness
- Implement `ensure_tui()`:
  - Run `tmaxclient --frames`, check for connected frame
  - If no frame, ensure `tui` tmux window exists (create if needed)
  - Respawn pane with `cd PROJECT_DIR && bun src/client/tui-client.ts`
  - Poll `--frames` up to 10s for frame to appear
- Implement action dispatch:
  - `setup_file` — create temp file at `/tmp/tmax-demo-<name>`, store path in variables dict
  - `open` — run `tmaxclient <filepath>`
  - `eval` — run `tmaxclient --eval <expr>`
  - `key` — run `tmaxclient --key <key>`
  - `keys` — run `tmaxclient --keys <sequence>`
  - `insert` — run `tmaxclient --insert <text>`
  - `command` — run `tmaxclient --command <name>`
  - `capture` — run `tmaxclient --capture`, print output
  - `pause` — time.sleep(duration)
  - `cleanup` — remove all tracked temp files
- Implement variable templating: replace `${VAR}` in strings from variables dict
- Implement `run_playbook(path)`:
  - Load YAML file
  - Resolve PROJECT_DIR from script location
  - Run setup steps, collect variables
  - Run each step: print section header if present, print narration, execute action, pause
  - Track errors vs expected errors
  - Run cleanup at end
- CLI interface:
  - `python3 demos/demo-runner.py <playbook.yaml> [options]`
  - `--speed <float>` (default 1.0) — multiplier for all pause durations
  - `--no-tui` — skip TUI frame startup (text-only mode)
  - `--dry-run` — print steps without executing

### Create demos/messages.yaml

- Setup: temp file with 5 lines of content
- Steps covering: open file, format-string message, warn-level log, check messages, level filtering (debug toggle), command context in error, read-only guard, ring buffer clear
- Each step has narration and appropriate pause

### Create demos/editing.yaml

- Setup: temp file with 5 lines
- Steps covering: open file, cursor movement (gg, G), insert mode (i, type, Escape), delete (x), undo (u), save
- Each step has narration and appropriate pause

### Create demos/buffers.yaml

- Setup: two temp files
- Steps covering: open first file, open second file, list buffers, switch buffers, switch to *Messages*, attempt insert (expect error)
- Each step has narration and appropriate pause

### Create demos/tlisp.yaml

- No setup files needed
- Steps covering: arithmetic (+, *, chained), strings (concat, length), lists (create, length, mapcar), variables (setq), functions (defun, call), editor API (cursor-position, editor-mode), error handling
- Each step has narration and appropriate pause

### Update .claude/skills/demo/SKILL.md

- Rewrite to instruct Claude to:
  1. Parse the user's prompt to identify features to demonstrate
  2. Pick matching playbook from `demos/` or generate a minimal one
  3. Run `python3 demos/demo-runner.py demos/<name>.yaml`
  4. Narrate what the user should see in tmux
- List available playbooks with descriptions
- Show playbook schema for ad-hoc generation

### Validate all playbooks end-to-end

- Run each playbook, verify no errors
- Verify TUI shows keystrokes in tmux
- Verify existing bash demos still work

## Testing Strategy

### Integration Tests
- Run each playbook with `--dry-run` to verify YAML parsing and step ordering
- Run each playbook live to verify daemon/TUI startup and step execution
- Run with `--speed 0` to verify all steps execute without delays (fast validation)

### Edge Cases
- Daemon already running (idempotent startup)
- TUI already connected (idempotent)
- Playbook with expect_error step that succeeds (should warn, not fail)
- Missing tmux session (should fail with clear error)

## Acceptance Criteria
- `python3 demos/demo-runner.py demos/messages.yaml` runs without errors and drives the TUI visually
- `python3 demos/demo-runner.py demos/editing.yaml` runs without errors
- `python3 demos/demo-runner.py demos/buffers.yaml` runs without errors
- `python3 demos/demo-runner.py demos/tlisp.yaml` runs without errors
- `--speed 0` runs all playbooks without delays
- `--dry-run` prints steps without executing
- Existing bash demos (`demo-messages.sh` etc.) still work unchanged
- SKILL.md instructs Claude to use playbooks with visual workflow

## Validation Commands
- `python3 demos/demo-runner.py demos/messages.yaml --speed 0` — fast validation of messages playbook
- `python3 demos/demo-runner.py demos/editing.yaml --speed 0` — fast validation of editing playbook
- `python3 demos/demo-runner.py demos/buffers.yaml --speed 0` — fast validation of buffers playbook
- `python3 demos/demo-runner.py demos/tlisp.yaml --speed 0` — fast validation of T-Lisp playbook
- `python3 demos/demo-runner.py demos/messages.yaml --dry-run` — dry-run validation
- `bash .claude/skills/demo/scripts/demo-messages.sh` — existing bash demo still works

## Notes
- Python 3 is already used by numbering scripts — no new language dependency
- PyYAML (`import yaml`) is available on this system
- The runner shells out to `tmaxclient` for all actions — no direct socket communication
- The `tui` and `tmax-daemon` tmux windows are reused across runs (idempotent startup)
- Pause durations are in seconds, scaled by `--speed` multiplier
