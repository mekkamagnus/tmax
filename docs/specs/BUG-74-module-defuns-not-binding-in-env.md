# Bug: `save.tlisp` `defun`s don't bind in the module env — premature `))` closes the defmodule (#126 / BUG-74)

## Bug Description

`src/tlisp/core/commands/save.tlisp` loads and registers as a module (`state="loaded"`, `exports` populated with all 13 names), but **none of its `defun`s/`defvar`s bind in the module's env** — `moduleRegistry.resolve("editor/commands/save").env.lookup("save-buffer")` is `undefined` for every save symbol. `resolveUniqueExport("save-buffer")` therefore returns `undefined`, failing `test/unit/lisp-owned-commands.test.ts` ("representative command libraries load and define functions").

The save commands still *run* (e.g. `SPC x s` / `:w` work) because `(funcall "save-buffer")` resolves through `globalEnv.lookup` first (`src/tlisp/core/stdlib.ts:57`) — the orphaned symbols leaked into the global env — which is why this stayed silent for months and only surfaces through module-env introspection (`resolveUniqueExport`, used by M-x resolution + the test).

Only `save.tlisp` is affected. Every other shipped module binds correctly (including 13 modules that also have a top-level `(defvar … (hashmap))`). Pre-existing (fails at `738bdd0`).

## Problem Statement

A one-character parenthesis defect in `save.tlisp` prematurely closes the `(defmodule …)` form immediately after the `(export …)` clause, so the defmodule body is empty and every `defvar`/`defun` is parsed as a separate top-level form that binds in `globalEnv` instead of `moduleEnv`. The module is registered with a populated export set but an empty env — a silent "exported but not defined" state. The fix must (a) restore the defmodule body so the defuns bind in the module env, and (b) prevent this class of silent failure from recurring.

## Solution Statement

1. **Source fix (root cause):** in `src/tlisp/core/commands/save.tlisp`, change line 5's doubled `))` to a single `)` (so `(defmodule …)` stays open after the export clause), and add one closing `)` at the end of the file to close the defmodule. Net paren count unchanged — one `)` is relocated from line 5 to EOF — so the defmodule wraps the entire body (matching `find-file.tlisp`'s structure).
2. **Defensive guard (prevent recurrence):** in `src/tlisp/evaluator/module-forms.ts` `evalDefmoduleForm`, warn loudly when a module declares exports but its body produced zero bound forms (the exact signature of this bug) — so a future stray-paren can't silently produce an empty-bodied module.
3. **Regression test:** `test/unit/lisp-owned-commands.test.ts` already asserts `resolveUniqueExport("save-buffer")`; with the fix it passes and will catch any regression. Strengthen it to not bail on the first failure (report all names) so future module-binding gaps are fully visible.

## Steps to Reproduce

```bash
bun test test/unit/lisp-owned-commands.test.ts -t "representative command libraries" --timeout 8000
# → fail: save-buffer (typeof resolved === "undefined")
```

Or probe directly:
```bash
# (via a temp bun test using createEditorFixture)
const r = editor.getInterpreter().moduleRegistry;
const save = r.resolve("editor/commands/save");
save.env.lookup("save-buffer");   // → undefined (BUG)
save.exports.has("save-buffer");  // → true
r.resolve("editor/commands/find-file").env.lookup("find-file"); // → <object> (works)
```

## Root Cause Analysis

`src/tlisp/core/commands/save.tlisp` line 5:

```lisp
          save-some-yes-no-table save-some-accept save-some-prompt-next))
```

The first `)` closes the `(export …)` sub-list; the **second `)` closes `(defmodule editor/commands/save …)`** — so `(defmodule editor/commands/save (export …))` is a complete top-level form with **zero body forms**. Verified: `parseProgram(save.tlisp)` returns **19 top-level forms** (form `[0]` = the empty defmodule with `#children=1`; forms `[1]`–`[18]` = the orphaned `defvar`/`defun`s). `find-file.tlisp` line 4 uses a single `)` after its export → defmodule stays open → its defuns are body children → bind in `moduleEnv`.

Load chain:
1. `interpreter.execute(source)` evaluates top-level forms in `globalEnv`. Form `[0]` runs `evalDefmoduleForm`: creates `moduleEnv`, the body loop has **zero iterations**, calls `register("editor/commands/save", moduleEnv, exports, "")` → `state="loaded"`, exports populated, **`moduleEnv.bindings` empty**. Returns `Right` (no error — `setFailed` is never hit because the body loop is empty).
2. Forms `[1]`–`[18]` (the orphans) evaluate in `globalEnv` → bind there.

Result: the module record has exports but an empty env; `resolveUniqueExport` (which requires both `exports.has` AND `env.lookup`) fails. BUG-60/#109 fail-loud didn't catch it because there's no parse error and no required-module load failure — the module loads "cleanly," just with the wrong binding target.

## Relevant Files

Use these files to fix the bug:

- **`src/tlisp/core/commands/save.tlisp`** — the defect (line 5 doubled `))`) + the fix site (relocate one `)` to EOF).
- **`src/tlisp/core/commands/find-file.tlisp`** — the correct structure to mirror (single `)` after export, line 4).
- **`src/tlisp/evaluator/module-forms.ts`** — `evalDefmoduleForm` (~lines 156-275); add the defensive "exports declared but body empty" warning after the body loop (~line 269, before `register`).
- **`test/unit/lisp-owned-commands.test.ts`** — the failing test; strengthen to report all names (not bail on first).

### New Files
None.

## Step by Step Tasks

### Restore the `save.tlisp` defmodule body

**User Story**: As a tmax user, I want `save-buffer` (and all save commands) to be real module exports resolvable via `resolveUniqueExport` + M-x, so that module introspection and the command registry are accurate.

- In `src/tlisp/core/commands/save.tlisp`, change line 5 `…save-some-prompt-next))` → `…save-some-prompt-next)` (remove ONE closing paren so the defmodule stays open after the export clause).
- Add one closing `)` at end of file (after the final `save-all-buffers` defun) to close `(defmodule editor/commands/save …)`.
- Verify the file parses as ONE top-level form (the defmodule) with the defvar + 18 defuns as body children (via a parseProgram probe or the lisp-owned-commands test).

**Acceptance Criteria**:
- [ ] `moduleRegistry.resolve("editor/commands/save").env.lookup("save-buffer")` resolves to the function (and all 13 save exports bind in `moduleEnv`).
- [ ] `parseProgram(save.tlisp)` returns exactly 1 top-level form (the defmodule), not 19.
- [ ] The save commands still work end-to-end (`:w` / `SPC x s` saves the buffer) — confirm via a tmax-use save playbook or eval.

### Add the defensive "empty-body module" guard

**User Story**: As a tmax maintainer, I want the module loader to fail loud when a module declares exports but binds nothing, so a future stray-paren can't silently produce an empty-bodied module.

- In `src/tlisp/evaluator/module-forms.ts` `evalDefmoduleForm`, after the body-evaluation loop (before `register`), add: if `exports.size > 0` AND none of the exported names are `env.lookup`-able in `moduleEnv`, emit a loud `console.warn` naming the module + its unbound exports (do NOT throw — warn, so a legit edge case doesn't break startup; the regression test below enforces the real contract).

**Acceptance Criteria**:
- [ ] A synthetic empty-bodied `(defmodule test/empty (export f))` triggers the warning.
- [ ] Legitimate side-effect modules (e.g. tabs, indent rules — body forms present, possibly no exports) do NOT trigger it.
- [ ] Existing module-system tests stay green.

### Strengthen the regression test

**User Story**: As a tmax maintainer, I want the representative-command-libraries test to report ALL unbound names (not bail on the first), so future module-binding gaps are fully visible.

- In `test/unit/lisp-owned-commands.test.ts`, collect failures across the full name list before asserting (so one missing name doesn't mask others).

**Acceptance Criteria**:
- [ ] The test passes (all 18 names resolve) after the save.tlisp fix.
- [ ] If a name is missing, the failure message lists ALL missing names.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions:

- `bun test test/unit/lisp-owned-commands.test.ts --timeout 8000` — the previously-failing test now passes (all 18 representative commands resolve).
- `bun test test/unit/module-system.test.ts test/unit/tlisp-standalone-module-loader.test.ts --timeout 8000` — module-system regression.
- `bun run typecheck` — clean (src + test + tmax-use + bench).
- `bun test test/unit/save-command.test.ts test/unit/file-primitives.test.ts --timeout 8000` — save primitives unaffected (or the relevant save test file).
- A save round-trip check: `HOME=$(mktemp -d) bin/tmax-use test tmax-use/playbooks/eval-28-write-file.yaml --reporter term` (write-file uses the save path) — confirms `:w` still works end-to-end with save-buffer now a proper module export.
- `bun run test:unit` — full suite advances past `lisp-owned-commands.test.ts` (batch 41) — i.e. the runner no longer stops there. (The BUG-72 intermittent stall, #122, is separate.)

## Notes

- This is the same family as BUG-63 (#112, "exported but not bound in module env") but a different trigger — BUG-63 was a source typo (export name ≠ defun name); this is a structural paren imbalance (premature defmodule close). The defensive guard above catches both shapes ("exports declared but nothing bound").
- The bug was masked at runtime because `funcall "<name>"` consults `globalEnv` first (`stdlib.ts:57`), so the leaked global bindings kept the commands working. Only `resolveUniqueExport` / M-x resolution / module introspection saw the empty env.
- Discovered via the #121 test:unit sweep (the runner stops at the first failing batch, so this only surfaced after the `<M-x>` + `write-file-content` failures were fixed).
- Investigated by 3 parallel agents (bisect + mechanism + differential) — all three independently converged on the save.tlisp:5 doubled-`)` root cause.
