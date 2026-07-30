# Bug: patch-review gathers an empty diff on every worktree-isolated run

## Bug Description

The adw patch-review stage's `gatherContext` builds its code diff with a
**commit-range** form — `git diff <base>..HEAD` (`adws/adws-modules/patch-reviewer.ts:267-270`).
But the orchestrator commits the builder's worktree changes **only after
patch-review passes** (`adw-plan-review-build-patch.ts:1415` → `commitWorktreeChanges`
at `:1425`, comment: *"commit implementation dirt … before finalize"*). The build
stage stages its changes without committing, so at patch-review time the worktree
`HEAD` still equals `base_sha`.

Therefore `git diff <base>..HEAD` is `git diff <base>..<base>` = **empty**, on
every worktree-isolated run. The gather bundle's "Files changed" is `0 files`
and "Tracked diff" is `(no tracked changes)`, so the patch-review auditor reviews
**blind** — it sees only the gate output (typecheck/unit) and the spec text, never
the implementation diff. Patch-review can still emit a verdict from the gates, but
it cannot actually audit the code against the spec's acceptance criteria.

**Expected:** patch-review's gather captures the builder's staged changes vs
`base_sha`, so the auditor reviews the real implementation diff.

**Actual:** gather returns `files_changed: []` and an empty diff whenever the run
is worktree-isolated (the default since SPEC-065). Observed on workspace
`01KY72CAFT` (SPEC-070): `patch-reviewer/gather.md` reported *"Files changed (0
files) — No changes detected"* while the worktree held 11 changed files / +279
lines vs `e8029402`.

## Problem Statement

Patch-review is the pipeline's spec-acceptance audit. With an empty diff it cannot
fulfill that role on any worktree run: it never sees the code it is supposed to
verify. This produces untrustworthy verdicts — both false PASS (gates green but
spec criteria unverified against code) and false GAPS (nothing to map criteria
to), and it starves the build↔patch retry loop of the signal it needs to converge.
The existing unit test encodes the buggy form (`test/unit/adw-patch-review.test.ts:398`
expects `"diff abc123def456..HEAD --no-color"`), which is why the regression was
not caught.

## Solution Statement

Diff the **working tree** against the base, not the commit range. `git diff <base>`
compares the base commit to the working tree and captures staged + committed state,
so it returns the builder's staged changes regardless of whether they have been
committed. (The orchestrator's post-pass commit is irrelevant to gather correctness.)

In `gatherContext` (`adws/adws-modules/patch-reviewer.ts`), the worktree-with-base
branch currently builds:

```ts
const range = `${resolvedDiffBase}..HEAD`;
diffArgs = ["diff", range, "--no-color"];
nameArgs = ["diff", "--name-only", range];
```

Change it to the working-tree-relative form (matching the non-worktree branch's
intent):

```ts
diffArgs = ["diff", resolvedDiffBase, "--no-color"];
nameArgs = ["diff", "--name-only", resolvedDiffBase];
```

This is strictly more correct: `git diff <base>` shows committed changes too (when
the working tree is clean it equals `<base>..HEAD`), so it handles both the
"builder stages" and "builder commits" cases. The worktree is freshly created from
`base_sha` for the run (SPEC-065), so the only working-tree changes vs base are the
builder's output — no incidental dirt.

## Steps to Reproduce

1. Run any worktree-isolated pipeline that produces implementation changes, e.g.
   `bun adws/adw-launch.ts --script adw-plan-review-build-patch.ts <spec-or-description>`.
2. Let it reach the patch-review stage.
3. Inspect `agents/<id>/patch-reviewer/gather.md` and the `gather` event in
   `agents/<id>/patch-reviewer/events.jsonl`.

Observed (workspace `01KY72CAFT`, SPEC-070): `gather` event carried
`files_changed: []`; `gather.md` read *"Files changed (0 files) — No changes
detected"* / *"Tracked diff: (no tracked changes)"*, while
`git -C <repo>.01KY72CAFT diff --stat e8029402` showed 11 files / +279 −4.

## Root Cause Analysis

Two facts combine into an always-firing bug:

1. **gatherContext uses a commit-range diff** (`patch-reviewer.ts:267-270`):
   `git diff <base>..HEAD` only sees *committed* changes between two commits.
2. **The orchestrator commits only after patch-review passes**
   (`adw-plan-review-build-patch.ts:1415 if (patchVerdict === "pass")` →
   `commitWorktreeChanges` at `:1425`). The build stage stages its output but does
   not commit, so at gather time `HEAD === base_sha`.

`<base>..HEAD` ⟹ `<base>..<base>` ⟹ empty. The `cwd` and `ADW_WORKTREE`
propagation are correct (patch-review IS dispatched with `getWt()` at
`adw-plan-review-build-patch.ts:725`, which sets `ADW_WORKTREE` via
`spawnStage`); the defect is purely the diff form.

## Relevant Files

- `adws/adws-modules/patch-reviewer.ts` — `gatherContext`, lines 265-278 (the
  worktree diff-form branch). **Fix site.**
- `test/unit/adw-patch-review.test.ts` — `gatherContext` describe block
  (lines 380-466); the mocks at `:398/:401/:443/:446` assert the buggy `..HEAD`
  form and must be updated; add a regression test documenting the
  staged-but-uncommitted scenario.
- `adws/adw-plan-review-build-patch.ts:1415/1425` — the post-pass commit that
  establishes why gather always sees uncommitted state (context only; no change
  needed).
- `adws/adw-patch-review.ts:369` — `cwd` resolution (verified correct; no change).

## Validation Commands

```bash
bun test test/unit/adw-patch-review.test.ts        # gatherContext uses working-tree diff
bun run typecheck:test                              # tsc clean on the updated test
bun run typecheck                                   # full typecheck
```

Manual confirmation (post-fix): on a worktree-isolated run, the `gather` event's
`files_changed` is non-empty and `gather.md` shows the real implementation diff.

## Acceptance Criteria

1. `gatherContext`'s worktree-with-base branch emits `git diff <base>` and
   `git diff --name-only <base>` (not `<base>..HEAD`).
2. With staged-but-uncommitted changes vs `base` (the builder's actual state at
   patch-review time), `files_changed` is non-empty and `diff` contains the staged
   changes.
3. Existing `gatherContext` tests updated to the working-tree form and pass.
4. A regression test asserts the staged-uncommitted scenario and explains why
   (commit happens only after pass).
5. `bun run typecheck` is clean.
