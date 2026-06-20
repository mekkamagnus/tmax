# Feature: `*daemon*` Event Buffer (Connection/Lifecycle Observability)

## Feature Description

Introduce a `*daemon*` virtual buffer inside tmax that records daemon lifecycle events — client connections and disconnections, client type/name, and timestamps — as a ring-buffered, human-readable log. This gives both users and AI agents an in-editor observability surface for "what is happening with my daemon" without polluting the `*Messages*` buffer or leaking ad-hoc `console.log` noise onto the TUI render surface.

Today, the daemon emits `Client connected: <id>` and `Client disconnected: <id>` via `console.log` directly to stdout (`src/server/server.ts:1024`, `:1118`). Because the embedded `bin/tmax` server shares the terminal's stdout with the SteepFrontend TUI, these log lines intrude into the visible render area whenever `tmaxclient` connects. They are also the only record of connection events; nothing structured or queryable exists in-editor.

The `*daemon*` buffer mirrors the established `*Messages*` virtual-buffer pattern (`src/editor/editor.ts:200`, `src/editor/message-log.ts`): a `MessageLog` ring rendered into a named buffer, created at editor startup, discoverable via `(switch-to-buffer "*daemon*")`, and quiet by default (not shown unless the user/agent switches to it).

## User Story

As a **tmax user or AI agent** running a daemon-driven workflow (`bin/tmax file` + `tmaxclient --keys`/`--eval` from other panes),
I want to **see daemon lifecycle events — which clients connected, when, and of what type — inside an editor buffer**,
So that **I can observe and debug daemon/client activity without stdout noise corrupting my TUI or filling the `*Messages*` buffer with connection chatter**.

## Problem Statement

1. **Stdout noise corrupts the TUI.** `console.log("Client connected/disconnected")` in the embedded `bin/tmax` process writes into the same terminal the SteepFrontend renders to, briefly overlaying log lines on the editor view. This was observed directly during the `bin/tmax` + `tmaxclient --keys` workflow work.
2. **No in-editor observability for connection events.** SPEC-001 established structured RPC observability (`--status`/`--clients`/`--frames`/`client-event`) for the Python harness and machine consumers, but there is no buffer a user or agent can `switch-to-buffer` to read a chronological event log. `*Messages*` is the wrong sink (user-facing editor events only, per the existing convention) — connection chatter would add noise there.
3. **The `console.log` calls are unowned by any spec.** They are ad-hoc, bypassing the observability layer SPEC-001 introduced (`recordError`, `frameObservability`).

## Solution Statement

Add a `*daemon*` virtual buffer, created at editor startup alongside `*Messages*`, fed by a new `editor.logDaemonEvent()` method backed by a second `MessageLog` ring instance. Replace the two `console.log` connection/disconnection calls in the server with `editor.logDaemonEvent(...)`, recording the client id, client type/name (when known), and event type.

This:
- Eliminates the stdout render-surface intrusion (the embedded server no longer logs connections to stdout).
- Provides a quiet-by-default, on-demand observability buffer for users and agents (`switch-to-buffer "*daemon*"`).
- Reuses the proven `MessageLog` ring + virtual-buffer machinery rather than inventing a new log type.
- Aligns with ADR-0067's principle that "the daemon owns lifecycle state," and with SPEC-043's virtual-buffer convention (special buffers created via the `createBuffer("*name*", content)` pattern), without conflating with SPEC-043's `*daemons*` discovery list (which lists running daemon *instances*, created on demand — a different concern).

The embedded (`bin/tmax`, `main.tsx`) and standalone-daemon (`bin/tmax --daemon`, `server.ts` without editor) paths both benefit: the embedded path gets the buffer; the standalone-daemon path's connection events still surface via SPEC-001's structured RPC (unchanged) and, when a TUI later attaches to that daemon, the buffer reflects subsequent events.

## Relevant Files

Use these files to implement the feature:

| File | Role |
|------|------|
| `src/editor/editor.ts` | Add the `*daemon*` virtual buffer (created at startup alongside `*Messages*`, `:200`), a `daemonLog: MessageLog` field, and a `logDaemonEvent(event, detail?)` method mirroring `logMessage` (`:2317`). |
| `src/editor/message-log.ts` | Existing `MessageLog` ring + `LogLevel` — reused verbatim for the daemon ring. No change required (a second instance is instantiated in `editor.ts`). |
| `src/server/server.ts` | Replace `console.log("Client connected...")` (`:1024`) and `console.log("Client disconnected...")` (`:1118`) with `this.editor.logDaemonEvent(...)`. Guard for the standalone-daemon case where `this.editor` may be absent (fall back to no-op or the existing observability ring). |
| `src/main.tsx` | No change expected — the embedded server holds the editor reference (`server.ts:171`), so `logDaemonEvent` reaches the buffer automatically. |
| `src/editor/CLAUDE.md` | Convention note: special buffers (`*scratch*`, `*Messages*`, now `*daemon*`) — document the `*daemon*` buffer as a daemon-lifecycle log, quiet by default. |

### New Files

| File | Purpose |
|------|---------|
| `test/unit/daemon-event-buffer.test.ts` | Unit tests: `logDaemonEvent` appends to the ring; `*daemon*` buffer exists and renders events with timestamps; ring caps at `maxSize`; `*Messages*` is NOT polluted by daemon events. |

## Implementation Plan

### Phase 1: Foundation — ring + buffer in the Editor

Add a second `MessageLog` instance (`daemonLog`) and the `*daemon*` virtual buffer to `Editor`, mirroring `*Messages*` exactly. Expose `logDaemonEvent(event, detail?)` that writes a formatted line (`[HH:MM:SS] client-connected <id> (tui, tmaxclient)` etc.) to the ring and refreshes the `*daemon*` buffer text.

### Phase 2: Core Implementation — route server events to the buffer

In `server.ts`, replace the two `console.log` connection/disconnection calls with `this.editor.logDaemonEvent(...)`. Capture available client metadata (`clientType`, `clientName` from SPEC-001 client records) in the detail. Ensure the standalone-daemon path (no editor) does not crash — guard with a presence check.

### Phase 3: Integration — discoverability + convention

Confirm `(switch-to-buffer "*daemon*")` shows the event log. Add a convention note to `src/editor/CLAUDE.md`. Add a T-Lisp primitive only if needed for agent queryability (`daemon-events` returning recent entries) — defer unless an acceptance criterion requires it (see Testing Strategy).

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add the `*daemon*` buffer and `daemonLog` ring to `Editor`
- In `src/editor/editor.ts`, declare `private daemonLog = new MessageLog();` alongside the existing `messageLog`/`messages` fields.
- In the constructor (near `:200` where `*Messages*` is created), create the `*daemon*` buffer: `this.buffers.set('*daemon*', FunctionalTextBufferImpl.create(''));` and set its metadata (modified: false).
- Add `logDaemonEvent(event: string, detail?: string): void` mirroring `logMessage` (`:2317`): build `[HH:MM:SS] <event> <detail>` and push to `daemonLog`, then set the `*daemon*` buffer text from `daemonLog.render()`.

### Step 2: Replace stdout `console.log` with `logDaemonEvent`
- In `src/server/server.ts:1024` (client connect), replace `console.log(\`Client connected: ${clientId}\`)` with `this.editor?.logDaemonEvent('client-connected', clientId)`.
- In `src/server/server.ts:1118` (client disconnect), replace `console.log(\`Client disconnected: ${clientId}\`)` with `this.editor?.logDaemonEvent('client-disconnected', clientId)`.
- Enrich detail with `clientType`/`clientName` when present on the client record (e.g. `(tui, myname)`), so the log distinguishes TUI vs `tmaxclient` connections.
- Use optional chaining (`this.editor?.`) so the standalone-daemon path (no editor) degrades gracefully to a no-op rather than crashing.

### Step 3: Write unit tests
- Create `test/unit/daemon-event-buffer.test.ts`:
  - `logDaemonEvent('client-connected', 'c-1')` → `*daemon*` buffer text contains `client-connected` and the id.
  - Events render with a `[HH:MM:SS]` timestamp.
  - The ring respects `daemonLog.maxSize` (set low, push >maxSize entries, assert oldest dropped).
  - **Negative:** after a daemon event, the `*Messages*` buffer remains empty (no pollution).
  - `switch-to-buffer "*daemon*"` semantics are covered by existing buffer-switch tests; only assert buffer existence + content here.

### Step 4: Document the convention
- Add a bullet to `src/editor/CLAUDE.md` (special-buffers section) describing `*daemon*` as the daemon lifecycle event log, created at startup, quiet by default.

### Step 5: Run the Validation Commands
- Execute every command in `Validation Commands` top to bottom; all must pass with zero regressions.

## Testing Strategy

### Unit Tests
- `test/unit/daemon-event-buffer.test.ts` — ring append, render format, cap behavior, `*Messages*` non-pollution (Step 3).

### Integration Tests
- Manual end-to-end (captured in Validation Commands): start `bin/tmax <file>` in a tmux pane, run `tmaxclient --keys j` from another pane, assert (a) no `Client connected` line intrudes into the TUI pane capture, and (b) `(switch-to-buffer "*daemon*")` shows the connection events.

### Edge Cases
- Standalone daemon (`bin/tmax --daemon`) with no editor attached: connection events must not crash (`this.editor?.` guard); they remain observable via SPEC-001's `--status`/`--clients` RPC.
- Rapid reconnect/disconnect storms: ring cap (`maxSize`, default 1000) bounds memory.
- A TUI attaching to an existing standalone daemon: subsequent events appear in the buffer; earlier ones (before editor attach) are not retroactively logged (acceptable — daemon-side structured state remains the source of truth per SPEC-001).
- Buffer name collision / reserved-name handling: `*daemon*` must be treated like `*Messages*` (not user-deletable, not counted as a modified file buffer).

## Acceptance Criteria
- [ ] `*daemon*` buffer exists at editor startup (alongside `*Messages*`).
- [ ] `editor.logDaemonEvent(event, detail)` appends a timestamped line to the `*daemon*` buffer.
- [ ] The `console.log("Client connected/disconnected")` calls in `server.ts` are removed; connection events flow exclusively to the `*daemon*` buffer.
- [ ] No `Client connected/disconnected` text appears on the TUI's stdout/render surface during `tmaxclient` connections (verified via tmux capture).
- [ ] `*Messages*` buffer is not polluted by daemon connection events.
- [ ] Standalone-daemon path (no editor) does not crash on connect/disconnect.
- [ ] `(switch-to-buffer "*daemon*")` renders the event log.
- [ ] Ring cap respected (`maxSize`).
- [ ] `typecheck:src`, `typecheck:test`, `typecheck`, `test:ui:renderer` all pass; `test:daemon` individual tests pass; no new regressions vs baseline.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Every command must execute without errors.

- `bun run typecheck:src` — no new type errors (only pre-existing `evaluator.ts` errors acceptable).
- `bun run typecheck:test` — test types clean.
- `bun run typecheck` — combined typecheck passes.
- `bun test test/unit/daemon-event-buffer.test.ts` — new unit tests pass.
- `bun test test/unit/server-client.test.ts test/unit/server-nility.test.ts` — server regression tests pass.
- `bun run test:ui:renderer` — renderer suite green.
- `bun run test:daemon` — daemon suite (individual tests) pass; if the suite runner times out on cleanup, run the component files individually: `cd test/ui && uv run python tests/01_startup.py && uv run python tests/02_basic_editing.py && uv run python tests/03_mode_switching.py && uv run python tests/14_vim_input.py`.
- End-to-end observability check (run, then inspect):
  - `tmux new-window -t tmax -n daemon-buf && tmux send-keys -t tmax:daemon-buf "bin/tmax <fixture>.md" Enter` (wait ~4s)
  - From another pane: `bin/tmaxclient --keys j` then `bin/tmaxclient --eval '(switch-to-buffer "*daemon*")'`
  - `tmux capture-pane -t tmax:daemon-buf -p` must NOT contain `Client connected` on the render surface, and `(buffer-text)` on `*daemon*` must contain `client-connected`.

## Notes

- **Relationship to SPEC-001 (daemon-tmux observability):** SPEC-001 owns structured RPC observability (`--status`/`--clients`/`--frames`/`client-event`) consumed by the Python harness and machine agents. This spec is the *in-editor, human-readable* complement: the `*daemon*` buffer. They do not overlap — one is JSON-RPC state, the other is a buffer. Both can coexist; connection events now flow to the buffer, structured RPC is unchanged.
- **Relationship to SPEC-043 (`*daemons*` buffer):** SPEC-043's `*daemons*` is a discovery list of running daemon *instances* (name/socket/pid), created on demand and currently unimplemented. This spec's `*daemon*` (singular) is an event log for *this* daemon's connection lifecycle, created at startup. Distinct concerns, distinct buffer names — do not conflate. If/when SPEC-043 is implemented, the naming difference (`*daemon*` vs `*daemons*`) keeps them unambiguous.
- **Future:** a T-Lisp `daemon-events` primitive (returning recent ring entries as a list) would let AI agents query the log programmatically without buffer switching. Defer unless a downstream need arises.
- **No new dependencies.** Reuses `MessageLog` (`src/editor/message-log.ts`), `FunctionalTextBufferImpl`, and existing buffer machinery.
