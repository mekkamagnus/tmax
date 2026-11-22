# SPEC-330 — Stagehand: cherry-pick + revert (conflict workflow)

## Goal

`c` / `r` in the *Stagehand-Log* view: cherry-pick or revert the
commit at point behind the n-first y/n confirm, with non-conflicting
outcomes refreshing the status view and conflicts routing to the
Conflicted section.

## Completion criteria

- [x] `c`/`r` on a commit row: the n-first y/n confirm (a bare Enter
      cancels; #287's lesson); a non-commit row refuses with the
      named status.
- [x] Non-conflicting outcome: the op runs (argv, no shell); the
      STATUS view refreshes; the log view stays; the status names
      the result.
- [x] Failure without conflicts (e.g. an already-applied ancestor —
      the empty-pick case): the named failure path with the first
      diagnostic line; HEAD unmoved.
- [x] Conflicts (exit ≠ 0 + conflict diagnostics): the status view
      opens showing the Conflicted section; the status names the
      conflict with the `git <op> --abort` advice. The key-driven
      continuation/abort flow rides #295's framework (blocked) —
      the documented v1 ceiling.

## Notes

- The log lists HEAD's ancestors: a cherry-pick from this view
  targets an already-applied commit by construction — the empty-pick
  failure path is first-class, and the primary conflict driver is
  revert-of-an-earlier-change (tested).
