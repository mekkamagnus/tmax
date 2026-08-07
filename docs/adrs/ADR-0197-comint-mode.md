# ADR-0197 — comint-mode (`#165`)

## Status

Accepted

## Context

tmax has terminal-mode (full PTY via Bun.spawn terminal API, #155/#164) but lacks a lighter-weight line-oriented command interpreter for REPLs and build tools. comint-mode fills that gap — spawn any process via pipes, accumulate output in a normal editor buffer, manage input history.

## Decision

Three-layer implementation following tmax's architecture pattern:

1. **ComintManager** (`src/editor/api/comint-ops.ts`) — manages pipe-based subprocess instances via `Bun.spawn({ stdin: "pipe", stdout: "pipe" })`. Output is read line-by-line and routed to a callback. History ring for M-p/M-n navigation.

2. **T-Lisp primitives** (9 ops): `comint-run`, `comint-send`, `comint-kill`, `comint-signal`, `comint-process-status`, `comint-buffer-p`, `comint-history-prev`, `comint-history-next`, `comint-list`.

3. **T-Lisp commands** (`src/tlisp/core/commands/comint.tlisp`): `run-node`, `run-python`, `comint-send-input`, `comint-interrupt`, `comint-eof`, `comint-prev-input`, `comint-next-input`.

## Consequences

- `M-x run-node` / `M-x run-python` open REPLs in normal editor buffers (not terminal windows).
- Output accumulates as text; input is typed at the bottom; M-p/M-n cycles history.
- Multiple comint buffers coexist (a node REPL + a python REPL).
- Uses pipes (not PTY) — lighter weight than terminal-mode, but interactive full-screen TUIs (vim, htop) won't work in comint buffers. Those use `M-x shell` (terminal mode).
- Security: comint-run takes an arbitrary command+args (like Emacs's `make-comint`). This is the user explicitly running a process — not a T-Lisp-callable attack surface (it requires `M-x` or explicit invocation).
- Verify-gate (SPEC-099): **PASS** — 7/7 tests, typecheck clean.
