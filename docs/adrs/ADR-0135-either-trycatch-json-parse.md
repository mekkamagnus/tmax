# ADR-0135 — Either.tryCatch for JSON.parse (#25)
## Status: Accepted
## Context: workspace.ts findWorkspaceBySpecPath used try/catch for readFileSync + JSON.parse + normalizeSpecPath. server.ts + sweep.ts already consolidated via readLockRaw (#11).
## Decision: workspace.ts now uses Either.tryCatch wrapping file-read + parse + normalize. The catch path (corrupt/missing state file → skip) is preserved via the error→false mapping.
