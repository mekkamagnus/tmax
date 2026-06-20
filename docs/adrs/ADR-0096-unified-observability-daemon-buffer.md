# Unified Observability — *daemon* Event Buffer

## Status

Accepted

## Context

The editor had no structured way to observe daemon lifecycle events (connections, disconnections, errors) or editor-internal events. Debugging required `console.log` statements, and there was no persistent record of what happened during a session. SPEC-055 specified a unified observability layer.

## Decision

Implement a three-layer observability system:

1. **`src/editor/log-store.ts` + `log-entry.ts` + `log-persist.ts`** — an in-memory ring buffer of timestamped log entries with optional persistence to disk. The store is a TypeScript primitive (data structure + I/O), not editor logic.
2. **`*daemon*` virtual buffer** — the daemon server (`src/server/server.ts`) writes lifecycle events (connect, disconnect, error) to the log store, surfaced as a read-only buffer viewable in the editor.
3. **`*Messages*` readonly** — the existing `*Messages*` buffer is now read-only and backed by the log store, providing a unified event stream.
4. **`src/tlisp/core/commands/observability.tlisp`** — T-Lisp commands for querying/filtering the log store from editor logic.

## Consequences

**Easier:** Daemon issues are diagnosable by reading `*daemon*`. Events persist across sessions (via `log-persist.ts`). T-Lisp code can query the log programmatically.

**Harder:** The log store adds memory overhead (ring buffer). Persistence writes must be crash-safe.

**Related:** SPEC-055 (unified observability spec), ADR-0093 (daemon event buffer — the initial version this builds on), RFC-017 (agent activity log).
