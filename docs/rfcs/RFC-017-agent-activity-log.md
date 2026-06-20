# RFC-017: Agent Activity Log — In-Editor Oversight of Daemon RPC Actions

**Status:** Proposed (deferred — see "Status & Trigger")
**Date:** 2026-06-16
**Related:** [SPEC-047](../specs/SPEC-047-daemon-event-buffer.md) (`*daemon*` lifecycle buffer), [SPEC-001](../specs/SPEC-001-daemon-tmux-observability.md) (daemon RPC observability), [ADR-0020](../adrs/ADR-0020-ai-agent-control.md) (AI agent control protocol)

## Summary

A proposed in-editor, human-readable log of *mutating* daemon RPC actions performed by non-local (remote/agent) clients — e.g. `c-3: keys (5ch)`, `c-3: eval`, `c-3: insert` — distinct from the connection-lifecycle `*daemon*` buffer (SPEC-047) and the structured RPC observability of SPEC-001. This RFC exists to (a) capture the design that was considered and deferred during SPEC-047 scoping, and (b) record the rationale for *not* folding it into the lifecycle buffer, so the decision is retrievable later.

It is **not** approved for implementation. It documents a candidate direction and the trade-offs that must be resolved first.

## Motivation

### The oversight gap

tmax is increasingly agent-controllable: a human runs `bin/tmax file` (a TUI + embedded daemon), and one or more AI agents drive the same daemon over the socket via `tmaxclient --keys`/`--eval`/`--insert`/`--command`. Two recent observations motivate this proposal:

1. **Visible state-changing actions are now seen.** The `onStateChange → requestRender` wiring (in `src/editor/editor.ts` / `src/steep/assam.ts` / `src/main.tsx`) means cursor moves, edits, and mode changes performed by an agent visibly repaint the human's TUI. The original "I can't see what the agent did" problem is solved for *state-changing* input.

2. **A residual gap remains for invisible or non-state-changing activity.** A background `--eval` that changes a setting, opens a buffer the human isn't viewing, or runs a side-effecting command does not move the cursor and is not apparent. Connection events (SPEC-047) can't attribute *what* a client did, only that it connected.

### Why not just extend SPEC-047?

During SPEC-047 scoping, "log all agent actions to `*daemon*`" was considered and rejected. The reasons are the crux of why this is a separate RFC:

| Concern | Lifecycle buffer (SPEC-047) | Activity log (this RFC) |
|---|---|---|
| Event frequency | Rare (connect/disconnect) | High (every RPC) |
| Ring pressure | Low | High — caps at 1000, blows through in seconds under a busy agent |
| Hot-path cost | Negligible | `MessageLog.render()` rebuilds the buffer string on every event — O(n) per RPC |
| Content sensitivity | Metadata (client id) | RPC payloads may include file text, expressions, paths |
| Audience | Humans + agents (either) | Primarily humans (agents already have SPEC-001 RPC) |
| Overlap | None | Risks duplicating SPEC-001 (`requestCount`/`lastRequestAt`/errors) and `*Messages*` (`logMessage`) |

Folding activity logging into the lifecycle buffer would invert its signal-to-noise: the rare, meaningful connection event would be buried under keypress spam, and the hot path would pay an O(n) cost per RPC. Hence a separate surface with its own policies.

### The "for AI agents" framing, reconsidered

The earlier framing ("observability for the user and AI agents") splits by audience:

- **For an AI agent** querying state, SPEC-001's structured RPC (`--status`/`--clients`/`--frames`) is already the better interface than parsing a text buffer. Machine consumers should not depend on this RFC.
- **For a human** watching agent-driven workflows, a readable "what just happened" buffer is a genuine governance/oversight feature — staying in the loop, attributing surprising state changes, reasoning about reversibility.

This RFC is therefore primarily a *human oversight* tool, not an agent-querying tool.

## Design

### Surface

A new virtual buffer, **not** `*daemon*`. Candidate name: **`*rpc*`** or **`*activity*`** (singular `*daemon*` is reserved by SPEC-047 for lifecycle events; `*daemons*` is reserved by SPEC-043 for instance discovery). The three special buffers must stay conceptually distinct:

- `*Messages*` — user-facing editor events (`logMessage`)
- `*daemon*` — this daemon's connection lifecycle (SPEC-047)
- `*rpc*` / `*activity*` — mutating RPC actions by remote clients (this RFC)

### Logging policy (the hard part)

Unrestricted logging of every RPC is the failure mode. The candidate policy:

1. **Mutating methods only.** Log `keypress`, `insert`, `command`, `open` (file). Do **not** log read-only `eval` that merely queries, nor `status`/`clients`/`frames`/`ping`. This excludes the high-frequency, low-value telemetry.
   - *Open question:* `eval` is dual-use — `(quick-save)` mutates, `(cursor-line)` reads. Distinguishing requires either a static heuristic (unsound) or marking commands as mutating (requires T-Lisp cooperation). This is unresolved.

2. **Summary, not contents.** Log `client c-3: keys (5ch)` and `client c-3: eval`, **not** the full payload, unless a verbose/audit mode is explicitly enabled. This bounds the leakage surface and keeps entries small.

3. **Client-type gating.** Log only when the client is **not** the local TUI (i.e., log remote/agent clients). The human's own typing is already visible in the TUI; logging it would duplicate the screen and double the volume.

4. **Sized/sampled ring.** Either a larger cap than SPEC-047's 1000, or a sampling policy under load, or ring-append without the O(n) `render()` rebuild on every event (lazy render — rebuild only when the buffer is *viewed*).

### Performance requirement (non-negotiable)

The current `MessageLog` pattern rebuilds the entire buffer string on every `log()` call (because the `*Messages*` buffer must always reflect current state). That is acceptable for low-frequency lifecycle events. It is **unacceptable** on the RPC hot path. Any implementation must defer the `render()` rebuild to view-time, not log-time. This is the single largest design constraint and likely the reason to introduce a "lazy-render ring" distinct from `MessageLog`, or to add a lazy mode to it.

## Alternatives Considered

1. **Fold into SPEC-047's `*daemon*` buffer.** Rejected — signal-to-noise inversion, hot-path cost, concept-blurring. (See table above.)

2. **Structured RPC only (no buffer); extend SPEC-001.** The "agent-querying" half of the audience is already served by SPEC-001. This alternative says: don't build a buffer at all; add a `--actions --json` endpoint with a recent-action ring. Pro: no hot-path rendering, machine-friendly. Con: doesn't serve the human-oversight audience (no readable in-editor view); defeats the "watch what's happening" goal. Rejected as a *replacement*; acceptable as a *complement* to the buffer.

3. **Log everything, large ring, no policy.** Rejected — volume, leakage, and the ring becomes useless within seconds under a busy agent.

4. **Defer entirely; rely on TUI visibility (post-`onStateChange` fix).** Viable for state-changing actions. Leaves the "invisible background eval" gap unaddressed, but that gap may be acceptable until real agent-driven workflows surface it as a pain point. This is the current posture (why the RFC is deferred).

## Status & Trigger

**Deferred.** Not approved for implementation. Conditions that would justify revisiting:

- Real agent-driven workflows where an agent's non-state-changing actions cause confusion a human cannot diagnose from TUI visibility + SPEC-047 lifecycle events + SPEC-001 RPC.
- A concrete need for attribution across multiple concurrent agent clients on one daemon.
- The lazy-render ring exists for other reasons (then the hot-path objection weakens).

Until then, the combination of (a) the `onStateChange → requestRender` fix (visible mutations), (b) SPEC-047's `*daemon*` lifecycle buffer (connections), and (c) SPEC-001's structured RPC (machine queryability) is judged sufficient.

## Open Questions

- How to distinguish mutating vs read-only `eval` without unsound heuristics or T-Lisp-level cooperation?
- Is the human-oversight value real enough to justify a third special buffer + a new lazy-render ring type, or is the structured RPC of SPEC-001 + TUI visibility enough?
- Should the log distinguish "agent" clients from "human remote" clients (e.g. a human on another terminal)? `clientType` exists but is coarse (`tui` vs others).
- Privacy: even summary-level logging of `--keys` lengths and method names on shared daemons — acceptable default, or opt-in?

## Notes

- This RFC intentionally proposes *policies*, not code. If approved, it should be decomposed into a SPEC (with phases, tests, acceptance criteria) before implementation, mirroring how SPEC-047 was derived.
- Naming: if `*rpc*` feels too protocol-flavored for users, `*activity*` is the user-facing alternative. Decide before a SPEC is written.
- No relationship to SPEC-043 (`*daemons*` discovery list) beyond the shared reservation of special-buffer names — keep them distinct.
