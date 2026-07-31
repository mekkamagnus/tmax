# ADR-0125 — Single RawRunResult export (#13)
## Status: Accepted
## Context: RawRunResult ({ok,exitCode,stdout,stderr}) was byte-identical in 3 modules.
## Decision: dispatcher-runtime.ts is the canonical source. tester.ts + patch-reviewer.ts import type + re-export (preserving their public surface for test consumers).
## Consequences: Single source of truth; type-only change; codex APPROVE-WITH-CONCERNS.
