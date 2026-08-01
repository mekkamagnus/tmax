# Bug: `tmax -e` error output dumps a JS stack trace instead of the one-line T-Lisp error

## Bug Description
When `tmax -e '<expr>'` (or any `tmaxclient` eval/command/query) fails, the catch
handlers printed the whole `Error` object — `console.error('Error …:', error)` —
which Bun renders as ~14 lines of client source-snippet + internal `node:net`
stack frames, burying the real one-line T-Lisp error at the bottom. The daemon
already returns a clean one-line JSON-RPC error; the inflation is purely
client-side (`sendRequest` wraps it in an `Error` whose `.message` is the clean
one-liner). Every T-Lisp config author hits this on the first typo.

## Problem Statement
`tmax -e` errors must print a clean single-line error (the T-Lisp message), not a
JS stack trace.

## Solution Statement
In `bin/tmaxclient`, the three handlers that dumped the whole `Error` — `eval`
(line 208), `executeCommand` (220), `query` (232) — now print only
`error instanceof Error ? error.message : String(error)` (the pattern already used
by the `--key`/`--command`/`--save` handlers and, after #52, the `openFile`
caller). Exit code stays 1.

Codex APPROVE: "reusing the existing `error instanceof Error ? error.message :
String(error)` pattern is the simplest, low-risk fix."

## Steps to Reproduce
```bash
bin/tmax -e '(+ "a" 1)'      # today: ~14-line JS stack trace; should be one line
```

## Root Cause Analysis
`sendRequest` (bin/tmaxclient:100-102) rejects with `new Error(\`${code}:
${message}\`)` — a clean one-liner. The eval/command/query catches passed the
whole `Error` to `console.error`, which Bun stringifies with the stack.

## Relevant Files
- `bin/tmaxclient:206-235` — the three catch handlers now print `error.message` only.
- `test/integration/teval-error-output.test.ts` — spawns `bin/tmaxclient -e` with a failing expr, asserts single-line + no stack frames + exit 1.

## Step by Step Tasks
### Task 1 — message-only error output
**AC**: the eval/executeCommand/query catches print `error.message` (not the Error object); exit code remains 1.
### Task 2 — clean single-line output
**AC**: `tmax -e '(+ "a" 1)'` prints a single-line error containing the T-Lisp message, with no `at ` stack frames, for eval / division-by-zero / undefined-symbol / parse-error variants.
### Task 3 — regression test
**AC**: a spawned-client test asserts the output is single-line, contains the message, has no stack frames, and exits 1; verify-gate PASS.

## Validation Commands
- `bin/tmaxclient --help` exits 0 (syntax).
- daemon + `bin/tmaxclient -s SOCKET -e '(+ "a" 1)'` ⇒ one-line stderr, exit 1, no `at ` frames.
- `bun test test/integration/teval-error-output.test.ts` — green.

## Notes
- The `openFile` caller was already made message-only in #52 (BUG-34); this issue covers the remaining three (eval/command/query).
- `error.message` includes the JSON-RPC code prefix (e.g. `-32010: …`); a single line containing the real message, which satisfies the criterion.
