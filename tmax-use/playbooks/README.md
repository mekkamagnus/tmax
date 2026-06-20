# tmax-use Playbooks

YAML playbooks drive declarative end-to-end tests against a real tmax daemon.
Each playbook launches a fresh daemon, writes its setup files, executes its
steps in order, tears down, and emits structured results to terminal, HTML,
and JUnit reporters.

## Schema

```yaml
name: <required string>
description?: <string>
mode?: <string>           # major-mode to verify after the first setup file opens
width?: <number>          # terminal width for capture (default 94)
height?: <number>         # terminal height for capture (default 29)
setup?:                   # list of setup_file actions
  - action: setup_file
    var?: <string>        # name to bind the resolved path to (used via ${VAR})
    name: <string>        # path (resolved against the project root)
    content: <string>     # file body
steps:                    # at least one step required
  - name?: <string>
    keys?: <string>       # key sequence (e.g. "]h", "<Esc>hi")
    eval?: <string>       # T-Lisp expression (mutually exclusive with keys)
    setup_cursor?: [<line>, <col>]   # 0-indexed position before the action
    wait?: <number>       # ms to wait after the action (defaults: keys 120, eval 150, screen-assert 300)
    headed?: <boolean>    # opt into tmux capture for this step
    expect?:              # all expected conditions (see below)
cleanup?: <boolean>       # default true
```

### Expect fields

All optional; all evaluated against the live frame state after the action:

| Field                | Type     | Meaning                                                    |
|----------------------|----------|------------------------------------------------------------|
| `cursor_line`        | number   | Cursor is on this line (0-indexed)                         |
| `cursor_column`      | number   | Cursor is on this column (0-indexed)                       |
| `line_text`          | string   | Current line equals this string exactly                    |
| `line_text_matches`  | string   | Current line matches this regex                            |
| `mode`               | string   | Editor mode equals this (e.g. `"normal"`, `"insert"`)      |
| `buffer_contains`    | string   | Buffer text contains this substring                        |
| `status_message`     | string   | Status line contains this substring                        |
| `result_contains`    | string   | Eval result contains this substring                        |
| `screen_contains`    | string   | Captured screen (headless, ANSI-stripped) contains this    |
| `screen_not_contains`| string   | Captured screen does NOT contain this                      |

## YAML subset supported

Mappings, sequences, strings, numbers, booleans, and null. **Not** supported:
anchors (`&`/`*`), aliases, custom tags, multi-document streams (`---`).
Anything outside this subset produces a parse error in `parsePlaybook()`.

## Variable substitution

`${VAR}` references in `keys`, `eval`, or step names resolve to the path
bound to `var` in any earlier `setup_file`. Useful for passing the resolved
fixture path into a T-Lisp expression.

## Backslash lint guard

A step's `eval` is rejected if it contains a backslash. JSON-RPC `eval` mangles
backslashes; drive such scenarios via `keys` instead. The lint guard fires
during `parsePlaybook()` so the playbook fails fast before any daemon starts.

## Naming convention

- `_smoke.yaml`, `_*-*.yaml` — runner self-tests (run explicitly).
- All other `*.yaml` files — default-discovered playbooks.

## Headless vs headed

By default every step is headless: the daemon's `capture` JSON-RPC renders
the frame without a TUI, so CI needs no `tmux`. A step opts into headed mode
by either setting `headed: true` on itself or being implicitly promoted when
its `expect` block uses `screen_contains`/`screen_not_contains` (the latter
works in both modes; the difference is only which renderer produces the
pixels being substring-matched).

## Examples

See `_smoke.yaml` (every matcher exercised), `which-key.yaml` (mixed
headless/headed), and `markdown.yaml` (full major-mode coverage).
