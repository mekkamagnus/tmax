# Chore: SPEC-065 blocker fix, BUG-20 re-run, and worktree/doc cleanup

## Chore Description

Two adw pipelines completed patch-review with a `gaps` verdict, plus there is leftover
git/worktree state to clean up. This chore resolves all three in priority order:

1. **SPEC-065 blocker (P0):** A hard TypeScript error in
   `adws/adw-plan-review-build-patch.ts` — `findWorkspaceBySpecPath` is imported on two
   consecutive lines (54 and 55), and `dirname` is imported but never used. This single
   defect fails `bun run typecheck` **and** every unit test that imports the orchestrator,
   so it is the root cause behind most SPEC-065 gate failures.
2. **BUG-20 (P1):** Workspace `01KVYKNHTN` shipped the **BUG-18** fix (529 retry), not
   BUG-20's fix. Its branch made zero changes to the two files BUG-20 requires. BUG-20
   needs a genuine re-run from the correct base.
3. **Cleanup (P2):** Three stale git worktrees are still registered
   (`tmax.01KVSZNCP1`, `tmax.01KVYKNHTN`, `tmax-spec067`) and there are uncommitted
   docs/spec edits plus an untracked `.codex/` directory in the main checkout.

## Relevant Files

Use these files to resolve the chore:

- `adws/adw-plan-review-build-patch.ts` — **the P0 blocker.** Lines 54–55 duplicate the
  `findWorkspaceBySpecPath` import; line 50 imports an unused `dirname`. The
  `ResumeContext` interface (line 290) and `loadWorkspace` (line 359) are also the BUG-20
  extension targets.
- `adws/adws-modules/workspace.ts` — exports `findWorkspaceBySpecPath` and
  `normalizeSpecPath` (line 92); the dedup fix consolidates onto a single import line here.
- `adws/adws-modules/worktree.ts` — BUG-20 requires adding `createWorktreeFromBase`
  (currently absent) so resume seeds a worktree from the spec's base rather than via the
  `existsSync` anti-pattern.
- `adws/adw-status.ts` — parses `--remote` (lines 102, 117–118) but `main()` never reads
  the parsed value (dead stub). Out of scope to fully implement; the chore only notes it.
- `test/unit/adw-launch.test.ts` — zero coverage for `--remote` / `--dry-run`.
- `test/unit/adw-pipeline-loop.test.ts` — mocks are no-ops that bypass real worktree
  logic.
- `docs/specs/BUG-20-worktree-duplication-on-resume.md` — the BUG-20 spec (uncommitted).
- `docs/specs/SPEC-065-adw-worktree-isolation.md` — the SPEC-065 spec (uncommitted edits).
- `AGENTS.md`, `CLAUDE.md`, `.gitignore` — missing SPEC-065 references per verdict.
- `docs/adrs/index.md` — uncommitted edit.

### New Files
- No new source files are required for the chore itself. This chore spec may currently be
  untracked and should be staged/committed with the chore if it is used as the execution
  record. BUG-20's re-run may create or update `agents/{id}/` runtime artifacts; those
  artifacts are already ignored by `.gitignore`, must not be committed, and are out of
  scope except as validation evidence.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. P0 — Fix the duplicate-import blocker in the orchestrator
- **User story:** *As a developer running the adw pipeline, I want the orchestrator to
  typecheck cleanly, so that unit tests and `bun run typecheck` stop failing on a
  self-inflicted import error.*
- In `adws/adw-plan-review-build-patch.ts`, delete the duplicate line 55 import and merge
  it into the single import on line 54 so the file imports
  `findWorkspaceBySpecPath` and `normalizeSpecPath` exactly once from
  `./adws-modules/workspace.ts`.
- Remove the unused `dirname` from the `path` import on line 50 (keep `join`).
- Acceptance criteria:
  - `rg -n "findWorkspaceBySpecPath" adws/adw-plan-review-build-patch.ts` shows exactly
    **one** import statement (plus call sites), no duplicate line.
  - `rg -n "\bdirname\b" adws/adw-plan-review-build-patch.ts` returns nothing (fully
    removed, not just the import token).
  - `bun run typecheck:src` passes with zero errors.
  - The full unit suite passes (`bun run typecheck:test` then the test run in
    Validation Commands).

### 2. P1 — Re-run BUG-20 from the correct base
- **User story:** *As a developer fixing the worktree-duplication-on-resume bug, I want
  the BUG-20 pipeline to actually implement BUG-20 (not re-land BUG-18), so that the
  resume path stops duplicating worktrees via the `existsSync` anti-pattern.*
- Before re-running BUG-20, commit the Step 1 P0 fix onto the base branch that BUG-20
  will use. Do not rely on unstaged or staged-only changes; the BUG-20 worktree must be
  created from a commit that includes the duplicate-import fix.
- Verify the BUG-20 diff is currently the wrong work:
  - Confirm `01KVYKNHTN`'s changes contain the 529-retry (BUG-18) code, **not** changes to
    `ResumeContext` (`adw-plan-review-build-patch.ts`) or a new
    `createWorktreeFromBase` (`worktree.ts`).
- Re-run BUG-20 from `main` (the clean committed base, post Step 1) with the concrete
  launcher command:
  `bun adws/adw-launch.ts docs/specs/BUG-20-worktree-duplication-on-resume.md`
  If executing inside an agent environment that supports slash commands, the equivalent
  `/adw-implement docs/specs/BUG-20-worktree-duplication-on-resume.md` is acceptable, but
  it is not a shell command.
- Acceptance criteria:
  - The re-run's patch touches `adw-plan-review-build-patch.ts` (the `ResumeContext`
    extension / resume-path change) **and** adds `createWorktreeFromBase` to
    `adws/adws-modules/worktree.ts`.
  - The resume path no longer relies on the `existsSync` anti-pattern called out in the
    spec.
  - Validation commands prove `createWorktreeFromBase` exists, `ResumeContext` and the
    resume path changed, and the problematic resume `existsSync(worktreePath)` behavior
    is absent from the BUG-20 resume path.
  - The resulting patch-review artifact under `agents/{bug20-id}/patch-reviewer/` proves
    the verdict is not blocked by "wrong work landed."

### 3. P2 — Remove the three stale git worktrees
- **User story:** *As a developer, I want `git worktree list` to show only the real
  working checkout, so stale adw/vim-parity worktrees don't accumulate and confuse resume
  discovery.*
- Use `git worktree list --porcelain` as the source of truth for the exact registered
  worktree paths. The current registered paths are siblings of the main checkout:
  `/Users/mekael/Documents/programming/typescript/tmax.01KVSZNCP1`,
  `/Users/mekael/Documents/programming/typescript/tmax.01KVYKNHTN`, and
  `/Users/mekael/Documents/programming/typescript/tmax-spec067`.
- Before removing anything, run the safety checks for each worktree:
  - `git -C /Users/mekael/Documents/programming/typescript/tmax.01KVSZNCP1 status --short`
  - `git log --oneline main..adw/01KVSZNCP1`
  - `git -C /Users/mekael/Documents/programming/typescript/tmax.01KVYKNHTN status --short`
  - `git log --oneline main..adw/01KVYKNHTN`
  - `git -C /Users/mekael/Documents/programming/typescript/tmax-spec067 status --short`
  - `git log --oneline main..spec-067-vim-parity`
- Only proceed if each worktree status is clean and each `main..<branch>` log is empty.
- Remove the registered worktrees by absolute path:
  - `git worktree remove /Users/mekael/Documents/programming/typescript/tmax.01KVSZNCP1 --force`
  - `git worktree remove /Users/mekael/Documents/programming/typescript/tmax.01KVYKNHTN --force`
  - `git worktree remove /Users/mekael/Documents/programming/typescript/tmax-spec067 --force`
- Delete the now-orphaned local branches only after the ahead-of-`main` checks above are
  empty:
  - `git branch -d adw/01KVSZNCP1`
  - `git branch -d adw/01KVYKNHTN`
  - `git branch -d spec-067-vim-parity`
- Acceptance criteria:
  - `git worktree list` shows only the main checkout line.
  - The three directories no longer exist on disk.
  - `git branch --list 'adw/01KVSZNCP1' 'adw/01KVYKNHTN' 'spec-067-vim-parity'` returns
    no branches.

### 4. P2 — Commit or discard uncommitted docs/specs + `.codex/`
- **User story:** *As a developer, I want the main checkout to have a clean working tree,
  so uncommitted spec/ADR edits are intentional and `.codex/` tooling cruft is ignored.*
- Intended final state for modified documentation/spec files:
  - Keep and stage/commit `docs/adrs/index.md`.
  - Keep and stage/commit `docs/specs/BUG-20-worktree-duplication-on-resume.md`.
  - Keep and stage/commit `docs/specs/SPEC-065-adw-worktree-isolation.md`.
  - Keep and stage/commit this chore spec if it is still untracked.
  - Do not stash these files; do not leave them as unstaged modifications.
- Add `.codex/` to `.gitignore` rather than committing the directory. Use this exact
  SPEC-065 `.gitignore` block:
  ```
  # SPEC-065 local agent/tooling state (never commit)
  .codex/
  ```
- Add the missing SPEC-065 references to `AGENTS.md` and `CLAUDE.md` called out by the
  patch-reviewer.
- Acceptance criteria:
  - `git status` after the chore shows no stray modifications other than intentionally
    staged work.
  - `.codex/` no longer appears in `git status` (ignored).
  - SPEC-065 is referenced in `AGENTS.md`, `CLAUDE.md`, and the exact `.gitignore` block
    above.

### 5. Run the Validation Commands
- Execute every command in the Validation Commands section, top to bottom, and confirm
  each passes with zero errors before reporting the chore complete.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:src` —
  validates the P0 fix; the duplicate-import error must be gone.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:test` —
  validates test sources typecheck.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck` —
  full typecheck (project standard gate per AGENTS.md §8).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test` — full unit
  suite; the orchestrator-importing tests that previously failed on the duplicate import
  must now pass.
- `cd /Users/mekael/Documents/programming/typescript/tmax && rg -n "findWorkspaceBySpecPath" adws/adw-plan-review-build-patch.ts` —
  must show exactly one import statement for `findWorkspaceBySpecPath`.
- `cd /Users/mekael/Documents/programming/typescript/tmax && ! rg -n "\\bdirname\\b" adws/adw-plan-review-build-patch.ts` —
  proves the unused `dirname` import is fully removed.
- `cd /Users/mekael/Documents/programming/typescript/tmax && rg -n "createWorktreeFromBase" adws/adws-modules/worktree.ts adws/adw-plan-review-build-patch.ts test/unit/adw-pipeline-loop.test.ts` —
  proves the BUG-20 helper is implemented, wired into the orchestrator, and covered.
- `cd /Users/mekael/Documents/programming/typescript/tmax && rg -n "ResumeContext|resumeFrom|resume.*worktree|worktree.*resume" adws/adw-plan-review-build-patch.ts test/unit/adw-pipeline-loop.test.ts` —
  proves the resume-context/resume-path changes are present and covered.
- `cd /Users/mekael/Documents/programming/typescript/tmax && ! rg -n "existsSync\\(worktreePath\\)" adws/adw-plan-review-build-patch.ts` —
  proves the problematic resume worktree-existence branch is gone.
- `cd /Users/mekael/Documents/programming/typescript/tmax && BUG20_ID=<bug20-id> && test -f "agents/$BUG20_ID/adw-state.json" && rg -n '"patch_review_verdict"\\s*:\\s*"pass"' "agents/$BUG20_ID/adw-state.json"` —
  proves the BUG-20 re-run reached a passing patch-review verdict. Replace `<bug20-id>`
  with the workspace id printed by the BUG-20 re-run.
- `cd /Users/mekael/Documents/programming/typescript/tmax && BUG20_ID=<bug20-id> && ! rg -n "wrong work landed" "agents/$BUG20_ID/patch-reviewer"` —
  proves the BUG-20 patch-review artifact is no longer blocked by the wrong-work verdict.
- `cd /Users/mekael/Documents/programming/typescript/tmax && git worktree list` —
  must show only the main checkout.
- `cd /Users/mekael/Documents/programming/typescript/tmax && test ! -d /Users/mekael/Documents/programming/typescript/tmax.01KVSZNCP1 && test ! -d /Users/mekael/Documents/programming/typescript/tmax.01KVYKNHTN && test ! -d /Users/mekael/Documents/programming/typescript/tmax-spec067` —
  verifies stale worktree directories are gone.
- `cd /Users/mekael/Documents/programming/typescript/tmax && test -z "$(git branch --list 'adw/01KVSZNCP1' 'adw/01KVYKNHTN' 'spec-067-vim-parity')"` —
  verifies stale local branches are deleted.
- `cd /Users/mekael/Documents/programming/typescript/tmax && rg -n "SPEC-065" AGENTS.md CLAUDE.md .gitignore` —
  verifies the required SPEC-065 documentation references exist.
- `cd /Users/mekael/Documents/programming/typescript/tmax && rg -n "# SPEC-065 local agent/tooling state \\(never commit\\)|^\\.codex/$" .gitignore` —
  verifies the exact `.gitignore` block was added.
- `cd /Users/mekael/Documents/programming/typescript/tmax && git status` — must be
  clean (or show only intentionally staged work); `.codex/` must not appear.

## Notes

- The P0 fix is genuinely a ~2-line change and is the single highest-leverage item — it
  unblocks typecheck **and** the unit tests in one edit, so do it first and alone before
  touching anything else.
- Do not attempt to fix the BUG-20 code by hand to "match" the wrong-work diff; the
  correct path is to re-run BUG-20 from a clean `main` base per step 2.
- The `--remote` stub in `adw-status.ts` and the no-op mocks in
  `test/unit/adw-pipeline-loop.test.ts` / missing `--remote`,`--dry-run` coverage in
  `test/unit/adw-launch.test.ts` are **noted by the SPEC-065 verdict but deliberately out of scope**
  for this chore — they are lower-priority follow-ups, listed here only so they aren't
  lost. File a separate chore if you want them addressed.
- Execute the steps serially. Steps 3 and 4 touch git/worktree state that the BUG-20
  re-run depends on, so do not parallelize them unless they are isolated in a separate
  clone with no shared worktrees or branches.
