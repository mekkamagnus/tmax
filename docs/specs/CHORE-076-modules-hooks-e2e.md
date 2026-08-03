# Chore: e2e coverage for the module loader and hook system (eval-43)

## Goals

- Lock the module-loading API — `load`, `load-path-add`, `load-path-list` — and
  the module/export machinery (`module-loaded?`, `module-exports`) behind a
  black-box e2e playbook so a regression in library discovery or `provide`/
  `module-loaded?` tracking surfaces before merge.
- Lock the hook system — `add-hook`, `remove-hook`, `run-hooks`,
  `hook-list` — behind the same playbook, covering prepend-vs-append ordering,
  removal by name, and the run-order semantics that modes and
  `enable-minor-mode` depend on.
- Drive both surfaces through the real `--eval` socket with a real on-disk
  `.tlisp` fixture (for `load`/`provide`) so the file-resolution path
  (load-path, `.tlisp` extension defaulting) is exercised, not stubbed.

## Completion Criteria (Definition of Done)

- [ ] Playbook `tmax-use/playbooks/eval-43-modules-hooks.yaml` exists and passes
      green via `bun run test:tmax-use` (or targeted
      `bun tmax-use ./tmax-use/playbooks/eval-43-modules-hooks.yaml`) with a
      fresh daemon per playbook — eval-43.
- [ ] eval-43 asserts the load-path + `load` resolution: `(load-path-add
      "<fixture-dir>")` then `(load "eval-43-mod")` (no extension) resolves and
      evaluates the fixture `eval-43-mod.tlisp`, with `(load-path-list)`
      reflecting the added dir — eval-43.
- [ ] eval-43 asserts the module/provide tracking exposed by the fixture's
      `(defmodule ... (export ...))` + `(provide ...)`: after `load`,
      `(module-loaded? "eval-43-mod")` is true and `(module-exports
      "eval-43-mod")` lists the exported symbol(s); calling an exported
      function the fixture defines returns its expected value — eval-43.
- [ ] eval-43 asserts hook add/list/remove: `(add-hook "eval-43-hook" "h1")`
      then `(add-hook "eval-43-hook" "h2")` → `(hook-list "eval-43-hook")`
      reports `[h2 h1]` (prepend default); `(add-hook "eval-43-hook" "h3" t)`
      appends → list tail is `h3`; `(remove-hook "eval-43-hook" "h2")` → list
      no longer contains `h2` — eval-43.
- [ ] eval-43 asserts `run-hooks` executes entries in listed order: the fixture
      defines two hook functions that each append a marker to a known buffer;
      `(run-hooks "eval-43-hook")` leaves the buffer containing both markers in
      the order the hook list dictates — eval-43.
- [ ] Any defect found while drafting the playbook (e.g. `module-loaded?` not
      tracking a `defmodule`, or `run-hooks` executing in reverse order) is
      filed as `BUG-##` and referenced by number in the "Test Plan" / "Notes"
      of this spec, with the playbook's relevant step commented out (with a
      `# BUG-##` note) until the bug is fixed.

## Description

The alpha-readiness audit catalogued fully-shipped editor subsystems that have
unit tests but **no end-to-end playbook**. The module loader and hook system
are both on that list. The loader (`load`, `load-path-add`, `load-path-list`)
in `src/editor/api/load-ops.ts` is what makes `~/.config/tmax/init.tlisp`,
minor modes, and user libraries work; the hook system (`add-hook`,
`remove-hook`, `run-hooks`, `hook-list`) in `src/editor/api/hook-ops.ts` is the
extension point every minor mode and lifecycle event
(`enable-minor-mode`, post-save hooks, etc.) builds on. Both are unit-tested
but the eval-NN harness never drives them end-to-end against a real on-disk
`.tlisp` file.

This chore adds one playbook, `eval-43`, that drops a real `.tlisp` fixture on
disk, adds its directory to the load path, loads it, and asserts on the
module/export + hook machinery through the structured `--eval` socket. No
production code changes; this is a test-only chore.

## User Story

As a **tmax maintainer preparing for alpha**,
I want **the module loader (load/load-path/provide) and the hook system
(add/remove/run-hooks) covered by an e2e playbook that runs in CI alongside
eval-01..eval-21**,
So that **a regression in library discovery, `provide` tracking, or hook
execution order — all of which silently break user config and minor modes —
fails the suite instead of shipping silently.**

## Problem Statement

The 2026-08-01 alpha audit filed "no e2e test" chores against the loader and
hook subsystems. Today:

- `load` / `load-path-add` / `load-path-list` (`load-ops.ts:77,96,118`) are
  unit-tested, but the resolution path — `.tlisp` extension defaulting,
  load-path search, `modes/` and `commands/` subdirectory fallback
  (`load-ops.ts:29-44`) — is only exercised by stubs, never against a real
  fixture file through the daemon socket.
- The module/provide tracking (`module-loaded?`, `module-exports`) that
  `defmodule`/`provide` feed is the backbone of conditional loading
  (`(unless (module-loaded? "x") (load "x"))`), and it has no e2e guard.
- The hook system (`hook-ops.ts`) is the extension point for every minor mode
  and lifecycle event. `add-hook` prepends by default and appends with a
  non-nil third arg (`hook-ops.ts:105-118`); `run-hooks` iterates the list in
  order (`hook-ops.ts:172-180`). A regression in prepend order or iteration
  order would silently reverse user hooks, and there is currently no e2e guard.

## Solution Statement

Write one tmax-use playbook (`tmax-use/playbooks/eval-43-modules-hooks.yaml`)
plus a tiny on-disk fixture `.tlisp` file, and wire both into the runner. The
tmax-use CLI auto-discovers every `tmax-use/playbooks/*.yaml`
(`tmax-use/test/cli.ts:146,176`), so "wiring" is purely placing the files — no
TS harness change, no manual registration.

The fixture is a real `.tlisp` module that `(defmodule ... (export ...))` an
incrementing function and `(provide "eval-43-mod")`, and defines two hook
functions that append distinct markers into a known buffer. The playbook's
`setup_file` writes the fixture into a per-run location, `(load-path-add)`s
that directory, `(load "eval-43-mod")` (no extension, to exercise the
`.tlisp` defaulting), then asserts on `module-loaded?`, `module-exports`, the
exported function's return value, and the hook add/list/remove/run cycle. This
exercises the real file-resolution + eval path, not a stub.

## Relevant Files

Read before/while writing the playbook (do not edit these — test-only chore):

- **`src/editor/api/load-ops.ts`** — the loader.
  - `resolveCandidate` (line 29): the resolution algorithm — tries the bare
    name, then `<name>.tlisp`, then walks `loadPaths` trying direct /
    `modes/<name>` / `commands/<name>` subpaths. The playbook's
    `(load "eval-43-mod")` (no extension) depends on the `.tlisp` defaulting
    branch at line 30.
  - `(load ...)` (line 77): reads the resolved file synchronously and evals
    its content; returns nil on success, the validation error on failure
    (line 92).
  - `(load-path-add ...)` (line 96): dedupes then appends to `loadPaths`
    (line 110).
  - `(load-path-list)` (line 118): returns the current list — the assertion
    target.
- **`src/editor/api/hook-ops.ts`** — the hook system.
  - `(add-hook ...)` (line 75): accepts 2-3 args; entry can be a string name,
    symbol, or function/lambda value (lines 96-103); **prepends** by default,
    **appends** when the third arg is non-nil (lines 105-118) — the ordering
    assertion depends on this.
  - `(remove-hook ...)` (line 124): removes by name match (string) or
    reference (value), lines 143-150.
  - `(run-hooks ...)` (line 157): iterates the list **in order**, invoking each
    entry (lines 172-180) — the run-order assertion depends on this.
  - `(hook-list ...)` (line 186): returns the list of entries described as
    strings (nil if the hook is empty) — the list assertion target.
  - `describeEntry` (line 37): how a non-string entry is stringified —
    relevant if the playbook uses a symbol/lambda entry.
- **`src/tlisp/core/commands/dired.tlisp:1`** — a real `(defmodule ... (export
  ...))` example to mirror in the fixture (shows the export syntax the
  playbook's `module-exports` assertion reads).
- **`tmax-use/playbooks/eval-18-macro-recording.yaml`** and
  **`tmax-use/playbooks/eval-05-multi-buffer.yaml`** — the template patterns
  (`setup_file`, `eval` steps, expectations). Mirror this structure.
- **`tmax-use/test/cli.ts:146`** — confirms `./tmax-use/playbooks` is a default
  discovery pattern, so the new YAML is auto-discovered.
- **`tmax-use/test/playbook.ts:65`** — the supported `setup_file` action shape;
  the fixture `.tlisp` content goes in its `content:` field.

### New Files

- **`tmax-use/playbooks/eval-43-modules-hooks.yaml`** — the playbook.
- The fixture `.tlisp` content is embedded in the playbook's `setup_file`
  `content:` (no separate fixture file needed; the runner materialises it on
  disk per run, matching how eval-05/eval-18 handle file fixtures).

## Implementation Plan

1. **Read `load-ops.ts` and `hook-ops.ts`** and confirm: the `.tlisp`
   extension defaulting (line 30), the prepend/append switch on `add-hook`
   (lines 105-118), and the in-order iteration of `run-hooks` (lines 172-180),
   so assertions match the implementation. Also confirm the exact spelling of
   `module-loaded?` / `module-exports` (find them in the tlisp core libs, not
   these two files) before writing the assertions.
2. **Author the fixture `.tlisp` content** (embedded in `setup_file`):
   ```lisp
   (defmodule eval-43-mod
     (export eval-43-counter-bump))
   (defvar eval-43-counter 0)
   (defun eval-43-counter-bump ()
     (setq eval-43-counter (+ eval-43-counter 1))
     eval-43-counter)
   (defun eval-43-hook-a ()
     (buffer-switch "*scratch*")
     (buffer-insert "[A]"))
   (defun eval-43-hook-b ()
     (buffer-switch "*scratch*")
     (buffer-insert "[B]"))
   (provide "eval-43-mod")
   ```
   (Adjust to the project's actual `defvar`/`setq`/`provide` spelling — verify
   against an existing core command file before finalising.)
3. **Author `tmax-use/playbooks/eval-43-modules-hooks.yaml`** with this shape:
   - `setup_file` writing the fixture to `eval-43-mod.tlisp` in the playbook's
     working dir; capture its directory path in a `${MODDIR}` var (or derive
     via `(file-dirname ...)` in-line).
   - **Loader section:** `(load-path-add "${MODDIR}")` → `(load-path-list)`
     → assert contains `${MODDIR}` → `(load "eval-43-mod")` (no extension) →
     assert success (nil result, no error) → `(module-loaded? "eval-43-mod")`
     → assert true → `(module-exports "eval-43-mod")` → assert contains
     `eval-43-counter-bump` → `(eval-43-counter-bump)` → assert `1` → call
     again → assert `2`.
   - **Hook section:** `(add-hook "eval-43-hook" "eval-43-hook-a")` →
     `(add-hook "eval-43-hook" "eval-43-hook-b")` → `(hook-list
     "eval-43-hook")` → assert order `[eval-43-hook-b, eval-43-hook-a]`
     (prepend) → `(add-hook "eval-43-hook" "eval-43-hook-a" t)` (append,
     dedupe note) → `(remove-hook "eval-43-hook" "eval-43-hook-b")` →
     `(hook-list "eval-43-hook")` → assert `eval-43-hook-b` absent.
   - **Run section:** clear `*scratch*`, `(run-hooks "eval-43-hook")` →
     `(buffer-text)` on `*scratch*` → assert the markers appear in the order
     the (post-removal) hook list dictates.
4. **Run the playbook** via
   `bun tmax-use ./tmax-use/playbooks/eval-43-modules-hooks.yaml` (or the full
   `bun run test:tmax-use`).
5. **If a step fails on a real defect** (e.g. `module-loaded?` not reflecting
   the `defmodule`, or `run-hooks` reversing order), file a `BUG-##`, mark that
   step commented-out with the bug id, and continue so the rest lands green.
   Record the bug id in this spec's Notes.
6. **Verify the full suite** still passes (`bun run test:tmax-use`) — the new
   playbook must not destabilise eval-01..eval-21 (fresh daemon per playbook,
   `runner.ts:470`).

## Test Plan

- **Primary:** the new playbook `eval-43` is the test. It runs under the same
  `bun run test:tmax-use` target as eval-01..eval-21 (auto-discovered). Key
  assertions:
  - Load-path resolution with `.tlisp` extension defaulting (the `load` path
    real users hit for `init.tlisp` and minor modes).
  - `module-loaded?` / `module-exports` reflect a freshly loaded module.
  - Hook add (prepend default, append with `t`), list, remove-by-name, and
    `run-hooks` in-order execution — the full hook lifecycle.
- **Unit coverage (already present, unchanged):** `test/unit/load*.test.ts`
  and `test/unit/hook*.test.ts` cover the implementations directly; this chore
  adds the *black-box* layer against a real file.
- **Defect handling:** if any assertion reveals a bug, the failing step is
  commented out with a `# BUG-##` note (do NOT delete it) and the BUG id is
  referenced here:
  - _(none yet — populate when the playbook is authored)._

## M-x Discoverability

This is a **test-only chore**: no new T-Lisp functions or keybindings are
introduced, so no M-x discoverability change is needed. The functions covered
(`load`, `load-path-add`, `load-path-list`, `add-hook`, `remove-hook`,
`run-hooks`, `hook-list`, `module-loaded?`, `module-exports`) are programmatic
primitives invoked from init files and other commands, not interactive M-x
targets. Per the rule in
`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`, they need not
appear in M-x completion, and this chore does not change that. No action
required.

## Notes

- The fixture must use the project's real `defmodule`/`provide`/`defvar`/
  `setq` spelling — confirm against an existing core file (e.g.
  `src/tlisp/core/commands/dired.tlisp:1` uses `(defmodule name (export ...))`
  and `(provide ...)` is the convention) before finalising, so the
  `module-loaded?` / `module-exports` assertions read what the loader actually
  populates.
- `add-hook` dedupes paths only via `load-path-add` (loader), **not** hooks:
  appending the same function name twice will list it twice (`hook-ops.ts`
  has no dedupe on `add-hook`). The playbook's append assertion should use a
  distinct third entry, not re-append an existing one, unless testing the
  no-dedupe behaviour explicitly.
- The hook functions switch to `*scratch*` before inserting so the run-order
  assertion has a stable buffer to read; confirm `*scratch*` exists at daemon
  start (it does — `src/editor/CLAUDE.md` lists it as a reserved startup
  buffer).
- Respect SPEC-067: this chore adds no keybindings, so the C-x constraint does
  not apply.
