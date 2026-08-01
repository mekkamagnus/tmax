# Bug: macOS --sweep misclassification (lsof -U ignores path filter)

## Bug Description
`sweep.ts:realCanonicalPids` called `lsof -t -U <socket>` without the `-a`
(AND) flag. On macOS, `lsof` ORs selectors by default, so `-U <path>` returns
every process holding ANY unix socket (~152 pids including Docker/distnoted),
not just the canonical daemon at `<path>`. `classifyLiveDaemon` then tagged any
live tmax daemon whose pid collided with that bogus set as `canonical-live`/KEPT,
so `tmax --sweep --apply` reported "reaped 0 orphans" and failed to clean up the
very orphans it is the documented recovery tool for.

## Problem Statement
The sweep must correctly identify the canonical daemon (only the process owning
the canonical socket) vs orphans on macOS.

## Solution Statement
Add the `-a` flag: `lsof -t -a -U <path>`. This ANDs the selectors (unix socket
AND at this path), returning only the canonical daemon's pid. Codex's corrected
approach (the original lock-only proposal was rejected as unsafe — ADR-0121
documents canonical daemons without locks).

## Steps to Reproduce
```bash
# start a daemon + an orphan, then:
tmax --sweep --dry-run    # today: misclassifies orphans as canonical-live
```

## Root Cause Analysis
macOS `lsof` without `-a` ORs `-U` (any unix socket) with `<path>`, producing
~152 false-positive pids. Adding `-a` ANDs them → 1 correct pid.

## Relevant Files
- `src/server/sweep.ts:346-355` — `realCanonicalPids` uses `lsof -t -a -U`.

## Step by Step Tasks
### Task 1 — lsof -a fix
**AC**: `realCanonicalPids` uses `lsof -t -a -U <socket>` (with `-a`).
### Task 2 — correct classification
**AC**: against a live canonical daemon + orphan, sweep --dry-run classifies the canonical as `canonical-live` and the orphan as `orphan`.
### Task 3 — Validate
typecheck clean + sweep unit tests green + empirical lsof comparison + verify-gate PASS.

## Validation Commands
- `bun run typecheck:src`
- Empirical: `lsof -t -U <socket>` → ~152 pids (old); `lsof -t -a -U <socket>` → 1 pid (new).
- `bun src/server/sweep.ts --dry-run` (with a daemon) → canonical correctly classified.
- `bun test test/unit/server-sweep.test.ts` — green (mock canonicalPids unaffected).

## Notes
- macOS-specific: Linux `lsof -U <path>` may already filter correctly; the `-a` flag is harmless there.
- The unit tests inject mock `canonicalPids` (don't exercise real lsof) — the fix is verified empirically.
- Codex originally REJECTED a lock-only approach (ADR-0121: canonical daemons can lack locks); the `-a` fix is codex's recommended alternative.
