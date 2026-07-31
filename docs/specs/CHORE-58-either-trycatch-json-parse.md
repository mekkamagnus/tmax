# Chore: Either.tryCatch for JSON.parse blocks (#25)
## Completion Criteria
- [x] workspace.ts findWorkspaceBySpecPath uses Either.tryCatch for readFileSync + JSON.parse + normalizeSpecPath.
- [x] server.ts + sweep.ts already use readLockRaw (done in #11/CHORE-50).
- [x] typecheck clean; adw tests pass (457/0).
## Notes
Codex CONCERNS: must wrap file-read too (not just JSON.parse). DONE — tryCatch wraps readFileSync + parse + normalize.
