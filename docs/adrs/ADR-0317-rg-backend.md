# ADR-0317 — The rg search backend: condition-case at the spawn seam, pid-attributed stashes, routed stderr

**Issue:** #308 · **Spec:** [SPEC-308](../specs/SPEC-308-rg-backend.md)
**Status:** accepted · **Date:** 2026-11-22

## Context

#308 adds the primary search backend (RFC-031 §2.2) on #307's
producer interface. The verify-gate's round-1 audit found the first
implementation green-on-tests but wrong at four seams the tests never
touched — the fixes are the decision record here.

## Decisions

### 1. The spawn is wrapped in `condition-case` — builtin `Either.left` THROWS

`make-process` returns `Either.left` when `Bun.spawn` throws
synchronously (a vanished executable). The evaluator propagates a
builtin's Left as a THROWN error, never as a value — so
`(cond ((numberp pid) ...) (t <rollback>))` never reaches the
rollback branch on a real spawn failure. The search stayed
half-registered on "searching…" with prior results wiped.

**Decision:** wrap the spawn in `(condition-case nil <spawn> (error
(m) <message-string>))` and branch on the result. Verified shape:
`(error (m) body)` — a body form in the var slot silently evaluates
to nil (the classic handler-shape trap). Tested with a REAL vanished
executable via the `grep-rg-executable` seam (detection cached true,
spawn throws ENOENT).

### 2. The stash is PID-ATTRIBUTED; strangers drop at replay

The spawn→setq race (a chunk can beat the `setq` of the pid)
originally stashed unregistered chunks as a raw concat — anything
stashed between a run's reset and its replay was replayed as the new
pid's data, so a killed predecessor's straggler could contaminate the
new generation. Worse, `g`/`q` never killed the prior process, so the
register→spawn window admitted OLD-run chunks through the still-set
pid guard.

**Decision:** (a) one kill choke point — `grep-rg-kill-prior` in
`grep-rg-run` (covers new searches, `g` reruns) and `grep-quit`; (b)
the pid guard closes BEFORE the new register (pid reset at run
start); (c) stashed pairs `(pid chunk)` — replay re-enters only our
pid's chunks in arrival order and DROPS strangers (every spawn has a
fresh pid; a stranger's chunk can never become ours).

T-Lisp nil/`'()` are DISTINCT: `reverse`/`cons`/`length` throw on
nil — the stash coalesces nil→`(list)` at every use
(`grep-rg-pending-as-list`).

### 3. stderr is ROUTED to T-Lisp (`:stderr-filter`); diagnostics aggregate on EVERY completion

stderr was TS-side-only (a log tail) — the spec's "exit ≥2 with
stderr" path was architecturally unreachable ("(no stderr)" always).
`make-process` now takes `:stderr-filter`, routed through the same
serialized hex-encode chain as stdout (`#208`'s per-process
serialization). The sentinel buffers it per run, reports the first
line on error, and the `(N undecodable paths, M unparseable lines)`
aggregation now attaches to done/no-matches completions too (zero
counts omitted) — a run whose every hit was undecodable reports
"no matches for X — (N undecodable paths…)", which is the truth.

### 4. Signal-killed children report 128+N

`proc.exitCode ?? 0` mapped a signal-killed child to exit 0 —
"done". `make-process` sentinels now synthesize the shell convention
(128+signum: SIGTERM→143, SIGKILL→137) when `signalCode` is set;
normally-exited children are unchanged. In-editor kill paths are
already generation-guarded (the sentinel drops); this fixes EXTERNAL
kills (OOM, pkill) being misreported as success.

### 5. Per-run state reset + the nil-backend coalesce

All diagnostics counters (filter calls, appends, last exit/flag/line)
reset at run start — the dump reflects the current run only (proved
deterministically by the failed-spawn path: reset runs, zero filter
calls follow). `grep-backend-available-p` coalesces a non-string
`grep-backend` to `auto` — `string=` on nil throws (the same hazard
class as the filter's flag).

## Consequences

- The provisional protocol is now real: no failed spawn leaves a
  half-registered search; prior content survives.
- `make-process` gained an opt-in kwarg (`:stderr-filter`) and a
  truthful exit-code mapping — both additive; existing consumers
  (fikra sentinels check `= exit-code 0`) are unaffected for
  normally-exited children and more truthful for killed ones.
- Test seams follow the existing hook precedent
  (`grep-backend-set!`): `grep-rg-executable-set!` (vanished-binary
  fixture) and `grep-rg-test-state!` (sentinel input state) — module
  defvars are not setq-able across the module boundary.
