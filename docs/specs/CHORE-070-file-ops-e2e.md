# Chore: End-to-end coverage for file ops (revert-buffer, save-buffer force/concurrent-modification, make-backup-file)

## Goals

- Add a black-box e2e playbook (`eval-37`) that drives the **real daemon/client** to exercise the file-operation commands that today have **no** e2e test: `revert-buffer`, the `save-buffer` force path (`:w!`), the `save-buffer` concurrent-modification refusal path, and `make-backup-file`.
- Pin the observable disk + buffer behavior those commands promise, so a future regression in the save/revert path is caught at the e2e layer, not just by the unit suite.
- Discover and file any defect the playbook reveals as a separate `BUG-##` spec referenced here (this chore ships tests only — no implementation).

## Completion Criteria (Definition of Done)

- [ ] Playbook `tmax-use/playbooks/eval-37-file-ops.yaml` exists and follows the runner schema (the `setup`/`steps`/`expect`/`cleanup` shape used by `eval-20-vim-search.yaml`).
- [ ] The playbook opens a fixture file, edits the buffer, then `(revert-buffer)` reloads the on-disk content and the buffer reflects the disk text (not the in-memory edit) — `eval-37`.
- [ ] The playbook covers the concurrent-modification refusal: after the file's mtime changes on disk, `:w` is **refused** with the `"File changed on disk since open — use :w! to force"` message and the file is **not** overwritten — `eval-37`.
- [ ] The playbook covers the force path: `:w!` (`(save-buffer nil t)`) writes through the concurrent-modification gate and the file on disk holds the buffer text — `eval-37`.
- [ ] The playbook covers `make-backup-file`: after a `:w` over an existing file, a `<file>~` backup exists holding the **pre-save** content (the `make-backup-file` call at `save.tlisp:25-26`) — `eval-37`.
- [ ] The playbook is wired into the runner so `bun run test:tmax-use` discovers and executes `eval-37`; any defect the playbook reveals is filed as a separate `BUG-##` and referenced by number here (none pre-known).
- [ ] `bun run test:tmax-use` is green overall for `eval-37` (or, if a defect is found, the playbook is marked `xfail`/skipped with the `BUG-##` cross-reference and the rest of the suite is unaffected).

## Description

The save/revert machinery is the editor's contract with the filesystem and is the most regression-prone surface in tmax (BUG-33 silent write, BUG-55 concurrent-modification, BUG-58 embedded `:w` writing nothing). Today the e2e layer covers basic `:w` (eval-06 save/load roundtrip) but has **no** coverage for `revert-buffer`, the `:w!` force path, the concurrent-modification **refusal** path, or `make-backup-file`. This chore closes that gap with a single playbook that drives each path through the real daemon and asserts on both the message buffer and the on-disk file.

## User Story

**As a** tmax maintainer
**I want** an e2e playbook that proves revert/force-save/concurrent-modification/backup actually work against a real daemon and a real file
**So that** a regression in the save path (the area with the most historical bugs) is caught before it ships, not after a user loses data.

## Problem Statement

The 2026-08-01 alpha audit found that several EXISTING file-operation commands have **no** end-to-end test — they are exercised only by unit tests that mock the filesystem. Concretely:

- `revert-buffer` (`src/tlisp/core/commands/buffers.tlisp:59-64`) is a thin alias over `(find-file-open (buffer-filename))` — never driven e2e. A regression in the `buffer-filename` association (exactly the class that caused BUG-58) would silently break "reload from disk" with no test failing.
- `save-buffer`'s concurrent-modification gate (`src/tlisp/core/commands/save.tlisp:14-24`) and its force override (`force` truthy, `:w!` at `command-line.tlisp:71-72`) have unit coverage but **no** e2e proof that a real on-disk mtime change is detected and that `:w!` actually writes through it.
- `make-backup-file` (`src/editor/api/file-ops.ts:284-311`, called at `save.tlisp:25-26`) — the `<file>~` backup-before-overwrite — is never asserted against a real filesystem in the e2e layer.

The unit layer mocks the filesystem, so it cannot catch the kind of integration drift (mtime format, association loss, sync-vs-async write ordering) that BUG-33/BUG-55/BUG-58 belonged to. This chore adds the missing real-disk coverage.

## Solution Statement

Write e2e playbook `eval-37` under `tmax-use/playbooks/` and wire it into the runner. The playbook sets up a real fixture file, drives the commands through the daemon (`(find-file-open …)`, `(revert-buffer)`, `:w`/`:w!`), mutates the file's mtime from outside the editor (the runner's `setup`/shell action, mirroring how `eval-06` writes fixtures), and asserts on both the message buffer (`*Messages*` / status) and the on-disk file content + the existence/content of the `<file>~` backup. No editor source changes — this is a TEST-ONLY chore. Any defect surfaced is filed as a separate `BUG-##`.

## Relevant Files

The playbook (to be created by the test author) and the source it asserts against:

- **`tmax-use/playbooks/eval-37-file-ops.yaml`** — the new playbook (this chore's deliverable). Follow the `setup_file` / `steps` / `expect` / `cleanup` schema of `tmax-use/playbooks/eval-20-vim-search.yaml`.
- **`tmax-use/test/runner.ts`** — playbook discovery (`runPlaybook` / discovery around line 736); confirm `eval-37` is picked up by the same glob the other eval-NN files use (no manual registration should be needed, but verify).
- **`src/tlisp/core/commands/save.tlisp`** — the command under test. Lines 7-33 implement `save-buffer`: the no-filename bail (10-13), the concurrent-modification gate (14-24), the `make-backup-file` call before overwrite (25-26), and the `saved-modtimes` mtime recording after save (32).
- **`src/tlisp/core/commands/buffers.tlisp:59-64`** — `revert-buffer`: re-opens `(buffer-filename)` via `find-file-open`; bails with `"Buffer has no associated file"` when there is no filename (the exact failure mode BUG-58 caused).
- **`src/tlisp/core/commands/command-line.tlisp:66-76`** — the `:w` / `:w!` / `:wq` / `:wq!` dispatch. `:w!` → `(save-buffer nil t)` (line 72), the force path the playbook must drive.
- **`src/editor/api/file-ops.ts:284-311`** — `make-backup-file`: `fs.copyFileSync(path, path + '~')`. The sync path (daemon eval RPC is sync) is what runs here.
- **`src/editor/api/file-ops.ts:183-208`** — `file-modtime`: returns the mtime ISO string the concurrent-modification gate compares against (`stat.mtime.toISOString()`); a real-disk mtime change is what the playbook must produce to trip the gate.

## Implementation Plan

### 1. Fixture setup
- `setup_file` a fixture (e.g. `eval-37-fileops.txt`) with deterministic seed content (e.g. `original line one\noriginal line two`). Capture its path in `var: FILE`.

### 2. revert-buffer reloads disk content
- `(find-file-open "${FILE}")` → `expect: buffer_contains` "original line one".
- Insert in-memory text that is NOT saved (e.g. via `(buffer-insert …)` or insert mode) → `expect: buffer_contains` the unsaved edit.
- `(revert-buffer)` → `expect: buffer_contains` "original line one" again (the unsaved edit is gone; disk content won).

### 3. make-backup-file runs on overwrite
- Edit the buffer and `:w` (save).
- Assert on disk (runner shell action / `cat`) that `${FILE}~` exists and holds the **pre-save** seed content. (Backup is created before the overwrite at `save.tlisp:25-26`.)

### 4. Concurrent-modification refusal
- Mutate the file's mtime/content from outside the editor between open and save — e.g. write a different string to the same path via the runner's shell action, which advances mtime past the recorded `saved-modtimes` entry.
- Edit the buffer, then `:w` → assert the status/`*Messages*` contains `"File changed on disk since open — use :w! to force"` and the on-disk file still holds the **external** content (the save was refused; `save.tlisp:23` `return-from`).

### 5. Force path writes through the gate
- Immediately `:w!` (`(save-buffer nil t)` / `:w!` keys) → assert the on-disk file now holds the **buffer** content (the `force` arg short-circuits the gate at `save.tlisp:21`).

### 6. no-associated-file bail (regression guard for BUG-58 class)
- On a fresh `*scratch*` buffer with no filename, `(revert-buffer)` → assert message `"Buffer has no associated file"` (does NOT crash / does NOT silently do nothing). This pins the `buffers.tlisp:63-64` guard.

### 7. Wire + run
- Run `bun run test:tmax-use`; confirm `eval-37` is discovered and green. If a step fails, capture the failure as `BUG-##` and reference it from this spec (do NOT edit editor source under this chore).

## Test Plan

- **Primary**: the `eval-37` playbook itself, run via `bun run test:tmax-use` (real daemon auto-start + TUI client + eval RPC). This is the deliverable.
- **Key assertions** (each ties to a Completion Criterion above):
  - revert: buffer reflects disk, not the unsaved in-memory edit.
  - concurrent-modification: `:w` refused with the documented message; file unchanged on disk.
  - force: `:w!` overwrites; file holds buffer content.
  - backup: `${FILE}~` exists and holds pre-save content.
  - no-filename: `(revert-buffer)` on `*scratch*` produces the `"Buffer has no associated file"` message (regression guard for the BUG-58 association-loss class).
- **Unit/integration coverage**: the existing unit tests for `save-buffer` and `make-backup-file` are NOT modified by this chore (test-only). The chore's value is the real-disk e2e layer the unit tests cannot provide (they mock the filesystem).
- **Defect handling**: if any playbook step reveals a defect (the most likely candidate, given history, is the mtime format/comparison in the concurrent-modification gate), file it as `BUG-##`, mark the step `xfail`/skip with a cross-reference, and leave the rest of the suite green. Do not paper over a real defect to make the playbook green.

## M-x Discoverability

This is a TEST-ONLY chore — it adds no new T-Lisp functions or key bindings, so it does not change M-x completion. The commands it exercises (`revert-buffer`, `save-buffer`, `quick-save`, `save-file`) already carry docstrings (`save.tlisp:8-9`, `buffers.tlisp:60`) and/or bindings (`SPC x s` → `quick-save` at `normal.tlisp:249`), so they already appear in M-x per `command-detail-interactive-p` in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19` (a command is M-x-visible IFF it has a docstring OR a binding). No discoverability action required.
