# ADR-0305 — #276: `--stop` refuses embedded sessions (the identity gate)

- **Status**: Accepted
- **Date**: 2026-11-22
- **Issue**: #276
- **Spec**: SPEC-279

## Context

`tmax --stop` remotely killed EMBEDDED sessions: the shutdown RPC went to
whatever held the standard socket (embedded editors bind it), and the
SIGTERM fallback signaled `lsof`'s first pid with no verification.

## Decision

- **The identity gate**: a new `server-identity` RPC answers
  `{mode: "daemon" | "embedded", pid}`. `--stop` asks it BEFORE any
  signal and REFUSES embedded sessions (the informational row, exit 1 —
  the matrix's one stdout-with-exit-1 exception). BOTH CLI surfaces
  route through the one sequence — `tmax --stop` AND `tmaxclient
  --stop` (the gate's catch: the latter EXISTED ungated, disproving the
  issue's "tmaxclient has no --stop" premise; it killed embedded
  sessions through a second surface). The shutdown RPC ITSELF also
  refuses embedded servers (`{ok: false, reason: "embedded"}` — the
  issue's design decision enforced at the RPC, so even a raw direct
  client cannot stop an embedded session).
- **Connection outcomes resolve FIRST**: ENOENT → "not running";
  refused → one 250ms recheck (a mid-start daemon) → stale unlink;
  connected-but-silent → unresponsive (NO unlink — the socket is left
  in place). Only then identity, graceful shutdown, and escalation.
- **The SIGTERM fallback signals a VERIFIED pid only**: the
  verification triple — identity re-check (same mode+pid), `lsof -t -U`
  with exactly one pid matching the identity pid, and `ps -p <pid> -o
  command=` containing the daemon invocation (`--daemon`) — runs
  immediately before the signal. Any leg fails → "socket owner changed
  or pid reused — not signaling".
- **PID-reuse race — ACCEPTED RISK**: a pid verified at the triple can
  be reused by an unrelated process in the instant before the signal;
  no cross-platform stable-process handle is available to a userspace
  CLI in scope. The triple narrows the window to single-digit
  milliseconds. This ADR records it as the accepted residual.
- **Testability**: the sequence is a pure decision machine over
  INJECTED effects (the #251 SweepDeps pattern; `cli/stop-sequence.ts`)
  — the 8-row matrix + the verification-triple replacements are unit
  rows. The live proof is the e2e: an embedded session launched,
  `--stop` refused, the session still usable (identity + keypress
  through the socket), quitting cleanly via `:q`.

## Consequences

- Embedded keeping the standard socket still blocks daemon startup —
  remains #235's loud error (unchanged boundary).
- `tmaxclient --stop` exists and now routes through this path (the
  same sequence, its own socket).
- The RPC method baseline refreezes 24→25 (`server-identity`).
