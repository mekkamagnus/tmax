# ADR-0141 — test:adw through the BUG-16 force-exit harness (#31)
## Status: Accepted
## Context: test:adw used bare `bun test --timeout 30000 test/unit/adw-*.test.ts` with no force-exit guard — the exact invocation BUG-16 documented as hanging.
## Decision: Added --adw flag to run-unit-tests.ts (inverts the adw-* exclusion to inclusion). test:adw = `bun scripts/run-unit-tests.ts --adw`. The runner's batching + force-exit + SIGKILL + --dots reporter now protect the adw suite.
## Consequences: test:adw gets the BUG-16 stall guard. PER_TEST_TIMEOUT_MS (60s) replaces the hard-coded 30s.
