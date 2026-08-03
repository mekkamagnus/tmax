# Chore: e2e coverage for major/minor mode commands (modes playbook)

## Goals

- Lock the existing major-mode and minor-mode T-Lisp/M-x command surface with a
  declarative end-to-end playbook (`eval-45`) so regressions in mode
  registration, auto-detection, hook running, toggling, and globalization fail
  loudly in `test:tmax-use`.
- Capture any defect surfaced by the playbook as a `BUG-##` spec referenced
  inline; the chore ships no new implementation, only the playbook + runner
  wiring (the runner auto-discovers `tmax-use/playbooks/*.yaml`, so "wiring"
  is just authoring the YAML in the discovered directory).
- Establish the assertion shapes later mode/indent/syntax features can reuse
  (read-after-write round-trips, hook side-effects, `minor-mode-active-p`
  reflection, `global-minor-mode-active-p` cross-buffer spread).

## Completion Criteria (Definition of Done)

- [ ] Playbook `eval-45` exists at `tmax-use/playbooks/eval-45-modes.yaml` and
  passes green via `bun run test:tmax-use` (or a scoped
  `bun tmax-use/test/cli.ts playbooks/eval-45-modes.yaml`).
- [ ] `(major-mode-set "markdown")` switches the buffer's major mode and
  `(major-mode-get)` reflects it — eval-45.
- [ ] `(major-mode-register "ts-indent" '(".tsind") "typescript" '("{") '("}"))`
  registers a custom mode that then appears in `(major-mode-list)` and whose
  `".tsind"` extension is resolved by `(major-mode-auto-detect)` on a file
  with that suffix — eval-45.
- [ ] `major-mode-auto-detect` runs the registered activate hook: a hook
  function added via `(major-mode-hook-add ...)` sets an observable marker
  (e.g. pushes a string into `*Messages*` or sets a buffer-local sentinel) that
  the playbook asserts — eval-45.
- [ ] `(minor-mode-toggle "line-numbers")` flips the mode and
  `(minor-mode-active-p "line-numbers")` returns the matching boolean both
  before and after the toggle — eval-45.
- [ ] `(define-minor-mode "test-mm" "test" "Test" nil)` registers a minor mode
  whose `minor-mode-active-p` is false until `(minor-mode-set "test-mm" t)`
  enables it — eval-45.
- [ ] `(global-minor-mode-set "line-numbers" t)` enables the mode globally and
  `(global-minor-mode-active-p "line-numbers")` returns true, observable in a
  second buffer after `(buffer-create)`/`(switch-to-buffer ...)` — eval-45.
- [ ] Any defect uncovered while designing the playbook is filed as `BUG-##`
  and its number is listed here (write `None found.` if the surface is clean).
- [ ] `bun run typecheck:src` and `bun run typecheck:test` still pass
  unchanged (the chore is YAML-only; no TS edits beyond optional runner
  plumbing if a matcher turns out to be missing — tracked here if so).

## Description

The mode layer (`src/editor/api/major-mode-ops.ts`,
`src/editor/api/minor-mode-ops.ts`) ships a rich T-Lisp surface — major-mode
register/set/get/list/auto-detect/hook-add/hook-run, minor-mode
register/toggle/set/active-p/list-active/global-p/global-set/active-p — but
**none** of it is exercised by an end-to-end playbook today (existing playbooks
stop at `eval-21`; `eval-11` only checks that a `.ts` file *loads*). This chore
adds `eval-45` to fill that gap: it is a TEST-ONLY chore — no new feature code,
no behavioral change — whose only deliverables are the YAML playbook and any
small runner tweak required to land it. A playbook here is the right tool
because modes are inherently cross-cutting (filename, syntax language,
indent rules, hook execution, multi-buffer state) and the daemon-driven
playbook harness already proves the full eval→assert loop against the real
binary.

## User Story

As a **tmax maintainer shipping future mode/indent/syntax features**
I want **a green e2e playbook that exercises every major/minor-mode command**
So that **a regression in mode registration, auto-detect, hook firing, toggle
reflection, or globalization is caught in `test:tmax-use` before it lands,
instead of being discovered by a user six months later.**

## Problem Statement

Per the prior alpha audit (`alpha-audit-2026-08-01` in user memory), the
mode command surface is implemented at the T-Lisp/M-x layer but has **no e2e
coverage**. The current playbook set (`eval-01`…`eval-21`) covers cursor,
insert, line ops, visual, multi-buffer, save/load, scrolling, which-key, M-x
command execution, command mode, syntax file-load smoke, unicode, long lines,
empty buffer, boundary nav, browse-url, rapid keys, macros, text objects,
search — but never calls `major-mode-set`, `minor-mode-toggle`, or
`global-minor-mode-set`. The `eval-11` playbook only verifies that a `.ts`
file's keywords are *present in the buffer*; it does not assert that
`major-mode-auto-detect` produced the right mode or that the mode's hook ran.
This is the exact class of regression that the daemon-driven harness exists to
prevent, and it is currently a blind spot.

## Solution Statement

Write one e2e playbook `eval-45` (this is a chore, so "solution" = "write the
playbook + wire it into the runner"). The runner at
`tmax-use/test/runner.ts:737` (`discoverTargets`) auto-discovers every
`*.yaml` under `tmax-use/playbooks/`, so wiring is just authoring the file in
that directory — no registry edit. The playbook drives the real daemon over
JSON-RPC, issues T-Lisp `eval` for each command, and asserts via the existing
expect fields (`result_contains`, `buffer_contains`, `status_message`).
Where a hook's side-effect is the only observable, the hook pushes a marker
into `*Messages*` via `(message ...)` and the playbook asserts on the status
line / messages buffer. Read-after-write round-trips (set then get) are used
for `minor-mode-active-p`, `major-mode-get`, and `global-minor-mode-active-p`.

## Relevant Files

Read these before designing assertions (paths are real, verified):

- **`src/editor/api/major-mode-ops.ts`** — the major-mode surface under test.
  - `major-mode-set` (line 150): validates the mode is registered, calls
    `writeCurrentMode`, optionally evals `(syntax-set-language ...)` and
    `(indent-set-rules ...)`, then runs `mode-<name>-activate-hook` (line 191).
    Returns the mode name as a string.
  - `major-mode-get` (line 197): returns the current mode string.
  - `major-mode-list` (line 207): returns registered mode names as a list.
  - `major-mode-auto-detect` (line 218): reads `currentFilename`; if nil
    returns `"fundamental"`; otherwise matches against `autoModeRules`, sets
    the mode, runs the same syntax/indent/hook side-effects, returns the name
    (or `"fundamental"`).
  - `major-mode-register` (line 75): `(name extensions [syntax-language
    indent-increase indent-decrease])` — note arg 1 must be a **list** and
    optional args 3/4 must be lists; seeds `autoModeRules` with extension
    rules.
  - `major-mode-hook-add` (line 310) / `major-mode-hook-run` (line 337): add
    a hook fn name to `mode-<mode>-activate-hook`, run it.
  - `auto-mode-add` / `auto-mode-list` / `auto-mode-detect` (lines 258/286/300)
    for direct rule manipulation.
- **`src/editor/api/minor-mode-ops.ts`** — the minor-mode surface under test.
  - `minor-mode-toggle` (line 239): flips the mode; returns the new boolean
    state. Records a local override. Fires `activateHook`/`deactivateHook` via
    `run-hooks`.
  - `minor-mode-set` (line 274): explicit enable/disable.
  - `minor-mode-active-p` (line 315): reflection predicate.
  - `minor-mode-list-active` (line 330) / `minor-mode-list-all` (line 339).
  - `define-minor-mode` (line 172): `(name description [lighter] [global])`.
  - `global-minor-mode-set` (line 389): adds to the globalized set, activates
    in every existing buffer (skipping buffers whose local override is
    `"disabled"`).
  - `global-minor-mode-active-p` (line 443) / `global-minor-mode-list-active`
    (line 456).
  - Builtin effect (line 78): `line-numbers`/`auto-fill` minor modes also flip
    the editor config flags `showLineNumbers`/`wordWrap` — useful as a
    concrete observable.
- **`src/editor/mode-state.ts`** — `getOrCreateModeState`,
  `applyGlobalMinorModes`, `normalizeExtension`, `createExtensionRule`,
  `createRegexpRule`. The `applyGlobalMinorModes` call inside
  `currentModeState()` (minor-mode-ops.ts:66) is what makes a global mode
  visible in a freshly-created buffer.
- **`src/editor/api/syntax-ops.ts`** and **`src/editor/api/indent-ops.ts`** —
  side-effects `major-mode-set` triggers; only relevant as cross-checks, not
  the focus of this playbook.
- **`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`** —
  `command-detail-interactive-p`: a function shows in M-x IFF it has a
  docstring OR a keybinding. The trt commands already carry docstrings; the
  mode commands are primitives (always present), so M-x discoverability is
  not gated here, but the rule applies if any new wrapper is added.
- **`tmax-use/test/runner.ts:737`** — `discoverTargets` auto-discovers
  `*.yaml` in `tmax-use/playbooks/`; no registration step is needed.
- **`tmax-use/playbooks/README.md`** — the playbook schema
  (`setup`/`steps`/`expect`, the `${VAR}` substitution, the backslash lint
  guard, headless vs headed). Match this exactly.

### New Files

- **`tmax-use/playbooks/eval-45-modes.yaml`** — the playbook (only deliverable
  if no defect is found).

## Implementation Plan

1. **Sketch the assertions offline.** For each command, decide the
   before/after observable:
   - major-mode: `major-mode-get` string before/after `major-mode-set`.
   - register: `(member "ts-indent" (major-mode-list))` via `result_contains`.
   - auto-detect: open `eval-45-fixture.tsind`, then `major-mode-get` should
     be `ts-indent`; and the custom hook marker should appear in `*Messages*`.
   - minor-mode toggle: read `minor-mode-active-p`, toggle, read again; assert
     both booleans.
   - minor-mode-set: define then `minor-mode-set t`; assert `active-p` true.
   - global: `global-minor-mode-set t` then open a fresh buffer and assert
     `minor-mode-active-p` is true there (proves the global spread).
2. **Write `eval-45-modes.yaml`.** Use `setup_file` for the `.tsind` fixture
   (so `currentFilename` is set, which `major-mode-auto-detect` reads). Use
   `eval` steps (not `keys`) for every mode command — they are pure data ops.
   Note the backslash lint guard: avoid `\` in `eval` strings; use simple
   symbols. Use `result_contains` for return-value assertions and
   `status_message`/`buffer_contains` for hook side-effects.
3. **Run the playbook scoped:** `bun tmax-use/test/cli.ts
   playbooks/eval-45-modes.yaml` (or `bun run test:tmax-use` if the suite is
   stable). Iterate until green.
4. **If a step reveals a defect,** do not patch it here (this is a TEST-ONLY
   chore). File a `BUG-##` spec describing the gap, set that step to the
   closest passing assertion, add a `# TODO(BUG-##)` comment in the YAML, and
   list the BUG number in the Completion Criteria above.
5. **Verify** the full suite still passes and that no other playbook broke
   (modes are global-ish; a globalized minor mode leaking across playbooks is
   the most likely cross-test contaminant — confirm each playbook's daemon is
   fresh, which the runner guarantees per `README.md`).

## Test Plan

- **Primary:** `tmax-use/playbooks/eval-45-modes.yaml` (the deliverable).
  Key assertions (cross-referenced to Completion Criteria):
  - `(major-mode-set "markdown")` then `(major-mode-get)` →
    `result_contains: markdown`.
  - `(major-mode-register "ts-indent" (list ".tsind") "typescript" (list "{") (list "}"))`
    then `(member "ts-indent" (major-mode-list))` → `result_contains: t`.
  - `(major-mode-hook-add "ts-indent" "ts-indent--marker")` where
    `ts-indent--marker` is a `(defun ... (message "TS-INDENT-HOOK-FIRED"))`,
    then open the fixture and `(major-mode-auto-detect)` →
    `status_message` (or `*Messages*` buffer) contains `TS-INDENT-HOOK-FIRED`
    and `(major-mode-get)` → `result_contains: ts-indent`.
  - `(minor-mode-active-p "line-numbers")` → record; toggle; re-read;
    assert the two booleans differ.
  - `(define-minor-mode "test-mm" "test")` then `(minor-mode-set "test-mm" t)`
    then `(minor-mode-active-p "test-mm")` → `result_contains: t`.
  - `(global-minor-mode-set "line-numbers" t)` then
    `(global-minor-mode-active-p "line-numbers")` → `result_contains: t`; then
    create/switch to a second buffer and assert
    `(minor-mode-active-p "line-numbers")` is still true there.
- **Regression:** the existing `eval-11` (syntax file-load) must remain green —
  it is the closest existing playbook and shares the major-mode code path.
- **No unit tests are added or changed** — this is an e2e chore. If a matcher
  the playbook needs is missing from `tmax-use/test/playbook.ts`, that is a
  runner gap; track it as a sub-task, not a feature.

## M-x Discoverability

The mode commands are TypeScript primitives registered directly into the
T-Lisp environment by `createMajorModeOps` / `createMinorModeOps`; primitives
are always callable and appear in `(callable-command-details)`. Per
`command-detail-interactive-p` in
`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`, a function
appears in **M-x completion** IFF it has a docstring OR a keybinding. The
trt-mode commands defined in T-Lisp already carry docstrings (see
`trt-commands.tlisp`); if the playbook defines any *new* T-Lisp wrapper (e.g.
the hook marker function above), that wrapper MUST get a docstring so it is
discoverable — but the primitives under test here are present regardless. No
SPEC-067 concern: no `C-x <key>` bindings are proposed; the chore adds no
bindings at all.
