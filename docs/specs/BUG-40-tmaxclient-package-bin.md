# Bug: tmaxclient missing from package.json bin (documented CLI unreachable after install)

## Bug Description
`package.json`'s `bin` field installed only `tmax`, `tlisp`, `trt`, `tmax-use` —
`tmaxclient` was omitted, so `npm`/`bun install -g` never linked a `tmaxclient`
command. Yet the texinfo manual documents `tmaxclient --messages`/`--list-buffers`/
`--ping`/`--eval` etc. as the user-facing diagnostic CLI. The data is reachable via
`tmax -e '(tlisp-last-error)'` but the documented CLI binary is missing.

## Problem Statement
A fresh global install must provide a working `tmaxclient` command.

## Solution Statement
Add `"tmaxclient": "./bin/tmaxclient"` to the `bin` field. `bin/tmaxclient` is
already executable with a `#!/usr/bin/env bun` shebang, and there is no `files`
field excluding it, so it ships in the tarball.

Codex APPROVE-WITH-CONCERNS honored: the clean-room check installs the packed
artifact and checks reachability (isolated BUN_INSTALL/PATH). The separate
structured-diagnostics contract (`--diagnostics --json` returning a genuine JSON
object) is out of scope — `--last-error`/`--json` today JSON-encodes the rendered
text; that's a future item, not #44's "reachability" goal.

## Steps to Reproduce
```bash
bun install --global .   # in a tmax checkout
which tmaxclient        # today: not found
```

## Root Cause Analysis
The `bin` map was never extended when `tmaxclient` was added.

## Relevant Files
- `package.json:46-52` — add the `tmaxclient` entry.

## Step by Step Tasks
### Task 1 — bin entry
**AC**: `package.json` bin includes `"tmaxclient": "./bin/tmaxclient"`.
### Task 2 — ships + installs
**AC**: `npm pack --dry-run` lists `bin/tmaxclient`; a global install links `tmaxclient` and `tmaxclient --help` works.
### Task 3 — Validate
verify-gate PASS.

## Validation Commands
- `jq '.bin.tmaxclient' package.json` ⇒ `"./bin/tmaxclient"`.
- `npm pack --dry-run` ⇒ includes `bin/tmaxclient`.
- isolated `bun install --global .` ⇒ `which tmaxclient` resolves + `tmaxclient --help` exits 0.

## Notes
- Out of scope: the `--diagnostics --json` structured-output contract (still renders text).
- Unblocks #47 (the unified launcher dispatching diagnostic flags to tmaxclient) via AUTO-UNBLOCK.
