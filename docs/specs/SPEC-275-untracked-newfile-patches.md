# SPEC-275 — untracked new-file patches + the revert affordance (#305)

## A. Untracked files as new-file patches

Untracked files in the turn viewer (`SPC a d`, `fikra-diff-for-paths`)
now render via `git diff --no-color --no-index -- /dev/null <path>` —
the REAL new-file diff grammar (`diff --git a/x b/x`, `new file mode`,
`--- /dev/null`, `+++ b/x`, all-addition hunks) with git's own edges:
empty → header only (no hunks, no ---/+++ pair); binary → the
`Binary files /dev/null and b/x differ` line; odd names safe by argv
construction (`--` separator for leading dashes; git quote-escapes
non-ASCII — correct output). Tracked files keep the tree-diff source.

## B. The revert affordance (`r`)

The viewer's confirm-gated `r` (completing-read: revert/cancel — the
minibuffer machinery has its own tests) restores the turn's file set
with the BASELINE-MEMBERSHIP semantics (the ADR decision — the
mechanism is the viewer's own restore, satisfying the dirty-file
semantics):

- **Tracked-dirty**: restored from the BASELINE TREE (the stash-create
  snapshot) — the pre-turn content, byte-exact, NOT HEAD.
- **Untracked turn-created** (absent from the baseline signature):
  REMOVED after confirm.
- **Untracked preexisting** (present in the baseline signature):
  UNTOUCHED — file-kind alone (the old logic) could not distinguish
  these from turn-created files and rm'd them.
- **Cancel / empty selection**: no-op.

## Completion criteria

- [x] Untracked new-file patches render with correct grammar incl.
      empty + binary + odd-name edges (6 tests)
- [x] Current `r` behavior documented (this spec + the ADR); the named
      defect (preexisting-untracked rm'd) fixed; pre-turn-dirty restore
      asserted byte-exact; turn-created untracked removed; cancel
      no-ops
