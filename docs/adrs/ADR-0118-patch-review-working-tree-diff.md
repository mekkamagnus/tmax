# ADR-0118 — patch-review gathers the working-tree diff (BUG-26)

## Status

Accepted

## Context

The adw patch-review stage audits a build against its spec's acceptance criteria. To do that, `gatherContext` (`adws/adws-modules/patch-reviewer.ts`) collects the implementation diff and writes it into the auditor's gather bundle.

On worktree-isolated runs (the default since SPEC-065), `gatherContext`'s worktree-with-base branch built the diff as a **commit range**:

```ts
const range = `${resolvedDiffBase}..HEAD`;
diffArgs = ["diff", range, "--no-color"];
```

`git diff <base>..HEAD` only sees *committed* changes between two commits. But the orchestrator commits the builder's worktree output **only after patch-review passes** (`adw-plan-review-build-patch.ts:1415 if (patchVerdict === "pass")` → `commitWorktreeChanges`). The build stage stages its changes without committing, so at gather time the worktree `HEAD === base_sha`. Therefore `<base>..HEAD` is `<base>..<base>` — **empty on every worktree-isolated run**. The gather bundle reported "0 files changed" and patch-review audited blind, relying only on gate output (typecheck/unit) and the spec text, never the implementation diff.

The cwd and `ADW_WORKTREE` propagation were confirmed correct: patch-review is dispatched with `getWt()` (`adw-plan-review-build-patch.ts:725`), which sets `ADW_WORKTREE` via `spawnStage`, so `git diff` ran *in the worktree* — the defect was purely the diff form. The regression went unnoticed because the existing unit test encoded the buggy `..HEAD` form (`test/unit/adw-patch-review.test.ts`).

## Decision

Diff the **working tree** against the base, not the commit range. In `gatherContext`'s worktree-with-base branch:

```ts
diffArgs = ["diff", resolvedDiffBase, "--no-color"];
nameArgs = ["diff", "--name-only", resolvedDiffBase];
```

`git diff <base>` compares the base commit to the working tree, so it captures the builder's **staged** changes regardless of commit state. It is strictly more correct than `<base>..HEAD`: when the working tree is clean (changes already committed) it equals `<base>..HEAD`; when changes are staged-but-uncommitted (the actual patch-review-time state) it captures them. Because the worktree is freshly created from `base_sha` for the run (SPEC-065), the only working-tree delta vs base is the builder's own output — no incidental dirt is swept in.

## Consequences

- **Positive:** patch-review now sees the real implementation diff on every worktree-isolated run; the spec-acceptance audit is no longer blind, and the build↔patch retry loop gets the diff signal it needs to converge. The fix is regression-tested (`test/unit/adw-patch-review.test.ts`: updated mocks + a BUG-26 case asserting staged-uncommitted capture and rejecting any `..HEAD` form).
- **Negative:** none material — the working-tree form is strictly more inclusive than the commit-range form it replaces.
- **Consistency:** the worktree-with-base branch now uses the same diff form as the non-worktree branch (`git diff <base>`), removing a needless asymmetry.
- This decision is independent of the orchestrator's commit-on-pass ordering: gather is correct whether the builder stages or commits, so future changes to commit timing do not reintroduce the blind-audit failure mode.
