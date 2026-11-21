# ADR-0310 — #287: argv-based mutations (shell-exec-argv)

- **Status**: Accepted
- **Date**: 2026-11-22
- **Issue**: #287
- **Spec**: SPEC-284

## Context

#287's safety contract is normative: "Every git invocation is
argv-based with `--` before the path — no string interpolation of
filenames into a shell." The repo had only shell-string primitives
(`shell-command`, `shell-exec`); the #289 arc had to defend its
string-built commands with shell-quoting + `:(literal)` pathspecs
after a gate-reproduced injection. Mutations (stage/discard) are the
most dangerous surface yet — `git checkout --` destroys worktree
content.

## Decision

- **Add `shell-exec-argv`** (`tlisp-api.ts`): argv LIST + optional
  cwd → `Bun.spawnSync(argv)` with NO shell in the path. Byte-faithful
  `(stdout stderr exit)` return, same shape as `shell-exec` so module
  code swaps between them freely. Non-string argv elements are a
  TypeError; the empty list is a FormatError.
- **`stagehand-git-argv`** conses `"git"` onto args — the mutation
  commands pass paths as argv ELEMENTS (no quoting, no injection
  surface). CORRECTION (codex r1, reproduced): argv alone does NOT
  disable git PATHSPEC magic — a file named `:(glob)*.txt` globbed
  its siblings. Every path also rides `:(literal)` (codex r1 fix);
  unstage branches to `git rm --cached` on unborn repos (restore
  --staged cannot resolve HEAD there).
- The #289 diff dispatch keeps its (gated, injection-hardened)
  string path — migrating it to argv is a natural follow-up for the
  cluster, not this issue's scope.
- **Destructive confirm** rides the async `completing-read` y/n table
  pattern (kill-buffer's): the discard defers to an accept handler;
  `y` alone runs it, everything else is a no-op.
- **Discard preserves the index** by construction (`git checkout --
  path` touches the worktree only); the split case is asserted on
  file CONTENTS.

## Consequences

- Any future consumer with attacker-shaped strings should reach for
  `shell-exec-argv` first; `shell-exec` remains for genuine
  shell pipelines (markdown execution, cd-prefixed read-only calls).
- Header-wide runs stop at first failure (applied rows stay) — the
  report's "of V visited" counts only visited rows, so excluded
  sections can never masquerade as failures.
