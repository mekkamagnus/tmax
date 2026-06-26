# adw Compile Gate and Feedback-Channel Integrity

## Status

Accepted

## Context

Two SPEC-065-era adw runs (`01KVSZNCP1`, `01KVYKNHTN`) completed patch-review with a
`gaps` verdict despite the code never compiling. Investigation of the orchestrator event
streams and the gate logic revealed that the pipeline did not *miss* the defects —
patch-review diagnosed both root causes precisely. The **gates** failed to encode the
defects as blocking, so the build↔test↔patch-review loop spun without correcting them.

The specific structural gaps, all confirmed against the code:

1. **No `typecheck` gate.** A duplicate `findWorkspaceBySpecPath` import in
   `adws/adw-plan-review-build-patch.ts:54-55` is a hard TypeScript duplicate-identifier
   error. Neither `adw-build.ts` nor `adw-test.ts` invokes `bun run typecheck` (both
   return zero matches for "typecheck"). The build stage "succeeded" because it never
   attempted to compile; the defect only surfaced *indirectly* as 2 unit-test timeouts
   (the tests that `import` the orchestrator crashed on module load).

2. **No hard-fail tier for compile-class failures.** The test verdict logic in
   `adws/adws-modules/tester.ts` is:
   ```ts
   const verdict = unit.ok && e2ePassed ? "pass" : "gaps";
   ```
   "Orchestrator won't compile" and "one flaky timeout" collapse to the same `gaps`
   severity — a retryable audit input (orchestrator line 1112: *"test returned gaps
   (continuing — gaps are audit input)"*). There is no tier that says "the module cannot
   be imported, stop and surface this immediately."

3. **Feedback-channel breakage when patch-review crashes.** The retry loop learns what to
   fix only through patch-review **appending findings to the spec file**, which the next
   build re-reads (orchestrator line 1217). On `01KVSZNCP1`, patch-review returned
   `stage-error … exited with code 1` repeatedly from 2026-06-23 13:58 through
   2026-06-25 05:03 — i.e. **~2 days of subprocess deaths, not verdicts**. While it was
   crashing, nothing was appended to the spec, so the builder re-ran **blind** against an
   unchanged spec and reproduced the identical defect every cycle.

4. **No base-sha / worktree-content guard.** On `01KVYKNHTN` (BUG-20), the resume path
   created the worktree from a base already carrying BUG-18's commits, then accepted it
   via `existsSync(worktreePath)` alone — the precise anti-pattern BUG-20's spec forbids.
   patch-review correctly reported *"the diff is a BUG-18 fix, not BUG-20,"* but nothing
   checked that the worktree's base matched the spec's intent *before* building, so the
   run was defeated by the absence of the very feature BUG-20 implements.

## Decision

Add a **compile gate** and a **hard-fail tier**, and make the feedback channel
**verifiable** so the retry loop cannot run blind:

### (a) `typecheck` gate in `adw-build.ts`

`bun run typecheck:src` runs as a build-stage gate, before the implement LLM call is
considered successful. A non-zero exit fails the build stage directly (not deferred to
test). This catches duplicate-identifier / missing-export / type errors at the stage that
produces the code, in seconds, rather than as downstream test timeouts.

### (b) Hard-fail tier for compile-class test failures

Distinguish test failures caused by **module-load / import-time** errors from ordinary
assertion or timeout failures. Import-time failures (a module under test cannot be
`import`ed) surface as a hard, non-retryable `compile-fail` outcome rather than `gaps`.
`gaps` remains the verdict for assertion/timeout/e2e failures. This prevents a
non-compiling orchestrator from being retried indefinitely as "soft" input.

### (c) Feedback-channel integrity check

Before the retry loop re-runs build, verify the feedback channel actually delivered: if
patch-review returned `gaps`, the spec file on disk must have been modified since the last
build (mtime/size check), OR the appended findings must be present. If the channel did not
deliver (patch-review crashed, or appended nothing), the loop **must not re-run build
blind** — it surfaces a `feedback-stalled` error instead of silently looping.

### (d) Worktree base-sha verification (separate, tracked under BUG-20/SPEC-065)

Resume validates the recorded worktree via `git worktree list --porcelain` /
`rev-parse --show-toplevel` + branch checks (not `existsSync`), and records `base_sha` in
state; mismatch fails loudly rather than silently reusing a contaminated worktree. This is
the BUG-20 fix itself, listed here for completeness as the fourth gap.

## Consequences

**Easier:** A duplicate-import or missing-export defect fails on iteration 1 at the build
stage, in seconds, instead of looping for days as opaque test timeouts. Compile-class
failures stop masquerading as retryable soft input. The retry loop can no longer spin blind
when patch-review is unhealthy — it surfaces the stall instead of burning iterations.
Contaminated worktrees are rejected before they waste a build cycle.

**Harder:** `typecheck:src` adds a small fixed cost (~seconds) to every build. The
hard-fail / feedback-stall tiers add new outcome states that resume logic and the
orchestrator's stage machine must handle (new verdict values, new failure events). The
base-sha check adds a git call to the resume path. These are localized additions to the
gate functions and the loop control; they do not change the 5-stage subprocess-composition
architecture.

**Related:** ADR-0094 (adw pipeline architecture), ADR-0101 (adw-test stage),
ADR-0104 (test-stage wall-clock timeout — same theme of making failures explicit),
SPEC-065 (worktree isolation), BUG-20 (worktree duplication on resume), BUG-18 (the 529
retry that mistakenly landed in the BUG-20 worktree).
