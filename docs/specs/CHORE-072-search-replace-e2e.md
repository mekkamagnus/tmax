# Chore: End-to-end coverage for query-replace and isearch-backward

## Goals

- Add a black-box e2e playbook (`eval-39`) that drives the **real daemon/client** to exercise the search/replace commands that today have **no** e2e test (or only partial coverage): `query-replace` with its `replace-yes`/`replace-no`/`replace-all`/`replace-quit` sub-commands, and `isearch-backward` (eval-20 covers forward isearch only).
- Pin the observable buffer + minibuffer behavior those commands promise, so a regression in the replace state machine or backward search is caught at the e2e layer.
- Discover and file any defect the playbook reveals as a separate `BUG-##` spec referenced here (this chore ships tests only — no implementation).

## Completion Criteria (Definition of Done)

- [ ] Playbook `tmax-use/playbooks/eval-39-search-replace.yaml` exists and follows the runner schema (the `setup`/`steps`/`expect`/`cleanup` shape used by `eval-20-vim-search.yaml`).
- [ ] The playbook drives `(query-replace "old" "new")` over a fixture with multiple matches, then `replace-yes` on the first and `replace-no` on the second, and asserts the buffer holds the replaced first match and the un-replaced second match — `eval-39`.
- [ ] The playbook covers `replace-all`: a fresh `query-replace` followed by `replace-all` replaces every remaining match and the buffer reflects the full count — `eval-39`.
- [ ] The playbook covers `replace-quit`: mid-session `replace-quit` exits to normal mode and leaves remaining matches untouched (`replace.tlisp:28-31`) — `eval-39`.
- [ ] The playbook covers `isearch-backward` (`?` binding, `isearch.tlisp:35`): starting the backward search and updating the pattern lands the cursor on a match that occurs **before** the starting position (forward search lands after; eval-20 covers forward only) — `eval-39`.
- [ ] The playbook covers the no-matches path: `(query-replace "zzz" "x")` produces the `"No matches found"` message and does not enter the replace state (`replace.tlisp:8-10`) — `eval-39`.
- [ ] The playbook is wired into the runner so `bun run test:tmax-use` discovers and executes `eval-39`; any defect the playbook reveals is filed as a separate `BUG-##` and referenced by number here (none pre-known).
- [ ] `bun run test:tmax-use` is green overall for `eval-39` (or, if a defect is found, the playbook is marked `xfail`/skipped with the `BUG-##` cross-reference and the rest of the suite is unaffected).

## Description

`query-replace` is a multi-step interactive state machine (`replace.tlisp` driving `replace-ops.ts`'s `replaceState`), and `isearch-backward` is the reverse-direction twin of the forward search eval-20 already covers. Today neither has end-to-end coverage: eval-20 proves forward incremental search and `n`/`N`, but says nothing about `query-replace`'s yes/no/all/quit cycle or about backward search landing the cursor on a prior match. This chore adds a playbook that drives the full replace cycle through the daemon and asserts on the resulting buffer text, plus a backward-search sequence that distinguishes backward landing from forward.

## User Story

**As a** tmax maintainer
**I want** an e2e playbook that proves interactive find/replace and backward search actually mutate the buffer and land the cursor correctly
**So that** a regression in the replace state machine (match-offset adjustment, count, exit) or in backward search direction is caught before it ships.

## Problem Statement

The 2026-08-01 alpha audit found that `query-replace` and `isearch-backward` have **no** end-to-end test. They are covered by unit tests that drive `createReplaceOps` directly. The unit layer cannot catch:

- The composition gap between the T-Lisp `query-replace`/`replace-yes`/`replace-no`/`replace-all`/`replace-quit` wrappers (`replace.tlisp`) and the `replaceState` primitives (`replace-ops.ts`) — e.g. a wiring regression where `replace-yes` calls the wrong primitive, or `replace-quit` does not actually exit to normal mode (`replace.tlisp:30`).
- The match-offset adjustment after a replace (`replace-ops.ts:410-419`: subsequent same-line matches shift by `lengthDiff`) — only observable against a real buffer with multiple matches on one line.
- The `isearch-backward` direction: eval-20's `n`/`N` and forward isearch all land the cursor at-or-after the start; backward search must land **before**. The unit tests for `search-incremental-start "backward"` do not prove the cursor actually moves backward through a real buffer.

This chore adds the missing e2e layer.

## Solution Statement

Write e2e playbook `eval-39` under `tmax-use/playbooks/` and wire it into the runner. The playbook sets up a fixture with multiple, unambiguous matches (avoiding the "theta"-style substring collisions eval-20 warns about), drives `query-replace` through the eval API (the yes/no/all/quit sub-commands are un-bound primitives, so they are driven via `(replace-yes)` etc., exactly as eval-20 drives the search API), and asserts on the resulting buffer text via `buffer_contains`. A separate sequence drives `isearch-backward` via the `?` binding / the API and asserts the cursor lands on a match before the starting line. No editor source changes — this is a TEST-ONLY chore. Any defect surfaced is filed as a separate `BUG-##`.

## Relevant Files

The playbook (to be created by the test author) and the source it asserts against:

- **`tmax-use/playbooks/eval-39-search-replace.yaml`** — the new playbook (this chore's deliverable). Follow the `setup_file` / `steps` / `expect` / `cleanup` schema of `tmax-use/playbooks/eval-20-vim-search.yaml`.
- **`tmax-use/test/runner.ts`** — playbook discovery (`runPlaybook` / discovery around line 736); confirm `eval-39` is picked up by the same glob the other eval-NN files use.
- **`src/tlisp/core/commands/replace.tlisp`** — the T-Lisp wrappers under test:
  - `query-replace` (5-12): finds matches, bails with `"No matches found"` if none (8-10), else inits state and prompts.
  - `replace-yes` (14-17): apply current + advance; messages `"Replaced"`.
  - `replace-no` (19-21): skip current.
  - `replace-all` (23-26): apply all remaining; messages `"All replaced"`.
  - `replace-quit` (28-31): exit + `(editor-set-mode "normal")`.
- **`src/editor/api/replace-ops.ts`** — the state-machine primitives the wrappers compose:
  - `replace-find-matches` (90-196): literal-vs-regex, optional START/END line bounds.
  - `replace-state-init` (282-358): stores find/replace/matches, resets index+count, sets `active=true`.
  - `replace-apply-current` (367-425): the per-match replace + the same-line offset adjustment (410-419).
  - `replace-skip` (433-452), `replace-apply-all` (460-485), `replace-exit` (493-509).
- **`src/tlisp/core/commands/isearch.tlisp`** — `isearch-backward` (10-13): `(search-incremental-start "backward")` + the `"I-search backward: "` minibuffer prompt; bound to `?` (35).
- **`src/editor/api/search-ops.ts`** — the `search-incremental-start/update/finish` primitives `isearch-backward` drives (direction `"backward"`); read alongside to design the backward-landing assertion.

## Implementation Plan

### 1. Fixture setup (unambiguous matches)
- `setup_file` a fixture (e.g. `eval-39-replace.txt`) with several lines, each containing a distinct, non-overlapping occurrence of the search term — e.g.:
  ```
  ALPHA first line
  middle ALPHA here
  ALPHA again at start
  unrelated tail
  ```
  (Use a term like `ALPHA` that is not a substring of any other word, per eval-20's collision warning.) Capture path in `var: FILE`.

### 2. query-replace yes/no cycle
- `(find-file-open "${FILE}")`.
- Place cursor at top (so all matches are ahead).
- `(query-replace "ALPHA" "OMEGA")` → state active, prompt shown.
- `(replace-yes)` → first `ALPHA` → `OMEGA`. Assert `buffer_contains` `OMEGA first line`.
- `(replace-no)` → second match skipped. Assert that line still contains `ALPHA` (`middle ALPHA here`).
- `(replace-quit)` → exits to normal mode; third match untouched. Assert `editor-mode` is `normal` and the third line still has `ALPHA`.

### 3. query-replace-all
- Reopen / re-seed the fixture (or use a second fixture) so all `ALPHA` are present.
- `(query-replace "ALPHA" "OMEGA")` then `(replace-all)` → assert every `ALPHA` is now `OMEGA` (`buffer_contains` no `ALPHA`, multiple `OMEGA`).

### 4. No-matches path
- `(query-replace "zzz" "x")` → assert the `"No matches found"` message and that the replace state is NOT active (`replace.tlisp:8-10` early return).

### 5. isearch-backward lands before the start
- Open a fixture where a search term appears on an early line and again on a late line. Place the cursor on/after the late occurrence.
- Drive `?` (the `isearch-backward` binding) then `(search-incremental-update "TERM")` then `(search-incremental-finish)` — assert via `(buffer-get-line (cursor-line))` that the cursor landed on the **earlier** occurrence (line index less than the starting line), proving backward direction. (Mirror eval-20's `buffer-get-line`/`cursor-line` assertion style, robust against exact column.)

### 6. Wire + run
- Run `bun run test:tmax-use`; confirm `eval-39` is discovered and green. If a step fails (likely candidate: the same-line match-offset adjustment at `replace-ops.ts:410-419`, or `replace-quit` not exiting mode), capture as `BUG-##` and reference it here (do NOT edit editor source under this chore).

## Test Plan

- **Primary**: the `eval-39` playbook itself, run via `bun run test:tmax-use` (real daemon auto-start + TUI client + eval RPC). This is the deliverable.
- **Key assertions** (each ties to a Completion Criterion above):
  - yes/no: first match replaced, second skipped, third untouched after quit; mode back to `normal`.
  - all: every occurrence replaced.
  - no-matches: `"No matches found"` message; replace state not entered.
  - backward search: cursor lands on a match whose line index is less than the starting line (direction is genuinely backward, distinct from eval-20's forward coverage).
- **Unit/integration coverage**: the existing `createReplaceOps` unit tests are NOT modified (test-only chore). The chore's value is the live-buffer composition + direction coverage the unit layer cannot provide.
- **Defect handling**: if a step reveals a defect (likely: match-offset drift after replace on same-line multi-match, or `replace-quit` mode-exit), file as `BUG-##`, mark the step `xfail`/skip with a cross-reference, and leave the rest green.

## M-x Discoverability

This is a TEST-ONLY chore — it adds no new T-Lisp functions or key bindings, so it does not change M-x completion. `query-replace` and its sub-commands already carry docstrings (`replace.tlisp:6,15,20,24,29`), and `isearch-backward` carries a docstring (`isearch.tlisp:11`) plus the `?` binding (`isearch.tlisp:35`), so they already appear in M-x per `command-detail-interactive-p` in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19` (a command is M-x-visible IFF it has a docstring OR a binding). No discoverability action required by this chore.
