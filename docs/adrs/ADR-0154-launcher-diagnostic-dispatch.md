# ADR-0154 — bin/tmax dispatches diagnostic flags + errors on unknown flags (#47)
## Status: Accepted
## Context
`bin/tmax`'s arg loop sent every unrecognized `--flag` (including the documented
diagnostic flags `--messages`, `--status`, `--ping`, `--frames`, `--clients`,
`--last-error`, `--backtrace`, `--diagnostics`, `--list-buffers`, `--server-info`,
`--capture*`) into `FILES[]`, which `main.ts` silently dropped before launching the
TUI — so `tmax --messages` booted the TUI (hanging on non-TTY stdin) instead of
reporting, and `tmax --bogus-flag` silently launched the editor. The documented
debug CLI (`docs/learnings.md` → `tmaxclient --status`) was unreachable through
the unified entry. Blocked by #44 (tmaxclient in `package.json bin`).

## Decision
1. **Diagnostic dispatch** — before the main arg loop, if any arg is a diagnostic
   flag, `exec tmaxclient -s "$SOCKET" "$@"` (pass-through preserves modifiers
   `--json`/`--frame`/`--since-request`/`-n`). Queries the EXISTING daemon (no
   auto-start — diagnostics need real state).
2. **Unknown-flag error** — the `*)` branch errors (exit 1, clear message) on any
   arg starting with `-` that isn't a recognized flag/value/diagnostic flag.
3. **POSIX `--`** — `--` sets end-of-options, so subsequent args (including
   leading-dash filenames) are treated as files, not unknown flags.

## Consequences
- Documented diagnostic flags work through `tmax` (verified: `--ping`/`--status`/
  `--messages`/`--frames`/`--clients` emit output, no TUI); `--bogus-flag` exits 1
  with an error; `--messages </dev/null` does not hang; `--` honors end-of-options;
  recognized flags (`--help`/`--stop`) still work (no false positives).
- Known follow-ups (out of scope, flagged by the verify-gate): (a) `tmax --messages
  --json` still pretty-prints (a tmaxclient `showMessages` defect — the launcher
  forwards `--json` correctly); (b) the main-loop `--capture` handlers are now dead
  (dispatch wins) — harmless, optional cleanup.

Spec: [BUG-41](../specs/BUG-41-launcher-diagnostic-dispatch.md). Issue: #47.
Verify-gate: PASS (gap-2 `--` separator addressed after the gate).
