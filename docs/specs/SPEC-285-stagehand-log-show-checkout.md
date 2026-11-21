# SPEC-285 — the Stagehand log / show / checkout (#290)

## Goal

Stagehand T0's last row: `l` opens the streaming `*Stagehand-Log*`,
RET shows a commit faced by #289's grammar, `b` checks out a ref
behind a confirm.

## Design

- **Module** `src/tlisp/core/stagehand/log.tlisp` (loads after
  status/diff/stage in `bindings/normal.tlisp`; status binds `l`
  lazily).
- **The log run**: `git log --graph --format=%h<US>%d<US>%s
  --color=never` (US = the hex-decoded 0x1f unit separator) via
  `make-process` — the stream appends through the TEMPORARY-SWITCH
  pattern (`buffer-append-to` hits a stale buffer object in streaming
  contexts; fikra's event.tlisp comment documents the same finding).
  The #307 generation guard (pid→generation map; `g` bumps the
  generation) drops stale chunks. FIELD rows (3 US-separated fields)
  render `sha  <dim>refs</dim>  subject` and record the sha at the
  buffer line; ART rows pass through (no sha; n/p skip them — nav
  scans the line→sha map). Unborn → `no commits yet`; no repo → a
  status.
- **The show view**: RET on a commit row → `git show --no-color <sha>`
  rendered through #289's parse + face emission; `n` walks DOWN the
  log list (newest-first: down is older; clamps at the oldest),
  `p` back up (clamps at the newest); `q` kills the show buffer then
  switches to the log (kill-then-switch — buffer-kill rebinds current
  to its survivor, so the explicit switch must come after).
- **Checkout (`b`)**: the n-FIRST y/n table (the #287 lesson — bare
  Enter cancels). Ref selection via `git for-each-ref
  --points-at=<sha>`: precedence `refs/heads/*` > `refs/tags/*` >
  `refs/remotes/*` (first in for-each-ref order within a class); the
  checkout target is the SHORT name (`git checkout refs/heads/x`
  treats the qualified ref as a rev and DETACHES); no ref →
  `git checkout <sha>` + `detached at <sha>`. The dirty tree is
  GIT's call — no preflight, no force (both outcomes tested). The
  log buffer stays; the status refreshes on next open.
- **Callbacks are EXPORTED module fns**: the `:filter`/`:sentinel`
  names eval outside the module's lexical context — an unexported
  callback is an invisible "Undefined symbol" (the
  process-callback-exports inventory pins this).

## Completion criteria

- [x] Temp-repo tests: log rendering (graph rows, dimmed refs, art
      pass-through on a real merge graph), SHA selection (n lands on
      a commit row with a recorded sha), show + the n/p walk (with
      clamp statuses) + q-returns
- [x] Checkout: branch (named in the status, HEAD moves) + detached
      (mid-branch sha) + dirty-tree BOTH outcomes (non-conflicting
      rides; conflicting refuses with git's message, HEAD unchanged)
      + cancel (n)
- [x] Unborn/empty statuses; the streaming re-run (`g` — fresh
      generation, no duplicate rows); the cherry-pick/revert
      follow-up issue FILED before close (#330)
- [x] Gate r1: graph-TAIL nav (every n lands on a commit row; the
      oldest reachable; wrap both ways), the sentinel failure path
      (named error, no buffer), the no-repo branch, the l/n keys via
      handleKey + the post-stream read-only assertion, and the
      refs/tags precedence row
