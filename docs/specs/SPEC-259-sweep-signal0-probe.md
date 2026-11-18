# Bug Fix: `--sweep --apply` Reports Orphans Reaped While They Survive (#251)

## Goal

The sweep's reap must actually kill what it reports: a SIGTERM-ignoring orphan dies by SIGKILL escalation, and the reaped verdict is honest (never "reaped" for a live process).

GitHub issue: #251 (found during #250 live verification; pre-existing BUG-29 machinery)

## Problem Statement (deterministically reproduced, then confirmed live)

`reapPid`'s liveness probe called `process.kill(pid, '0')` — the STRING `'0'`. Node coerces it; **Bun rejects it** (`Unknown signal: 0`), so the probe always threw, `alive()` always returned false, and `reapPid` returned `true` at its entry check **without ever sending a signal**. The sweep therefore reported `reaped N orphan(s)` while every orphan lived — the exact live observation (a SIGTERM-ignoring `bun src/server/server.ts` daemon + a `tmux new-session` wrapper, both ppid 1, survived `--apply`; manual `kill -9` worked).

Reproduced deterministically: a detached SIGTERM-trapping child + injected discovery + REAL kill/sleep deps — pre-fix, `report.reaped` contains the pid and the process is alive seconds later. Confirmed live on the stale pre-fix binary (two real orphans reported reaped, both alive), then the source-path sweep with the fix killed both.

## Solution

1. The probe passes **numeric `0`** (`deps.kill(pid, 0)`); `SweepDeps.kill`'s signal type widens to `string | number` (documented at the type). Signal names (`SIGTERM`/`SIGKILL`) were always fine — only the probe was broken.
2. Post-SIGKILL polling hardened from a single 50ms check to a ~500ms poll: signal 0 also succeeds on a not-yet-reaped zombie, so one check can misread a killed process as surviving while its (reparented) parent reaps it — the issue's original suspect, exonerated as the cause but cheap to harden.

## Completion Criteria

1. A real detached SIGTERM-trapping orphan, swept with real kill/sleep deps, is actually dead shortly after `runSweep --apply` reports it reaped — verified by `test/unit/sweep-reap-escalation.test.ts` ("a SIGTERM-trapping orphan is actually killed (SIGKILL escalation)") — red before the fix (reaped reported, process alive), green after.
2. When signals are refused (simulated EPERM) and the pid lives, the report does NOT claim it reaped — verified by `test/unit/sweep-reap-escalation.test.ts` ("an unkillable-by-SIGTERM verdict is honest when the pid survives").
3. The pre-existing injected-kill sweep suite stays green with its probe updated to numeric 0 (`signals` recorded as strings) — `test/unit/server-sweep.test.ts` (18 tests), including the SIGTERM-ignored → SIGKILL escalation ordering pin.
4. Full unit gate passes (observed to terminal summary, exit 0) and `typecheck:src` + `typecheck:test` are clean.

## Out of scope

`reaped`-count semantics beyond the honest verdict (the report already lists per-pid), the #243 graceful-shutdown hang that makes the daemon ignore SIGTERM (separate concern), rebuilding/refreshing the installed `dist/tmax` binary (distribution pipeline).
