# ADR-0128 — ADW workspacePaths factory (#12)
## Status: Accepted
## Context: 4 generic stage scripts each curried appendEvent/writeState with AGENTS_DIR (~6 lines each, byte-identical).
## Decision: workspacePaths(agentsDir) factory in dispatcher-runtime.ts. The 4 generic scripts (build/plan/spec-review/patch-review) use it. 2 specialized scripts (test="tester", orchestrator="orchestrator"+injected agentsDir) keep their agent-hardcoded curry — genuinely different from the generic pattern.
## Consequences: ~20 lines removed; single source for the generic curry; specialized patterns preserved.
