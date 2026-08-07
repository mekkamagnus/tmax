# ADR-0184 — `runOneGate` helper extraction (#17)

## Status
Accepted

## Context
`runGates` (`adws/adws-modules/patch-reviewer.ts`) had three copy-pasted gate blocks
(typecheck/unit/tmax-use), each ~30 lines following the same pattern: `safePhase` →
`runRaw(...)` → optional `Promise.race` timeout → spawn-failed Left / `GateResult` Right
→ catch timeout → `GateResult { ok: false }`. Issue #17 proposed collapsing them into a
`runOneGate` helper; codex REJECTED the original "treat gates as identical" approach
(typecheck has no timeout; spawn failures return an outer Left, not a GateResult — a
`Promise<GateResult>` helper cannot preserve that). A corrected approach was identified:
return `TaskEither<string, GateResult>` with an optional timeout parameter. The blocker
#40 (`TaskEither.raceTimeout`) landed (`8589bd2`).

## Decision
Extract `runOneGate(deps, cwd, opts): TaskEither<string, GateResult>` that encapsulates
the gate pattern, addressing codex's 3 concerns:
1. **Returns `TaskEither<string, GateResult>`** — spawn failure → Left (the outer
   short-circuit); timeout/success → Right(GateResult).
2. **Optional timeout** — typecheck passes no `timeoutMs` (no `Promise.race`); unit and
   tmax-use pass their respective timeouts.
3. **Per-gate formatting preserved** — the exact spawn-failed Left message, the timeout
   `GateResult.output` message, and the success `GateResult` field mapping are all
   identical to the original inline code.

Uses `Promise.race + try/catch` (the proven pattern from the original code) rather than
`raceTimeout` — simpler, fewer moving parts, behavior-identical. The 3 call sites in
`runGates` collapsed from ~90 lines of triplicated gate logic to ~50 lines of declarative
calls. The `runGates` body, `GateResults` type, and all gate tests (53/53) are unchanged.

## Consequences
- The gate logic is defined in ONE place (`runOneGate`), so a 4th gate (or a change to
  the timeout/GateResult mapping) is a single edit, not 3.
- The codex-rejected label on #17 is resolved (the corrected approach was implemented,
  not the rejected one).
- Behavior is byte-identical: all 53 gate tests pass, `GateResult` outputs are unchanged.
