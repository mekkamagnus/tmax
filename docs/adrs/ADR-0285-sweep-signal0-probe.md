# ADR-0285: The Sweep Liveness Probe Passes Numeric Signal 0

## Status

Accepted

## Context

Issue #251: `tmax --sweep --apply` reported `reaped 2 orphan(s)` while both orphans (a SIGTERM-ignoring daemon and a tmux wrapper, both ppid 1) remained alive; manual `kill -9` worked. The issue suspected zombie-probe misreads or swallowed SIGKILLs.

## Decision

The cause was the probe itself: `process.kill(pid, '0')` with the STRING `'0'` — Node coerces it, **Bun throws `Unknown signal: 0`**. `alive()` therefore always returned false and `reapPid` returned "reaped" at its entry check without signalling anything. The fix passes numeric `0` and widens `SweepDeps.kill` to `(pid, sig: string | number)`; the post-SIGKILL check also became a ~500ms poll (signal 0 succeeds on unreaped zombies — the issue's original suspect, exonerated as the cause but hardened anyway).

## Consequences

- The sweep's core promise holds again: what it reports reaped is dead (SIGTERM → grace → SIGKILL escalation), deterministically pinned by a real-process test (detached SIGTERM-trapper + real kill deps) that was red before and green after.
- Any future liveness probe on Bun must pass numeric 0, never the string — recorded here as the Bun-vs-Node divergence bit us once silently (the try/catch converted the throw into "dead").
- Injected-kill tests express the probe as `sig === 0`.

## Related

- [SPEC-259](../specs/SPEC-259-sweep-signal0-probe.md), issue #251
- ADR-0273 (#246 sweep identity), ADR-0276 (#250 launcher port — where `--sweep` is dispatched), #243 (the graceful handler whose hang makes SIGTERM ignoring possible)
