# Chore: End-to-end coverage for window ops (split-window-below/right, other-window, delete-window, window-resize-height/width)

## Goals

- Add a black-box e2e playbook (`eval-38`) that drives the **real daemon/client** to exercise the window-management commands that today have **no** e2e test: `split-window-below`, `split-window-right`, `other-window` (cycle), `delete-window`, and `window-resize-height` / `window-resize-width`.
- Pin the observable window-model behavior those commands promise (window count, current-window index, per-window dimensions), so a regression in the window model is caught at the e2e layer, not just the unit layer.
- Discover and file any defect the playbook reveals as a separate `BUG-##` spec referenced here (this chore ships tests only — no implementation).

## Completion Criteria (Definition of Done)

- [ ] Playbook `tmax-use/playbooks/eval-38-window-ops.yaml` exists and follows the runner schema (the `setup`/`steps`/`expect`/`cleanup` shape used by `eval-20-vim-search.yaml`).
- [ ] The playbook asserts `(window-count)` is `1` at start, becomes `2` after `(split-window-below)` (and again `2` after a fresh split via `(split-window-right)` from a single-window state) — `eval-38`.
- [ ] The playbook drives `C-w w` (the bound `(other-window)`, `motions.tlisp:513`) and asserts `(window-current)` index cycles between windows (0 → 1 → 0) — `eval-38`.
- [ ] The playbook drives `(delete-window)` / `C-w q` and asserts `(window-count)` returns to the prior count and the last window cannot be deleted (stays at `1`) — `eval-38`.
- [ ] The playbook drives `(window-resize-height N)` and `(window-resize-width N)` and asserts the current window's height/width changed by the delta (clamped to the `MIN_HEIGHT=3` / `MIN_WIDTH=10` floor in `window-ops.ts`) — `eval-38`.
- [ ] The playbook is wired into the runner so `bun run test:tmax-use` discovers and executes `eval-38`; any defect the playbook reveals is filed as a separate `BUG-##` and referenced by number here (none pre-known).
- [ ] `bun run test:tmax-use` is green overall for `eval-38` (or, if a defect is found, the playbook is marked `xfail`/skipped with the `BUG-##` cross-reference and the rest of the suite is unaffected).

## Description

Window management (`C-w s`/`C-w v`/`C-w w`/`C-w q` plus the resize primitives) is exercised today only by unit tests that construct the window model directly. There is **no** e2e proof that the T-Lisp commands (`windows.tlisp`) compose the TypeScript primitives (`window-ops.ts`) correctly against a live editor — e.g. that `(split-window-below)` actually grows `(window-count)`, that `other-window` cycles, that `delete-window` refuses to delete the last window, and that the resize primitives mutate the current window's dimensions. This chore adds that e2e coverage. The playbook reads the window model through the read-only primitives (`window-count`, `window-current`, `window-list`) so assertions are robust and do not depend on rendered screen geometry.

## User Story

**As a** tmax maintainer
**I want** an e2e playbook that proves the window commands actually split/cycle/close/resize the live window model
**So that** a regression in window management (a frequent source of off-by-one and last-window-edge-case bugs) is caught before it ships.

## Problem Statement

The 2026-08-01 alpha audit found that the window-operation commands have **no** end-to-end test. They are covered by unit tests that call `createWindowOps` directly against a hand-built model, which cannot catch:

- The composition gap between the T-Lisp wrappers (`windows.tlisp:7-21`) and the primitives they wrap (`window-next`/`window-close`/`split-window` in `window-ops.ts`) — e.g. a wiring regression where `other-window` calls the wrong primitive.
- The last-window guard in `window-close` (`window-ops.ts:154-157`: `if (windows.length <= 1) return nil`) — the most common edge-case bug in window managers.
- The resize clamp floors (`MIN_HEIGHT = 3` at `window-ops.ts:243`, `MIN_WIDTH = 10` at `window-ops.ts:283`) against a real terminal size.

These only manifest against the live editor. The unit layer cannot catch the composition gap because it tests the primitive in isolation. This chore adds the missing e2e layer.

## Solution Statement

Write e2e playbook `eval-38` under `tmax-use/playbooks/` and wire it into the runner. The playbook opens a buffer (so the window has something to display — `split-window` throws `"No buffer to display in new window"` otherwise, `window-ops.ts:61-63`), then drives each window command through the eval API and asserts on the read-only window primitives (`window-count`, `window-current`, `window-list`). The bound `C-w`-prefix keys (`C-w s`/`v`/`w`/`q`) are also exercised via real keystrokes to cover the key-dispatch path. No editor source changes — this is a TEST-ONLY chore. Any defect surfaced is filed as a separate `BUG-##`.

> **Note on SPEC-067:** the window commands use the **`C-w` prefix** (`motions.tlisp:511-514`, `windows.tlisp:24`), which is the vim window prefix — **not** the Emacs `C-x` prefix that SPEC-067 redefined to vim decrement. The playbook uses `C-w` keys only; it does NOT propose any `C-x` binding. SPEC-067 is respected.

## Relevant Files

The playbook (to be created by the test author) and the source it asserts against:

- **`tmax-use/playbooks/eval-38-window-ops.yaml`** — the new playbook (this chore's deliverable). Follow the `setup_file` / `steps` / `expect` / `cleanup` schema of `tmax-use/playbooks/eval-20-vim-search.yaml`.
- **`tmax-use/test/runner.ts`** — playbook discovery (`runPlaybook` / discovery around line 736); confirm `eval-38` is picked up by the same glob the other eval-NN files use.
- **`src/tlisp/core/commands/windows.tlisp`** — the T-Lisp wrappers under test: `split-window-below` (7-9), `split-window-right` (11-13), `other-window` → `(window-next)` (15-17), `delete-window` → `(window-close)` (19-21), and the `C-w` prefix binding (24).
- **`src/editor/api/window-ops.ts`** — the primitives the wrappers compose and the read-only inspectors the playbook asserts on:
  - `split-window` (42-105): the `"horizontal"`/`"vertical"` dimension math; throws on bad type/arg count and when there is no current buffer.
  - `window-next` (111-123) / `window-prev` (129-141): modular cycle.
  - `window-close` (147-171): the last-window guard (154-157) and index adjustment.
  - `window-list` (177-193), `window-current` (199-205), `window-count` (211-217): read-only inspectors — use these in `expect` so assertions don't depend on rendered geometry.
  - `window-resize-height` (223-257, `MIN_HEIGHT = 3`) and `window-resize-width` (263-297, `MIN_WIDTH = 10`): the resize primitives + clamp floors.
- **`src/tlisp/core/commands/motions.tlisp:511-514`** — the bound `C-w s`/`C-w v`/`C-w w`/`C-w q` keys the playbook drives via real keystrokes.

## Implementation Plan

### 1. Fixture setup (buffer required)
- `setup_file` a fixture (e.g. `eval-38-windows.txt`) with a few lines. Open it via `(find-file-open "${FILE}")` so the window has a current buffer (`split-window` otherwise throws `"No buffer to display in new window"`).

### 2. Baseline + split
- Assert `(window-count)` is `1` and `(window-current)` is `0`.
- `(split-window-below)` → assert `(window-count)` is `2`.
- Assert the new window's `splitType` is `"horizontal"` (via `window-list` if exposed, else assert count only).

### 3. Cycle (other-window)
- Record `(window-current)` (e.g. `0`).
- Drive `C-w w` (real keystroke) → assert `(window-current)` advanced to `1`.
- Drive `C-w w` again → assert it wrapped back to `0` (modular cycle at `window-ops.ts:118`).

### 4. Vertical split
- (Optional from the 2-window state, or reset to 1 window first.) `(split-window-right)` → assert `(window-count)` grew by 1 and the new window's `splitType` is `"vertical"`.

### 5. Resize
- From a known current window, `(window-resize-height 2)` → assert the current window's height increased by 2 (read via `window-list` or a dedicated dimension accessor). Drive a negative delta and assert the `MIN_HEIGHT = 3` clamp holds (height never drops below 3).
- Repeat for `(window-resize-width N)` and the `MIN_WIDTH = 10` floor.

### 6. Delete + last-window guard
- `(delete-window)` (or `C-w q`) → assert `(window-count)` decreased by 1.
- Repeatedly delete until one window remains; then assert `(delete-window)` is a **no-op** (count stays `1` — the `window-ops.ts:154-157` guard) and does not error.

### 7. Wire + run
- Run `bun run test:tmax-use`; confirm `eval-38` is discovered and green. If a step fails (e.g. `window-list` does not expose dimensions needed for the resize assertion, or the clamp behaves differently), capture as `BUG-##` and reference it here (do NOT edit editor source under this chore).

## Test Plan

- **Primary**: the `eval-38` playbook itself, run via `bun run test:tmax-use` (real daemon auto-start + TUI client + eval RPC). This is the deliverable.
- **Key assertions** (each ties to a Completion Criterion above):
  - split: `(window-count)` grows from 1 → 2 for both below and right splits.
  - cycle: `(window-current)` toggles 0 ↔ 1 under `C-w w`, with modular wrap-around.
  - delete: count decreases; the last window is never deleted (count floors at 1, no error).
  - resize: height/width change by the delta; clamped at `MIN_HEIGHT=3` / `MIN_WIDTH=10`.
- **Unit/integration coverage**: the existing `createWindowOps` unit tests are NOT modified (test-only chore). The chore's value is the live-editor composition coverage the unit layer cannot provide.
- **Defect handling**: if a step reveals a defect (likely candidates: `window-list` not exposing per-window dimensions, making the resize assertion indirect; or the clamp math), file as `BUG-##`, mark the step `xfail`/skip with a cross-reference, and leave the rest green.

## M-x Discoverability

This is a TEST-ONLY chore — it adds no new T-Lisp functions or key bindings, so it does not change M-x completion. The commands it exercises (`split-window-below`, `split-window-right`, `other-window`, `delete-window`) already carry docstrings (`windows.tlisp:8,12,16,20`) and `C-w`-prefix bindings (`motions.tlisp:511-514`), so they already appear in M-x per `command-detail-interactive-p` in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19` (a command is M-x-visible IFF it has a docstring OR a binding). The resize primitives (`window-resize-height`/`width`) lack docstrings and bindings and so are NOT in M-x today; they are driven via the eval API in the playbook, which is the correct path for un-bound primitives. No discoverability action required by this chore.
