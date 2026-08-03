# Chore: End-to-end coverage for kill ring, yank-pop, and named registers

## Goals

- Add a black-box e2e playbook (`eval-40`) that drives the **real daemon/client** to exercise the kill-ring + register commands that today have **no** e2e test: `kill-ring-yank` / `kill-ring-save` / `kill-ring-list`, `yank-pop` (cycle through kill history after a paste), and the named-register API (`set-register` / `get-register` / `register-list` / `paste-from-register`).
- Pin the observable kill-ring + register behavior those commands promise (rotation after `yank-pop`, per-editor independence of the ring, append semantics of uppercase registers), so a regression in the kill/register state is caught at the e2e layer.
- Discover and file any defect the playbook reveals as a separate `BUG-##` spec referenced here (this chore ships tests only — no implementation).

## Completion Criteria (Definition of Done)

- [ ] Playbook `tmax-use/playbooks/eval-40-kill-ring-registers.yaml` exists and follows the runner schema (the `setup`/`steps`/`expect`/`cleanup` shape used by `eval-20-vim-search.yaml`).
- [ ] The playbook drives `(kill-ring-save "A")` then `(kill-ring-save "B")` and asserts `(kill-ring-yank)` returns `"B"` (newest-first, `kill-ring.ts:64-69`) and `(kill-ring-list)` is `("B" "A")` — `eval-40`.
- [ ] The playbook covers `yank-pop` cycling: after `(paste-after)` (which activates yank-pop state) and a `(kill-ring-rotate)`, a subsequent `(yank-pop)` replaces the pasted text with the previous kill-ring entry (`yank-pop-ops.ts:93-121`) — `eval-40`.
- [ ] The playbook covers named registers: `(set-register "a" "alpha")` then `(get-register "a")` returns `"alpha"`; uppercase `(set-register "A" "bet")` **appends** to the `a` register (append semantics, `evil-integration.ts:82-93`) — `eval-40`.
- [ ] The playbook covers `register-list`: after setting a couple of registers, `(register-list)` returns the formatted `"<name>: <content>"` entries (e.g. `": …"`, `"a: alphabetet"`, `evil-integration.ts:118-134`) — `eval-40`.
- [ ] The playbook covers `paste-from-register`: `(paste-from-register "a")` returns the register's content for insertion (`evil-integration.ts:210-215`) — `eval-40`.
- [ ] The playbook is wired into the runner so `bun run test:tmax-use` discovers and executes `eval-40`; any defect the playbook reveals is filed as a separate `BUG-##` and referenced by number here (none pre-known).
- [ ] `bun run test:tmax-use` is green overall for `eval-40` (or, if a defect is found, the playbook is marked `xfail`/skipped with the `BUG-##` cross-reference and the rest of the suite is unaffected).

## Description

The kill ring (Emacs-style yank/delete history) and the evil-integration register system (vim named registers wired into the same ring) are the editor's clipboard backbone. Today they are exercised only by unit tests that construct the state objects directly. There is **no** e2e proof that `kill-ring-save`/`kill-ring-yank`/`kill-ring-list`, `yank-pop` cycling, or the named-register API (`set-register`/`get-register`/`register-list`/`paste-from-register`) actually work through the live daemon — i.e. that the T-Lisp functions compose the per-editor `KillRingOps`/`RegisterOps` correctly and that the append-semantics and rotation behave as documented. This chore adds that e2e coverage.

## User Story

**As a** tmax maintainer
**I want** an e2e playbook that proves the kill ring, yank-pop cycling, and named registers actually store/retrieve/cycle text through a live daemon
**So that** a regression in copy/paste (the most-used editor feature after cursor motion) is caught before it ships.

## Problem Statement

The 2026-08-01 alpha audit found that the kill-ring + register commands have **no** end-to-end test. They are covered by unit tests that call `createKillRingOps` / `createEvilIntegrationOps` / `createYankPopOps` directly against a hand-built state. The unit layer cannot catch:

- The composition gap between the T-Lisp-facing functions and the per-editor bound ops — e.g. a wiring regression where `kill-ring-yank` reads a different ring than `kill-ring-save` wrote (CHORE-44 Change 1 made these per-editor precisely to avoid this class; the e2e layer is the only thing that proves the per-editor binding actually holds end-to-end).
- The `yank-pop` activation contract: `yank-pop` is a no-op unless the immediately-prior command was a paste (`yank-pop-ops.ts:97-99`), because `paste-after`/`paste-before` call `session.yankPop.activate(...)` (`yank-ops.ts:391,424,500,525`). The unit tests construct the active state directly; only an e2e flow that pastes-then-pops proves the activation wiring.
- The uppercase-append semantics (`evil-integration.ts:84-93`): `"A"` appends to the `"a"` register. This is the most easily regressed register behavior and is only meaningful through the real `set-register` path.

This chore adds the missing e2e layer.

## Solution Statement

Write e2e playbook `eval-40` under `tmax-use/playbooks/` and wire it into the runner. The playbook drives the kill-ring and register functions through the eval API (these are mostly un-bound primitives, so they are driven via `(kill-ring-save …)` / `(set-register …)` etc., exactly as eval-20 drives the search API), and asserts on the return values (`kill-ring-yank`, `kill-ring-list`, `get-register`, `register-list`, `paste-from-register`) and on the buffer text after a real `(paste-after)` + `(yank-pop)` cycle. No editor source changes — this is a TEST-ONLY chore. Any defect surfaced is filed as a separate `BUG-##`.

## Relevant Files

The playbook (to be created by the test author) and the source it asserts against:

- **`tmax-use/playbooks/eval-40-kill-ring-registers.yaml`** — the new playbook (this chore's deliverable). Follow the `setup_file` / `steps` / `expect` / `cleanup` schema of `tmax-use/playbooks/eval-20-vim-search.yaml`.
- **`tmax-use/test/runner.ts`** — playbook discovery (`runPlaybook` / discovery around line 736); confirm `eval-40` is picked up by the same glob the other eval-NN files use.
- **`src/editor/api/kill-ring.ts`** — the kill ring under test. `bindKillRing` (56-90): `save` unshifts newest-first (58-63), `yank` returns index 0 (64-69), `rotate` shifts front to back (70-76), `list` returns a copy (77). `createKillRingOps` (95-152) exposes `kill-ring-save`/`kill-ring-yank`/`kill-ring-rotate`/`kill-ring-list`/`set-kill-ring-max`/`get-kill-ring-max` to T-Lisp.
- **`src/editor/api/yank-pop-ops.ts`** — the yank-pop cycle. `bindYankPop.perform` (93-121): no-op unless `state.active` (97-99); else rotates the ring, deletes the prior paste range, inserts the next entry, updates `pastedText`. `createYankPopOps` (127-170) exposes `yank-pop`/`yank-pop-active`/`yank-pop-reset`.
- **`src/editor/api/yank-ops.ts`** — `paste-after` (310-428) / `paste-before` (434-529): both call `session.yankPop.activate(pasteText, pos)` (391, 424, 500, 525) — the activation contract the playbook's yank-pop step depends on.
- **`src/editor/api/evil-integration.ts`** — the named-register API under test. `bindRegisters` (74-136): `get`/`set` with the uppercase-append branch (82-93), `yank` writes unnamed + register 0 + kill ring (98-102), `listEntries` formats `"<name>: <content>"` (118-134). `createEvilIntegrationOps` (146-218) exposes `get-register`/`set-register`/`register-get`/`register-set`/`yank-delete-store`/`register-list`/`paste-from-register`.
- **`src/tlisp/core/bindings/normal.tlisp:201`** — the `M-y` → `(yank-pop)` binding (so the playbook can also drive `yank-pop` via a real keystroke after a paste, in addition to the eval API).

## Implementation Plan

### 1. Fixture setup
- `setup_file` a fixture (e.g. `eval-40-killring.txt`) with a line or two of seed text, so a paste has somewhere to land. Open via `(find-file-open "${FILE}")`.

### 2. kill-ring save/yank/list (newest-first)
- `(kill-ring-save "A")` then `(kill-ring-save "B")`.
- Assert `(kill-ring-yank)` returns `"B"` (newest at index 0).
- Assert `(kill-ring-list)` equals `("B" "A")`.

### 3. yank-pop cycle (paste then pop)
- `(yank-register-set "first")` and `(yank-register-set "second")` to seed two distinct kill-ring entries (or use `(kill-ring-save …)` twice — note `kill-ring-save` pushes to the same ring `yank-pop` reads).
- `(paste-after)` to insert the newest and **activate** yank-pop state (`yank-ops.ts:391`).
- `(yank-pop)` → assert the pasted text in the buffer is now the **previous** kill-ring entry (the rotate at `yank-pop-ops.ts:100` swapped it in). Read the buffer via `buffer_contains`.
- Optionally drive `M-y` (real keystroke, `normal.tlisp:201`) as a second pop to prove the key-dispatch path also cycles.

### 4. Named registers + uppercase append
- `(set-register "a" "alpha")` → `(get-register "a")` returns `"alpha"`.
- `(set-register "A" "bet")` → uppercase appends → `(get-register "a")` returns `"alphabetet"` (append, not overwrite; `evil-integration.ts:84-93`).

### 5. register-list formatting
- After the above, `(register-list)` returns entries including `"a: alphabetet"` (and the unnamed `": …"` entry if populated). Assert `result_contains` the formatted `"a: alphabetet"` string (`evil-integration.ts:118-134`).

### 6. paste-from-register
- `(paste-from-register "a")` returns the register content (`evil-integration.ts:210-215`); assert the returned string equals the register's current content, ready for insertion.

### 7. Wire + run
- Run `bun run test:tmax-use`; confirm `eval-40` is discovered and green. If a step fails (likely candidates: the `yank-pop` activation contract — does `paste-after` actually activate against the live editor? — or the uppercase-append branch), capture as `BUG-##` and reference it here (do NOT edit editor source under this chore).

## Test Plan

- **Primary**: the `eval-40` playbook itself, run via `bun run test:tmax-use` (real daemon auto-start + TUI client + eval RPC). This is the deliverable.
- **Key assertions** (each ties to a Completion Criterion above):
  - kill ring: `kill-ring-yank` returns newest; `kill-ring-list` is newest-first.
  - yank-pop: after a paste, `yank-pop` swaps the pasted text for the previous ring entry (buffer reflects the swap).
  - registers: `set`/`get` round-trip; uppercase `"A"` appends to `"a"` (not overwrite).
  - register-list: formatted `"<name>: <content>"` entries present.
  - paste-from-register: returns the register's content.
- **Unit/integration coverage**: the existing `createKillRingOps` / `createEvilIntegrationOps` / `createYankPopOps` unit tests are NOT modified (test-only chore). The chore's value is the live-editor composition + activation-contract coverage the unit layer cannot provide.
- **Defect handling**: if a step reveals a defect (most likely the `yank-pop`-after-`paste-after` activation, or the append branch), file as `BUG-##`, mark the step `xfail`/skip with a cross-reference, and leave the rest green.

## M-x Discoverability

This is a TEST-ONLY chore — it adds no new T-Lisp functions or key bindings, so it does not change M-x completion. The commands it exercises fall into two groups per `command-detail-interactive-p` in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19` (a command is M-x-visible IFF it has a docstring OR a binding):

- `yank-pop` has the `M-y` binding (`normal.tlisp:201`) → already M-x-visible.
- `kill-ring-save`/`kill-ring-yank`/`kill-ring-list`, `set-register`/`get-register`/`register-list`/`paste-from-register` are un-bound primitives with no docstrings → NOT in M-x today; they are driven via the eval API in the playbook, which is the correct path for un-bound primitives. No discoverability action is required or proposed by this chore.
