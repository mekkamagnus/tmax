# Bug (pre-existing): `loadInitFile` fallback unit test fails — core bindings resolve to a bogus `/core/...` path

## Goals

- `test/unit/editor-runtime-delegation.test.ts` "loadInitFile falls back to ~/.config/tmax/init.tlisp path on default read failure" passes.

## Completion Criteria (Definition of Done)

- [ ] The CHORE-44 Change 3 `loadInitFile` fallback test is green.
- [ ] No "Failed to load bindings from /core/bindings/<x>.tlisp: File not found" errors during the test (the leading-slash path is the symptom).
- [ ] `bun run test:unit` does not report this failure.

## Bug Description

`test/unit/editor-runtime-delegation.test.ts` — "CHORE-44 Change 3 — BindingRuntime policy (core/fallback/init) > loadInitFile falls back to ~/.config/tmax/init.tlisp path on default read failure" — fails, accompanied by:

```
Failed to load bindings from /core/bindings/insert.tlisp: File not found: /core/bindings/insert.tlisp
Failed to load bindings from /core/bindings/visual.tlisp: File not found: /core/bindings/visual.tlisp
Failed to load bindings from /core/bindings/command.tlisp: File not found: /core/bindings/command.tlisp
Failed to load some core bindings. Last error: Failed to load from /core/bindings/command.tlisp
```

The leading-slash `/core/bindings/...` path indicates the binding loader is resolving the core-bindings root against the wrong base (cwd / a temp dir) in the unit-test fixture, so the fallback path logic doesn't behave as the test expects. **Pre-existing** — confirmed by stashing all Emacs-M×-gap `src/` changes; identical failure. Not caused by that work.

## Problem Statement

The BindingRuntime's core-bindings path resolution is environment-dependent: under the unit-test fixture's cwd it resolves to `/core/bindings/...` (absolute, missing the `src/tlisp` prefix), so binding load fails and the init-file fallback assertion doesn't hold. The production daemon path resolves correctly (playbooks pass), so the bug is latent in the fixture/cwd assumption.

## Solution Statement

Make the core-bindings root resolution file-relative (e.g. `dirname(fileURLToPath(import.meta.url))`-based) rather than cwd-relative, so it resolves identically in the daemon and the unit fixture; or seed the fixture with the correct base path. Reconcile with the CHORE-44 Change 3 BindingRuntime policy.

## Relevant Files

- `test/unit/editor-runtime-delegation.test.ts` — the failing CHORE-44 Change 3 test.
- `src/editor/runtime/binding-runtime.ts` (and wherever core-bindings root is resolved) — the cwd-relative path.
- `src/editor/CLAUDE.md` / CHORE-44 notes — the intended BindingRuntime policy.

## Severity / Notes

- **Priority:** low-medium. Pre-existing; the production path works (binding load succeeds in the daemon), so user-facing impact is limited to the test/fixture. Not from the Emacs-M× gap work.
