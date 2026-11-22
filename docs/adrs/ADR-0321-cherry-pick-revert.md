# ADR-0321 — Cherry-pick + revert in the log view

**Issue:** #330 · **Spec:** [SPEC-330](../specs/SPEC-330-cherry-pick-revert.md)
**Status:** accepted · **Date:** 2026-11-23

## Context

Split from #290's OUT-OF-SCOPE; #295's continuation/abort framework
(the conflict machinery) is blocked, but the core ops stand alone.

## Decisions

1. **The confirm mirrors checkout** (#287's pattern): n-first table,
   the pending (op sha) list, cancel clears. A bare Enter never
   mutates.
2. **Sync argv execution** (`shell-exec-argv`): cherry-pick/revert
   are fast local ops — the async make-process machinery is not
   warranted; the outcome routes synchronously.
3. **Conflict routing is v1-honest**: exit ≠ 0 + conflict
   diagnostics → the status view opens (the Conflicted section
   visible) with the named advice (`git <op> --abort`); the
   key-driven continuation rides #295's blocked framework — named
   as the ceiling in the spec, not hidden.
4. **The log view lists ancestors**: a cherry-pick from this view is
   an already-applied commit by construction — the empty-pick
   failure path is first-class (tested); the primary conflict
   driver is revert-of-an-earlier-change.
