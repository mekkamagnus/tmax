---
description: Goal-driven autonomous loop — work GitHub issues to zero. Batch-parallel (each issue in its own worktree) with an adversarial verify-gate Workflow per issue before landing. Self-terminates when the board is clear.
---

GOAL: Drive the tmax GitHub issue board to ZERO open, non-blocked issues — each implemented, verified green, passed an adversarial verify-gate, documented with an ADR, and closed.

TERMINATION (what makes it a goal, not a runaway): after each cycle, re-check `gh issue list --state open`. If no open non-blocked issues remain → the goal is MET: post a final summary (issues completed, ADRs written, anything blocked) and STOP. Do NOT schedule another wake. Until then, keep working.

WORK MODE — batch-parallel (Option 2) with an adversarial verify-gate (Option 1):
You process issues in BATCHES for throughput, and EVERY implementation must pass a read-only Workflow verify-gate before it lands. Two rails keep it sound:
- Parallel issues run in **separate git worktrees** (no shared-checkout conflicts).
- The verify-gate Workflow returns `PASS | GAPS`; only `PASS` is committed.
Side-effects (commit / merge / push / close) are done ONLY by you — never inside the Workflow agents.
You can watch each issue's verify-gate live with `/workflows`.

=================  ONE CYCLE  =================

1. SURVEY. `gh issue list --state open --json number,title,labels`. Skip `codex-rejected` / `wontfix` / `blocked`. If none remain → DONE, STOP.

2. PICK A BATCH (Option 2). Choose up to N=3 **independent** issues — non-overlapping touched files, so their merges can't conflict. Priority: `codex-approved` first, then `codex-concerns` / `refactor` / `test` with a spec ready, lowest number first. Shrink the batch if fewer are independent; a batch of 1 is fine.

3. FOR EACH ISSUE IN THE BATCH — concurrently, each in its own worktree:
   a. **Worktree.** Create a sibling worktree on `issue-<n>` from current `main`. Record `baseSha = $(git rev-parse HEAD)`.
   b. **Spec.** Ensure a spec with Goal + Completion Criteria exists in `docs/specs/` (create via `/bug` defect, `/feature` new behavior, or `/chore` refactor if missing). Behavior changes MUST be spec'd (precedent: BUG-30, CHORE-45).
   c. **Implement** against the spec IN THE WORKTREE, applying the codex comment's suggested fix/guard. Surgical; match existing style.
   d. **Verify-hard.** In the worktree run `bun run typecheck` + the spec's Validation Commands. Must be GREEN (run them yourself; paste real output).
   e. **Verify-gate Workflow (Option 1) — INLINE.** (`args` does NOT propagate via `scriptPath`, so launch inline.) Substitute this issue's values into the template (`<<SPEC>>` = spec path string, `<<BASE>>` = baseSha string, `<<ISSUE>>` = issue number, bare), then `Workflow({ script: <substituted JS> })`. Read-only; returns `{ verdict, gaps, summary }`.
      ```js
      export const meta = { name: 'verify-gate', phases: [{ title: 'Review' }, { title: 'Synthesize' }] }
      const specPath = '<<SPEC>>', diffBase = '<<BASE>>', issue = <<ISSUE>>
      const REVIEW = { type: 'object', additionalProperties: false, properties: { criteria: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { criterion: { type: 'string' }, met: { type: 'boolean' }, note: { type: 'string' } }, required: ['criterion', 'met', 'note'] } }, concerns: { type: 'array', items: { type: 'string' } } }, required: ['criteria', 'concerns'] }
      const RESULT = { type: 'object', additionalProperties: false, properties: { verdict: { type: 'string', enum: ['PASS', 'GAPS'] }, gaps: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, required: ['verdict', 'gaps', 'summary'] }
      phase('Review')
      const r = await agent('Adversarial verifier (tmax, TypeScript/Bun). READ-ONLY: do not edit. (1) Read the spec at ' + specPath + ' — especially its Completion Criteria. (2) Run `git diff ' + diffBase + '` to see the implementation. (3) Fetch the issue comments with `gh api repos/mekkamagnus/tmax/issues/' + issue + '/comments` and use the one whose body contains "Codex review". Then for EACH completion criterion decide met=true/false with a one-line note citing the diff; list concrete concerns (behavior-preservation vs the codex note, regressions, edge-cases). Be skeptical; flag a gap when a criterion is not clearly met.', { label: 'verify', phase: 'Review', schema: REVIEW, effort: 'high' })
      const gaps = ((r && r.criteria) || []).filter((c) => !c.met).map((c) => c.criterion + ' - ' + c.note).concat((r && r.concerns) || [])
      phase('Synthesize')
      return await agent('Verify-gate synthesizer (tmax uses bun). The caller already ran typecheck + tests GREEN; focus ONLY on whether the diff satisfies the spec criteria and honors the codex review. Gaps: ' + JSON.stringify(gaps) + '. Return verdict PASS if there are NO gaps (every criterion met, no real regression). Otherwise GAPS with the list.', { label: 'synthesize', phase: 'Synthesize', schema: RESULT, effort: 'medium' }) || { verdict: 'GAPS', gaps: ['no verdict'], summary: 'none' }
      ```
   f. **DECIDE.**
      - typecheck+tests GREEN **AND** verdict `PASS` → write ADR (`docs/adrs/ADR-NNNN-<slug>.md` + one line in `docs/adrs/index.md`, next free number) and **commit** (code+spec+ADR together, conventional-commit message, `Co-Authored-By: Claude <noreply@anthropic.com>`) IN THE WORKTREE.
      - verdict `GAPS` → feed the gaps back, reimplement, re-run verify-gate (max 2 retries). Still `GAPS` → label the issue `blocked` (with the gaps), discard the worktree, move on.

4. MERGE (Option 2). For each committed worktree branch, **fast-forward-merge into `main` ONE AT A TIME** (sequential, to avoid conflicts), push, remove the worktree. If a merge conflicts (shouldn't — the batch was independent), resolve or set that issue aside as `blocked`.

5. CLOSE. For each landed issue, close it with a comment linking the spec path, the ADR path, the verify-gate verdict, and the green test output.

6. ADVANCE. If open non-blocked issues remain, `ScheduleWakeup` (~60–270s — you're mid-work, keep the cache warm) to run the next cycle. If none remain, STOP.

================================================

RAILS:
- One ADR per landed issue.
- Side-effects (commit/merge/push/close) ONLY by you; the verify-gate Workflow is read-only.
- Parallel issues MUST be in separate worktrees and touch non-overlapping files. When in doubt, batch size 1.
- Never land without: `bun run typecheck` clean AND tests green AND verify-gate `PASS`.
- Honor the codex review comments — they're fed into the verify-gate.
- Bounded retries on `GAPS` (max 2); don't loop on one issue.
- The goal is "zero open issues," not "attempt every issue" — blocked items get set aside, not force-fit.

When the board is clear, STOP. That's the goal.
