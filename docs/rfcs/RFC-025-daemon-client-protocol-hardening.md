# RFC-025: Daemon/Client Protocol & Lifecycle Hardening (herdr Lessons)

**Status:** PROPOSED
**Created:** 2026-07-23
**Author:** tmax Design Team
**Follows from:** [herdr-client-server-lessons.md](../memos/herdr-client-server-lessons.md), [RFC-002](RFC-002-server-client-architecture.md), [ADR-0058](../adrs/ADR-0058-frame-based-daemon-client.md), [ADR-0093](../adrs/ADR-0093-daemon-event-buffer.md)

## Context

A deep research pass over the [herdr](https://github.com/ogulcancelik/herdr) codebase (Rust agent-aware terminal multiplexer; full cited findings in [herdr-client-server-lessons.md](../memos/herdr-client-server-lessons.md)) surfaced a cluster of high-confidence, currently-applicable hardening lessons for tmax's daemon/client model. herdr hit and fixed several problems tmax has not yet hit — tmax can preempt them cheaply.

### The key asymmetry (verified against tmax source)

tmax and herdr are both daemon/client over a Unix socket, but their **state-distribution models differ**, and this determines which lessons apply:

- **herdr** is *push/event-based*: the server owns runtime state and pushes fine-grained events to every subscribed client. herdr's hardest bugs (slow-client-blocks-others #726, event-queue stalls #265) live in that push path.
- **tmax** is *pull/poll-based*: each TUI client polls `render-state` per frame for its own frame; the handler is read-only by design (`src/server/rpc/handlers/frames.ts:9`, AC5.3). Every `conn.write` in `server.ts` (lines 1054/1087/1113/1137) is a response to the *requesting* client — there is no broadcast path today.

**Therefore the push-path lessons (per-client bounded queues, event backpressure) are deferred** to whenever tmax adopts server-push (gestured by [ADR-0093](../adrs/ADR-0093-daemon-event-buffer.md)). This RFC covers only what applies *now*.

## Proposal

Five changes, each tied to a herdr mistake+fix and a concrete tmax touchpoint.

### 1. Versioned, negotiated wire protocol (anchor change)

[herdr AGENTS.md](https://github.com/ogulcancelik/herdr/blob/master/AGENTS.md) policy (verbatim): *"When changing the server/client wire protocol, compare `PROTOCOL_VERSION` against the latest released tag. Bump it only if the current source protocol is not already greater."* herdr bumped through v5→v7→v8→v9→v10→v11→v14, and only *later* (0.7.5, #1435) retrofitted a machine-readable `protocol_mismatch` error and early-fail detection — because clients were silently attaching to mismatched servers first.

tmax's router currently validates only `jsonrpc === '2.0'` (`src/server/rpc/router.ts:377`, verified) — every client/daemon version skew is silent.

**Change:**
- Add `export const PROTOCOL_VERSION = 1` in `src/server/rpc/types.ts`.
- Surface `protocolVersion` in a handshake / `status` response.
- In `router.ts`, when a client declares a `protocolVersion` that mismatches the daemon's, return a `protocol_mismatch` error (`-32600` family) with stop/restart guidance *before* dispatch.
- (Optional follow-on) `rpc.schema` returning the JSON Schema of all methods, mirroring herdr's `api schema --json` (0.7.2).
- Transition: tolerate clients that omit `protocolVersion` for one release, then enforce.

### 2. Two-phase, socket-liveness-gated `--stop`

herdr 0.7.2 (verbatim): *"`server stop` now waits until both server sockets are unreachable before returning, avoiding an immediate first-start failure when restarting right after replacing the binary."* tmax's `--stop` should do the same: after closing the server, poll `net.connect()` to the socket path until it refuses, *then* return. Prevents the restart-after-binary-swap race.

### 3. Raise/warn on fd soft limit at daemon start

herdr 0.6.4 (#327): fd exhaustion (`dup of fd N failed` / `Too many open files`) hit around **40 live panes** on macOS until they raised the server fd soft limit. tmax opens a socket + PTY per client and many buffer-related fds; it does not raise or warn on the limit today. **Change:** at daemon start, read the fd soft limit; if below a threshold, attempt to raise it (Bun cannot raise the soft limit via `process.resourceUsage()` — use a native addon or spawn `ulimit -n`); otherwise log a clear, actionable warning naming the ceiling.

### 4. Document resume-path guarantees explicitly

herdr separates five resume paths with *different guarantees* (detach/reattach · snapshot restore · screen-history replay · native-agent resume · live handoff). tmax conflates "daemon alive" vs "daemon crashed" under one path. **Change (docs, not code):** in [ADR-0058](../adrs/ADR-0058-frame-based-daemon-client.md) and the daemon/client rules (`rules/daemon-client.md`), name the resume paths tmax supports and what each guarantees — including the explicit statement that **live handoff is not possible on Bun** (herdr's handoff relies on `dup`'d master PTY fds across fork-exec to a new binary, which Bun/Node cannot do).

### 5. Reconcile persisted references against live objects on resume

herdr discussion [#668](https://github.com/ogulcancelik/herdr/discussions/668) documents a "monotonic-seq wedge"; fixes #943/#614/#712/#1189 re-anchor stale session references after restart so resumed panes don't stay tied to abandoned sessions. **Change:** on any resume-from-disk (`src/server/serialize.ts`), reconcile persisted references (frames, buffer handles, etc.) against live objects; discard handles whose backing object is gone rather than trusting the persisted snapshot.

## Out of scope (deferred)

- **Per-client bounded outbound queues / event-push backpressure** — herdr's #726/#265 fixes. Only relevant if/when tmax adopts server-push ([ADR-0093](../adrs/ADR-0093-daemon-event-buffer.md)). tmax's current pull model is immune: each `conn.write` targets only the requesting socket, so no client's slow write blocks another.
- **Snapshot-then-subscribe bootstrap ordering** — herdr 0.7.2. Unnecessary under pull; tmax re-reads full state each frame. Adopt together with push if/when it ships.
- **Self-describing event payload schemas** — herdr's `session.snapshot`/`layout.updated`/`pane.scroll_changed` field shapes were not verified from source (see memo §4). Defer until a concrete push design exists.

## Alternatives

1. **Do nothing — tmax hasn't hit these yet.** Rejected: every item here is a documented herdr *regression* that required a later fix. Preempting is cheaper than retrofitting — herdr's own protocol-version guard shipped ~12 versions late.
2. **Adopt herdr's full push/event model.** Rejected for now: a large architectural change, tmax's pull model is simpler and currently sufficient, and it would import the exact failure modes (#726, #265) herdr spent versions fixing. Revisit if multi-client push becomes a requirement.
3. **Per-item RFCs.** Rejected: these five changes share one source (the herdr research) and a common theme (preempt known daemon/client regressions). One RFC is the right granularity; each change can still become its own SPEC at implementation time.

## Consequences

**Easier:** Client/daemon version skew fails loudly and early instead of silently corrupting a session. `--stop` becomes safe to chain with restart. Resume-from-disk can't wedge on stale references.

**Cost:** Small. Change 1 is ~20 lines across `types.ts` + `router.ts` plus a test. Changes 2–3 are tens of lines in `server.ts`. Changes 4–5 are docs + a reconcile pass in `serialize.ts`. No new dependencies.

**Compatibility:** `PROTOCOL_VERSION` negotiation is additive — old clients that don't send `protocolVersion` can be tolerated during a transition window, then enforced.

## Open questions / unverifiable from the research

See [memo §4](../memos/herdr-client-server-lessons.md). herdr's source internals were not read over the web: the current value of `PROTOCOL_VERSION`, the `protocol_mismatch` error shape, and the event payload schemas are known to *exist* (CHANGELOG) but not their field structure. If we want to mirror herdr's exact shapes, run `herdr api schema --json` against a live install or read `src/protocol/` in the repo. **tmax need not copy the shapes — only the contracts.**
