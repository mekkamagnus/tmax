# ADR-0133 — test.skip → test.todo (#33)
## Status: Accepted
## Context: server-observability.test.ts had a test.skip with 37 lines of dead body asserting unimplemented behavior.
## Decision: Replace with test.todo (preserves the test name; no dead body).
