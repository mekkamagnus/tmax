# ADW Playbook Schema

A **playbook** is a YAML file describing an e2e editor workflow to be run by
`adws/adw-run-e2e.ts`. The runner brings up its own daemon, drives the keys/eval
you declare, asserts the `expect` blocks, tears down, and exits non-zero on any
failure.

A playbook can be **mixed**: most steps are headless (drive the daemon client,
assert on T-Lisp state — fast), but steps that verify a *visual* feature are
**headed** (drive a real tmax TUI in tmux and assert on the captured screen).
This is the playwright-cli model — "playbook passes" ⇔ "a fresh `tmax` shows the
same thing".

> **ADW vs Demo:** an ADW playbook *asserts and exits non-zero on failure*. A
> demo playbook (`demos/*.yaml` + `demos/demo-runner.py`) *narrates* in a live
> tmux/TUI session and asserts nothing. They share the `${VAR}` templating
> idiom but are different primitives. This directory holds ADW playbooks only.

## Running a playbook

```bash
bun adws/adw-run-e2e.ts adws/playbooks/which-key.yaml   # one playbook
bun adws/adw-run-e2e.ts                                 # all playbooks/*.yaml (skips _-prefixed)
```

## Top-level fields

| Field      | Type    | Required | Description |
|------------|---------|----------|-------------|
| `name`     | string  | yes      | Human-readable title, printed in output. |
| `mode`     | string  | no       | Major mode to verify via `(major-mode-get)` after the setup file opens. Fails the playbook if it doesn't match. |
| `setup`    | list    | no       | Setup actions (see below). |
| `steps`    | list    | yes      | Ordered steps to execute (see below). |
| `cleanup`  | bool    | no       | Default `true`. Kills the buffer and removes temp files on completion (even on failure). |

### Setup action: `setup_file`

```yaml
setup:
  - action: setup_file
    var: FILE                 # becomes ${FILE} when referenced in steps
    name: my-fixture.md       # written under the project root
    content: |
      # Heading
      body text
```

## Step fields

| Field          | Type          | Description |
|----------------|---------------|-------------|
| `name`         | string        | Description shown in the pass/fail output. |
| `keys`         | string        | Key sequence. Headless: via `tmaxclient --keys`. Headed: via `tmux send-keys` into the real TUI. e.g. `"]h"`, `"iHello<Escape>"`. |
| `eval`         | string        | T-Lisp expression to evaluate. **Mutually exclusive with `keys`.** |
| `setup_cursor` | `[line, col]` | Runs `(cursor-move line col)` before this step (0-indexed). |
| `wait`         | number (ms)   | Settle delay after keys/eval. Default `120` (keys) / `150` (eval) / `300` (screen assertions — the TUI must repaint). **Required for async/timer-driven features** (e.g. which-key popup activation). |
| `headed`       | bool          | Force this step through the real TUI (tmux). Auto-enabled when `expect` uses `screen_*` matchers. |
| `expect`       | map           | Assertion block (see below). Omit for a pure action step. |

## `expect` matchers

All matchers in a block must pass. There is **no boolean matcher** — see the
boolean idiom below.

| Matcher              | Checks |
|----------------------|--------|
| `cursor_line`        | `(cursor-line)` equals the number (0-indexed). |
| `cursor_column`      | `(cursor-column)` equals the number. |
| `line_text`          | `(buffer-get-line (cursor-line))` exactly equals the string. |
| `line_text_matches`  | The cursor line matches the regex. |
| `mode`               | `(major-mode-get)` equals the string. |
| `buffer_contains`    | `(buffer-text)` contains the substring. |
| `status_message`     | `(editor-status)` contains the substring. |
| `result_contains`    | The return value of the step's `eval` contains the substring. More reliable than `status_message` for functions that report via their return value. |
| `screen_contains`    | **HEADED.** The rendered TUI screen (tmux `capture-pane`, ANSI stripped) contains the substring. Forces the step headed. |
| `screen_not_contains`| **HEADED.** The rendered screen does NOT contain the substring (e.g. a dismissed popup). Forces the step headed. |

### Boolean idiom (there is no boolean matcher)

To assert a T-Lisp boolean like `(which-key-active)`, wrap it in an `if` that
returns a sentinel string, then match the sentinel with `result_contains`:

```yaml
- name: which-key popup is active
  eval: '(if (which-key-active) "ACTIVE" "INACTIVE")'
  expect:
    result_contains: "ACTIVE"
```

Combine several values into one eval to assert them together:

```yaml
- name: popup active with prefix z
  eval: '(concat (if (which-key-active) "ACTIVE" "INACTIVE") "|" (which-key-prefix))'
  expect:
    result_contains: "ACTIVE|z"
```

## Lint guard (fail-fast before daemon start)

Any `eval` expression containing a backslash is rejected before the daemon
starts. Reason: the JSON-RPC eval path (`tmaxclient --eval` → server →
interpreter) re-decodes backslashes, so regex/string-escape expressions arrive
mangled and the feature silently returns `ERR` or `null`. **Drive such features
via `keys` instead** (add a keybinding first if the feature lacks one). The
guard reports **all** offending steps in a single pass.

## Control keys in `keys` sequences

In a `keys` sequence, **control/special keys must be bracketed**: `<Escape>`,
`<Enter>`, `<Space>`, `<Tab>`, `<Backspace>`, `<SPC>`, `<RET>`, `<ESC>`. A bare
`C-g` is **not** recognized — both the headless daemon path and the headed tmux
path split it into three literal keys (`C`, `-`, `g`), which corrupts prefix
state and dispatches garbage. Use `<Escape>` to cancel (it shares the
normal-handler cancel path with `C-g`).

## Headed mode (mixed playbooks, playwright-style)

A playbook can mix **headless** steps (assert on T-Lisp state — fast) and
**headed** steps (drive a real tmax TUI and assert on the captured screen — what
a user actually sees). This is the playwright-cli model: launch a browser, drive
it, assert on what's rendered.

A step is headed if **either** is true:
- it sets `headed: true`, or
- its `expect` block uses `screen_contains` / `screen_not_contains` (which
  auto-enable headed mode).

If a playbook contains any headed step, the runner spawns a real TUI in a
detached tmux session connected to the same daemon and prints how to watch it:

```
✓ headed TUI: tmux attach -t tmax-adw-<pid> (to watch live)
```

Headed `keys` are sent via `tmux send-keys` (real terminal input); headless
`keys` go through the daemon client. State matchers (`cursor_line`, `mode`, …)
work in both modes, since the TUI shares the daemon's editor state.

```yaml
# Headed: assert the popup actually renders
- name: press z, popup renders on screen
  keys: "z"
  wait: 350
  expect:
    screen_contains: "scroll-cursor-top"
- name: Escape dismisses it
  keys: "<Escape>"
  wait: 250
  expect:
    screen_not_contains: "scroll-cursor-top"
```

**When to use which:**
- *Headless* — state-only features: cursor movement, buffer contents, mode,
  keymap structure. No rendering involved; fast; runs anywhere.
- *Headed* — visual features: popups, overlays, the status line, anything where
  "the state flag is set" does not prove "the user sees it".

**CLI flags:**
- `--headless` — force every step headless (CI without tmux). Screen matchers
  then fail fast with "cannot run a headed step with --headless".

## Tips

- Each step is a separate `tmaxclient` process, so there is real wall-clock
  latency between steps. For deterministic timing on async features, set an
  explicit `wait` rather than relying on that latency.
- Make navigation steps independent by giving each its own `setup_cursor`.
- Prefer `result_contains` over `status_message` when a function reports via its
  return value — status messages can be overwritten by later commands.
