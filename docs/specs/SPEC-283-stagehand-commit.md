# SPEC-283 — the Stagehand commit flow (#288)

## Goal

Stagehand T0: COMMIT — the `*Commit-Message*` compose buffer with
`git commit -F` delivery, the amend/reword/fixup variants, failure
retention with retry, and always-removed temp files.

## Design

- **Module** `src/tlisp/core/stagehand/commit.tlisp`, loaded from
  `bindings/normal.tlisp` AFTER status (one-way dependency: commit
  consumes status's exported helpers — `stagehand-git`, `stagehand-shq`,
  `stagehand-has-commits-p`, `stagehand-git-line`,
  `stagehand-current-sections`, `stagehand-status-root`; status's keymap
  binds `c`/`C`/`R` into commit lazily, so NO cycle). The order file's
  "lands with own buffer" resolution: #277's shared primitive extracts
  LATER (its own spec says refactor-and-extract from capture) — the
  compose here follows capture's chord pattern (insert-mode buffer,
  `C-c C-c`/`C-c C-k`/`C-g`).
- **Variants** (normative table): `c` = new message (≥1 staged file
  required — the live parse's Staged section — else status `nothing
  staged`; works unborn); `C` = amend (seeded with `git log -1
  --format=%B`; `--amend`; the index rides AS IT STANDS —
  nothing-staged amend edits the message); `R` = reword at HEAD (the
  status-buffer fallback; #290's log rows own the general case;
  non-HEAD is #295's machinery — out of scope); `F` = fixup — the
  compose is SKIPPED entirely: `git commit --fixup=<sha>` runs
  directly (git constructs the `fixup! <subject>` message — no `-F`
  file, the flags' message semantics never combine; autosquash
  ordering is #295's); status shows the created fixup sha; nil sha →
  `no target`. Unborn guards: `C`/`R` → `no commits to amend`.
- **Delivery**: the message is written via `append-file` to a fresh
  `mktemp` file (an injection-SAFE file write — never a shell
  argument); commit runs `git commit -F <tmp> [--amend]`. **The temp
  file is ALWAYS removed at the sentinel — success, git failure, or
  abort** (`stagehand-commit-tmp-path` + the exported getter let tests
  assert the orphan-file contract on every exit).
- **Failures**: exit ≠ 0 (hook rejection, empty message without
  `--allow-empty-message`) → status names exit + first stderr line;
  the compose buffer and typed message are RETAINED — `C-c C-c` again
  re-runs (retry tested through a rejecting commit-msg hook that is
  then removed). Empty message → status `empty message`, retained.
- **Restoration**: on success OR abort the compose closes
  (`buffer-kill`'s recency survivor restores the prior buffer; editor
  mode returns to normal); on FAILURE it stays open; the status
  buffer is never torn down.

## Completion criteria

- [x] Temp-repo integration tests INSPECT resulting commits: new
      message, amend (message replaced + staged file folded,
      `--stat`), reword-at-HEAD (one commit, subject replaced),
      fixup message format (`fixup! <subject>`) + the created-sha
      status + the no-compose/no-temp contract
- [x] Failure paths: hook rejection retains buffer + message; retry
      then succeeds; empty message; temp-file cleanup asserted on
      success, failure, and abort
- [x] Abort restores without committing; the `c` nothing-staged
      refusal; unborn guards (`c` first-commit works, `C`/`R`/`F`
      refuse); the `c` KEY dispatches from the status buffer
