# ADR-0151 — `tmax -e` errors print a clean one-line message, not a JS stack trace (#61)
## Status: Accepted
## Context
When `tmax -e '<expr>'` (or any `tmaxclient` eval/command/query) failed, the catch
handlers passed the whole `Error` object to `console.error`, which Bun rendered as
a ~14-line client source-snippet + `node:net` stack trace — burying the real
one-line T-Lisp error. The daemon already returns a clean one-line JSON-RPC error;
`sendRequest` wraps it in an `Error` whose `.message` is that one-liner.

## Decision
The three handlers that dumped the whole `Error` — `eval`, `executeCommand`,
`query` (`bin/tmaxclient`) — now print only
`error instanceof Error ? error.message : String(error)` (the pattern already used
by the `--key`/`--command`/`--save` handlers and, after #52, the `openFile`
caller). Exit code remains 1. Codex APPROVE: reusing the existing pattern is the
simplest, low-risk fix.

## Consequences
- `tmax -e` errors are a clean single line containing the T-Lisp message, no stack
  frames (verified for type-error, undefined-symbol, and parse-error variants).
- The message includes the JSON-RPC code prefix (e.g. `-32010:`) — a deliberate,
  spec-accepted single line.
- Regression test `test/integration/teval-error-output.test.ts` spawns the real
  `bin/tmaxclient` (async `spawn`, not `spawnSync` — `spawnSync` blocks the
  in-process daemon's event loop and deadlocks) and asserts single-line +
  message-present + no-stack-frames + exit 1.
- Out of scope: the `openFile` callers' `: error` fallback (vs `: String(error)`)
  is a #52-era inconsistency; not reachable today (sendRequest always rejects with
  an `Error`).

Spec: [BUG-39](../specs/BUG-39-teval-error-output.md). Issue: #61.
Verify-gate: PASS.
