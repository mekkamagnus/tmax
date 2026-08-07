# Chore: Extract runOneGate helper — collapse 3 copy-pasted gate blocks (#17)

## Chore Description
`runGates` (`adws/adws-modules/patch-reviewer.ts`) had three structurally-similar gate blocks (typecheck/unit/tmax-use) following the same pattern: `safePhase` → `runRaw(...)` → (optional `Promise.race` with timeout) → spawn-failed Left / `GateResult` Right → catch timeout → `GateResult { ok: false }`. The timeout/catch logic was copy-pasted 3× (~90 lines of duplicated gate logic).

This chore extracts a `runOneGate(deps, cwd, opts): TaskEither<string, GateResult>` helper that encapsulates the pattern, then collapses the 3 call sites to ~7 lines each. **Codex review correction applied:** the original approach ("treat the 3 gates as identical") was rejected; the corrected approach returns `TaskEither<string, GateResult>` (spawn failure → Left, timeout/success → Right), makes timeout optional (typecheck keeps none), and preserves exact per-gate timeout/stderr/output formatting.

## Relevant Files
- `adws/adws-modules/patch-reviewer.ts` — `runGates` (the 3 gate blocks) + the new `runOneGate` helper + `RunOneGateOptions` interface.
- `test/unit/adw-patch-review-gates-phase.test.ts` — gate tests (phase ordering, onPhase callback, tmax-use conditional).
- `test/unit/adw-patch-review.test.ts` — broader patch-review tests.

## Step by Step Tasks

### Extract `runOneGate` + collapse call sites
- Added `RunOneGateOptions` interface (phase, cmdLabel, cmd, args, timeoutMs?, timeoutLabel, onPhase?).
- Added `runOneGate(deps, cwd, opts): TaskEither<string, GateResult>` — encapsulates: `safePhase` → `runRaw` → optional `Promise.race` timeout → spawn-failed Left / GateResult Right → catch timeout → GateResult { ok: false }.
- Collapsed the 3 gate blocks in `runGates` to `runOneGate(...)` calls + a spawn-failed Left check (preserves the short-circuit).
- Spawn failure → `Either.left(\`runGates: <label> spawn failed: ...\`)` (exact format preserved).
- Timeout → `GateResult { ok: false, exitCode: -1, output: \`BUG-16: <label> gate timed out after <N>s\` }` (exact format preserved).
- typecheck: no `timeoutMs` (no `Promise.race`). unit: `3_600_000ms`. tmax-use: `180_000ms` + conditional on `hasTmaxUseTargets`.

## Validation Commands
- `bun run typecheck:src` — clean (no type errors).
- `bun test test/unit/adw-patch-review-gates-phase.test.ts test/unit/adw-patch-review.test.ts --timeout 8000` — 53 pass / 0 fail.

## Notes
- The codex-rejected label on issue #17 refers to the ORIGINAL "treat gates as identical" approach. This implementation addresses codex's 3 concerns: (1) `runOneGate` returns `TaskEither<string, GateResult>`, (2) timeout is optional (typecheck keeps none), (3) per-gate timeout/stderr/output formatting preserved exactly. The blocker #40 (`TaskEither.raceTimeout`) landed (`8589bd2`); this implementation uses `Promise.race + try/catch` (the proven pattern from the original code) rather than `raceTimeout` — simpler, fewer moving parts, behavior-identical.
