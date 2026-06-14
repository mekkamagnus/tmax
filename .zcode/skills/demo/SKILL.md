---
name: demo
description: "Demo tmax functionality visually in the tmux TUI. Reads YAML playbooks and executes them with keystroke pacing so the user can watch in tmux session 'tmax'. Triggers on: /demo, demo tmax, show me, demonstrate."
---

# Demo

Demo tmax functionality visually in the tmux TUI. The user watches the editor operate live in their tmux session while you narrate what's happening.

## Demo Workflow

When the user invokes `/demo`:

1. **Check the args** — If the args reference a playbook (by name, filename, or topic), run it immediately. Do not ask for confirmation.
   - `/demo messages` or `/demo messages.yaml` → `python3 demos/demo-runner.py demos/messages.yaml`
   - `/demo show me editing` → `python3 demos/demo-runner.py demos/editing.yaml`
   - `/demo tlisp` → `python3 demos/demo-runner.py demos/tlisp.yaml`
2. **If no playbook matches** — Generate one following the "Generating Custom Demos" section below.
3. **Run the playbook** — Execute `python3 demos/demo-runner.py demos/<name>.yaml`.
4. **Narrate** — After the runner finishes, briefly describe what the user just saw in their tmux TUI window.

## Available Playbooks

| Playbook | Description |
|----------|-------------|
| `demos/messages.yaml` | *Messages* buffer: severity levels, format strings, filtering, read-only guard |
| `demos/editing.yaml` | Basic editing: file open, cursor movement, insert/delete, undo, save |
| `demos/buffers.yaml` | Buffer management: multiple buffers, switching, *Messages* read-only |
| `demos/tlisp.yaml` | T-Lisp interpreter: arithmetic, strings, lists, functions, editor API |

## Running a Demo

```bash
# Visual demo (drives TUI in tmux)
python3 demos/demo-runner.py demos/messages.yaml

# Fast validation (no delays)
python3 demos/demo-runner.py demos/messages.yaml --speed 0

# Dry run (print steps without executing)
python3 demos/demo-runner.py demos/messages.yaml --dry-run
```

## Generating Custom Demos

When no existing playbook covers what the user asked for, you must generate one. Follow this exact flow:

1. **Identify the features** from the user's prompt. Break them into concrete, demonstrable steps.
2. **Research the available T-Lisp functions** by running `python3 demos/demo-runner.py demos/tlisp.yaml --dry-run` or calling `tmaxclient --eval '(callable-command-details)'` to find relevant API functions.
3. **Write the playbook** following the schema below. Save it to `demos/<descriptive-name>.yaml`.
4. **Validate** with `python3 demos/demo-runner.py demos/<name>.yaml --speed 0` before running it visually.
5. **Run visually** with `python3 demos/demo-runner.py demos/<name>.yaml`.
6. **Narrate** what the user sees in their tmux TUI window.

### Prefer keys over eval — and know why

A demo shows the **user-facing experience**. Users interact through keystrokes, so demos should drive features through `key`/`keys` (which go to the TUI frame via raw input) — not `eval` (which goes through `tmaxclient --eval` → JSON-RPC → interpreter).

The reason this matters, not just as a principle but as a concrete bug source: `--eval` serializes the T-Lisp expression through JSON, and **backslashes get re-decoded somewhere in that path**. A regex like `"^sum(@\([0-9]+\)\\$..."` works when loaded from a `.tlisp` file (as the interpreter does natively) but arrives mangled when passed through `--eval`, so the feature silently returns `ERR` or `null`. The unit-test harness bypasses JSON-RPC, which is why a feature can pass all its tests yet fail in a demo.

Rules, in order of preference:

1. **If the feature has a keybinding, use `key`/`keys`.** This is the only path that exercises the real editor dispatch and avoids the escaping trap.
2. **If the feature has no keybinding, add one first**, then demo it via keys. (e.g. `markdown-table-eval-formula` should be bound to `, t e` in `markdown-mode.tlisp` before you demo it.)
3. **Use `eval` only for pure-computation steps that have no UI surface** — e.g. `(buffer-text)` to print a result, or `(+ 1 2)` in the `tlisp.yaml` interpreter demo. Even then, avoid expressions containing backslashes or regex metacharacters.
4. **If you must invoke a command programmatically**, prefer `action: command` (which dispatches through the editor's command path, not the raw `--eval` string) over `action: eval`.

The validator (`--speed 0` and `--dry-run`) hard-fails on `eval` steps whose expression contains a backslash, with a message pointing here. If you hit that error, the fix is almost always "add a keybinding and switch to `keys`", not "escape harder".

Example — user asks "show me how search works":

```yaml
name: search
description: "Demonstrates incremental search — forward, backward, repeating."
speed: 1.0
setup:
  - action: setup_file
    var: FILE
    name: search-demo.txt
    content: |
      apple
      banana
      cherry
      date
      elderberry
steps:
  - section: Forward search
    narrate: "Opening a file with 5 fruit names"
    action: open
    file: "${FILE}"
    pause: 1.0

  - narrate: "Starting forward search for 'an'"
    action: keys
    keys: "/an"
    pause: 0.5

  - narrate: "Typing the search pattern"
    action: insert
    text: "an"
    pause: 0.8

  - narrate: "Jumping to next match with n"
    action: key
    key: "n"
    pause: 0.8

cleanup: true
```

### Tips for generating playbooks

- Use `setup_file` for any file content the demo needs — never hardcode `/tmp` paths.
- Set `pause: 1.0` for key steps the user should watch, `0.3` for quick evaluations.
- Use `expect_error: true` for steps that intentionally fail (read-only guard, undefined symbols).
- Use `section` headers to group related steps.
- Use `keys` for multi-key sequences: `iHello<Escape>`, `gg`, `C-h e`.
- Use `key` for single keys: `G`, `x`, `u`, `i`.
- Always test with `--speed 0` before running visually.

## Playbook Schema

```yaml
name: <string>
description: <string>
speed: <float>          # global speed multiplier (default 1.0)
setup:                  # optional pre-demo temp files
  - action: setup_file
    var: FILE           # becomes ${FILE} in later steps
    name: <filename>
    content: |
      <file content>
steps:
  - section: <string>    # optional section header
    narrate: <string>    # what to tell the user
    action: <type>       # see action types below
    pause: <float>       # seconds after this step
    expect_error: <bool> # don't fail on errors
cleanup: true            # remove temp files at end
```

### Action Types

| Action | Parameters | Description |
|--------|-----------|-------------|
| `setup_file` | `var`, `name`, `content` | Create temp file, store path in `${var}` |
| `open` | `file` | Open file in editor |
| `key` | `key` | Send single keystroke (preferred for any feature with a binding) |
| `keys` | `keys` | Send key sequence (`iHello<Escape>`, `gg`, `, x l`) — preferred for any feature with a binding |
| `command` | `name` | Execute editor command by name (dispatches through the editor; safer than `eval`) |
| `insert` | `text` | Insert text at cursor |
| `eval` | `expr` | Evaluate T-Lisp expression. **Avoid for features with keybindings.** Backslashes/regex in the expr are corrupted by the JSON-RPC path; the validator hard-fails on `eval` steps containing `\`. See "Prefer keys over eval" above. |
| `capture` | — | Capture and print TUI screen |
| `pause` | `duration` | Just wait |
| `cleanup` | — | Remove tracked temp files |

## Constraints

- Only use tmux session `tmax`
- All operations through `tmaxclient` CLI
- No direct file manipulation of editor internals
- Playbooks must be deterministic and idempotent
