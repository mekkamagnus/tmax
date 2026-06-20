# SPEC-047: `*daemon*` Event Buffer — Architectural Decisions

## Status

Accepted — implemented (working tree, not yet committed as of 2026-06-16).

## Context

The daemon emitted client connect/disconnect events via ad-hoc `console.log` calls (`src/server/server.ts:1024`, `:1118`). This caused two problems:

1. **Stdout noise corrupted the TUI render surface.** In the embedded `bin/tmax` process (`src/main.tsx`), the SteepFrontend renders into the same terminal whose stdout the daemon writes to. Every `tmaxclient` connection printed `Client connected: <id>` over the editor view — observed directly during the `bin/tmax` + `tmaxclient --keys` workflow work.
2. **No in-editor observability for connection events.** The events were neither structured nor queryable from inside the editor. SPEC-001 had already introduced structured RPC observability (`--status`/`--clients`/`--frames`/`client-event`) for the Python harness and machine consumers, but there was no buffer a user or agent could read to see a chronological connection log.

The natural sink — `*Messages*` — was the wrong one: `*Messages*` is the user-facing editor event log (`logMessage`), and connection chatter would add noise there. During scoping, "log all agent RPC actions to a buffer" was also considered and explicitly deferred (see RFC-017) on volume, hot-path, and leakage grounds.

## Decisions

### 1. A dedicated `*daemon*` virtual buffer, separate from `*Messages*`

Create a `*daemon*` buffer at editor startup (`src/editor/editor.ts:210`, alongside `*Messages*` at `:200`), fed by a second `MessageLog` ring instance (`daemonLog`, `:106`). Connection events flow here exclusively; `*Messages*` is untouched.

**Why separate rings, not one ring with a level/filter:** the audiences differ (`*Messages*` = editor events a user must see; `*daemon*` = daemon lifecycle, quiet by default), and the default `MessageLog.render()` rebuild-on-write cost is acceptable only because connection events are low-frequency. A single shared ring would either pollute `*Messages*` or require every `*Messages*` consumer to filter — both worse.

### 2. Reuse `MessageLog` verbatim, do not subclass

`daemonLog` is a plain `new MessageLog()` (`src/editor/message-log.ts`), not a subclass. The ring already provides timestamp formatting, severity levels, `maxSize` cap, and `render()`. Adding a `DaemonEventLog` type would duplicate working machinery for no behavioral difference. The only `*daemon*`-specific logic is the `logDaemonEvent(event, detail?)` wrapper (`editor.ts:2341`) that formats `event detail` into a single text line.

### 3. Replace the `console.log` calls at the source; guard for the no-editor path

Both `console.log` sites in `server.ts` are replaced with `this.editor?.logDaemonEvent('client-connected'|'client-disconnected', clientId)`. The optional chain (`?.`) is load-bearing: the standalone-daemon path (`bin/tmax --daemon`, `new TmaxServer(undefined, false)` without an editor) has `this.editor` assigned but in test/non-embedded modes the call must degrade to a no-op rather than crash. Verified live: standalone daemon serves requests across connections without error.

### 4. Add a `daemon-buffer` T-Lisp primitive (mirroring `messages-buffer`)

SPEC-047 AC7 specifies that `(switch-to-buffer "*daemon*")` renders the event log. In practice, no generic named-buffer-read or buffer-switch primitive exists in the T-Lisp API — only the hardcoded `messages-buffer` primitive (`tlisp-api.ts:639`) that reads `*Messages*` by name. To make AC7 genuinely verifiable in the running editor (and to give agents/users a way to read the log without buffer switching), a `daemon-buffer` primitive was added (`tlisp-api.ts:650`) mirroring `messages-buffer` exactly.

This adds minor API surface not enumerated in the SPEC's "Relevant Files" table. It is the smallest change that satisfies AC7 without inventing a generic buffer-switching protocol (which would be scope creep and is partially covered by the buffer-name-keyed access pattern `*Messages*` already establishes).

### 5. Buffer naming: `*daemon*` (singular) is distinct from `*daemons*` (SPEC-043, plural)

SPEC-043 reserves `*daemons*` (plural) for an on-demand discovery list of running daemon *instances* (name/socket/pid) — currently unimplemented. This ADR's buffer is `*daemon*` (singular): the connection-lifecycle event log for *this* daemon, created at startup. The naming distinction is deliberate and documented in `src/editor/CLAUDE.md` to prevent future conflation. The full special-buffer set is now: `*scratch*`, `*Messages*`, `*daemon*`, and (future, SPEC-043) `*daemons*`.

### 6. Quiet by default; observable on demand

The buffer is created at startup but never auto-displayed. Users/agents see it only via `(daemon-buffer)` or by switching to it. This matches the `*Messages*` convention (exists always, shown when relevant) and avoids imposing the log on users who never use multi-client workflows.

## Consequences Summary

### Positive

- **No more TUI render-surface corruption.** `tmaxclient` connections no longer print to stdout; verified via tmux capture.
- **Human- and agent-readable connection observability** without polling structured RPC. `(daemon-buffer)` returns the chronological log; `getDaemonLog()` exposes the ring to TypeScript consumers/tests.
- **`*Messages*` stays clean** of daemon plumbing — the separation is enforced structurally (separate rings), not by convention.
- **Minimal, pattern-consistent code.** Reuses `MessageLog` and the `messages-buffer` primitive pattern; no new log type or buffer machinery.
- **Standalone-daemon path preserved** — the `?.` guard keeps SPEC-001's structured RPC as the observability surface when no editor is attached.

### Negative

- **Two rings to reason about.** A future feature wanting "all events" must query both `messageLog` and `daemonLog`. Acceptable given the distinct audiences; documented in `src/editor/CLAUDE.md`.
- **Minor API surface growth** (`daemon-buffer` primitive) beyond the SPEC's file list — justified by AC7 but worth noting for anyone auditing primitive bloat.
- **No retroactive events.** When a TUI attaches to an already-running standalone daemon, the `*daemon*` buffer reflects only events *after* the editor attached; earlier connections remain observable only via SPEC-001 structured RPC. This is acceptable — the daemon-side state (SPEC-001) remains the source of truth for full history.
- **Hot-path caveat for future expansion.** `MessageLog.render()` rebuilds the buffer string on every `log()`. This is fine for low-frequency connection events but would be unacceptable on a high-frequency RPC path — which is exactly why RFC-017 (agent activity logging) was deferred and would require a lazy-render ring if ever implemented.

## Related

- **SPEC-047** — `docs/specs/SPEC-047-daemon-event-buffer.md` (the implemented spec)
- **SPEC-001** — daemon-tmux structured RPC observability (the machine-queryable complement; unchanged by this work)
- **SPEC-043** — named daemons / `*daemons*` discovery list (distinct buffer, unimplemented)
- **RFC-017** — agent activity log (the deferred "log all RPC actions" proposal; documents why this ADR's scope stops at connection events)
- **ADR-0067** — daemon/tmux observability and strict renderer testing (established the daemon-owns-lifecycle-state principle this buffer makes human-readable)
