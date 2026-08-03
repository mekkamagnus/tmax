# Chore: e2e coverage for dired (directory editor) commands (eval-44)

## Goals

- Lock the dired command surface — `dired`, `dired-open-file`,
  `dired-mark-delete`, `dired-execute-deletions` — behind a black-box e2e
  playbook so a regression in directory listing, entry parsing, mark parsing,
  or batch deletion surfaces before merge.
- Exercise the full mark→delete→refresh lifecycle against a **real, isolated
  temp directory** so `dired-execute-deletions` (which calls `file-remove` and
  touches real disk) is tested safely without ever threatening repo or user
  files.
- Drive the commands through the real `--eval` socket, asserting on the
  `*Dired*` buffer contents (the listing text), the marked-file list, and the
  on-disk aftermath (files actually gone after `dired-execute-deletions`).

## Completion Criteria (Definition of Done)

- [ ] Playbook `tmax-use/playbooks/eval-44-dired.yaml` exists and passes green
      via `bun run test:tmax-use` (or targeted
      `bun tmax-use ./tmax-use/playbooks/eval-44-dired.yaml`) with a fresh
      daemon per playbook — eval-44.
- [ ] eval-44 creates an **isolated temp directory** per run (via a setup step
      that `mkdir`s a unique dir — e.g. `(make-directory "<tmp>/eval-44-<pid>")`
      or a `setup_file`-style fixture that materialises a dir + seed files),
      so `dired-execute-deletions` never operates on repo/user paths — eval-44.
- [ ] eval-44 asserts `dired` populates the `*Dired*` buffer: after
      `(dired "<tmpdir>")`, `(buffer-current)` is `*Dired*` and `(buffer-text)`
      contains the header line (the dir path) and each seeded entry name —
      eval-44.
- [ ] eval-44 asserts `dired-open-file` on a file entry: positioning the cursor
      on a seeded file's line and calling `(dired-open-file)` switches the
      current buffer to that file's buffer with its contents — eval-44.
- [ ] eval-44 asserts the mark/delete lifecycle: navigate to a seeded file's
      line → `(dired-mark-delete)` toggles the `D` prefix on that line and
      `(dired-get-marked)` returns that file → `(dired-execute-deletions)`
      removes it from disk → a follow-up read of the directory (or
      `(file-exists-p ...)`) confirms the file is gone and the refreshed
      listing no longer contains it — eval-44.
- [ ] eval-44 cleans up its temp dir in `cleanup` so no test artifacts leak
      across runs — eval-44.
- [ ] Any defect found while drafting the playbook (e.g. `dired-get-marked`
      mis-parsing the filename, or `dired-execute-deletions` not refreshing) is
      filed as `BUG-##` and referenced by number in the "Test Plan" / "Notes"
      of this spec, with the playbook's relevant step commented out (with a
      `# BUG-##` note) until the bug is fixed.

## Description

The alpha-readiness audit catalogued fully-shipped editor commands that have
unit tests but **no end-to-end playbook**. The dired (directory editor)
surface is on that list. `dired` and its kin are defined in
`src/tlisp/core/commands/dired.tlisp` (composing the raw primitives in
`src/editor/api/dired-ops.ts`: `dired-insert-listing`,
`dired-parse-current-entry`, `dired-is-directory-p`, `dired-toggle-mark`,
`dired-get-marked`, `dired-refresh`). They are unit-tested at the primitive
layer, but the eval-NN harness never drives the composed commands
end-to-end — and crucially never exercises `dired-execute-deletions`, which
calls `(file-remove ...)` (`dired.tlisp:42`) and mutates real disk.

This chore adds one playbook, `eval-44`, that creates a unique temp directory,
seeds it with disposable files, runs the full dired lifecycle (open → enter
file → mark → execute deletions), and asserts on both the `*Dired*` buffer
state and the on-disk aftermath. No production code changes; this is a
test-only chore.

## User Story

As a **tmax maintainer preparing for alpha**,
I want **the dired command surface — especially the destructive
`dired-execute-deletions` — covered by an e2e playbook that runs in CI
alongside eval-01..eval-21 against a throwaway temp dir**,
So that **a regression in directory listing, entry parsing, mark parsing, or
batch file deletion fails the suite instead of silently deleting the wrong file
in a user's directory.**

## Problem Statement

The 2026-08-01 alpha audit filed a "no e2e test" chore against the dired
commands. Today:

- `dired`, `dired-open-file`, `dired-mark-delete`, `dired-execute-deletions`
  (`dired.tlisp:5,16,28,38`) are composed from primitives in `dired-ops.ts`
  that are unit-tested in isolation, but the composed commands are never driven
  through the daemon `--eval` socket.
- The riskiest command, `dired-execute-deletions`, calls `(file-remove (concat
  (buffer-filename) "/" file))` for every marked entry (`dired.tlisp:40-43`) —
  a real, irreversible `unlink`. A bug in `dired-get-marked`'s filename parsing
  (`dired-ops.ts:362-398`, which extracts the last whitespace column and strips
  a trailing `/`) or in the `(buffer-filename)` concat could delete the wrong
  path. There is currently no e2e guard, and a unit test of the primitive
  cannot catch a concat-order bug in the T-Lisp layer.
- dired also has no test that asserts the `*Dired*` buffer is actually
  populated with a parseable listing after `(dired <dir>)`, which is the
  precondition for every other dired command.

## Solution Statement

Write one tmax-use playbook (`tmax-use/playbooks/eval-44-dired.yaml`) and wire
it into the runner. The tmax-use CLI auto-discovers every
`tmax-use/playbooks/*.yaml` (`tmax-use/test/cli.ts:146,176`), so "wiring" is
purely placing the file — no TS harness change, no manual registration.

**Temp-dir safety:** the playbook's `setup` step creates a unique isolated
directory under the system temp location (e.g. via a `setup_file`-style action
that materialises a dir, or an `(eval "(make-directory ...)")` first step using
a path prefixed with the OS temp dir + a per-run discriminator like the daemon
PID or a timestamp). All seeded files live inside that dir; `dired` is invoked
on that dir; `dired-execute-deletions` only ever sees files inside it. The
`cleanup` step removes the whole temp dir. **No repo path, no user home path,
no `~/.config/tmax` path is ever passed to `dired` or `file-remove`.**

The playbook asserts on the `*Dired*` buffer text (the listing), the
`dired-get-marked` return value, and — for the delete step — re-reads the
directory (or uses `(file-exists-p ...)`) to confirm the file is actually gone
on disk, not just hidden from the listing.

## Relevant Files

Read before/while writing the playbook (do not edit these — test-only chore):

- **`src/tlisp/core/commands/dired.tlisp`** — the composed commands under test.
  - `dired` (line 5): creates `*Dired*`, switches to it, sets the buffer
    filename to the dir, inserts the listing, clears the modified flag.
  - `dired-open-file` (line 16): parses the current entry; if a directory,
    recurses into `dired`; else `(find-file (concat (buffer-filename) "/"
    entry))`.
  - `dired-mark-delete` (line 28): `(dired-toggle-mark "D")` then
    `(line-next 1)`.
  - `dired-execute-deletions` (line 38): `(dired-get-marked)` →
    `(dolist (file marked) (file-remove (concat (buffer-filename) "/" file)))`
    → `(dired-refresh)` → `(message ...)`. **This is the destructive step the
    temp-dir requirement protects against.**
- **`src/editor/api/dired-ops.ts`** — the primitives the commands compose.
  - `dired-insert-listing` (line 147): sets `s.path`, clears marks, formats the
    listing (header = dir path, one line per entry), replaces the current
    buffer content.
  - `dired-parse-current-entry` (line 235): reads the cursor line, splits on
    whitespace, takes the last column, strips a trailing `/` — the filename
    `dired-open-file` and `dired-get-marked` rely on.
  - `dired-toggle-mark` (line 285): adds/removes the line index in
    `s.markedForDelete` and rewrites the line's prefix to `D`/space.
  - `dired-get-marked` (line 362): scans every line starting with `D`,
    extracts the filename the same way as `dired-parse-current-entry`.
  - `dired-refresh` (line 401): re-reads `s.path` from disk and rebuilds the
    listing.
- **`src/editor/api/file-ops.ts:313`** — `(file-remove ...)` (the `unlink`
  primitive `dired-execute-deletions` calls). Cited for context.
- **`tmax-use/playbooks/eval-05-multi-buffer.yaml`** — the template pattern
  for `setup_file` fixtures. Mirror this structure (the dired playbook adds a
  directory-creation setup step on top).
- **`tmax-use/test/cli.ts:146`** — confirms `./tmax-use/playbooks` is a default
  discovery pattern, so the new YAML is auto-discovered.
- **`tmax-use/test/playbook.ts:65`** — the supported `setup_file` action shape.
  (If `setup_file` only creates files, not dirs, the playbook's first eval step
  must `(make-directory ...)` the temp dir instead — confirm before relying on
  either.)

### New Files

- **`tmax-use/playbooks/eval-44-dired.yaml`** — the playbook (the only artifact
  this chore produces).

## Implementation Plan

1. **Read `dired.tlisp` and `dired-ops.ts`** and confirm: the listing line
   format (`"<mark>  <perms>  <size>  <date>  <name>[/]"`, `dired-ops.ts:76`)
   so the entry-name assertions match; that `dired-get-marked` parses the last
   whitespace column (`dired-ops.ts:388-392`); and that
   `dired-execute-deletions` concats `(buffer-filename) "/" file`
   (`dired.tlisp:42`) — so the temp-dir path passed to `dired` becomes the
   `buffer-filename` and the concat resolves inside the temp dir.
2. **Confirm the temp-dir creation mechanism:** check whether the playbook
   `setup_file` action can create a directory (read `playbook.ts`); if not,
   the first eval step is `(make-directory "<tmp>/eval-44-<discriminator>")`.
   Pick the discriminator (PID via `(getpid)` if available, else a fixed
   `eval-44-<timestamp>`), and capture the dir path in a var for later steps.
3. **Seed the temp dir** with 2-3 disposable files via `(eval "(write-file ...)")`
   or a `setup_file` action that writes into the temp dir; names should be
   distinct and unambiguous when parsed (e.g. `alpha.txt`, `beta.txt`,
   `gamma.dat`).
4. **Author `tmax-use/playbooks/eval-44-dired.yaml`** with this shape:
   - **Setup:** create temp dir + seed files (per steps 2-3).
   - **Listing section:** `(dired "<tmpdir>")` → `(buffer-current)` → assert
     `*Dired*` → `(buffer-text)` → assert contains the dir header and each
     seeded filename.
   - **Open-file section:** navigate the cursor to a seeded file's line (via
     cursor-move / line search) → `(dired-open-file)` → `(buffer-current)` →
     assert it is the opened file's buffer → `(buffer-text)` → assert the
     file's content. Then return to `*Dired*` (`buffer-switch`).
   - **Mark/delete section:** navigate to a target file's line →
     `(dired-mark-delete)` → `(dired-get-marked)` → assert the target file is
     in the list → `(dired-execute-deletions)` → `(message)` / status asserts
     "Deleted N files" → `(file-exists-p "<tmpdir>/<target>")` → assert false
     → `(dired-refresh)` (already called by execute-deletions, but re-list to
       confirm) → `(buffer-text)` → assert the target name is gone.
   - **Cleanup:** remove the temp dir (`(eval "(delete-directory ... t)")` or
     the playbook `cleanup: true` plus an explicit recursive remove).
5. **Run the playbook** via
   `bun tmax-use ./tmax-use/playbooks/eval-44-dired.yaml` (or the full
   `bun run test:tmax-use`).
6. **If a step fails on a real defect** (e.g. `dired-get-marked` returning the
   wrong filename because of the date column, or `dired-execute-deletions` not
   refreshing), file a `BUG-##`, mark that step commented-out with the bug id,
   and continue so the rest lands green. **If the defect is in the destructive
   path, leave that step commented-out until the bug is fixed** — do not risk
   deleting outside the temp dir. Record the bug id in this spec's Notes.
7. **Verify the full suite** still passes (`bun run test:tmax-use`) — the new
   playbook must not destabilise eval-01..eval-21 (fresh daemon per playbook,
   `runner.ts:470`).

## Test Plan

- **Primary:** the new playbook `eval-44` is the test. It runs under the same
  `bun run test:tmax-use` target as eval-01..eval-21 (auto-discovered). Key
  assertions:
  - `(dired <dir>)` populates `*Dired*` with a parseable listing (header + each
    entry) — the precondition for every other dired command.
  - `dired-open-file` on a file entry opens that file's buffer.
  - The mark→delete→refresh lifecycle: `dired-mark-delete` marks the line and
    `dired-get-marked` reports it; `dired-execute-deletions` actually unlinks
    the file (confirmed by `file-exists-p`) and the refreshed listing drops it.
- **Safety guard (load-bearing):** the playbook operates exclusively inside a
  per-run temp dir; `cleanup` removes it. This is an acceptance criterion, not
  a nicety — `dired-execute-deletions` is irreversible.
- **Unit coverage (already present, unchanged):** `test/unit/dired*.test.ts`
  covers the primitives; this chore adds the *black-box* composed-command
  layer, including the destructive path the unit tests cannot safely exercise.
- **Defect handling:** if any assertion reveals a bug, the failing step is
  commented out with a `# BUG-##` note (do NOT delete it) and the BUG id is
  referenced here:
  - _(none yet — populate when the playbook is authored)._

## M-x Discoverability

This is a **test-only chore**: no new T-Lisp functions or keybindings are
introduced, so no M-x discoverability change is needed. The dired commands
covered (`dired`, `dired-open-file`, `dired-mark-delete`,
`dired-execute-deletions`) already have docstrings in
`src/tlisp/core/commands/dired.tlisp` (lines 6,17,29,39), so per the rule in
`src/tlisp/core/commands/execute-extended-command.tlisp:15-19` they already
appear in M-x completion. This chore does not change their docstring or
binding status. No action required.

## Notes

- **The temp-dir constraint is the single most important rule of this chore.**
  `dired-execute-deletions` calls `file-remove` on
  `(concat (buffer-filename) "/" file)` for each marked entry (`dired.tlisp:42`).
  If `buffer-filename` were ever a repo or home path, a mark-parse bug could
  delete user files. The playbook MUST construct a unique disposable dir, pass
  only that to `dired`, and tear it down in cleanup. Never hardcode a repo
  path or `~`.
- `dired-get-marked` and `dired-parse-current-entry` both extract the filename
  as the **last whitespace-separated column** of the listing line
  (`dired-ops.ts:260,388`), stripping a trailing `/` for directories. A
  filename with spaces would break this — the playbook's seed filenames should
  be single-token (no spaces) to test the happy path; a spaced-filename edge
  case is out of scope but worth noting as a future BUG if observed.
- The listing line format prefixes the mark (`D` or space) and the permissions
  string (`dired-ops.ts:70-76`); the playbook's "navigate to the file's line"
  step should search for the filename in the line text, not assume a fixed
  line number, since directory ordering is filesystem-dependent.
- `dired-execute-deletions` already calls `(dired-refresh)` internally
  (`dired.tlisp:43`), so an explicit refresh after it is belt-and-braces; keep
  it to assert the post-delete listing explicitly.
- Respect SPEC-067: this chore adds no keybindings, so the C-x constraint does
  not apply. (Dired's own keybindings, if any, are pre-existing and unchanged.)
