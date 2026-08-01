# Bug: bin/tmax swallows documented diagnostic flags (launches the TUI instead of dispatching to tmaxclient)

## Bug Description
`bin/tmax`'s arg case-statement recognized only a subset of flags; every documented
diagnostic flag (`--messages`, `--last-error`, `--backtrace`, `--diagnostics`,
`--status`, `--ping`, `--frames`, `--clients`, `--list-buffers`, `--server-info`,
`--capture*`) fell into the `*)` branch → appended to `FILES[]` → silently
swallowed by `main.ts`, and `bin/tmax` booted the interactive TUI instead (which
hangs on non-TTY stdin). `docs/learnings.md` directs developers to debug via
`tmaxclient --status`/`--messages` — unreachable through the unified `tmax` entry.

## Problem Statement
Documented diagnostic flags must work through `tmax`, and unknown `--flags` must
error loudly (not silently launch the TUI).

## Solution Statement
1. **Diagnostic dispatch** — before the main arg loop, if any arg is a diagnostic
   flag, `exec tmaxclient -s "$SOCKET" "$@"` (pass-through preserves modifiers like
   `--json`/`--frame`/`--since-request`/`-n`). Queries the EXISTING daemon on
   `$SOCKET` (no auto-start — diagnostics need real daemon state).
2. **Unknown-flag error** — the `*)` branch now errors (exit 1) on any arg starting
   with `-` that isn't a recognized flag / value / diagnostic flag, instead of
   dropping it into `FILES[]`.

Codex APPROVE-WITH-CONCERNS honored: pass-through preserves modifiers (vs a
hand-built dispatch that could drop `--json`); the `--messages`/`--json` structured
envelope exists in tmaxclient (the verifier for #44 confirmed structured output at
several sites). Blocked by #44 (tmaxclient in `package.json bin`) — now resolved.

## Steps to Reproduce
```bash
tmax --messages        # today: launches the TUI (hangs on non-TTY)
tmax --bogus-flag      # today: silently launches the TUI
```

## Root Cause Analysis
The arg loop's `*)` branch treated unrecognized `--flags` as positional files;
`main.ts` then filtered `--`-prefixed args out and launched the editor.

## Relevant Files
- `bin/tmax` — diagnostic dispatch before the arg loop; unknown-`-`-flag error in the `*)` branch.

## Step by Step Tasks
### Task 1 — diagnostic dispatch
**AC**: `tmax --messages` / `--status` / `--ping` / `--frames` / `--clients` / `--last-error` / `--backtrace` / `--diagnostics` / `--list-buffers` dispatch to tmaxclient and emit their documented output (against a running daemon).
### Task 2 — unknown-flag error
**AC**: `tmax --bogus-flag` exits non-zero with a clear error (does not launch the TUI).
### Task 3 — no hang on non-TTY
**AC**: `tmax --messages </dev/null` does not hang or crash.
### Task 4 — Validate
empirical repro + verify-gate PASS.

## Validation Commands
- `bin/tmax --help` exits 0.
- With a daemon running: `tmax --ping`, `tmax --status`, `tmax --messages`, `tmax --frames`, `tmax --clients` emit output (not a TUI).
- `tmax --bogus-flag` ⇒ exit ≠ 0, error message.
- `tmax --messages </dev/null` ⇒ no hang.

## Notes
- Dispatch queries the EXISTING daemon (no ensure_daemon) — diagnostics need real state.
- Modifiers (`--json`, `--frame`, `--since-request`) pass through unchanged.
- bin/tmax is a bash launcher outside the tsconfig roots; validation is empirical.
