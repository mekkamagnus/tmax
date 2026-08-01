# ADR-0147 — ensure_daemon uses a trailing-X mktemp template (#53)
## Status: Accepted
## Context
`bin/tmax` ensure_daemon created its startup-log temp file with
`mktemp /tmp/tmax-daemon-start.XXXXXX.log`. BSD/macOS `mktemp` only substitutes
a **trailing** run of X's; with `.log` after the X's, no substitution occurs and
every call returns the same literal path. The first caller won; every later or
concurrent caller hit `mkstemp failed: File exists`, which — under
`set -euo pipefail` — aborted `ensure_daemon` before the daemon was contacted.
A single leftover file or any concurrent `tmax` invocation thereby locked out
ALL `tmax -e` / `tmax <file>` use.

## Decision
Use a trailing-X template: `mktemp /tmp/tmax-daemon-start.XXXXXX`. Each call now
yields a unique path (no collision, no lockout). The `.log` suffix is dropped —
the file is a throwaway diagnostic; content matters, not extension. Codex
APPROVE: "the simplest portable fix."

## Consequences
- Concurrent launches no longer collide; a stale literal file cannot lock out
  tmax (verified: 5 concurrent `mktemp` calls → 5 unique files, 0 collisions).
- Surgical: one template token changed + an explanatory comment; no adjacent
  code touched.
- Separate, pre-existing issue (NOT caused by this change, surfaced during
  verification): `bin/tmax -e` startup latency is variable (<12s to >2min) due
  to a daemon-startup-readiness race in `is_running`/`wait_for_daemon` (the
  `--ping` RPC can block on a partially-ready daemon). Tracked as its own issue.

Spec: [BUG-35](../specs/BUG-35-mktemp-template.md). Issue: #53.
Verify-gate: PASS (template-level: old `mkstemp failed`, new 5/5 unique).
