# ADR-0140 — readLock sum type (#28)
## Status: Accepted
## Context: readLock returned LockData | null, conflating "no lock file" with "corrupt lock."
## Decision: LockReadResult sum type (ok/missing/corrupt). acquireSocket + shutdown match on kind.
## Consequences: Intent legible at call sites; same behavior (missing + corrupt → skip/remove).
