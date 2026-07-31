# Chore: test.skip → test.todo (#33)
## Completion Criteria
- [x] test.skip('...') → test.todo('...') (no dead body, visible in counts).
- [x] ~37 lines of dead test body removed.
- [x] typecheck clean; test file passes.
## Notes
Codex CONCERNS: use bare test.todo (it not imported). DONE.
