# Bug: malformed mktemp template in bin/tmax races on concurrent launch and locks out all tmax use

## Bug Description
`bin/tmax:90` used `mktemp /tmp/tmax-daemon-start.XXXXXX.log`. On macOS/BSD,
`mktemp` only substitutes a **trailing** run of X's; because `.log` follows the
X's, every call returns the **same literal path** (`/tmp/tmax-daemon-start.XXXXXX.log`).
The first caller wins and every concurrent or subsequent caller hits
`mkstemp failed: File exists`. Under `set -euo pipefail`, that aborts
`ensure_daemon` before the daemon is contacted — so a single leftover file or any
concurrent `tmax` invocation permanently fails every later `tmax -e` / `tmax <file>`.

## Problem Statement
Daemon startup must use a correct unique temp file so concurrent launches do not
collide and a stale file cannot lock out all tmax use.

## Solution Statement
Use a trailing-X template — `mktemp /tmp/tmax-daemon-start.XXXXXX` — so each call
yields a unique path (codex APPROVE: "the simplest portable fix"). The `.log`
suffix is dropped (the file is a throwaway diagnostic; content, not extension,
matters).

## Steps to Reproduce
```bash
touch /tmp/tmax-daemon-start.XXXXXX.log       # pre-create the literal stale file
bin/tmax -e '(+ 1 1)'                          # today: "mkstemp failed: File exists", exit != 0
# concurrent:
for i in 1 2 3 4 5; do TMAX_SOCKET=/tmp/par-$i/server bin/tmax -e '(+ 1 1)' & done; wait
# today: only the first wins; the rest fail
```

## Root Cause Analysis
BSD `mktemp` requires the X-run to be the suffix of the template. `XXXXXX.log`
places non-X chars after the X's, so no substitution occurs and the literal
template path is used every time — a classic single-path race.

## Relevant Files
- `bin/tmax:88-95` (`ensure_daemon`) — the `daemon_log=$(mktemp …)` line.

## Step by Step Tasks
### Task 1 — trailing-X template
**AC**: `bin/tmax` uses a trailing-X mktemp template (e.g. `/tmp/tmax-daemon-start.XXXXXX`); no non-X suffix after the X-run.
### Task 2 — no stale-file lockout
**AC**: pre-creating `/tmp/tmax-daemon-start.XXXXXX.log` (the old literal path) no longer prevents `bin/tmax -e '(+ 1 1)'` from succeeding.
### Task 3 — concurrent-launch safety
**AC**: 5 concurrent `TMAX_SOCKET=/tmp/par-N/server bin/tmax -e '(+ 1 1)'` invocations all return `2` with exit 0 (no "mkstemp failed").
### Task 4 — Validate
empirical repro (concurrent + stale-file, fresh socket paths, stop spawned daemons); verify-gate PASS.

## Validation Commands
- Pre-create the old literal file, then `bin/tmax -e '(+ 1 1)'` succeeds (returns 2, exit 0).
- 5 concurrent `TMAX_SOCKET=/tmp/par-N/server bin/tmax -e '(+ 1 1)'` all return 2, exit 0.
- `bin/tmax --help` exits 0 (syntax sanity).

## Notes
- `bin/tmax` is a bash launcher outside the tsconfig roots; validation is empirical (fresh sockets, daemons stopped after).
- Size S; codex APPROVE.
