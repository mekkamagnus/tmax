# ADR-0181 — `save.tlisp` defmodule was prematurely closed; defuns bound in `globalEnv` not `moduleEnv` (#126 / BUG-74)

## Status

Accepted

## Context

`src/tlisp/core/commands/save.tlisp` registered as a module (`state="loaded"`,
`exports` populated with all 13 names) but **none of its `defun`s/`defvar`s bound
in the module env** — `resolveUniqueExport("save-buffer")` returned `undefined`.
The save commands still *ran* (`:w` / `SPC x s` worked) because `(funcall "name")`
resolves through `globalEnv.lookup` first (`src/tlisp/core/stdlib.ts:57`) and the
orphaned symbols had leaked into `globalEnv` — masking the breakage for months.
It surfaced only via module-env introspection (`resolveUniqueExport`, used by the
`lisp-owned-commands` test). Pre-existing (failed at `738bdd0`). Only `save.tlisp`
was affected; every other module (incl. 13 with top-level `(defvar … (hashmap))`)
bound correctly.

## Root cause

A one-character parenthesis defect: `save.tlisp` line 5 ended with a doubled `))` —

```lisp
          save-some-yes-no-table save-some-accept save-some-prompt-next))
```

The first `)` closed `(export …)`; the **second prematurely closed
`(defmodule editor/commands/save …)`**, so the defmodule had an **empty body**.
`parseProgram(save.tlisp)` returned 19 top-level forms (the empty defmodule + 18
orphaned `defvar`/`defun`s). `interpreter.execute()` evaluates top-level forms in
`globalEnv`, so the orphans bound there, not in `moduleEnv`. `evalDefmoduleForm`
registered the module with the populated export set but an empty env — no error
(the body loop had zero iterations, so `setFailed` was never reached). Same family
as BUG-63 (#112, "exported but not bound in module env") but a different trigger
(a structural paren imbalance, not an export/defun name typo).

## Decision

1. **Source fix:** relocate one `)` from line 5 to end-of-file in `save.tlisp` —
   the export clause now closes with a single `)` (defmodule stays open) and a
   closing `)` after the final `defun` closes the defmodule. Net paren count
   unchanged; the defmodule now wraps its 19 body forms, which bind in `moduleEnv`
   (matching `find-file.tlisp`'s structure).
2. **Defensive guard:** in `evalDefmoduleForm` (`src/tlisp/evaluator/module-forms.ts`),
   warn loudly when a **leaf** module (no `require-module` in its body) declares
   exports but binds none of them in its env — the exact signature of this bug.
   Aggregator/parent modules (e.g. `editor/commands/markdown`, which `require-module`s
   its children + re-exports) are excluded via a `hasRequireModule` flag, since they
   legitimately bind nothing in their own env. The warn (not throw) surfaces future
   stray-paren defects at load instead of months later.
3. **Strengthened regression test:** `test/unit/lisp-owned-commands.test.ts` now
   collects ALL unresolved/non-function names before asserting (rather than bailing
   on the first), so future module-binding gaps are fully visible.

## Consequences

- `save-buffer` (and all 13 save exports) bind in `moduleEnv` and resolve via
  `resolveUniqueExport`; the `lisp-owned-commands` test passes. The save path still
  works end-to-end (`eval-28` write-file / `:w` green) — `funcall`/resolve reaches
  the module export.
- A future leaf module that declares exports but binds nothing (e.g. another
  premature `))` close) emits a loud load-time warning, preventing a repeat of the
  months-long silent masking.
- `test:unit` advances past the `lisp-owned-commands` batch (it previously stopped
  there), unblocking the next cluster member in the #121 sweep.

## Investigation note

Root-caused by 3 parallel sub-agents (bisect / mechanism / differential) that
independently converged on the `save.tlisp:5` doubled-`)` defect — the
module-system mechanism (`evalDefmoduleForm`, `evalDefun`, env binding) is sound;
the defect was purely structural in the source file.
