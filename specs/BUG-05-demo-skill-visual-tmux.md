# Bug: /demo skill outputs text instead of showing features visually in tmux TUI

## Bug Description
When the user runs `/demo show me the *Messages* functionality`, the skill runs bash scripts that call `tmaxclient` and output results as text in Claude's terminal. The user sees a log of RPC calls, not the editor working visually in their tmux session.

**Expected**: Parse the user's prompt → pick or generate a YAML playbook → ensure daemon + TUI frame are running → execute the playbook visually using keystrokes with pauses so the user can watch the editor operating live in the tmux window.

**Actual**: Runs `demo-messages.sh` which calls `tmaxclient --eval`, `--open`, `--messages` etc. and dumps the text output. The user reads about the feature instead of seeing it.

## Problem Statement
The demo skill has three problems:
1. **No structured demo definitions** — Demo steps are hardcoded in bash scripts with no reusable format.
2. **No visual execution** — All output goes to Claude's terminal as text. No TUI frame connection, no keystroke pacing, no screen capture.
3. **SKILL.md lacks visual workflow** — It tells Claude to run bash scripts instead of interpreting prompts and driving the TUI visually.

## Solution Statement
Replace the bash-centric approach with a Python runner + YAML playbook system:

1. **YAML playbooks** in `demos/` define demo steps declaratively (action, parameters, narration, pacing).
2. **Python runner** (`demos/demo-runner.py`) reads a playbook, ensures daemon + TUI are running, and executes each step with visual pacing via `tmaxclient`.
3. **SKILL.md** instructs Claude to pick the right playbook from the user's prompt (or generate a minimal one), then run it with the Python runner. Claude narrates what the user should see in tmux.

## Steps to Reproduce
1. Open tmux session 'tmax' with daemon and TUI windows
2. Run `/demo show me the *Messages* functionality and how it can be useful`
3. Observe: Claude runs `demo-messages.sh` and outputs text to its terminal
4. Expected: Claude drives the TUI in the 'tmax' tmux session so the user can watch

## Root Cause Analysis
The SKILL.md instructions tell Claude to run pre-made bash scripts that output text. There are no instructions to:
- Interpret the user's prompt to build a demo plan
- Ensure a TUI frame is connected in the tmux session
- Drive the TUI visually with keystrokes and pauses
- Capture the TUI screen to verify each step

The bash scripts mix narration, action, and output formatting into a single stream that only makes sense as terminal text.

## Relevant Files

### New Files
- `demos/demo-runner.py` — Python playbook runner. Reads YAML, ensures daemon/TUI, executes steps with pacing.
- `demos/messages.yaml` — Playbook for *Messages* buffer demo.
- `demos/editing.yaml` — Playbook for basic editing demo.
- `demos/buffers.yaml` — Playbook for buffer management demo.
- `demos/tlisp.yaml` — Playbook for T-Lisp interpreter demo.

### Files to Modify
- `.claude/skills/demo/SKILL.md` — Rewrite with visual demo workflow using playbooks.
- `.claude/skills/demo/scripts/demo-lib.sh` — Keep as daemon/TUI startup layer only.

### Reference Files (no changes)
- `bin/tmaxclient` — Already supports `--keys`, `--capture`, `--frames`, `--key`, `--eval`, `--open`, `--insert`, `--ping`.

## Step by Step Tasks

### Task 1: Create the Python demo runner

**User Story**: As a demo system, I want a Python runner that reads YAML playbooks and executes them visually so demos are consistent and driven in the tmux TUI.

- Create `demos/demo-runner.py` with:
  - `ensure_daemon()` — check ping, start daemon in tmux `tmax-daemon` window via respawn-pane if needed
  - `ensure_tui()` — check frames via `--frames`, start TUI client in tmux `tui` window if no frame connected
  - `execute_step(step)` — dispatch on action type:
    - `open` → `tmaxclient <file>`
    - `eval` → `tmaxclient --eval <expr>`
    - `key` → `tmaxclient --key <key>`
    - `keys` → `tmaxclient --keys <sequence>`
    - `insert` → `tmaxclient --insert <text>`
    - `command` → `tmaxclient --command <name>`
    - `capture` → `tmaxclient --capture` (print to stdout)
    - `pause` → time.sleep(duration)
    - `setup_file` → create temp file with content
    - `cleanup` → remove temp files
  - `run_playbook(path)` — load YAML, call ensure_daemon + ensure_tui, iterate steps, handle errors
  - Variable templating: `${FILE}`, `${DIR}` etc. substituted from setup_file outputs
  - Each step has optional: `narrate` (print text), `pause` (delay after action, default from step or global), `expect_error` (don't fail on error)
  - CLI: `python3 demos/demo-runner.py demos/messages.yaml [options]`
  - Global options: `--speed <multiplier>` (default 1.0, scales all pauses), `--no-tui` (text-only mode for backwards compat)

**Acceptance Criteria**:
- [ ] Runner starts daemon and TUI if not running
- [ ] Each action type correctly calls tmaxclient
- [ ] Pauses scale with --speed flag
- [ ] Temp files created by setup_file are tracked and cleaned up
- [ ] Narration is printed to stdout
- [ ] Errors from expect_error steps don't crash the runner

### Task 2: Create YAML playbooks

**User Story**: As a demo author, I want YAML playbooks that define demo steps declaratively so they're easy to read, write, and maintain.

- Create `demos/messages.yaml` — exercises severity levels, format strings, level filtering, read-only guard, ring buffer
- Create `demos/editing.yaml` — exercises file open, cursor movement, insert mode, delete, undo/redo, save
- Create `demos/buffers.yaml` — exercises multiple buffers, switching, *Messages* buffer
- Create `demos/tlisp.yaml` — exercises arithmetic, strings, lists, variables/functions, editor API, error handling

Playbook schema:
```yaml
name: <string>
description: <string>
speed: <float>  # global speed multiplier, default 1.0
setup:          # optional pre-demo setup
  - action: setup_file
    var: FILE   # becomes ${FILE} in later steps
    name: <filename>
    content: |
      <file content>
steps:
  - section: <string>       # optional section header
    narrate: <string>       # what to tell the user
    action: <action_type>  # open|eval|key|keys|insert|command|capture|pause
    ...action params...
    pause: <float>         # seconds after this step
    expect_error: <bool>   # don't fail on errors
cleanup: true               # remove temp files at end
```

**Acceptance Criteria**:
- [ ] All 4 playbooks are valid YAML
- [ ] Each playbook covers the same features as the corresponding bash script
- [ ] Playbooks use setup_file for temp files, not hardcoded paths

### Task 3: Update SKILL.md with visual demo workflow

**User Story**: As Claude running the /demo skill, I want clear instructions on how to pick and run a visual demo so the user sees features in the tmux TUI.

- Rewrite SKILL.md to instruct Claude to:
  1. Parse the user's prompt to identify which feature(s) to demonstrate
  2. Pick the matching playbook from `demos/`, or generate a minimal one for ad-hoc demos
  3. Run `python3 demos/demo-runner.py demos/<name>.yaml`
  4. Narrate what the user should see happening in their tmux TUI window
- List available playbooks with descriptions
- Include example of generating a minimal ad-hoc playbook for a custom prompt
- Keep demo-lib.sh as the daemon/TUI startup reference

**Acceptance Criteria**:
- [ ] SKILL.md instructs Claude to parse prompts and pick playbooks
- [ ] SKILL.md instructs Claude to run the Python runner
- [ ] SKILL.md instructs Claude to narrate what the user sees in tmux

### Task 4: Validate end-to-end

**User Story**: As a developer, I want to verify the visual demo works so I'm confident the bug is fixed.

- Run each playbook through the Python runner
- Verify TUI frame is connected and keystrokes appear in tmux
- Verify no regressions in existing bash demo scripts

**Acceptance Criteria**:
- [ ] `python3 demos/demo-runner.py demos/messages.yaml` runs without errors
- [ ] `python3 demos/demo-runner.py demos/editing.yaml` runs without errors
- [ ] `python3 demos/demo-runner.py demos/buffers.yaml` runs without errors
- [ ] `python3 demos/demo-runner.py demos/tlisp.yaml` runs without errors
- [ ] Existing bash demos still work: `bash .claude/skills/demo/scripts/demo-messages.sh`

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `python3 demos/demo-runner.py demos/messages.yaml` — visual messages demo
- `python3 demos/demo-runner.py demos/editing.yaml` — visual editing demo
- `python3 demos/demo-runner.py demos/buffers.yaml` — visual buffers demo
- `python3 demos/demo-runner.py demos/tlisp.yaml` — visual T-Lisp demo
- `bash .claude/skills/demo/scripts/demo-messages.sh` — existing text demo still works

## Notes
- Python 3 is already used by the bug/feature numbering scripts — no new dependency
- YAML parsing uses `import yaml` (PyYAML). If not available, fall back to `json` format. Check with `python3 -c "import yaml"`.
- The `tui` tmux window already exists in the session — `ensure_tui` just needs to ensure a frame is active
- `tmaxclient --capture` returns ANSI-formatted TUI output — useful for Claude to verify
- `tmaxclient --keys 'iHello<Escape>'` parses `<Key>` notation for special keys
- Pause delays are critical: without them the demo flashes by too fast in tmux
