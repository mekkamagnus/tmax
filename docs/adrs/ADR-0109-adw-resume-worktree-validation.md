# adw Resume-Worktree Validation — Verify Before Reuse, Recreate from Recorded base_sha

## Status

Accepted

## Context

SPEC-065 isolates each adw pipeline run inside a **sibling worktree**
(`<repo>.<adw-id>/` on branch `adw/<adw-id>`). Resume (`--id <workspace>`) must
find the previously recorded worktree and reuse it so a kill-and-resume cycle
does not create a second, divergent checkout. BUG-20 found the resume path doing
this unsafely:

```ts
// adws/adw-plan-review-build-patch.ts (pre-fix)
if (existsSync(worktreePath)) {
  currentWorktreePath = worktreePath;          // reuse — no verification
  appendEvent(id, { event: "worktree-reused", path: worktreePath, branch });
} else {
  // recreate from the recorded branch via createWorktree (HEAD-based)
  const createRes = await worktreeDeps.createWorktree(PROJECT_ROOT, branch, worktreePath);
  ...
}
```

`existsSync(worktreePath)` returns true for **any** directory — an arbitrary
folder, a stale checkout from a different repo, or a worktree checked out on the
wrong branch. On workspace `01KVYKNHTN` this combined with a second defect: the
worktree was created from a base that already carried BUG-18's commits, so the
BUG-20 run built and "patch-reviewed" the wrong work entirely. patch-review
correctly reported *"the diff is a BUG-18 fix, not BUG-20,"* but nothing checked
that the worktree's contents matched the spec's intent *before* building, so the
run was defeated by the absence of the very feature BUG-20 implements. A second
consequence: resume recreated a worktree from `HEAD` (via `createWorktree`),
which silently swallowed the recorded `base_sha` — so a resumed run could build
on a base the original plan never saw.

ADR-0108 called this the fourth structural gap (gap (d)) and explicitly deferred
it to BUG-20. This ADR records the fix.

## Decision

Resume no longer trusts the worktree path alone. It carries the recorded
worktree path + branch + base SHA forward as a single source of truth and
**validates** before reuse:

### (1) Carry recorded state forward — `ResumeContext`

`loadWorkspace` reads `state.worktree_path`, `state.branch`, and `state.base_sha`
from `adw-state.json` and carries them on `ResumeContext`. `runPipeline` derives
the worktree path/branch from the recorded values (`resume?.worktreePath` /
`resume?.branch`) rather than re-deriving a deterministic sibling path.

### (2) Validate before reuse — `validateWorktree`

`adws/adws-modules/worktree.ts` exports `validateWorktree(rootPath, worktreePath,
expectedBranch)`, the spec-required primitive built on `git worktree list
--porcelain` (not `existsSync`). It distinguishes five outcomes:

- **missing** — path absent on disk → recreate via `createWorktreeFromBase`.
- **not-a-worktree** — path exists but is not a registered worktree (arbitrary
  dir) → refuse.
- **wrong-repo** — registered worktree of a different common repo (compared via
  `rev-parse --git-common-dir`) → refuse.
- **wrong-branch** — worktree of this repo but on a branch other than
  `expectedBranch` → refuse.
- **ok** — real worktree of this repo on the expected branch → reuse (and do
  **not** call `createWorktree`).

The orchestrator's resume branch (post plan+review) calls `validateWorktree` and
routes each non-`ok` outcome to a loud `worktree-error` event + `finalize(Left)`,
except `missing`, which proceeds to recreation.

### (3) Recreate from the recorded base — `createWorktreeFromBase`

When the recorded worktree is gone, resume recreates it from the **recorded
`base_sha`**, not `HEAD`:

- Branch does not exist → `git worktree add -b <branch> <path> <baseSha>`
  (creates the branch at `baseSha` and checks it out).
- Branch already exists → `git worktree add <path> <branch>` (checks out the
  existing branch) without deleting or force-recreating it.

This guarantees a resumed run sees the same base the plan saw. A missing
`base_sha` is a hard error, not a silent fallback to HEAD.

## Consequences

**Easier:** A resume that would silently build on the wrong base, the wrong
branch, or a non-worktree directory now fails loudly at the setup step, in
seconds, instead of producing a patch-review verdict on unrelated work. The
recorded `base_sha` is the single source of truth for recreation, so
kill-and-resume is reproducible. `existsSync` — the anti-pattern that admitted
arbitrary directories — is gone from the resume path.

**Harder:** `validateWorktree` adds two git calls to the resume path
(`worktree list --porcelain` + a defensive `rev-parse --git-common-dir`). The
`WorktreeValidation` discriminated union adds a new return type that callers and
tests must handle, and `OrchestratorWorktreeDeps` grew two members
(`createWorktreeFromBase`, `validateWorktree`), which every mock in the test
suite must satisfy. Resume now refuses (rather than reuses) when a recorded path
is an arbitrary directory or wrong branch — correct, but a behavioral change for
anyone who relied on the lenient old behavior.

**Related:** BUG-20 (the spec), [SPEC-065](../specs/SPEC-065-adw-worktree-isolation.md)
(worktree isolation), [ADR-0094](ADR-0094-adw-pipeline-architecture.md) (the
orchestrator), [ADR-0108](ADR-0108-adw-compile-gate-and-feedback-integrity.md)
(gap (d) — this ADR closes it), BUG-18 (the 529-retry work that mistakenly landed
in the BUG-20 worktree, which this validation would have caught).
