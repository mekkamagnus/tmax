# Bug: concurrent on-disk modification detection (#65)

## Description
No mtime check on save — a file changed externally (git pull, another editor)
was silently clobbered.

## Solution
save.tlisp tracks per-path mtimes in a `saved-modtimes` hashmap (via
`file-modtime` primitive). On save, if the on-disk mtime differs from the
recorded one, the save is refused with "File changed on disk since open —
use :w! to force". `:w!`/`:wq!` pass `force=t` to skip the check.
`make-backup-file` already creates a ~ backup (was only on the T-Lisp path).

## Validation
- Save → external modify → save refused → `:w!` forces ✓
