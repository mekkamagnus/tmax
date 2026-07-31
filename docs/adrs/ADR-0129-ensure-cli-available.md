# ADR-0129 — Generic ensureCliAvailable() (#15)
## Status: Accepted
## Context: 3 byte-identical ensureAvailable guards (builder, patch-reviewer, tester) each ran deps.run(CLAUDE,["--version"],{cwd}) + mapped to the same install message.
## Decision: Generic ensureCliAvailable(run, cmd, cwd, installHint?) in dispatcher-runtime.ts. Each module's ensureAvailable delegates with its Deps.run + CLAUDE + cwd. cwd preserved (codex).
## Consequences: ~15 lines removed; single source for the probe + install message.
