---
name: tmax-spec-loop
description: "Pick the next unstarted SPEC, implement it in an isolated git worktree, verify with typecheck + tests + daemon restart, audit against the SPEC's acceptance criteria via tmax-patch-review, commit on green, record progress, return. Up to 3 reflect-refine retries per invocation: on verify failure OR audit GAPS the failing gate/excerpt or audit findings are fed back to the sub-agent and re-dispatched. done requires both VERIFY OK and audit VERDICT: PASS and an empty DEFERRED.md. Triggers on: tmax-spec-loop, spec loop, next spec, implement next spec."
argument-hint: '[next | dry-run | status | reset <SPEC-ID>]'
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent
user-invocable: true
---

# tmax-spec-loop

One iteration of an autonomous loop over `docs/specs/SPEC-*.md`. Each invocation:

1. **Pick** the lowest-numbered SPEC with no progress entry (or `status: skipped`).
2. **Worktree** — create `.worktrees/spec-<id>` on branch `spec-loop/<id>`.
3. **Reflect-refine loop (up to 3 attempts)** — dispatch a Claude Code sub-agent (via Agent tool) with the SPEC content + the standard verification gates. On verify failure, feed the failing gate + excerpt back to the sub-agent and re-dispatch. Same worktree across all retries.
4. **Verify** — `bun run typecheck` and `bun run test:unit`.
5. **Audit gate** — after VERIFY OK, run the tmax-patch-review auditor against the worktree's branch. Only `VERDICT: PASS` proceeds to `done`. `GAPS` feeds the audit findings back into the reflect-refine loop (same 3-attempt budget).
6. **Deferred check** — after audit PASS, read `DEFERRED.md` from the worktree. If non-empty, STOP for human approval (no autonomous descopes).
7. **Record** — write `{spec_id, status, worktree, branch, commit, attempts, attempt_log, files, last_error}` to `.spec-loop/progress.json`.
8. **Commit on green** — leave the worktree on its branch for review; do NOT merge to main.
9. **On red (after 3 attempts)** — record `last_error` with the final gate + excerpt or audit gaps, leave worktree commits in place, return the failure to the caller.

## Usage

```
/tmax-spec-loop              # pick + implement next SPEC
/tmax-spec-loop next         # same as above
/tmax-spec-loop dry-run      # show which SPEC would be picked; do nothing
/tmax-spec-loop status       # print progress table
/tmax-spec-loop reset 044    # mark SPEC-044 as not-started (re-pick)
/tmax-spec-loop skip 044     # mark SPEC-044 as permanently skipped
```

## How to drive the loop

This skill does ONE iteration per invocation. To walk the backlog:

- Use Claude Code's built-in `/loop` skill: `/loop /tmax-spec-loop next` (self-paced or fixed interval).
- Or invoke repeatedly from a tmux session via the daemon.
- Or schedule via `schedule` / `CronCreate`.

## Files written

- `.spec-loop/progress.json` — append-only ledger. Safe to commit; safe to delete (loop restarts from SPEC-001).
- `.worktrees/spec-<id>/` — git worktree per active SPEC. Branch `spec-loop/<id>`. Not committed to main.
- `.spec-loop/logs/<id>-<timestamp>.log` — raw sub-agent stdout/stderr.

## Prerequisites

- Clean working tree on `main` (the orchestrator refuses to start otherwise).
- `bun` on PATH.
- `gh` on PATH (only used for the `status` summary, not for the loop itself).
- `docs/specs/SPEC-*.md` files with at least one section parseable as a title.

## Safety

- Never merges to main. Worktree branches must be reviewed and merged by hand.
- Never pushes. Local only.
- Never deletes an existing worktree with uncommitted changes — refuses and reports.
- Caps attempts per SPEC at 3; on the 4th, marks `status: blocked` and moves on.

## Failure modes and what they mean

| Symptom | Meaning |
|---|---|
| `No unstarted SPEC found` | Every SPEC-*.md has `status: done|skipped|blocked`. Inspect `progress.json` for blocked ones. |
| `Worktree already exists for <id>` | A prior run crashed mid-iteration. Run `/tmax-spec-loop reset <id>` or delete `.worktrees/spec-<id>`. |
| `Working tree not clean` | Commit or stash your changes first. The loop will not start on a dirty main. |
| `Verification failed: typecheck` | TS errors. The orchestrator feeds the error back to the sub-agent for a reflect-refine retry (up to 3 attempts). After 3 fails, the SPEC is marked `failed`; the sub-agent's commits remain on the branch for hand review. |
| `Verification failed: tests` | Same shape as typecheck failure. Reflect-refine loop applies; work preserved on the branch after 3 attempts. |
| `Audit verdict: GAPS` | Tests pass but criteria aren't met. The orchestrator feeds the audit findings (criteria + edge cases) back to the sub-agent for a reflect-refine retry. After 3 GAPS verdicts, the SPEC is marked `failed`. |
| `DEFERRED.md non-empty` | The implementer met every audited criterion but consciously deferred some MUSTs. The orchestrator STOPS and asks the user: approve the deferrals (→ done), re-dispatch (→ retry), or fail. Not an error — a human gate. |

## When to use this skill vs ralph-loop

- **tmax-spec-loop** — Claude Code sub-agent, native worktrees, SPEC-driven, one iteration per call. Use when you want to walk `docs/specs/`.
- **ralph-loop** — External CLI agent (qwen/codex/gemini), tmux window, multi-iteration internal loop, PRD-driven. Use when you want a long-running detached session against `prd.json`.

## Out of scope

- BUG-*.md, CHORE-*.md, RFC-*.md specs (different shape; add a `--kind=` flag later).
- Auto-merge (intentional; manual review is the point).
- Multi-SPEC fan-out (run multiple invocations in parallel from separate sessions).
- Daemon hot-reload detection beyond `src/server/` or `src/tlisp/`.
- **Loop detection / escalation** (detecting "same gate failed twice → escalate" beyond the blunt 3-attempt cap). Candidate for a follow-up; `attempt_log[]` already captures the data.

## What changed from v1

- **Inner reflect-refine loop (Step 4).** Previously: one dispatch per invocation; on `VERIFY FAILED` the loop exited. Now: up to 3 dispatches per invocation, with the failing gate + excerpt fed back to the sub-agent on retries. Turns the loop from one-shot to self-correcting.
- **Audit gate (Step 4f).** After VERIFY OK, the tmax-patch-review auditor runs against the worktree's branch. Only `VERDICT: PASS` proceeds to `done`. `GAPS` feeds the audit findings (criteria + edge cases) back into the reflect-refine loop — much richer feedback than "tests failed". Requires `audit.ts --root` to scan the worktree's git log, not main's.
- **Deferred check (Step 4g).** After audit PASS, the orchestrator reads `DEFERRED.md` from the worktree. A non-empty file is a human gate — the orchestrator STOPS and asks whether to approve the deferrals, re-dispatch, or fail. No silent descopes possible.
- **`attempt-record` subcommand + `attempt_log[]` ledger field.** Per-attempt history for observability; the top-level `attempts` counter is unchanged.
- **Daemon-script path fallback.** `verify` now resolves `tmax-daemon/scripts/*.py` via `.zcode/skills/` first, then `.claude/skills/` (the latter is where they actually ship today). Fixes the spurious daemon-gate failure we hit during SPEC-039 tmax-patch-review.

---

## Invocation protocol (the model's contract)

**Step 0 — Parse args.** `next` (default), `dry-run`, `status`, `reset <ID>`, `skip <ID>`. For `status`/`reset`/`skip`/`dry-run`, run `bun scripts/run.ts <args>` and pass through its output. STOP. Do not dispatch a sub-agent.

**Step 1 — Dry-run the picker.** Run `bun scripts/run.ts dry-run`. Read the picked SPEC ID. If output says `No unstarted SPEC found`, report it and stop.

**Step 2 — Orchestrator sets up the worktree.** Run `bun scripts/run.ts setup`. This creates the worktree, the branch, the log file, and returns `WORKTREE_PATH=<path>`, `SPEC_ID=<id>`, `SPEC_PATH=<abspath>`, `LOG_PATH=<path>`. If it fails, pass through the error and stop.

**Step 3 — Read the SPEC.** Use Read on `SPEC_PATH`. Identify the title, prerequisites, assumptions, and step-by-step acceptance criteria. If the SPEC has a "Pre-Phase-1 smoke" section (like SPEC-044), include that as a first sub-step.

**Step 4 — Inner reflect-refine loop (attempts 1..3).** The orchestrator runs a self-correcting loop inside this invocation. Same worktree is reused across all 3 attempts; `setup` runs once.

For `ATTEMPT_NUM` starting at 1:

  **4a — Render the prompt.** Read `references/agent-prompt.md` and substitute:
  - `{{SPEC_PATH}}`, `{{WORKTREE_PATH}}`, `{{SPEC_ID}}`, `{{LOG_PATH}}` — as today
  - `{{ATTEMPT_NUM}}` — the current attempt number (1, 2, or 3)
  - `{{FEEDBACK}}` — empty string on attempt 1; on attempts 2-3, the previous attempt's `FAILED_GATE` + `FAILURE_EXCERPT` lines, formatted as:
    ```
    Previous attempt failed at gate: <FAILED_GATE>
    Verifier output (last 40 lines):
    <FAILURE_EXCERPT>
    ```

  **4b — Dispatch the sub-agent.** Call the Agent tool with:
  - `subagent_type: "general-purpose"`
  - `description: "Implement <SPEC-ID> (attempt N)"`
  - `prompt:` the rendered `references/agent-prompt.md`

  The sub-agent works INSIDE the worktree (cwd = `WORKTREE_PATH`) and commits incrementally on `spec-loop/<id>`.

  **4c — Verify.** Run `bun scripts/run.ts verify <SPEC_ID>`. This runs `typecheck` and `test:unit`. It emits either:
  - `VERIFY OK` → go to **4f (audit gate)**.
  - `VERIFY FAILED: <reason>` plus `FAILED_GATE=<label>` and `FAILURE_EXCERPT=<last 40 lines, single line, capped 2000 chars>` → go to **4d**.

  **4d — On verify failure, record the attempt.** Run `bun scripts/run.ts attempt-record <SPEC_ID> <ATTEMPT_NUM> <FAILED_GATE>`. This appends to `attempt_log[]` in `progress.json` for observability without overwriting `last_error`.

  **4e — Loop or give up (verify path).**
  - If `ATTEMPT_NUM < 3` → increment `ATTEMPT_NUM`, go back to 4a with the verify feedback.
  - If `ATTEMPT_NUM == 3` → go to Step 5 with `status=failed` and `last_error` = the final `FAILED_GATE` + `FAILURE_EXCERPT`.

  **4f — Audit gate (NEW — only reached on VERIFY OK).** Run the tmax-patch-review auditor against the worktree's branch. This is the criteria check that gates `done` — tests passing is necessary but not sufficient. The auditor lives at `.zcode/skills/tmax-patch-review` (referred to below as `<patch-review-skill>`).

  1. **Gather.** `bun <patch-review-skill>/scripts/audit.ts gather <SPEC_ID> --root <WORKTREE_PATH>`. Emits `GATHER_DIR=<path>`, `GATHER_PATH=<path>/gather.md`, `COMMITS=<sha1>,...`. If it reports `NO IMPLEMENTATION FOUND`, the implementer didn't put `SPEC-<ID>` in commit subjects — record `status=failed`, `last_error="audit: no implementing commits found (commit subjects must include SPEC-<ID>)"`, go to Step 6.
  2. **Gates (re-run via audit script).** `bun <patch-review-skill>/scripts/audit.ts gates <SPEC_ID> --gather-dir <GATHER_DIR> --root <WORKTREE_PATH>`. Emits `GATES_PASS` or `GATES_FAILED: <which>`. (These gates overlap with the verify step, but the audit bundle records the output for the auditor to reference.)
  3. **Dispatch the auditor sub-agent.** Read `<patch-review-skill>/references/audit-prompt.md`, substitute `{{SPEC_ID}}`, `{{SPEC_PATH}}`, `{{WORKTREE_PATH}}=<WORKTREE_PATH>`, `{{GATHER_PATH}}`, `{{GATHER_DIR}}`, `{{CHECKLIST_PATH}}`. Call the Agent tool (subagent_type: Explore — read-only audit) with the rendered prompt. The auditor writes `<GATHER_DIR>/verdict.md`.
  4. **Read the verdict.** Use Read on `<GATHER_DIR>/verdict.md`. Parse the `VERDICT:` line:
     - `VERDICT: PASS` → go to **4g (deferred check)**.
     - `VERDICT: GAPS` → go to **4d-gaps** (below).

  **4d-gaps — On audit GAPS, record + feed back.** Run `bun scripts/run.ts attempt-record <SPEC_ID> <ATTEMPT_NUM> audit-gaps`. Format `{{FEEDBACK}}` for the next retry from the verdict's Criteria + Edge cases sections:
  ```
  Previous audit verdict: GAPS
  Gaps found:
    - [criterion] — PARTIAL [file:line]: <gap text>
    - [criterion] — MISSING: <what should be there>
    - [edge case] — MISSED: <where to look>
  Address these before re-submitting. The verify gates already pass, so focus
  on closing the criteria gaps, not re-running tests.
  ```
  Then apply 4e (loop or give up) — GAPS consumes an attempt, same as a verify failure. On the 3rd attempt's GAPS, `last_error` cites the audit gaps.

  **4g — Deferred check (NEW — only reached on audit PASS).** After the audit says PASS, check whether the implementer deferred any MUSTs.

  1. Read `<WORKTREE_PATH>/DEFERRED.md` (may not exist — that's fine, treat as empty).
  2. If **absent or empty** → go to Step 5 with `status=done`.
  3. If **non-empty** → STOP. Do NOT record `done`. Print the deferred criteria to the user and present three options via AskUserQuestion:
     - **(a) Approve the deferrals** — record `done` anyway (the audit passed; the deferrals are conscious scope decisions). Commit the DEFERRED.md alongside the work so the record is durable.
     - **(b) Re-dispatch** — feed the deferred criteria back to the sub-agent via `{{FEEDBACK}}` and loop to 4a (consumes an attempt).
     - **(c) Record failed** — keep the work on the branch for hand review.
     The orchestrator does NOT pick (a)/(b)/(c) autonomously. A non-empty DEFERRED.md is a human gate.

**Step 5 — Record.** Run `bun scripts/run.ts record <SPEC_ID> <status>` where status is `done` or `failed`. `done` is only reached via 4g with an empty DEFERRED.md (or user-approved deferrals). `failed` is reached via verify-failure-3x, audit-GAPS-3x, or user choice at the deferred gate. On `done`, the orchestrator commits green. On `failed`, the orchestrator preserves the branch and writes `last_error` to `progress.json`.

**Step 6 — Report.** Print: SPEC ID, status, attempts used (1-3), final gate if verify-failed, audit verdict if audit-gapped, deferred criteria if stopped at 4g, worktree path, commit SHA (if any), files changed count, and the next SPEC that would be picked. Do NOT auto-start the next iteration — the user invokes `/tmax-spec-loop` again or wraps with `/loop`.

**LAW — never merge to main.** The orchestrator only commits to `spec-loop/<id>` branches. Merging is a human action.

**LAW — never delete worktrees with uncommitted changes.** `scripts/run.sh reset` refuses if the worktree has staged or unstaged changes.

**LAW — feed back the actual failure, not a generic "try again".** On every reflect-refine retry, `{{FEEDBACK}}` must contain the concrete signal from the prior attempt: `FAILED_GATE` + `FAILURE_EXCERPT` for a verify failure, or the verdict's Criteria + Edge cases sections for an audit GAPS. A retry without concrete feedback defeats the loop.

**LAW — done requires VERDICT: PASS and an empty DEFERRED.md.** `VERIFY OK` alone is not sufficient. The audit gate (4f) must return PASS, and the deferred check (4g) must find an empty (or user-approved) DEFERRED.md. This is the difference between "tests pass" and "the spec is actually done." Recording `done` without both is invalid.

**LAW — no autonomous descopes.** A non-empty DEFERRED.md is a human gate (4g). The orchestrator never records `done` over deferred MUSTs without explicit user approval. If the implementer hit a wall, the honest outcome is `failed` or a user-approved deferral — never a silent partial completion.
