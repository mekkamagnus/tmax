# herdr → tmax: Client-Server Architecture Lessons

**Date:** 2026-07-23
**Type:** External-research lessons memo
**Source:** Deep multi-agent research pass over the [herdr](https://github.com/ogulcancelik/herdr) codebase (~17k★, Rust agent-aware terminal multiplexer). Methodology: 199 research agents → 140 URLs gathered (57 after dedup) → 28 fetched → 157 claims extracted → 50 adversarially verified (3-vote, default-refute). **43 confirmed, 3 uncertain, 4 killed.**
**Sourcing rule:** Every load-bearing claim cites herdr *primary* sources (repo `CHANGELOG.md`, `AGENTS.md`, `SKILL.md`, `herdr.dev/docs`, discussions #611/#668). No secondary blog/video is load-bearing. Where herdr source internals could not be read over the web, the gap is stated explicitly in §4.
**tmax-side verification:** The load-bearing claims about tmax's own source were independently re-checked against the current tree on 2026-07-23 — `router.ts:377`, `server.ts:1054/1087/1113/1137`, `server.ts:1146/1153/1567`, `frames.ts:9`.
**Feeds:** [RFC-025 — Daemon/Client Protocol & Lifecycle Hardening](../rfcs/RFC-025-daemon-client-protocol-hardening.md)

---

## 0. Critical finding — tmax is pull-based, herdr is push-based

The single most important (and most easily mis-applied) finding. The two projects are both daemon/client over a Unix socket, but their **state-distribution models differ**, and this determines which herdr lessons transfer at all.

- **herdr (push/event model):** the server owns runtime state, emits fine-grained events (`layout.updated`, `pane.scroll_changed`, agent-status), and pushes them to every subscribed attached client over each client's socket. This is where herdr's hardest bugs bit — #726 ("slow client blocks server writes to other clients"), #265 ("event queues stall under load").
- **tmax (pull/poll model):** each TUI client polls `render-state` per render frame for *its own* frame. The handler is explicitly read-only (`src/server/rpc/handlers/frames.ts:9`, AC5.3: "no frame→editor or editor→frame sync"). The four `conn.write` calls at `server.ts:1054/1087/1113/1137` are all **request/response writes back to the single requesting client** — not broadcasts. There is no server-push event path to multiple clients today.

**Consequence:** the slow-client-blocks-everyone and event-queue-stall failure modes **do not currently apply to tmax**, because no client's write blocks another's. They become relevant *only if* tmax adopts server-push notifications (gestured by [ADR-0093](../adrs/ADR-0093-daemon-event-buffer.md)). The push-path lessons below are therefore **conditional / deferred**, not urgent.

---

## 1. Executive summary — six lessons, ranked

| # | Lesson | tmax impact | Confidence |
|---|--------|-------------|------------|
| **1** | **Make the wire protocol a versioned, negotiated contract** — not just "JSON-RPC 2.0". herdr bumps `PROTOCOL_VERSION` on every breaking change and refuses attach on mismatch with stop/restart guidance. | **High** — tmax's router only validates `jsonrpc === "2.0"` (`router.ts:377`, verified); every client/daemon skew is silent. | High (primary: AGENTS.md policy quoted verbatim) |
| **2** | **Snapshot-then-subscribe is the correct bootstrap ordering** *when a push path exists*. herdr clients call `session.snapshot` for the full tree *first*, then subscribe to diff events. | Med-High — applies **if** tmax adopts push; today's pull model avoids the race by re-reading full state each frame. | High (primary) for herdr; Medium for tmax transfer |
| **3** | **Each client needs its own bounded outbound queue IF the server pushes to multiple clients.** herdr #726/0.7.1 decoupled slow-client writes from server throughput. | Conditional — tmax's pull model is immune; risk appears only if push ships. | High (primary) for herdr behavior; TS mechanism **unverified** (§4) |
| **4** | **Closed ids must never be recycled.** herdr moved to stable `w1`/`w1:t1`/`w1:p1` handles (0.7.0) and stopped retargeting closed ids, *because* recycling caused late in-flight RPCs to land on the wrong pane. | Med-High — tmax's `frame-<Date.now()>-<rand>` ids are already monotonic and non-recycling. ✅ already safe. | High (primary) |
| **5** | **Model resume as distinct paths with explicit guarantees**, not one mechanism. herdr separates (a) detach/reattach, (b) snapshot restore, (c) screen-history replay, (d) native-agent resume, (e) live handoff. | **High** — tmax currently conflates "daemon alive" vs "daemon crashed" under one path. | High (primary) |
| **6** | **Crash-restore must reconcile persisted authority against *live* resources**, or stale records linger and wedge detection. herdr discussion #668 documents the wedge; CHANGELOG fixes #943, #614, #712, #1189 re-anchor stale session references. | Medium | High (primary) |

---

## 2. Dimension findings

### Dimension 1 — Daemon Lifecycle & Resume

**herdr's approach (all primary, cited):**
- Persistent daemon/client is the **default** since 0.5.0 (CHANGELOG verbatim): *"herdr now defaults to a persistent server/client session model. running `herdr` starts or reattaches to a background session server instead of launching the old single-process UI."* Single-process survives only as `--no-session`. — same split tmax already has.
- **Socket hygiene:** Unix socket *"restricted to the current user"* (0.4.4); named persistent sessions (0.5.3); long-running waits/subscriptions *"stop cleanly on disconnect or shutdown instead of hanging indefinitely"* (0.4.4).
- **Two-phase, socket-liveness-gated shutdown** (0.7.2): *"`herdr server stop` now waits until both server sockets are unreachable before returning, avoiding an immediate first-start failure when restarting right after replacing the binary."* Live handoff *"waits for slower server shutdowns"* and *"flushes API responses before the old server exits"* (0.7.4, #1180).
- **Raise rlimit on launch** (0.6.4, #327): *"Fixed macOS server startup with large restored sessions by raising the server file descriptor soft limit, preventing new panes from failing with `dup of fd N failed` or `Too many open files` around 40 live panes."*
- **Five distinct resume paths** with different guarantees ([herdr.dev/docs/session-state](https://herdr.dev/docs/session-state)): detach/reattach (processes live) · server restart (layout only, processes gone, screen history only with opt-in) · update without `--handoff` · update with `--handoff` (best-effort live transfer).
- **Auto-save with debounce** since 0.4.5; full-restart restore in 0.5.0.

**Rust→TypeScript translation gap:**
- **Live handoff does NOT transfer to Bun.** herdr's handoff relies on `dup`'d master PTY fds passed to a new binary across fork-exec. Bun/Node cannot fork-exec-and-transfer-fds across a binary swap. What *does* transfer: serialize the session tree to disk on every change (debounced), keep exactly one authoritative owner per resource, and on resume re-read the snapshot rather than trusting in-memory state.
- **Two-phase socket-gated shutdown transfers directly:** Bun's `server.close()` + polling `net.connect()` until it fails is the TS equivalent of "wait until socket unreachable."
- **rlimit raise transfers** but tmax doesn't do it today. `process.resourceUsage()` reports usage but cannot raise the soft limit; a native addon or spawn `ulimit -n` is needed. At minimum, document the ceiling.

### Dimension 2 — Socket Protocol & Framing

**herdr's approach (all primary, cited):**

**2.1 Versioned wire protocol.** `AGENTS.md` policy (verbatim): *"When changing the server/client wire protocol, compare `src/protocol/wire.rs::PROTOCOL_VERSION` against the latest released tag. Bump it only if the current source protocol is not already greater than the latest released protocol."* CHANGELOG shows the bumps, each with stop/restart guidance:

| Version | Release | Verbatim CHANGELOG text |
|---|---|---|
| v5 | 0.5.9 | *"The client/server protocol is now version 5. Stop and restart any running v0.5.8 server before attaching."* |
| v7 | 0.5.11 | *"…protocol is now version 7. Stop and restart any running v0.5.10 server…"* |
| v8 | 0.6.0 | *"…protocol is now version 8. Stop and restart any running v0.5.12 server…"* |
| v9 | 0.6.1 | *"…protocol version 9."* (scrollback-to-direct-attaches) |
| v10 | 0.6.2 | *"…protocol version 10."* (Git worktree API) |
| v11 | 0.6.3 | *"…protocol is now version 11."* (scrollback to direct agent attaches) |
| v12/v13 | — | **No bump appears in 0.6.4–0.6.10 or 0.7.0's breaking-changes section.** Either skipped or internal-only — **could not determine which from CHANGELOG alone** (§4). |
| v14 | 0.7.0 | *"Bumped the client/server protocol version to 14 for `pane.move` compatibility. (#299)"* |

Self-describing schema + status check: `herdr api schema` (with `--json` for full JSON Schema, 0.7.2); `herdr status` reports protocol compatibility + whether a restart is needed (0.5.3). The mismatch retrofit (late, 0.7.5, #1435): *"CLI requests now return a machine-readable `protocol_mismatch` error when the client and server protocols differ."*

**2.2 Permission-tiered attach.** `terminal session observe` (read-only live ANSI stream as newline-JSON) vs `terminal session control` (input + resize + scroll + release + takeover authority) — 0.7.2.

**2.3 CLI is a thin sibling client — spawn-and-wait vocabulary.** [SKILL.md](https://github.com/ogulcancelik/herdr/blob/master/SKILL.md) documents the exact commands an agent uses to synchronously block on a spawned pane — directly relevant to tmax's `adw` subprocess model:
- Spawn-and-run: `herdr pane split 1-2 --direction right --no-focus` → parse `result.pane.pane_id` → `herdr pane run "$NEW_PANE" "npm run dev"`.
- Wait for output (string/regex, timeout-bounded): `herdr wait output 1-3 --match "ready on port 3000" --timeout 30000` (regex via `--regex`; exit 1 on timeout).
- Wait for agent status (state-machine blocking): `herdr wait agent-status 1-1 --status done --timeout 60000`.
- Read pane screen: `herdr pane read 1-1 --source recent --lines 50`.
- 0.7.5 rename: `wait` → `agent wait` / `pane wait-output`, `agent send` → `agent send-keys`; now reports `agent_prompt_stalled` after 5s and `agent_not_running` promptly on pane close (#1439).

**Framing:** newline-delimited JSON — same as tmax.

**Rust→TypeScript translation gap:** Minimal for the contract layer. Rust `enum`-based `EventKind` → TS discriminated union; `PROTOCOL_VERSION` const → TS `export const`. No ownership/threading concerns. The spawn-and-wait vocabulary maps cleanly to JSON-RPC methods (`pane.waitOutput`, `agent.waitStatus`) with timeout params.

### Dimension 3 — Multi-Client State Sync

**herdr's approach (all primary, cited):**
- **Pure state vs runtime separation** (`AGENTS.md` "Principles", verbatim): *"State is separated from runtime. `AppState` is pure data, testable without PTYs or async. `PaneState` is separate from `PaneRuntime`."* And: *"Render is pure. `compute_view()` handles geometry and mutations. `render()` takes `&AppState` and only draws. Never mutate state during render."* Testability hooks: `AppState::test_new()`, `AppState::test_with_adversarial_identity_state()`, `AppState::assert_invariants_for_test()`.
- **Server-owned runtime, TUI is one client** (`AGENTS.md`, explicit migration guardrail, verbatim): *"Herdr is migrating toward a server-owned runtime protocol with the TUI as one client. New work should not deepen the current server/TUI coupling… Do not add new shared behavior that only works through the private TUI client socket."*
- **Per-client write isolation** (#726 behavior verified verbatim): *"Idle or slow clients no longer block server writes to other clients while the blocked client is waiting for output"* (0.7.1); *"App and server event queues no longer stall under load"* (0.6.3, #265). The *implementation* (bounded size, drop-vs-close policy, mpsc vs spawn-per-writer) is **not in CHANGELOG/AGENTS.md and source was not read** — §4.
- **Event-sourced on top of snapshot** (0.7.2): *"Added `session.snapshot` to bootstrap client runtime state in one socket API response before subscribing to events"*; `layout.updated` events; `pane.scroll_changed` subscriptions.
- **Persisted screen history OFF by default** ([docs](https://herdr.dev/docs/session-state)): *"This is off by default because pane output can include secrets, tokens, prompts, and command output."*
- **No client-lifecycle events in the public protocol.** `EventKind` covers workspace/tab/pane only — no attach/detach/active-client-changed (discussion #611). A known gap.
- **Agent-state as a detected, single public field** ([SKILL.md](https://github.com/ogulcancelik/herdr/blob/master/SKILL.md)): `idle | working | blocked | done | unknown`; *"`done` means the agent finished, but you have not looked at that finished pane yet."* Detection reads a dedicated bottom-buffer snapshot, *"not the user-visible viewport"* (`AGENTS.md`); `done` exposed since 0.4.5.

**Transferable lesson (corrected for tmax):** herdr's architecture is **pure-state server → snapshot pull → per-client bounded queue → fine-grained diff events**. tmax already has the pure-state separation (editor state vs connection; `render-state` read-only) but uses a **pull model**. tmax has neither the per-client queue (unnecessary while pull-only) nor the diff-event vocabulary (unnecessary while polling full state). These transfer **conditionally**: adopt them together if/when tmax adds server-push.

---

## 3. CHANGELOG-derived lessons — what herdr got wrong, then fixed

Ranked by preemptability for tmax. All entries verbatim.

| herdr's mistake | How they fixed it (verbatim cite) | What tmax can preempt |
|---|---|---|
| **Recycled/compacted ids broke automation** (SKILL.md still warns *"do not treat them as durable ids… do not guess that an older `1-3` is still the same pane later"*) | 0.7.0: *"Public workspace, tab, and pane ids are now short stable handles such as `w1`, `w1:t1`, and `w1:p1`; closed tab and pane ids no longer retarget later resources. (#569)"* (workspaces stabilized earlier, 0.4.0) | tmax's `frame-<Date.now()>-<rand>` is already monotonic/non-recycling. **Don't add id-compaction.** |
| **Shipped without a protocol-version guard** | 0.7.5: *"CLI requests now return a machine-readable `protocol_mismatch` error…"* (#1435); 0.5.7: *"detect incompatible running servers earlier."* | Add `PROTOCOL_VERSION` + handshake **now**. |
| **Slow client blocked all server writes** (push model) | 0.7.1 #726 | Conditional on tmax adopting push. |
| **Event queues stalled under load** | 0.6.3 #265 | Conditional on push. |
| **Crash-restore left stale authority/session records** | 0.7.2 #943; 0.7.1 #614/#712/#719/#765; 0.7.4 #943/#1189; discussion #668 (monotonic-seq wedge) | On any resume-from-disk, **reconcile** persisted references against live objects; discard handles whose backing object is gone. |
| **Restart-after-binary-replacement race** | 0.7.2: *"`server stop` now waits until both server sockets are unreachable before returning."* | `--stop` should poll until socket refuses. |
| **fd exhaustion at ~40 panes** | 0.6.4 #327: *"raising the server file descriptor soft limit…"* | Raise/warn on fd limit at daemon start. |
| **Pane output can contain secrets** | docs: *"off by default because pane output can include secrets…"* | Default viewport-content persistence OFF. |
| **Done-pane re-focus left stale state** | 0.7.3: *"Re-focusing an already-focused done agent or pane through the socket API now marks it seen instead of leaving stale done status."* | Any per-client "seen/dirty" flag must be scoped to the focusing client, not global. |
| **Agent-state detection noisy across agents** | fixes for Codex (0.6.1), Claude Code (0.6.7), Pi (0.7.4), Grok/OpenCode (0.7.5) | Treat detected/derived state as **advisory**, re-reconciled against live screen on every read. |

**State-model evolution narrative:** herdr shipped with compact recycling ids, discovered automation breakage, stabilized workspaces first (0.4.0), then completed the migration to non-retargeting tab/pane ids three months later (0.7.0) — a two-stage migration.

---

## 4. Confidence & Gaps

### Verified against primary (load-bearing)

All CHANGELOG entries (verbatim quotes above), `AGENTS.md` architectural statements (verbatim), `SKILL.md` command vocabulary (verbatim), release notes, `herdr.dev/docs/session-state` (verbatim table), discussions #611/#668.

### Sourced only from secondary

**None** used for any load-bearing claim.

### Could NOT be closed over the web (require reading herdr source directly)

- **`src/protocol/wire.rs::PROTOCOL_VERSION`** — the *bump policy* is verified verbatim from `AGENTS.md`, but the current constant value, the `session.snapshot` field-level schema, and the `layout.updated`/`pane.scroll_changed` event payload shapes were not read from source. CHANGELOG confirms they exist (0.7.2) but not their structure. **Next step:** read `src/protocol/` in the repo, or run `herdr api schema --json` against a live install.
- **Per-client queue mechanism (#726)** — behavior verified verbatim; implementation (bounded size, drop-vs-close, mpsc vs spawn-per-writer) not in CHANGELOG/source. Any TS reimplementation should pick its own policy based on tmax's semantics.
- **Snapshot-vs-subscribe race** — no CHANGELOG entry shows herdr *hit and repaired* this bug; the ordering is documented as correct *usage*, not as a fix. Treat lesson #2 as best-practice guidance, not proven necessity.
- **Issue/discussion mining** — herdr's issue tracker is restricted; only the issues cited above (#265, #611, #668, #726, #943, #614, #712, #1189, #1279, #1435, #1439) could be found. No distinct issue numbers for socket-ECONNREFUSED-on-resume, orphaned-client-cleanup, or multi-client-focus races.

---

## Recommended actions for tmax (ranked impact × confidence)

1. **Add `PROTOCOL_VERSION` + handshake refusal on mismatch** — high impact, high confidence, cheap, preempts herdr's retrofit. Touches `src/server/rpc/types.ts` + `src/server/rpc/router.ts:377`.
2. **Two-phase socket-gated `--stop`** — med-high, high confidence (0.7.2).
3. **Raise/warn on fd rlimit at daemon start** — med, high confidence (0.6.4, #327).
4. **Document resume-path guarantees explicitly** — detach-alive vs crash-snapshot vs "no live handoff (Bun)".
5. **Reconcile persisted references against live objects on resume** — med, high confidence (#668/#943/#614).
6. **Per-client outbound queue with backpressure** — conditional; adopt **only if/when** tmax adds server-push. Unnecessary under the current pull model.

Items 1–5 are proposed in [RFC-025](../rfcs/RFC-025-daemon-client-protocol-hardening.md). Item 6 is explicitly deferred there.

### Relevant tmax files for follow-up

- `src/server/rpc/router.ts` (line 377 — the version-validation gate)
- `src/server/rpc/types.ts` (where `PROTOCOL_VERSION` would live)
- `src/server/server.ts` (lines 1054/1087/1113/1137 — per-client response writes; 1146/1153 — disconnect cleanup; 1567 — `clients.clear()`)
- `src/server/rpc/handlers/frames.ts` (read-only `render-state` handler; the pull model)
- `src/server/serialize.ts` (persistence/resume layer)
- Context: [ADR-0058](../adrs/ADR-0058-frame-based-daemon-client.md), [ADR-0074](../adrs/ADR-0074-frame-aware-rpc-methods.md), [ADR-0093](../adrs/ADR-0093-daemon-event-buffer.md), [ADR-0103](../adrs/ADR-0103-server-test-socket-leak-fix.md)

---

## Sources (primary, all verified)

- [ogulcancelik/herdr — CHANGELOG.md](https://github.com/ogulcancelik/herdr/blob/master/CHANGELOG.md)
- [ogulcancelik/herdr — AGENTS.md](https://github.com/ogulcancelik/herdr/blob/master/AGENTS.md)
- [ogulcancelik/herdr — SKILL.md](https://github.com/ogulcancelik/herdr/blob/master/SKILL.md)
- [ogulcancelik/herdr — README](https://github.com/ogulcancelik/herdr)
- [herdr.dev — Session state and restore](https://herdr.dev/docs/session-state)
- [ogulcancelik/herdr — discussion #668](https://github.com/ogulcancelik/herdr/discussions/668)
- [ogulcancelik/herdr — discussion #611](https://github.com/ogulcancelik/herdr/discussions/611)
