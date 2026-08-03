# Chore: e2e coverage for undo/redo and the undo-tree API (eval-41)

## Goals

- Lock the linear undo/redo path (`u`, `C-r` → `(undo)` / `(redo)`) and the
  branching `undo-tree-*` family behind a black-box e2e playbook so regressions
  in edit-history navigation surface before merge.
- Cover every public `undo-tree-*` command that has no e2e test today:
  `undo-tree-undo`, `undo-tree-redo`, `undo-tree-goto`,
  `undo-tree-branches`, plus the supporting `undo-tree-push` / `undo-tree-reset`
  / `undo-tree-current` / `undo-tree-nodes` primitives that the navigation
  commands compose.
- Drive the commands through the real `--eval` socket (same harness as
  eval-01..eval-21) rather than the TUI keystroke path, sidestepping the known
  daemon crash on raw key dispatch (see eval-18's rationale) and asserting on
  observable buffer text + history counts.

## Completion Criteria (Definition of Done)

- [ ] Playbook `tmax-use/playbooks/eval-41-undo-tree.yaml` exists and passes
  green via `bun run test:tmax-use` (or the targeted
  `bun tmax-use ./tmax-use/playbooks/eval-41-undo-tree.yaml`), with a fresh
  daemon per playbook (runner default) — eval-41.
- [ ] eval-41 asserts the linear `u`/`C-r` round-trip via `(undo)` / `(redo)`:
      insert "A" → `(buffer-text)` contains "A" → `(undo)` → buffer no longer
      contains "A" and `(undo)` again returns the `"Already at oldest change"`
      status → `(redo)` → "A" is back → `(redo)` again returns
      `"Already at newest change"` — eval-41.
- [ ] eval-41 asserts branch clearing: after `undo` then a *new* insert "B",
      `(undo-history-count)` no longer admits redo of the old "A" branch (a
      second `(redo)` reaches "Already at newest change", not "A") — eval-41.
- [ ] eval-41 drives the `undo-tree-*` family directly:
      `(undo-tree-reset)` → `(undo-tree-nodes)` reports `0` → two
      `(undo-tree-push ...)` commits grow the node count to `2` and
      `(undo-tree-current)` tracks the pushed id → `(undo-tree-undo)` steps the
      current id back to the parent → `(undo-tree-redo)` returns to the leaf →
      `(undo-tree-goto <root-id>)` jumps to the root and the buffer reflects it
      — eval-41.
- [ ] eval-41 asserts branching: from the root node,
      `(undo-tree-branches <root-id>)` lists the child id(s); after undoing to
      the root and pushing a *second* distinct child, the branches list grows
      and `undo-tree-goto` to the first child restores that branch's buffer
      text — eval-41.
- [ ] Any defect found while drafting the playbook (e.g. a navigation command
      returning the wrong node, or `(undo-tree-branches)` not reflecting a new
      sibling) is filed as `BUG-##` and referenced by number in the
      "Test Plan" / "Notes" of this spec, with the playbook's relevant step
      marked `xfail`-style (skipped with a comment) until the bug is fixed.

## Description

The alpha-readiness audit ([alpha-audit-2026-08-01 memory](../../../.claude/projects/-Users-mekael-Documents-programming-typescript-tmax/memory/alpha-audit-2026-08-01.md))
filed a cluster of "no e2e test" chores against fully-shipped editor commands.
The undo/redo surface is the most user-visible of these: `u` (undo) and `C-r`
(redo) are bound in `src/tlisp/core/bindings/normal.tlisp:186-187`, and the
branching `undo-tree-*` API (`undo-tree-undo`, `undo-tree-redo`,
`undo-tree-goto`, `undo-tree-branches`, plus push/current/nodes/reset/structure)
is implemented in `src/editor/api/undo-tree.ts`. Both are exercised by the unit
suite (`test/unit/undo*`) but have **no black-box e2e playbook** in
`tmax-use/playbooks/` — the eval-NN harness stops at eval-21.

This chore closes that gap with one new playbook, `eval-41`, that drives the
commands through the structured `--eval` JSON-RPC path (no tmux keystrokes),
asserting on `(buffer-text)`, `(undo-history-count)`, status messages, and the
`undo-tree-*` introspection primitives. No production code changes; this is a
test-only chore. If a command misbehaves under e2e, the playbook step is
commented out with a `BUG-##` cross-reference rather than masked.

## User Story

As a **tmax maintainer preparing for alpha**,
I want **the undo/redo and undo-tree API covered by an e2e playbook that runs
in CI alongside eval-01..eval-21**,
So that **a regression in edit-history navigation (wrong node restored, redo
branch not cleared, tree navigation off-by-one) fails the suite instead of
shipping silently.**

## Problem Statement

The 2026-08-01 alpha audit catalogued editor commands that ship with unit tests
but **no end-to-end coverage**. The undo surface is on that list:

- `(undo)` / `(redo)` (`src/editor/api/undo-redo-ops.ts:340,366`) and the
  `undo-tree-*` family (`src/editor/api/undo-tree.ts:411,429,447,515`) are
  unit-tested but never driven through the daemon's `--eval` socket in the e2e
  harness.
- The branching behaviour — undo, then a *new* edit, then `undo-tree-branches`
  reporting the sibling — is exactly the kind of stateful logic that unit tests
  miss but a black-box playbook catches, and it currently has zero e2e guard.
- Without this playbook, a refactor of `UndoRedoDomainState`
  (`undo-redo-ops.ts:53`) or the tree's `pushToTree`/`gotoNode` helpers
  (`undo-tree.ts:96,263`) could silently break branch navigation and only be
  caught by a user.

## Solution Statement

Write one tmax-use playbook (`tmax-use/playbooks/eval-41-undo-tree.yaml`) and
wire it into the runner. The tmax-use CLI auto-discovers every
`tmax-use/playbooks/*.yaml` (`tmax-use/test/cli.ts:146,176`), so "wiring" is
purely placing the file — no TS harness change, no manual registration. The
playbook uses the established eval pattern (one `setup_file`, a sequence of
`(eval ...)` steps with `expect:` blocks asserting on `buffer_contains` /
`result_contains` / `mode`), matching eval-05/eval-18 exactly.

## Relevant Files

Read before/while writing the playbook (do not edit these — test-only chore):

- **`src/editor/api/undo-redo-ops.ts`** — the linear undo/redo implementation.
  `(undo)` at line 340; `(redo)` at line 366; the `"Already at oldest change"`
  status at lines 186,213; `"Already at newest change"` at line 248.
  `undo-history-count` at line 481. `UndoRedoDomainState` (the per-editor state
  group, CHORE-44 Change 1) at line 53. The playbook's linear section targets
  these.
- **`src/editor/api/undo-tree.ts`** — the branching tree. `(undo-tree-push)`
  at line 359 (returns the new node id); `(undo-tree-undo)` at 411;
  `(undo-tree-redo)` at 429; `(undo-tree-goto)` at 447; `(undo-tree-branches)`
  at 515 (returns a list of child node ids); `(undo-tree-current)` at 496
  (returns -1 at the root/initial state); `(undo-tree-nodes)` at 544;
  `(undo-tree-reset)` at 562. `pushToTree` (line 96) appends the new node to
  its parent's `children[]`, which is what `undo-tree-branches` reads — the
  branching assertion depends on this.
- **`src/tlisp/core/bindings/normal.tlisp:186-187`** — `(key-bind "u" "(undo)"`
  and `(key-bind "C-r" "(redo)")`. Cited for context; the playbook calls the
  functions directly via `--eval`, not the keys, to avoid the daemon
  keystroke-dispatch crash noted in eval-18.
- **`tmax-use/playbooks/eval-18-macro-recording.yaml`** — the template pattern
  for an eval-API-only playbook (`setup_file`, `eval` steps, `result_contains`
  expectations). Mirror this structure.
- **`tmax-use/playbooks/eval-05-multi-buffer.yaml`** — second template
  reference for `setup_file` + multiple `eval` assertions.
- **`tmax-use/test/cli.ts:146`** — confirms `./tmax-use/playbooks` is a default
  discovery pattern, so the new YAML is picked up with no registration edit.
- **`tmax-use/test/playbook.ts:65`** — the supported `setup_file` action shape
  the playbook `setup:` block must match.

### New Files

- **`tmax-use/playbooks/eval-41-undo-tree.yaml`** — the playbook (the only
  artifact this chore produces).

## Implementation Plan

1. **Read the two API files** (`undo-redo-ops.ts`, `undo-tree.ts`) and confirm
   the exact return strings (`"Already at oldest change"`,
   `"Already at newest change"`) and the `(undo-tree-current)` sentinel (`-1`
   at root) so assertions match the implementation.
2. **Author `tmax-use/playbooks/eval-41-undo-tree.yaml`** with this shape:
   - `setup_file` creating a one-line scratch file (so `find-file` has a real
     buffer, matching eval-05/eval-18).
   - **Linear section:** `find-file` → `buffer-insert "A"` → assert text
     contains "A" → `(undo)` → assert text no longer contains "A" → `(undo)`
     → assert `result_contains: "Already at oldest change"` → `(redo)` →
     assert "A" is back → `(redo)` → assert `"Already at newest change"`.
   - **Branch-clearing section:** `(undo)` to drop "A" → `buffer-insert "B"`
     → `(redo)` → assert `"Already at newest change"` (the "A" branch was
     truncated, not re-entered).
   - **Tree section:** `(undo-tree-reset)` → `(undo-tree-nodes)` → assert
     `0` → two `(undo-tree-push "edit1" <buf> ...)` / `"edit2"` →
     `(undo-tree-nodes)` → assert `2` → capture the leaf id via
     `(undo-tree-current)` → `(undo-tree-undo)` → assert current stepped back
     → `(undo-tree-redo)` → assert current is the leaf again →
     `(undo-tree-goto <root>)` → assert current is root.
   - **Branching section:** from the root, `(undo-tree-branches <root>)` →
     assert it lists the first child id → undo to root → push a second distinct
     child → `(undo-tree-branches <root>)` now lists two →
     `(undo-tree-goto <first-child>)` restores that branch's buffer.
3. **Run the playbook** via `bun tmax-use ./tmax-use/playbooks/eval-41-undo-tree.yaml`
   (or the full `bun run test:tmax-use`).
4. **If a step fails on a real defect** (not a typo in the assertion), file a
   `BUG-##`, mark that step commented-out with the bug id, and continue so the
   rest of the playbook lands green. Record the bug id in this spec's Notes.
5. **Verify the full suite** still passes (`bun run test:tmax-use`) — the new
   playbook must not destabilise the existing eval-01..eval-21 set (the runner
   gives each playbook a fresh isolated daemon, `runner.ts:470`, so concurrent
   daemon load is the only risk; re-run with `--dots` if BUG-16 inactivity-timer
   noise appears, per project memory).

## Test Plan

- **Primary:** the new playbook `eval-41` is the test. It runs under the same
  `bun run test:tmax-use` target as eval-01..eval-21 (auto-discovered). Key
  assertions:
  - Linear undo/redo round-trip restores buffer text exactly.
  - `"Already at oldest change"` / `"Already at newest change"` boundary
    strings are returned (not silently nil) — guards against the status path
    regressing.
  - Branch clearing: a new edit after undo truncates the redo future.
  - `undo-tree-nodes` / `undo-tree-current` / `undo-tree-branches` report the
    expected counts and ids after each navigation — the branching guard.
- **Unit coverage (already present, unchanged):** `test/unit/undo*.test.ts`
  covers the implementation directly; this chore adds the *black-box* layer.
- **Defect handling:** if any assertion reveals a bug, the failing step is
  commented out with a `# BUG-##` note (do NOT delete it — it documents the
  gap) and the BUG id is referenced here:
  - _(none yet — populate when the playbook is authored)._

## M-x Discoverability

This is a **test-only chore**: no new T-Lisp functions or keybindings are
introduced, so no M-x discoverability change is needed. The existing commands
(`undo`, `redo`, `undo-tree-*`) already follow the rule that a function appears
in M-x completion IFF it has a docstring OR a keybinding (per
`command-detail-interactive-p` in
`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`): `undo`/`redo`
are keybound (`normal.tlisp:186-187`), and the `undo-tree-*` family is an
internal primitive API (invoked programmatically, not via M-x). No action
required.

## Notes

- The playbook calls functions by `(eval ...)` rather than dispatching `u` /
  `C-r` keystrokes through tmux, deliberately. eval-18 documented that raw key
  dispatch via the daemon crashes; the eval-API path avoids that and tests the
  command logic directly. The keybinding-to-function wiring is already covered
  by the bindings tests.
- `(undo-tree-current)` returns `-1` when at the initial (pre-edit) state
  (`undo-tree.ts:314-316`); assertions on the root id must account for this,
  not assume `0`.
- `undo-tree-push` returns the *new node id* (`undo-tree.ts:404`), so the
  playbook can capture a specific child id for the `undo-tree-goto` /
  `undo-tree-branches` assertions without hardcoding ids.
- Respect SPEC-067: this chore adds no keybindings, so the C-x constraint does
  not apply, but the existing `u` / `C-r` bindings are the correct (non-C-x)
  bindings and are referenced, not changed.
