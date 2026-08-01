# ADR-0164 — Black-box e2e for the embedded editor (#77)

## Status

Accepted

## Context

BUG-58 (`tmax file.md` → `:w` wrote nothing) reached users through a green
suite. The joint Claude + `codex exec` diagnosis (`docs/specs/CHORE-69-reliable-test-harness.md`)
found the structural cause: **every** save/`:w` test exercised the daemon RPC
path (`Editor.openFile`, which sets `bufferMetadata.filename` correctly). The
embedded `src/main.ts` CLI bootstrap — where the bug lived — had **zero**
behavioral coverage, and `tmax-use` only ever spawns `src/server/server.ts`. The
single existing `:w` playbook asserted the `"Saved"` message, not disk content,
so it would have passed even when nothing was written.

A socket-only test cannot reproduce BUG-58: opening the file via RPC takes the
`openFile` path, which doesn't have the bug. The only faithful reproduction is
to launch the real embedded editor with the file as an argv argument and drive
the TUI.

## Decision

Add a black-box e2e that drives the REAL embedded editor and asserts disk state.

- **`tmax-use/src/embedded-instance.ts`** — `EmbeddedEditor`: spawns
  `bun src/main.ts <file>` (repo-local `EMBEDDED_ENTRY`) inside a tmux session
  under an **isolated `mkdtemp` HOME** and a **unique `TMAX_SOCKET`** (inside
  that HOME). Drives keys via `tmux send-keys`, captures via `capture-pane`,
  asserts via the editor's own socket (`eval`). `launch()` verifies the embedded
  server bound our socket AND that `(buffer-filename) === file` — throwing
  loudly on a daemon hijack or a `*scratch*` reset (BUG-58 class).
  - **Drives `src/main.ts` directly, not `bin/tmax`.** This guarantees the CLI
    bootstrap (the BUG-58 site) runs and makes daemon rerouting impossible
    (rerouting happens only when a daemon answers on `$TMAX_SOCKET`; ours is
    unique + empty). The codex review permitted either `bin/tmax` or direct
    `src/main.ts`; we chose direct for determinism.
- **`tmax-use/tests/embedded-save.tmax-use.ts`** — opens a NEW file and an
  EXISTING file, drives `i…<Esc>:w<Enter>`, and asserts **EXACT disk content**
  (not the message). Mode-switch waits (`waitForMode`) make it robust under
  runner load — fixed sleeps raced the async command-mode switch.

## Consequences

- The suite now has a test that **catches BUG-58**: verified to FAIL on
  `7d3f0c8^` (new file ENOENT; existing file unchanged) and PASS on HEAD. This
  is the regression-proof requirement for the whole CHORE-69 effort.
- The pattern (tmux-driven black-box of `src/main.ts`) is reusable for any
  future embedded-path coverage (launcher routing, `cleanStart`, frontend
  startup, shutdown) — Issue #80 (unify) keeps this e2e green as its net.
- Trade-offs accepted: depends on a host `tmux` (no preflight yet); a hard
  `SIGKILL` mid-test can orphan the `tmax-embedded-*` session + temp HOME (low
  risk for CI; `close()` is in every `finally` and on launch-readiness failure).
  Both are non-blocking and tracked as observations, not criteria.

Spec: [CHORE-69](../specs/CHORE-69-reliable-test-harness.md) (Issue A). Issue: #77.
