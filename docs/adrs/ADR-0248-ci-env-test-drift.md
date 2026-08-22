# ADR-0248: Environment-dependent test drift — pin semantics, not positions

**Date:** 2026-08-22
**Status:** Accepted
**Issue:** #198
**Spec:** SPEC-198

## Context

After the CI hang fix, CI failed fast on environment-dependent tests. The
longest-standing one (key-bind-enhancements "conflicting bindings") had
been parked as "needs a deliberate user decision" for weeks. Investigation
showed the decision was never needed.

## Decision

1. **Attribute test failures to MECHANISMS, not vibes.** The key-bind test
   failed because it indexed a flat per-key mapping list by POSITION; the
   list legitimately carries entries for multiple modes in insertion
   order. The override semantics it sought were implemented all along
   (same key+mode+majorMode entries are replaced; dispatch provably runs
   the new binding). Tests must SELECT by identity (mode), never by list
   position.
2. **Playbooks are living tests — they drift with the engine and get
   repaired, not pinned to old behavior.** Three of the four playbook
   failures were drift from correct later landings (ADR-0208 describe
   surfaces; module-scoped hook resolution #214; the splash read-only
   daemon seeding). Each repair re-anchors the playbook to the CURRENT
   contract (e.g. assert the `"Major mode:"` invariant rather than a
   specific mode that depends on which buffer is current).
3. **Self-contained test hooks must not depend on cursor identity.**
   `buffer-switch` resets the cursor and `buffer-insert` inserts at it —
   switch-then-insert PREPENDS. Hook-style probes that append markers move
   to the buffer end first.

## Consequences

- No production code changed in this issue — the engine was right four
  times; the tests were wrong four times.
- The last known `test:unit` red is gone; the CI run after landing is the
  real verdict on the "short tail".
