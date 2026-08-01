# ADR-0157 — :wq / :w persist synchronously before quitting (#50)
## Status: Accepted
## Context
`:wq`/`:x` was `(progn (file-save) (editor-quit))` where `file-save` is
fire-and-forget (calls `saveFile()` async + returns `"saving..."` immediately).
`editor-quit` ran before the write resolved, losing data on slow/erroring writes.
The same race affected `:w` immediately followed by `:q`.

## Decision
Route `:w`/`:w!` and `:wq`/`:x` (in `command-line.tlisp`) through `save-buffer`
instead of `file-save`. `save-buffer` is **synchronous** — it writes via
`write-file-content` (`fs.writeFileSync`, made sync by #45) — so the save
completes before `editor-quit` runs. Write failures surface as errors.

`file-save` (async TS primitive) remains for direct callers; only the `:w`/`:wq`
command-line dispatch changed. The sync-eval constraint (async-let can't run in
`executeCommand`) makes this the correct approach — the write is synchronous, no
awaiting needed.

## Consequences
- `:wq`/`:w` persist the buffer before quitting; the data-loss race is closed
  (verify-gate confirmed via `editor-dispatch-command-line "w"` → file on disk).
- Sync write blocks the daemon eval thread for the write duration — the accepted
  tradeoff (the async/non-blocking path is deferred to #43/#46 Phase-2).
- Known gap: `:wq` on an unnamed buffer still quits (save-buffer returns normally
  on no-filename); a future fix could make save-buffer signal failure on no-file.

Spec: [BUG-44](../specs/BUG-44-wq-save-gate.md). Issue: #50.
Verify-gate: PASS (data-loss race closed; gaps are spec-text/failure-test/no-file semantic, non-blocking).
