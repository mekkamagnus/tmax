# ADR-0159 — sweep uses lsof -a (AND-selector) on macOS (#57)
## Status: Accepted
## Context
`sweep.ts:realCanonicalPids` called `lsof -t -U <socket>` without `-a`. On macOS,
`lsof` ORs selectors, so `-U <path>` returned every process holding ANY unix
socket (~155 pids). `classifyLiveDaemon` then tagged any live tmax daemon whose
pid collided with that bogus set as `canonical-live`/KEPT, so `--sweep --apply`
reported "reaped 0 orphans" and failed to clean up actual orphans.

## Decision
Add `-a`: `lsof -t -a -U <socket>`. This ANDs the selectors (unix socket AND at
this path), returning only the canonical daemon's pid (1 instead of ~155). This
is codex's recommended fix — the original lock-only approach was rejected as
unsafe (ADR-0121: canonical daemons can lack locks).

## Consequences
- Sweep correctly identifies the canonical daemon vs orphans on macOS (verified
  empirically: 155 pids → 1; sweep --dry-run classifies canonical-live vs orphan
  correctly).
- Harmless on Linux (`-a` is a valid no-op there if `-U` already filters).
- Known gap: the 14 unit tests inject mock `canonicalPids` and don't exercise
  the real `lsof` command — the `-a` fix is verified empirically, not by an
  automated test (pre-existing, acknowledged).

Spec: [BUG-46](../specs/BUG-46-sweep-macos-lsof.md). Issue: #57.
Verify-gate: PASS (deep empirical: live socket + classification trace).
