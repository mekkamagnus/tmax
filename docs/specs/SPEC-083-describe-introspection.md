# Feature: describe-key / describe-mode / describe-variable — self-documentation

## Goals

- Complete the Emacs-style `describe-*` self-documentation surface so a user can ask, from inside the editor, "what does this key do", "what mode am I in and what does it bind", and "what is the value of this variable" — without leaving tmax or reading source.
- Fill the two **missing** introspection commands (`describe-mode`, `describe-variable`) and fix the one **stub** in the existing `describe-key` (it currently returns the literal `"No documentation available"` for every key — `src/editor/editor.ts:716`).
- Surface every describe result in a dedicated, reusable `*Help*` buffer (not just a status-line flash) so the user can scroll and copy the output, matching Emacs `*Help*` behavior.

## Completion Criteria (Definition of Done)

- [ ] `(describe-mode)` returns a structured description of the current buffer's major mode (name + active hooks + every key the mode binds), and writing it to the `*Help*` buffer shows: the major-mode name, the editor (minor) mode, and the list of active key bindings for the current mode — eval-34.
- [ ] `(describe-variable "NAME")` returns the variable's current value plus its docstring when available, and writes a `*Help*` entry of the form `NAME is <value>` (with `Documentation:` line when a docstring exists; `NAME is not defined` for an unbound name) — eval-34.
- [ ] `(describe-key "j")` returns `[command key mode docstring]` where the `docstring` slot is the **bound command's actual docstring** (looked up via `resolveCallable`/`documentation-get`), not the current hardcoded `"No documentation available"` placeholder — eval-34.
- [ ] Each describe command opens/refreshes a single `*Help*` buffer (reused across invocations — no duplicate `*Help*` buffers) and switches to it in normal mode so the user can scroll — eval-34.
- [ ] `describe-mode`, `describe-variable`, and the improved `describe-key` are each M-x-discoverable (docstring and/or binding) — eval-34. Bindings (SPEC-067: no `C-x` chords): `SPC h k` → describe-key-prompt, `SPC h m` → describe-mode, `SPC h v` → describe-variable, `SPC h f` → describe-function-prompt.

## Description

tmax already ships a documentation module (`src/editor/api/documentation.ts`: `documentation-get`/`search`/`list`/`by-category`/`categories`) and partial Emacs-style describe commands: `describe-key`, `describe-key-prompt`, `describe-function`, `describe-function-prompt`, `describe-function-complete`, and `apropos-command` (all in `src/editor/editor.ts:598-880`). But the surface is incomplete and partially stubbed:

- **`describe-mode`** — does not exist. There is no way to ask "what mode is this buffer in and what keys does it bind" even though all the data is available (`editor-mode` in `src/editor/api/mode-ops.ts:60`, `major-mode-get`/`major-mode-list` in `src/editor/api/major-mode-ops.ts:197/207`, and `key-bindings` in `src/editor/editor.ts:571`).
- **`describe-variable`** — does not exist. There is no way to read a T-Lisp variable's value through a help affordance, even though the environment stores them (`src/tlisp/environment.ts:30` `lookup`, `:48` `define`, `:58` `set`) and `defvar`/`set!` are evaluated in `src/tlisp/evaluator.ts:1938/2051`.
- **`describe-key` is stubbed** — its fourth return slot is the hardcoded string `"No documentation available"` (`editor.ts:716`), so it never shows the bound command's real docstring even though `describe-function` already resolves it via `resolveCallable` (`editor.ts:760`).
- **No `*Help*` buffer** — describe results today are returned as lists/values; there is no reusable buffer the user can scroll, consistent with how `:marks` already routes formatted output to `*Messages*`.

This spec completes the surface: add `describe-mode` and `describe-variable`, fix `describe-key`'s docstring slot, and route every describe result through a `*Help*` buffer via a small T-Lisp command library.

## User Story

As a **user learning tmax or recalling what a key/variable does mid-session**,
I want **to press a key (or run a command) and see, in a scrollable buffer, exactly what command a key runs and its docstring, what my current mode is and what it binds, and what value a variable holds**,
so that **I can self-serve answers without grepping source or leaving the editor.**

## Problem Statement

The 2026-08-01 alpha audit filed self-documentation as **partial at the introspection layer**: `describe-function`/`apropos-command` work, but `describe-mode` and `describe-variable` are missing entirely, and `describe-key` returns a placeholder instead of the bound command's docstring. Reading the source confirms: `describe-mode`/`describe-variable` appear nowhere outside `docs/` and tests (grep returns no definition), and `describe-key`'s docstring slot is a `// TODO: Implement function documentation lookup` literal (`editor.ts:716`). The documentation module (`documentation.ts`) and the interpreter's `resolveCallable` already hold the data needed; the gap is purely the missing/stubbed command glue and the absence of a `*Help*` buffer to render into.

## Solution Statement

Implement the missing pieces in two layers, respecting the `src/editor/CLAUDE.md` rule that TypeScript provides primitives and editor logic lives in T-Lisp:

1. **TS primitives (in `src/editor/editor.ts`, next to the existing describe-* `defineRaw` calls):**
   - `describe-mode (mode)` — resolve the editor minor mode name + the current buffer's major mode (`major-mode-get` data is already on the model), enumerate the current mode's bindings (filter `key-bindings` / `this.keyMappings` to those whose mode matches), and return a structured value: `[editor-mode major-mode bindings-list]` where each binding entry is `[key command docstring]` (docstring resolved via the same `resolveCallable` path `describe-function` uses, `editor.ts:760`).
   - `describe-variable (name)` — look the name up in the interpreter's global environment (`this.interpreter`'s environment `lookup`, mirroring how `defvar`/`set!` store values per `environment.ts:30`); return `[name value docstring?]` or `[name "not defined"]`. (defvar docstrings are not currently stored on the value — Phase 1 returns the value and a `Documentation:` line only when `documentation-get` has an entry for the name; a follow-up can store defvar docstrings.)
   - **Fix `describe-key`'s docstring slot** (`editor.ts:716`): replace `"No documentation available"` with a real lookup — extract the command symbol from `mapping.command` (the `^\(([^\s()]+)\)$` shape already parsed in `callable-command-details` at `editor.ts:1118`), call `this.resolveCallable(cmdName)`, and use its `docstring` (falling back to `documentation-get(cmdName)?.description`, then the placeholder).

2. **T-Lisp command library (`src/tlisp/core/commands/describe.tlisp`)** mirroring `buffers.tlisp`/`isearch.tlisp`:
   - `(describe-key-at-point)` — set the existing `describeKeyPending` flag (already wired through `SetDescribeKeyPending` in `src/editor/functional/messages.ts:75`, `model.ts:82`, `update.ts:121`) and capture the next pressed key, then call the TS `describe-key` and render to `*Help*`.
   - `(describe-function-at-point)` — `completing-read` over `callable-command-details` (the M-x completion source, `editor.ts:1113`), call TS `describe-function`, render to `*Help*`.
   - `(describe-mode)` / `(describe-variable)` — call the new TS primitives and render to `*Help*`.
   - `(describe-to-help (title body))` — the shared renderer: ensure/reuse `*Help*` (pattern from `buffers.tlisp` `switch-buffer-accept`), clear it, insert `title\n\n` + `body`, switch to it in normal mode. This keeps the `*Help*` buffer single-instance.
   - Bindings (SPEC-067 — NO `C-x`): `SPC h k` → describe-key-at-point, `SPC h f` → describe-function-at-point, `SPC h m` → describe-mode, `SPC h v` → describe-variable (read the name via `completing-read` over a variable-name list).

The `*Help*` buffer is a plain named buffer (NOT in the reserved set `*scratch*`/`*Messages*`/`*daemon*` per `src/editor/CLAUDE.md`), reused across invocations so it never duplicates.

## Relevant Files

READ before implementing — paths and plan are grounded in the current source:

- **`src/editor/editor.ts`** — where the existing describe-* primitives live:
  - `key-bindings` (line 571) and `key-binding` (line 598) — the binding-introspection data `describe-mode` filters/renders.
  - `describe-key` (line 667) — **the stub to fix**: line 716 returns `"No documentation available"`; replace with a `resolveCallable` lookup.
  - `describe-key-prompt` (line 722) — sets the `SetDescribeKeyPending` flag; the T-Lisp `describe-key-at-point` reuses this machinery.
  - `describe-function` (line 748) — the **template** for the new `describe-mode`/`describe-variable`: it calls `this.resolveCallable(name)` (line 760) to pull `docstring`/`parameters`/`source`/`moduleName`. `describe-mode` reuses the same resolution path for each binding's docstring.
  - `callable-command-details` (line 1113) — parses `mapping.command` with `^\(([^\s()]+)\)$` (line 1118) to map a binding's command string to a callable name; `describe-key`'s fix reuses this regex.
  - `apropos-command` (line 856) — another template showing the `(name binding documentation)` triple shape that describe results follow.
- **`src/editor/api/documentation.ts`** — `getDocumentation` (line 394), `formatDocumentation` (line 418), and the `createDocumentationOps` `documentation-get`/`documentation-search`/`documentation-list`/`documentation-by-category`/`documentation-categories` T-Lisp functions (lines 448-559). `describe-variable`/`describe-function` consult `getDocumentation` for a richer `Documentation:` block when the interpreter's docstring is empty.
- **`src/editor/api/major-mode-ops.ts`** — `major-mode-get` (line 197), `major-mode-list` (line 207), and the per-editor `mm` registry (line 56). `describe-mode` reads the current major mode from `mm`/the `getCurrentMajorMode` callback.
- **`src/editor/api/mode-ops.ts`** — `editor-mode` (line 60) returns the current editor (minor) mode; `describe-mode` includes it alongside the major mode.
- **`src/editor/runtime/binding-runtime.ts`** — owns binding-file policy and the load order (`keymaps.tlisp` then `normal/insert/visual/command`); relevant only to confirm there is no separate mode→bindings table the new code must touch — bindings come from `this.keyMappings` on the editor, which `describe-mode` reads directly.
- **`src/tlisp/environment.ts`** — `lookup` (line 30), `define` (line 48), `set` (line 58). `describe-variable` reads a value via the interpreter's global environment `lookup`. (Read this to find the exact accessor the interpreter exposes for the global env — `this.interpreter` has the environment handle.)
- **`src/tlisp/evaluator.ts`** — `defvar` (line 1938) and `set!` (line 2051) special forms define/store variables; confirms variables live in the environment chain and are readable via `lookup`.
- **`src/tlisp/core/commands/buffers.tlisp`** — command-library template (`defmodule` + exported `defun`s + `provide`) and the `*Occur*`/`*Help*` create-or-reuse pattern (`switch-buffer-accept` at its line 26 does `(buffer-create name)` / `(buffer-switch name)`).
- **`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`** — `command-detail-interactive-p`: a function is M-x-discoverable IFF it has a docstring OR a binding. Every new `defun` therefore gets a docstring.
- **`src/editor/CLAUDE.md`** — reserves `*scratch*`/`*Messages*`/`*daemon*`; `*Help*` is NOT reserved, so it is a plain user buffer.

### New Files

- **`src/tlisp/core/commands/describe.tlisp`** — the T-Lisp command library: `describe-to-help`, `describe-key-at-point`, `describe-function-at-point`, `describe-mode`, `describe-variable`, the `SPC h …` bindings, `(provide "describe")`.

## Implementation Plan

### Phase 1 — Fix `describe-key` and add `describe-mode` / `describe-variable` TS primitives

1. In `src/editor/editor.ts`, fix `describe-key` (line 716): extract the command name from `mapping.command` using the same `^\(([^\s()]+)\)$` regex `callable-command-details` uses (line 1118); call `this.resolveCallable(cmdName)`; set the docstring slot to `fn.docstring` if present, else `getDocumentation(cmdName)?.description`, else `"No documentation available"`.
2. Add `defineRaw("describe-mode", …)` next to the existing describe-* calls: read the editor minor mode (`this.getMode()`), the current buffer's major mode (`getCurrentMajorMode` callback or the `mm` registry's fallback), and enumerate `this.keyMappings` filtered to entries whose `mode` matches the current editor mode; for each, resolve the docstring as in step 1. Return `[editorMode majorMode bindingsList]` where `bindingsList` is a list of `[key command docstring]`.
3. Add `defineRaw("describe-variable", …)`: take a string name; look it up via the interpreter's global environment `lookup` (read `src/tlisp/environment.ts` + how `this.interpreter` exposes its environment to pick the exact accessor); on hit return `[name value documentation?]` (documentation from `getDocumentation(name)?.description` when available); on miss return `[name createString("not defined")]`.
4. Add `defineRaw("describe-variables-list", …)` (optional helper for `completing-read` in step 8): return the names of all global bindings whose value is NOT a function (i.e. the variables), so `describe-variable`'s minibuffer can complete over real variable names.

### Phase 2 — `*Help*` buffer + T-Lisp command library

5. Create `src/tlisp/core/commands/describe.tlisp` with `(defmodule editor/commands/describe (export describe-to-help describe-key-at-point describe-function-at-point describe-mode describe-variable) ...)`.
6. `(describe-to-help title body)` — the shared renderer:
   - If `(member "*Help*" (buffer-list))` is nil, `(buffer-create "*Help*")`; else `(buffer-switch "*Help*")`.
   - Clear the buffer (delete its full range) so re-runs do not accumulate.
   - `(buffer-insert-at-position 0 0 (concat title "\n\n" body))`.
   - `(buffer-switch "*Help*")`, `(cursor-move 0 0)`, `(editor-set-mode "normal")`.
7. `(describe-key-at-point)` — `(describe-key-prompt)` (sets the pending flag; the existing key-press path resolves it), and when the bound command is known, call `(describe-key <key>)`, format the `[command key mode docstring]` list into a human-readable block, and `(describe-to-help …)`. (If the pending-key capture flow is not yet fully wired end-to-end — the `SetDescribeKeyPending` flag exists but the dispatch on the next key is the gap — Phase 2 may first ship the non-prompt `(describe-key "j")` form from M-x/eval and defer the interactive `SPC h k` capture to a follow-up; call this out in the spec's Test Plan.)
8. `(describe-function-at-point)` — `(completing-read "Describe function: " … nil t "" "function-history " …)` over `callable-command-details` (mirror `execute-extended-command` at `execute-extended-command.tlisp:39`), accept a name, call `(describe-function name)`, format, render to `*Help*`.
9. `(describe-mode)` — call the new TS `describe-mode`; format the editor mode, major mode, and each binding line (`key → command  ; docstring`) into the body; render to `*Help*`.
10. `(describe-variable)` — `(completing-read "Describe variable: " …)` over `describe-variables-list`; accept a name; call TS `describe-variable`; format `NAME is <value>` (+ `Documentation:` block when present); render to `*Help*`.
11. Bindings (SPEC-067 — NO `C-x`): `(key-bind "k" "(describe-key-at-point)" "normal")` behind the `SPC h` prefix, similarly `f`/`m`/`v` for the other three. Wire through the existing `editor-space-prefix-active-p` / SPC-prefix machinery (see `execute-extended-command-maybe` at `execute-extended-command.tlisp:52`).
12. End with `(provide "describe")` and add `describe.tlisp` to the core command-file load list wherever `buffers.tlisp`/`isearch.tlisp` are loaded.

### Phase 3 — Discoverability + tests

13. Give every exported `defun` a docstring (M-x discoverability via `command-detail-interactive-p`).
14. Add a unit test asserting `describe-key` returns the real docstring for a known-bound key (e.g. a key bound to a documented function), replacing the placeholder assertion.
15. Add integration coverage via the eval-34 playbook (see Test Plan).

## Test Plan

- **eval-34** (e2e playbook, to be authored in `tmax-use/playbooks/eval-34-describe-introspection.yaml`):
  - `(describe-key "j")` → assert the returned list's 4th element is the **real** docstring of whatever `j` is bound to (not `"No documentation available"`).
  - `(describe-mode)` → assert the `*Help*` buffer contains the current editor mode name, the major mode (`fundamental` by default), and at least the `j`/`k` bindings.
  - `(describe-variable "command-history")` (a defvar from `execute-extended-command.tlisp`) → assert `*Help*` shows `command-history is (...)`. Also test an unbound name → `is not defined`.
  - `SPC h f` (or eval `(describe-function-at-point)` accepting a name) → `*Help*` shows the function signature + docstring.
  - Reusability: invoke two describe commands back-to-back and assert `(buffer-list)` contains exactly one `*Help*`.
- **Unit** (`test/unit/editor.test.ts` or a new `test/unit/describe-ops.test.ts`): `describe-key` docstring slot is non-placeholder for a documented binding; `describe-variable` round-trips a `defvar`'d value and reports `not defined` for an unknown name.
- **Known limitation to note in the playbook**: the interactive `SPC h k` (capture-next-key) path depends on the `SetDescribeKeyPending` dispatch being wired on the next keypress. If that dispatch is not yet implemented, eval-34 drives `describe-key` directly via eval (the fully-wired path) and records the interactive capture as a deferred follow-up — do not skip the docstring-correctness assertion, which is the core acceptance criterion.
- **Validation commands** (run all, zero regressions): `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:tmax-use` (drives eval-34).

## M-x Discoverability

A function appears in M-x completion **IFF it has a docstring OR a keybinding**, per `command-detail-interactive-p` in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19`. Therefore:

- Every exported `defun` in `describe.tlisp` (`describe-mode`, `describe-variable`, `describe-key-at-point`, `describe-function-at-point`, `describe-to-help`) MUST get a docstring. The four user-facing commands additionally get `SPC h …` bindings. The new TS `defineRaw` primitives (`describe-mode`, `describe-variable`, `describe-variables-list`) are callable from T-Lisp but, lacking docstrings, intentionally stay out of M-x (they are composed by the T-Lisp layer, not invoked directly by users).

## Notes

- **`describe-function` and `apropos-command` already work** — this spec does NOT reimplement them; it only adds a `*Help*` renderer for `describe-function-at-point` and the two missing commands, plus the `describe-key` docstring fix.
- **defvar docstrings:** the T-Lisp `defvar` special form (`evaluator.ts:1938`) currently does not attach a docstring to the value, so `describe-variable` shows the value and a `Documentation:` line only when `documentation.ts` has a static entry for the name. Storing defvar docstrings on the value is an optional follow-up, explicitly out of scope here to keep this spec minimal.
- **SPEC-067 reminder:** `C-x` is the vim decrement prefix, NOT an Emacs-style prefix. All bindings here are `SPC h <key>`; no `C-x`/`C-h` chords (Emacs uses `C-h k`; tmax uses `SPC h k` instead).
- **`*Help*` is a plain buffer**, not reserved — it can be killed by the user and is recreated on the next describe call.
