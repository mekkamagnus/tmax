# ADR-0127 — Shared lock-file primitives (#11)
## Status: Accepted
## Context: readLock (file-read + JSON.parse + null-on-failure) was duplicated in server.ts and sweep.ts with divergent return types (LockData.pid:number vs LockEntry.pid:number|undefined). lockPathFor was server.ts-only.
## Decision: src/server/lock-file.ts exports lockPathFor + readLockRaw (the shared parsing). Each consumer wraps readLockRaw in its own type. isProcessAlive/writeLock/tryAcquireLock stay local (sweep uses injected kill for testability; write/tryAcquire are server-only).
## Consequences: Shared parsing logic (single source of truth for file-read + JSON.parse + null); divergent shapes preserved per codex; typecheck clean + tests green.
