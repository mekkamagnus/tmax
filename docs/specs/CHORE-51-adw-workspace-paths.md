# Chore: ADW workspacePaths factory (#12)
## Completion Criteria
- [x] workspacePaths(agentsDir) factory exported from dispatcher-runtime.ts.
- [x] 4 generic stage scripts (build, plan, spec-review, patch-review) use it (curry removed).
- [x] 2 specialized scripts (test with "tester" agent, orchestrator with "orchestrator" agent + injected agentsDir) keep their agent-hardcoded curry (genuinely different, not duplication).
- [x] typecheck clean; adw tests pass.
## Notes
Codex CONCERNS: preserve agentsDir seam (factory takes agentsDir param). Specialized curry (hardcoded agent names) is NOT the target duplication.
