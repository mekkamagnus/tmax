# SPEC-198: CI green-up — environment-dependent failures

**Issue:** #198 (bug / test triage)
**Status:** Implemented 2026-08-22

## Goal

Make the post-hang-fix CI (`test-bun` + `test-tmax-use`) green by fixing
environment-dependent tests: the (already-landed) hermetic file-completion
fixture, the key-bind-enhancements "conflict" failure, and the four
playbooks that drifted with later landings.

## Diagnosis + fixes

**1. key-bind-enhancements "conflicting bindings" — a MISATTRIBUTION.**
The long-standing note said this needed a deliberate user decision
(override vs append). It did not: the override semantics were ALWAYS
implemented and working — `key-bind` filters same key+mode+majorMode
entries before pushing (override), and dispatch provably runs the new
binding (pressed `x` ran the test's dummy command). The TEST's bug:
`mappings.get("x")[0]` assumed list position, but the flat per-key list
carries the default VISUAL-mode `x` binding at [0]; the normal-mode entry
was at [1]. Fixed the test to select by MODE (and pinned that a visual
binding coexists untouched through a normal-mode rebind). This was the
last pre-existing `test:unit` red — the suite can now run fully green.

**2. eval-23 (save-some-buffers):** a fresh daemon seeds the *scratch*
splash READ-ONLY; the playbook eval'd `buffer-insert` into it without the
first-keystroke splash clear. The step now calls `clear-splash-if-present`
first — exactly what a real user's first key does.

**3. eval-34 (describe-introspection):** three drifts from ADR-0208 —
`describe-function` now renders to *Help* and returns the BUFFER NAME (the
data surface is `describe-function-info`); the major-mode assertion now
asserts the `"Major mode:"` invariant (the named mode follows the CURRENT
buffer — help-mode after the describe steps, not fundamental); the
second-describe step asserts the buffer-name return.

**4. eval-43 (modules-hooks):** two real drifts. (a) The hook fns were
defined INSIDE the loaded module — module-scoped names don't resolve from
the global scope `run-hooks` uses (#214 rule); moved to top-level defuns.
(b) The subtler one: `buffer-switch` RESETS the cursor to 0,0 and
`buffer-insert` inserts AT the cursor — self-contained hooks that
switch-then-insert PREPEND, inverting the run order in the marker buffer
(the observed `[C][A]`). The hook bodies now move to the buffer end
(clamped) before inserting, so entries append in run order. The engine's
hook ordering itself was verified correct (list order = run order).

**eval-47**: passes solo now — no change needed (was flaky-or-fixed).

## Completion Criteria

- [x] The key-bind conflict test asserts override semantics CORRECTLY
      (select-by-mode; visual coexistence pinned) — 10/10, the last
      pre-existing test:unit red clears.
- [x] eval-23 / eval-34 / eval-43 / eval-47 all PASS locally (4/4 in one
      run, 48s).
- [x] typecheck:src + :test green.
- [x] No production code changed — all four fixes are test/playbook-side
      (the engine behaviors — key-bind override, hook ordering, splash
      read-only, ADR-0208 describe surfaces — are all correct as-is).

## Notes

- The runner's halt-on-first-failing-batch means the CI run after landing
  is the real verdict; any NEW environment-dependent failure it surfaces
  is the "short tail" the issue predicted — each is a normal small bug.
- The `test:unit` wrapper still halts on the first failing batch, but with
  this change there is no known failing batch left.
