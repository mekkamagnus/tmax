# Chore: Shared lock-file primitives (#11)
## Completion Criteria
- [x] src/server/lock-file.ts exports lockPathFor + readLockRaw (shared primitives).
- [x] server.ts imports lockPathFor + readLockRaw; local lockPathFor removed; readLock delegates.
- [x] sweep.ts readLock delegates to readLockRaw; divergent shapes preserved (LockData vs LockEntry).
- [x] isProcessAlive/writeLock/tryAcquireLock NOT forced shared (sweep uses injected kill; write/tryAcquire are server-only).
- [x] typecheck clean; 14/0 sweep tests; 38/0 router tests.
## Notes
Codex CONCERNS: share primitives, KEEP divergent shapes. No spec needed per corrected approach.
