# SPEC-217: Fikra checkpoint capture + lifecycle

**Issue:** #217 (fikra-p2 / RFC-027 §D6, §Phase 2)
**Status:** Implemented 2026-08-22

## Goal

Non-invasive git checkpoints: temp-index `refs/fikra/<thread>/<n>[-baseline]`
that never touch the user's index, HEAD, or working tree; capture as its
own process (async follow-up — never blocks the next turn); checkpoint
FAEP events; edge cases stated.

## Design

`src/tlisp/core/fikra/checkpoint.tlisp`:

- **Capture command contract** (one shell line via shell-command; the RFC's
  step sequence preserved inside): fresh `GIT_INDEX_FILE` → `git add -A
  -- .` (fresh index = exact disk state; deletions by absence) →
  `write-tree` → `commit-tree -p HEAD` → `update-ref` (the atomic commit
  point) → temp-index removed → `echo REF:<sha>` marker. Pre-update-ref
  failure → checkpoint-error event, no ref, turn state untouched.
- **Sync capture** (`fikra-checkpoint-capture kind`): for tests + explicit
  callers; returns the sha; emits checkpoint-ready/-error.
- **Async reactor** (`fikra-checkpoint-capture-async kind`): the capture
  as its own make-process (:cwd = thread root) with a serialized filter
  that parks the output and a sentinel that parses the REF: marker and
  emits. Callback names are module-QUALIFIED strings (make-process invokes
  them by name — unqualified names are undefined symbols; the filter/
  sentinel are EXPORTED for exactly this).
- **Disabled states**: non-git root or unborn HEAD → checkpointing
  disabled (nil, no crash); probed and cached. Gitignored files NOT
  captured (temp-index add respects ignore rules — documented, not fixed).
- **Tail parsing**: `string-match` returns a match INDEX (not the string)
  — the tail helper uses `match-string 0` + slicing.

## Completion Criteria

- [x] Capture creates `refs/fikra/<thread>/<n>`; the captured tree
      contains working-tree state; **THE NON-INVARIANCE TEST**: a dirtied
      USER index is byte-identical after capture; HEAD unchanged; temp
      index cleaned up (pinned).
- [x] Untracked files captured; deletions captured by absence (pinned).
- [x] Baseline ref gets the `-baseline` suffix (pinned).
- [x] Capture failure/nil never touches thread state (pinned via a
      non-git-rooted thread) AND a REAL mid-chain git failure (write-tree
      stub on PATH) emits checkpoint-error — not an eval throw (gate
      round-1 catch: the && chain's nonzero exit threw in execSync BEFORE
      the emit; the chain now ends `|| echo CAPTURE-FAILED` so failure is
      a parseable marker; pinned).
- [x] Disable cache is PER ROOT (gate round-1 catch: the sticky flag let
      one non-git probe poison the interpreter forever). Pinned within ONE
      interpreter (gate retry-1 catch: the first test used two editors —
      fresh defvars — and pinned nothing): poison at a non-git root, then
      re-init the thread at a git root in the SAME editor → capture
      works. The async sentinel's kind is THREADED (was hard-coded
      completion — async baseline would have emitted the wrong ref name;
      gate retry-1 catch). Same-root never-invalidates documented (an
      unborn→born transition re-probes only on root change).
- [x] Non-git + unborn-HEAD disabled (pinned); gitignored NOT captured
      (pinned).
- [x] FAEP checkpoint-ready with the ref emitted; sync and async emit the
      SAME payload shape (ref name + sha — gate round-1 catch: they
      differed). The async filter APPENDS chunks (mid-REF: splits no longer
      misreport success as failure — gate round-1 catch). Async capture is
      process-based — the sentinel emits the event and creates the ref
      (pinned with a poll loop; found and fixed the unqualified-callback
      bug — filter/sentinel must be exported + module-qualified).
- [x] Final-round items fixed (both minor per the gate itself): async
      kinds are PID-KEYED (a single global could race between concurrent
      captures — the sentinel now resolves ITS capture's kind from a
      pid→kind hashmap and clears it); the sentinel no longer consults
      exit-code (the `|| echo CAPTURE-FAILED` marker neutralized it —
      correctness rests on the REF: parse, documented in-code).
- [x] Tests: 11 (gate-driven additions: per-root cache re-probe pinned
      within ONE interpreter, real-failure checkpoint-error, non-
      invariance via the write-tree HASH — the fresh-cycle gate upgraded
      the name-only diff to a full index fingerprint —, async reactor).
- [x] typecheck 4/4 green; checkpoint 11/11 + the full seven-suite fikra
      batch 72/72 (`--timeout 20000`); 0 `.tmax` residue.

## Notes

- Per-thread capture CHAINING (N+1's baseline queues behind N's unsettled
  completion) is #218's revert work — the caller chooses spawn order; the
  sentinel already emits asynchronously.
- `commit-tree -p HEAD` on every capture means each checkpoint's parent is
  HEAD, not the previous checkpoint — turns are snapshots of disk state,
  not a chain. #218's diff is always `<n>-baseline..<n>` per turn.
