# ADR-0136 — Wire orphaned adws tests (#30)
## Status: Accepted
## Context: process-supervisor.test.ts (10 BUG-25 regression tests) was in adws/adws-modules/ — no npm script discovered it. adw-right-bracket-h.test.ts was a superseded standalone script.
## Decision: Move process-supervisor.test.ts to test/unit/adw-process-supervisor.test.ts (test:adw discovers it). Delete adw-right-bracket-h.test.ts (superseded by tmax-use playbooks, SPEC-048).
## Consequences: 10 BUG-25 supervisor regression tests now run in CI via test:adw. Coverage gain.
