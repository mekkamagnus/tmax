---
name: patch-review
description: "Audit a SPEC's shipped implementation against its acceptance criteria. Verifies every criterion is implemented, tests exist and pass, and no edge cases were missed. On PASS, marks the SPEC done in .spec-loop/progress.json. On GAPS, appends an audit-findings section to the SPEC and dispatches to /tmax-spec-loop for rework. Triggers on: patch-review, audit spec, review spec implementation."
argument-hint: '<SPEC-ID-or-path> [--dispatch]'
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent
user-invocable: true
---

# patch-review

Audit a SPEC's shipped implementation. One SPEC per invocation.

Given a SPEC ID or path, this skill answers two questions:

1. **Did the implementation actually do what the SPEC asked?** — for every acceptance criterion in the SPEC, was it implemented, and is there a test?
2. **Were edge cases missed?** — boundary conditions, error paths, mode interactions, empty-input behavior.

The verdict is binary:

- **PASS** — every criterion implemented, tests exist and pass, gates green, no missed edge cases. Writes a "Verified" note to the SPEC, marks `done` in `.spec-loop/progress.json`.
- **GAPS** — one or more criteria missing/incorrect, tests missing/failing, or edge cases unhandled. Appends an `## Audit findings (patch-review <timestamp>)` section to the SPEC enumerating each gap, then dispatches the SPEC to `/tmax-spec-loop` for rework (unless `--dispatch` is omitted and the user wants to review first).

## Usage

```
/patch-review 039                       # audit SPEC-039, do not auto-dispatch on gaps
/patch-review docs/specs/SPEC-039-*.md  # same, by path
/patch-review 039 --dispatch            # audit + auto-dispatch to /tmax-spec-loop if gaps found
```

## How it works

1. **Gather (mechanical, script-driven).** `bun scripts/audit.ts gather <SPEC>` finds the implementing commit(s), computes the diff, lists files touched + line counts, and writes a gather bundle to `.patch-reviews/<SPEC-ID>-<timestamp>/gather.md`.
2. **Run gates (mechanical).** The script runs `bun run typecheck:src`, `bun run test:unit`, and (if `src/server/` or `src/tlisp/` was touched) restarts the daemon and runs `bun run test:daemon`. Output goes into the gather bundle.
3. **Audit (semantic, sub-agent-driven).** The orchestrator dispatches a sub-agent with the SPEC, the gather bundle, and the rubric in `references/criteria-checklist.md`. The sub-agent walks each acceptance criterion, cites the implementing code (file:line), notes edge cases, and writes a verdict.
4. **Verdict (orchestrator-driven).** Orchestrator reads the sub-agent's verdict:
   - **PASS** → writes the verified note, marks `done`, reports to user.
   - **GAPS** → appends audit findings to SPEC, optionally dispatches to `/tmax-spec-loop`.

## Files written

- `.patch-reviews/<SPEC-ID>-<timestamp>/` — gather bundle + audit report. Gitignored (machine state, like `.spec-loop/`).
- `.spec-loop/progress.json` — updated entry for the SPEC (status → `done` on PASS).
- `<SPEC>.md` — appended audit-findings section on GAPS (committed by the user if they choose).

## Prerequisites

- The SPEC exists in `docs/specs/`.
- The implementation has been committed (not just working-tree changes). The gather step searches commit messages for `SPEC-<ID>`.
- `bun` on PATH.
- Clean working tree on `main` is NOT required — patch-review is read-only on the main checkout. The sub-agent's audits run against `HEAD`.

## Out of scope

- Re-implementing the SPEC (that's `/tmax-spec-loop`'s job).
- Reviewing uncommitted working-tree changes (gather only reads committed history).
- Multi-SPEC audits (one at a time).
- Pre-implementation review (no commits → no gather → no audit; the script reports and stops).

## When to use this skill

- After a SPEC was implemented (manually, by another agent, or by `/tmax-spec-loop`) and you want a second-pass audit before merging.
- When `/tmax-spec-loop` reported `done` but you want to verify the work matches the SPEC's acceptance criteria, not just that gates are green.
- When a SPEC feels "shipped but shaky" — testing for missed edge cases is the explicit goal.

## When NOT to use this skill

- The SPEC isn't implemented yet (use `/tmax-spec-loop`).
- You want a generic code review (use the `review` skill).
- You want to verify a single PR rather than a SPEC (use `code-review:code-review`).

---

## Invocation protocol (the model's contract)

**Step 0 — Parse args.** Accept `<SPEC-ID-or-path>` (required) and optional `--dispatch` flag. If the SPEC argument is just digits like `039`, normalize to `SPEC-039`. If it's a path, extract the ID from the filename. If neither matches, error out and stop.

**Step 1 — Gather.** Run `bun scripts/audit.ts gather <SPEC>`. This emits `GATHER_DIR=<path>`, `GATHER_PATH=<path>/gather.md`, `COMMITS=<sha1>,<sha2>,...`, `FILES_CHANGED=N`. If the script reports `NO IMPLEMENTATION FOUND`, the SPEC has no implementing commits — report and stop.

**Step 2 — Run gates (via the same script).** Run `bun scripts/audit.ts gates <SPEC> --gather-dir <path>`. This appends gate results to the gather bundle. Emits `GATES_PASS` or `GATES_FAILED: <which>`.

**Step 3 — Dispatch the auditor.** Call the Agent tool with:
- `subagent_type: "general-purpose"`
- `description: "Audit <SPEC-ID>"`
- `prompt:` the rendered `references/audit-prompt.md` with `{{SPEC_PATH}}`, `{{GATHER_PATH}}`, `{{SPEC_ID}}`, `{{CHECKLIST_PATH}}` substituted.

The sub-agent reads SPEC + gather bundle + rubric, walks every acceptance criterion, and writes its verdict to `<GATHER_DIR>/verdict.md`. The verdict has the shape:

```
VERDICT: PASS | GAPS

Criteria:
  1. [criterion summary] — IMPLEMENTED [file.ts:42-58] | MISSING | PARTIAL [why]
  2. ...

Tests:
  - [behavior] — COVERED [test.ts:12] | UNCOVERED
  - ...

Edge cases:
  - [case] — HANDLED | MISSED [where to look]

Final: <one-paragraph summary>
```

**Step 4 — Read the verdict.** Use Read on `<GATHER_DIR>/verdict.md`. Parse the `VERDICT:` line.

**Step 5a — On PASS.** Run `bun scripts/audit.ts record <SPEC> done`. Append a `> Verified by patch-review on <date>` line under the SPEC's title (use Edit, not Write). Print the summary to the user.

**Step 5b — On GAPS.** Append the verdict's criteria/edge-case findings to the SPEC as an `## Audit findings (patch-review <timestamp>)` section (use Edit). Run `bun scripts/audit.ts record <SPEC> failed`. If `--dispatch` was passed, immediately invoke `/tmax-spec-loop next` (the picker will pick this SPEC because its status is now `failed`/`not_started`). Otherwise, print the gaps to the user and suggest running `/tmax-spec-loop <SPEC>` to rework.

**Step 6 — Report.** Print: SPEC ID, verdict (PASS/GAPS), files audited count, commits audited, gates result, and (on GAPS) a numbered list of the gaps with file references.

**LAW — patch-review never edits implementation code.** It only edits SPECs (to append findings) and `.spec-loop/progress.json` (to record status). Fixing code is `/tmax-spec-loop`'s job.

**LAW — never claim PASS without citing implementation.** Every criterion marked IMPLEMENTED must cite `file:line`. Verdicts with uncited IMPLEMENTED marks are invalid.

**LAW — never auto-dispatch to /tmax-spec-loop without `--dispatch`.** The user gets to see the gaps first.
