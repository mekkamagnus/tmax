# Chore: e2e coverage for buffer-state predicates and read-only mode (eval-42)

## Goals

- Lock the buffer-state query/mutation API — `buffer-modified-p`,
  `set-buffer-modified-p`, `buffer-set-read-only` — behind a black-box e2e
  playbook so a regression in the modified-flag or read-only enforcement
  surfaces before merge.
- Assert the full state lifecycle through the real `--eval` socket: clean →
  edited (flag flips true) → explicitly cleared → toggled read-only (edits
  refused) → read-only cleared (edits succeed again).
- Cover the Emacs-convention nil-as-false path on `set-buffer-modified-p`
  (used by `save-buffer`) and the multi-spelling truthiness on
  `buffer-set-read-only` (`t`, `nil`, boolean, non-zero number).

## Completion Criteria (Definition of Done)

- [ ] Playbook `tmax-use/playbooks/eval-42-buffer-state.yaml` exists and passes
  green via `bun run test:tmax-use` (or targeted
  `bun tmax-use ./tmax-use/playbooks/eval-42-buffer-state.yaml`) with a fresh
  daemon per playbook — eval-42.
- [ ] eval-42 asserts the modified flag tracks edits: after `find-file` a clean
      buffer reports `(buffer-modified-p)` → `false`; after `buffer-insert`
      it reports `true`; after `(set-buffer-modified-p nil)` it reports `false`
      again — eval-42.
- [ ] eval-42 asserts `set-buffer-modified-p` accepts both a literal `false`
      and Emacs `nil` (the path `save-buffer` relies on, per the in-source
      comment at `buffer-ops.ts:559-567`) and that a literal `true` sets the
      flag — eval-42.
- [ ] eval-42 asserts read-only enforcement: `(buffer-set-read-only t)` makes
      `buffer-insert` refuse (the step's `eval` result carries the
      `ReadOnly` error / the buffer text is unchanged), then
      `(buffer-set-read-only nil)` re-enables inserts and the text lands —
      eval-42.
- [ ] eval-42 asserts the read-only truthiness spellings accepted by
      `buffer-set-read-only` (`buffer-ops.ts:772-783`): `t` symbol → true,
      `nil` → false, literal `true`/`false` booleans, and a non-zero number →
      true (each round-tripped through a follow-up insert attempt) — eval-42.
- [ ] Any defect found while drafting the playbook (e.g. the flag not flipping
      after a delete, or read-only leaking across a `buffer-switch) is filed as
      `BUG-##` and referenced by number in the "Test Plan" / "Notes" of this
      spec, with the playbook's relevant step commented out (with a `# BUG-##`
      note) until the bug is fixed.

## Description

The alpha-readiness audit catalogued fully-shipped editor commands that have
unit tests but **no end-to-end playbook**. The buffer-state surface —
`buffer-modified-p`, `set-buffer-modified-p`, `buffer-set-read-only` — is on
that list. These three functions are the backbone of the unsaved-changes
indicator, the `kill-buffer`/`save-some-buffers` save prompts, and the
read-only/`view-mode` enforcement. They are implemented in
`src/editor/api/buffer-ops.ts` (lines 540, 553, 766) and unit-tested, but the
e2e harness (eval-01..eval-21) never exercises them as a state machine.

This chore adds one playbook, `eval-42`, that drives the three functions
through the structured `--eval` JSON-RPC path and asserts on the observable
flag value, the buffer text after refused/accepted edits, and the error shape
returned when a read-only buffer is mutated. No production code changes; this
is a test-only chore.

## User Story

As a **tmax maintainer preparing for alpha**,
I want **the modified-flag and read-only enforcement covered by an e2e playbook
that runs in CI alongside eval-01..eval-21**,
So that **a regression in unsaved-changes tracking or read-only guarding — both
of which feed user-facing save prompts and data-loss prevention — fails the
suite instead of shipping silently.**

## Problem Statement

The 2026-08-01 alpha audit filed a "no e2e test" chore against the buffer-state
commands. Today:

- `buffer-modified-p` / `set-buffer-modified-p` (`buffer-ops.ts:540,553`) and
  `buffer-set-read-only` (`buffer-ops.ts:766`) are unit-tested in isolation but
  never driven through the daemon `--eval` socket as a *lifecycle*.
- The interaction is subtle and load-bearing: `save-buffer` calls
  `(set-buffer-modified-p nil)` after writing (the nil-as-false path,
  `buffer-ops.ts:559-567`); `kill-buffer` (SPEC-071) and
  `save-some-buffers` (SPEC-072) both gate their prompts on
  `(buffer-modified-p)`; and `buffer-insert`/`buffer-delete` short-circuit with
  a `ReadOnly` error when the current buffer is in the readonly set
  (`buffer-ops.ts:265,312`).
- A refactor that, say, stops flipping the flag on `buffer-delete`, or makes
  read-only leak across a `buffer-switch`, would pass the unit tests (which
  call the predicate directly) but break the user-visible behaviour. There is
  currently no e2e guard.

## Solution Statement

Write one tmax-use playbook (`tmax-use/playbooks/eval-42-buffer-state.yaml`)
and wire it into the runner. The tmax-use CLI auto-discovers every
`tmax-use/playbooks/*.yaml` (`tmax-use/test/cli.ts:146,176`), so "wiring" is
purely placing the file — no TS harness change, no manual registration. The
playbook uses the established eval pattern (`setup_file`, `(eval ...)` steps
with `expect:` blocks), matching eval-05/eval-18.

For the read-only refusal assertion, the playbook relies on the `--eval` result
carrying the error: a `buffer-insert` against a read-only buffer returns an
`Either.left` with `ReadOnly` variant (`buffer-ops.ts:265`), which the
`--eval` JSON-RPC layer surfaces in the result string. The step asserts that
result string contains the error marker (and that a follow-up
`(buffer-text)` confirms the text is unchanged).

## Relevant Files

Read before/while writing the playbook (do not edit these — test-only chore):

- **`src/editor/api/buffer-ops.ts`** — the implementation under test.
  - `buffer-modified-p` (line 540): reads `bufferModified` off the model;
    returns `false` when no setter is wired.
  - `set-buffer-modified-p` (line 553): accepts `nil` as false (Emacs
    convention, line 562) **and** a boolean; the load-bearing path for
    `save-buffer`.
  - `buffer-set-read-only` (line 766): accepts `t`/`nil`/boolean/non-zero
    number (lines 772-783); adds/removes the current buffer's name in the
    `readonlyBuffers` set.
  - `buffer-insert` (line 259): the read-only guard at line 265 returns
    `Either.left(createBufferError('ReadOnly', 'Buffer is read-only'))` — the
    string the playbook's refusal assertion matches.
  - `buffer-delete` (line 306): same read-only guard at line 312; also flips
    the modified flag at line 351 — relevant to the "delete flips the flag"
    sub-assertion if added.
- **`src/editor/editor.ts`** — where `createBufferOps` is constructed and the
  `readonlyBuffers` `Set<string>` is created/passed. Cited for context only.
- **`tmax-use/playbooks/eval-18-macro-recording.yaml`** and
  **`tmax-use/playbooks/eval-05-multi-buffer.yaml`** — the template patterns
  (`setup_file`, `eval` steps, `result_contains` / `buffer_contains`
  expectations). Mirror this structure.
- **`tmax-use/test/cli.ts:146`** — confirms `./tmax-use/playbooks` is a default
  discovery pattern, so the new YAML is picked up with no registration edit.
- **`tmax-use/test/playbook.ts:65`** — the supported `setup_file` action shape.

### New Files

- **`tmax-use/playbooks/eval-42-buffer-state.yaml`** — the playbook (the only
  artifact this chore produces).

## Implementation Plan

1. **Read `buffer-ops.ts`** and confirm: the exact `ReadOnly` error string
   (`'Buffer is read-only'`, line 265), the nil-as-false acceptance on
   `set-buffer-modified-p` (line 562), and the four truthiness spellings on
   `buffer-set-read-only` (lines 772-783), so assertions match the
   implementation.
2. **Author `tmax-use/playbooks/eval-42-buffer-state.yaml`** with this shape:
   - `setup_file` creating a small scratch file.
   - **Modified-flag section:** `find-file` → `(buffer-modified-p)` → assert
     `false` → `buffer-insert "x"` → `(buffer-modified-p)` → assert `true` →
     `(set-buffer-modified-p nil)` → `(buffer-modified-p)` → assert `false`
     → `(set-buffer-modified-p true)` → assert `true` →
     `(set-buffer-modified-p false)` → assert `false`.
   - **Read-only section:** `(buffer-set-read-only t)` → `buffer-insert "y"`
     → assert result contains `ReadOnly` / `read-only` → `(buffer-text)` →
     assert "y" is NOT present → `(buffer-set-read-only nil)` →
     `buffer-insert "y"` → `(buffer-text)` → assert "y" IS present.
   - **Truthiness section:** cycle `(buffer-set-read-only <spelling>)` for
     `t`, `nil`, `true`, `false`, `1`, `0`, each followed by a probe insert
     asserting refused vs. accepted.
3. **Run the playbook** via
   `bun tmax-use ./tmax-use/playbooks/eval-42-buffer-state.yaml` (or the full
   `bun run test:tmax-use`).
4. **If a step fails on a real defect** (not a typo in the assertion), file a
   `BUG-##`, mark that step commented-out with the bug id, and continue so the
   rest of the playbook lands green. Record the bug id in this spec's Notes.
5. **Verify the full suite** still passes (`bun run test:tmax-use`) — the new
   playbook must not destabilise eval-01..eval-21 (fresh daemon per playbook,
   `runner.ts:470`).

## Test Plan

- **Primary:** the new playbook `eval-42` is the test. It runs under the same
  `bun run test:tmax-use` target as eval-01..eval-21 (auto-discovered). Key
  assertions:
  - The modified flag flips `true` after `buffer-insert` and back to `false`
    after `(set-buffer-modified-p nil)` — guards the save-prompt backbone.
  - `set-buffer-modified-p` accepts both `nil` and `false` (the Emacs path).
  - Read-only refusal: `buffer-insert` returns the `ReadOnly` error and the
    buffer text is unchanged; clearing read-only re-enables inserts.
  - `buffer-set-read-only` honours all four spellings (`t`/`nil`/boolean/
    non-zero number).
- **Unit coverage (already present, unchanged):** `test/unit/buffer*.test.ts`
  covers the predicates directly; this chore adds the *black-box* lifecycle
  layer.
- **Defect handling:** if any assertion reveals a bug, the failing step is
  commented out with a `# BUG-##` note (do NOT delete it) and the BUG id is
  referenced here:
  - _(none yet — populate when the playbook is authored)._

## M-x Discoverability

This is a **test-only chore**: no new T-Lisp functions or keybindings are
introduced, so no M-x discoverability change is needed. The three functions
covered (`buffer-modified-p`, `set-buffer-modified-p`, `buffer-set-read-only`)
are programmatic state primitives, not interactive commands — they are invoked
by other commands (`save-buffer`, `kill-buffer`, etc.), not via M-x. Per the
rule in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19`, they
need not appear in M-x completion, and this chore does not change that. No
action required.

## Notes

- `set-buffer-modified-p`'s nil-as-false acceptance is deliberate and
  load-bearing (in-source comment at `buffer-ops.ts:559-567`, referencing #49 /
  BUG-43): `save-buffer` calls `(set-buffer-modified-p nil)`. The playbook must
  exercise *both* `nil` and `false` so a future tightening (rejecting nil)
  would break `save-buffer` loudly here, not in the field.
- The read-only guard lives on the *current buffer's name* in the
  `readonlyBuffers` set (`buffer-ops.ts:62-67,787-796`); it is per-buffer, not
  global. The playbook's single-buffer flow is sufficient, but a maintainer
  extending it could add a `buffer-switch` step to confirm the flag does not
  leak — out of scope for this chore's minimal viable guard.
- Respect SPEC-067: this chore adds no keybindings, so the C-x constraint does
  not apply.
