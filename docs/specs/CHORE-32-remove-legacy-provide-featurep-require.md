# Chore: Remove legacy provide/featurep/require (SPEC-003, SPEC-007)

## Chore Description

Delete the legacy feature-loading API — `(provide FEATURE)`, `(featurep FEATURE)`, and `(require FEATURE &optional FILE)` — from the T-Lisp runtime entirely, completing SPEC-007 Phase 4/5 and AC#9.

**Why this is a removal, not an implementation:** SPEC-046 item 1 framed this as "make `provide`/`featurep`/`require` truthful." That work is **already done** — `module-registry.ts` has a `providedFeatures: Set<string>`, `evalProvide` registers into it, `evalFeaturep`/`evalRequire` query it, and `test/unit/provide-featurep.test.ts` + `module-system.test.ts:69-84` pass. The truthful mechanism works in both the editor and standalone interpreters (verified by direct probe).

The real open work is the **opposite** direction: SPEC-007 (the module-system spec, the later authority) requires these legacy APIs **deleted** in favor of the pure `defmodule`/`require-module` module system. SPEC-007 §34, Step 12 (line 209-219), Phase 5 (line 109), and AC#9 are explicit:

> "Legacy feature-loading APIs are removed in the editor runtime as well as the standalone interpreter. `(provide ...)`, `(require ...)`, and `(featurep ...)` must be unavailable."

The decision for this chore (confirmed with the user) is: **follow SPEC-007 — delete entirely.** Module identity and dependency declaration happen exclusively through `defmodule` + `require-module` (qualified/aliased/selective imports), backed by `ModuleRegistry`/`ModuleLoader`.

**Scope of deletion:**
- The three special forms in `src/tlisp/evaluator.ts` (`evalProvide`, `evalFeaturep`, `evalRequire`) and their sync + async dispatch cases.
- The backing state in `src/tlisp/module-registry.ts` (`providedFeatures`, `provideFeature()`, `hasFeature()`).
- All 15 live `(provide "...")` calls in core `.tlisp` files. These are vestigial — the files are already `defmodule`-wrapped (e.g. `python-mode.tlisp` is `(defmodule editor/modes/python (export) ...)`), so the `(provide ...)` lines register feature strings nothing actually gates on except the tests. They are simply removed.
- The three test files that assert the legacy APIs work (`test/unit/provide-featurep.test.ts`, the `module-system.test.ts:69-84` block, `test/tlisp/modes.test.tlisp:4-6`).

**After this chore:**
- `(provide "x")`, `(featurep "x")`, `(require "x")`, and `(require "x" "file.tlisp")` all fail as unresolved symbols/special forms in BOTH the editor and standalone interpreters.
- `ModuleRegistry` no longer carries any feature-tracking state.
- Module loading is exclusively `(require-module NAME [:as ALIAS | :import (SYMBOLS...)])`, unchanged.
- `rg '(provide|featurep|\(require )' src/tlisp/core src/editor/api/load-ops.ts src/editor/tlisp-api.ts` finds no live legacy feature-loading API calls or registrations.

## Relevant Files
Use these files to resolve the chore:

**Source — delete legacy special forms and backing state:**
- `src/tlisp/evaluator.ts` — Contains the three special forms to delete: `evalProvide` (line 494), `evalFeaturep` (line 523), `evalRequire` (line 550); and their dispatch cases in the sync evaluator (`case "provide"`/`"featurep"`/`"require"` at lines 649-654) and the async tail-call dispatcher (`case "provide"`/`"featurep"`/`"require"` at lines 751-753). After removal, these forms fall through to the default case and fail as unresolved symbols.
- `src/tlisp/module-registry.ts` — Delete the feature-tracking state: `providedFeatures: Set<string>` (line 41), `provideFeature()` (line 58), `hasFeature()` (line 63). `ModuleRegistry` keeps only module records (`register`/`resolve`/loading state).

**Source — verify clean (no edits expected, but verify):**
- `src/editor/api/load-ops.ts` — Already contains only `load`/`load-path-add`/`load-path-list` (no provide/featurep/require). SPEC-007 Step 5 target; confirm it stays clean.
- `src/editor/tlisp-api.ts` — Already wires none of the legacy APIs. Confirm it stays clean.
- `src/tlisp/profiles/standalone.ts` — Registers none of the legacy APIs directly (they come from the evaluator special forms, which we're deleting). Confirm the standalone interpreter fails on all three forms after the change.

**Core T-Lisp libraries — delete the 15 vestigial `(provide ...)` calls (files already `defmodule`-wrapped; just remove the lines):**
- `src/tlisp/core/modes/python-mode.tlisp:9` — `(provide "python-mode")`
- `src/tlisp/core/modes/line-numbers-mode.tlisp:38` — `(provide "line-numbers-mode")`
- `src/tlisp/core/modes/markdown-mode.tlisp:110` — `(provide "markdown-mode")`
- `src/tlisp/core/keymaps.tlisp:159` — `(provide "keymaps")`
- `src/tlisp/core/commands/messages.tlisp:19` — `(provide "messages")`
- `src/tlisp/core/commands/observability.tlisp:36` — `(provide "observability")`
- `src/tlisp/core/commands/browse-url.tlisp:415` — `(provide "browse-url-commands")`
- `src/tlisp/core/commands/markdown.tlisp:1990` — `(provide "markdown-commands")`
- `src/tlisp/core/fikra/fikra-workflow.tlisp:86` — `(provide "fikra-workflow")`
- `src/tlisp/core/fikra/fikra-capture.tlisp:113` — `(provide "fikra-capture")`
- `src/tlisp/core/fikra/fikra-mode.tlisp:81` — `(provide "fikra-mode")`
- `src/tlisp/core/fikra/fikra-adapter.tlisp:80` — `(provide "fikra-adapter")`
- `src/tlisp/core/fikra/fikra-backend-claude.tlisp:54` — `(provide "fikra-backend-claude")`
- `src/tlisp/core/fikra/fikra-chat.tlisp:121` — `(provide "fikra-chat")`
- `src/tlisp/core/fikra/fikra-context.tlisp:25` — `(provide "fikra-context")`

**Tests — remove or rewrite legacy-API assertions:**
- `test/unit/provide-featurep.test.ts` — Entire file tests the legacy API (`describe("SPEC-003/SPEC-007: truthful provide/featurep/require")`, 7 tests). DELETE the file; replace with negative tests (see New Files).
- `test/unit/module-system.test.ts` — The block at lines 69-84 (`test("editor runtime supports truthful provide/featurep/require (SPEC-003/007)")`) asserts all three legacy forms work. REPLACE it with assertions that all three forms (and the two-argument `(require "x" "file.tlisp")` form) now FAIL (Left). Keep the rest of the file (require-module tests) intact.
- `test/tlisp/modes.test.tlisp:4-6` — The `mode-features-loaded` `deftest` calls `(featurep "python-mode")` and `(featurep "line-numbers-mode")`. REWRITE to assert mode presence through the module system instead (e.g. `(module-lookup ...)` or that the mode is registered via `(major-mode-list)`/`(minor-mode-list-all)`), or delete the test if it's redundant with other mode-registration tests.

### New Files
- `test/unit/legacy-feature-api-removed.test.ts` — New test file asserting the legacy APIs are gone in BOTH interpreters (editor `TLispInterpreterImpl` and standalone via `createStandaloneInterpreter`): `(provide "x")`, `(featurep "x")`, `(require "x")`, and `(require "x" "file.tlisp")` all return `Left`, and that calling them does not mutate `ModuleRegistry` (no feature state exists to mutate). This is the positive assertion of SPEC-007 AC#9.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Delete the legacy special forms and dispatch in evaluator.ts
- Remove the `evalProvide` method (starts at line 494), the `evalFeaturep` method (starts at line 523), and the `evalRequire` method (starts at line 550) from `src/tlisp/evaluator.ts`.
- Remove the three sync dispatch cases at lines 649-654: `case "provide": return this.evalProvide(...)`, `case "featurep": return this.evalFeaturep(...)`, `case "require": return this.evalRequire(...)`.
- Remove the three async tail-call dispatcher cases at lines 751-753: `case "provide":`, `case "featurep":`, `case "require":` (the ones that route to `evalList`).
- After removal, verify the three forms are NOT reachable as builtins anywhere else (they were special forms, not stdlib builtins, so no other registration site exists — but grep to confirm).

### Delete the feature-tracking state from module-registry.ts
- Remove `providedFeatures: Set<string>` (line 41), `provideFeature()` (line 58), and `hasFeature()` (line 63) from `src/tlisp/module-registry.ts`.
- Remove any imports/types that become unused as a result.
- `ModuleRegistry` now exposes only module-record state: `register`, `resolve`, and loading-state tracking.

### Remove the 15 vestigial `(provide ...)` calls from core .tlisp files
- Delete the single `(provide "...")` line in each of the 15 files listed in Relevant Files. These files are already `defmodule`-wrapped; the provide lines are vestigial and load nothing.
- Do NOT otherwise edit these files. The `defmodule`/`export`/`require-module` structure stays as-is.

### Update test/unit/module-system.test.ts
- Replace the `test("editor runtime supports truthful provide/featurep/require (SPEC-003/007)")` block (lines 69-84) with a block asserting all three legacy forms FAIL in the editor interpreter: `(provide "x")` → Left, `(featurep "x")` → Left, `(require "x")` → Left, and the two-argument `(require "x" "file.tlisp")` → Left.
- Keep all `require-module` tests (lines 16-66) unchanged — the module system is the replacement and must keep passing.

### Delete test/unit/provide-featurep.test.ts
- Delete the entire file. Its 7 tests assert the legacy API works, which is the opposite of the target state.

### Rewrite test/tlisp/modes.test.tlisp mode-feature assertions
- Replace the `mode-features-loaded` `deftest` (lines 4-6) so it no longer calls `(featurep ...)`. Assert mode presence through the module system or mode registry instead (e.g. that `"python"` and `"line-numbers"` appear in `(major-mode-list)` / `(minor-mode-list-all)`, or via `(module-lookup ...)`). If no equivalent module-system assertion is straightforward, delete the deftest and leave a comment noting modes are now identified by defmodule, not feature strings.

### Create test/unit/legacy-feature-api-removed.test.ts
- New file asserting the legacy APIs are unavailable in BOTH the editor interpreter (`new TLispInterpreterImpl()`) and the standalone interpreter (`createStandaloneInterpreter()`).
- For each of `(provide "x")`, `(featurep "x")`, `(require "x")`, `(require "x" "file.tlisp")`: assert the result is `Left`.
- Assert that after attempting these calls, the interpreter's `moduleRegistry` exposes no feature API (the `provideFeature`/`hasFeature` methods are gone — this is enforced by TypeScript at compile time once removed, so the test primarily asserts runtime Left results).

### Verify editor and standalone API surfaces are clean
- Confirm `src/editor/api/load-ops.ts` contains only `load`/`load-path-add`/`load-path-list` (no edits needed — already clean per research).
- Confirm `src/editor/tlisp-api.ts` wires none of the legacy APIs (already clean).
- Confirm `src/tlisp/profiles/standalone.ts` registers none of the legacy APIs (inherits from evaluator special forms, which are now gone).

### Run the Validation Commands
- Execute every command in the Validation Commands section, top to bottom, and confirm each passes with zero errors before declaring the chore complete.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run typecheck:src` — Confirm no TypeScript errors after removing the evaluator methods, registry methods, and test file.
- `bun run typecheck:test` — Confirm the rewritten/new test files typecheck.
- `bun run typecheck` — Full typecheck (src + test).
- `bun test test/unit/module-system.test.ts` — The require-module tests (lines 16-66) must still pass; the rewritten legacy-API block must now assert Left for all three forms.
- `bun test test/unit/legacy-feature-api-removed.test.ts` — New negative tests pass: all four legacy forms return Left in both interpreters.
- `bun test test/unit/` — Full unit suite; zero regressions. (Note: `test/unit/provide-featurep.test.ts` is deleted, so it must not appear in the run.)
- `bash -lc 'set -euo pipefail; bin/tmax --stop 2>/dev/null || true; rm -f /tmp/tmax-$(id -u)/server.lock; bin/tmax --daemon >/tmp/tmax-chore32.log 2>&1 & for i in $(seq 1 100); do bin/tmaxclient --ping >/dev/null 2>&1 && break; sleep 0.1; done; bin/tmaxclient --ping >/dev/null; bin/tmaxclient --eval "(load \"test/tlisp/modes.test.tlisp\")"; trap "bin/tmax --stop 2>/dev/null || true" EXIT; echo OK"'` — Daemon starts cleanly with the 15 `(provide ...)` calls removed; the rewritten modes test loads without error.
- `rg '(^|[^[:alnum:]_-])\(provide |\(featurep |\((require) ([[:alnum:]]|"|\()' src/tlisp/core src/editor/api/load-ops.ts src/editor/tlisp-api.ts` — MUST find no live legacy feature-loading API calls or registrations (empty output expected; a nonzero rg exit with no matches is the success signal).

## Notes

- **SPEC reconciliation:** SPEC-003 originally asked for truthful `provide`/`featurep`/`require`; that was implemented and works. SPEC-007 (later) supersedes it and mandates deletion in favor of the `defmodule`/`require-module` system. This chore implements the SPEC-007 end state. The user confirmed this direction explicitly.
- **The `(provide ...)` calls are vestigial, not load-bearing.** Each core `.tlisp` file is already wrapped in `(defmodule ...)`. The `(provide "feature")` lines only register feature strings that `featurep` checks, and the ONLY consumers of those feature strings are the tests being updated/removed in this chore. No production code gates on `(featurep ...)` or `(require FEATURE)`. Deleting the lines is safe.
- **`(require MODULE)` vs `(require-module MODULE)`:** These are different. `(require-module ...)` is the SPEC-007 module system and stays. `(require FEATURE ...)` is the legacy Emacs-style feature loader being deleted. The validation grep distinguishes them by matching `(require ` followed by a string or bare feature symbol, not `(require-module`.
- **Do not remove `(load)`, `(load-path-add)`, or `(load-path-list)`** from `load-ops.ts`. SPEC-007 §34 explicitly permits load-path APIs "if they are explicitly scoped to raw file evaluation and are not used for module dependency resolution" — which is exactly their current scope. Only the three feature APIs are deleted.
- **The standalone interpreter inherits these forms from the evaluator** (verified: `src/tlisp/profiles/standalone.ts` does not separately register them). Deleting the evaluator special forms removes them from both profiles automatically; no standalone-specific edits are needed beyond the new negative test covering `createStandaloneInterpreter`.
