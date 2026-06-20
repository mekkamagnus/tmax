# Feature: Unified Observability — One Schema, Many Buffers

> Verified by tmax-patch-review on 2026-06-17. All acceptance criteria implemented with citations; gates green (typecheck all clean, SPEC-055 test gate 124/0, test:daemon 19/0, test:ui:renderer 5/5). Two latent bugs found and fixed during audit: (1) workspace-lifecycle timeout from synchronous appendEntry on the RPC path → fixed via queueMicrotask deferral; (2) `:keyword` kwargs failed in T-Lisp function calls, silently breaking trt run logging → fixed by adding positional-args support to `log-program-run`.

## Feature Description

Today tmax has three virtual buffers that each observe a slice of editor activity — `*Messages*` (editor events, SPEC-016), `*daemon*` (connection lifecycle, SPEC-047), and the ad-hoc `*Fikra*` — plus five categories of "program run" (synchronous shell commands, async subprocesses, trt test runs, workspace auto-save, daemon lifecycle) whose output is scattered, partial, or lost entirely. This feature unifies all of them under **one `LogEntry` schema** backed by **one ring store**, rendered into **many category-filtered virtual buffers**, and **persisted across daemon restarts** as JSONL.

The unifying glue is a single routing rule: **every event is captured by its category's own buffer, and `warn`/`error` entries also mirror into `*Messages*`** — with unbound keys elevated to `warn` during this alpha stage so that "I pressed a key and nothing happened" is always visible. This gives high observability while the buffer the user already checks never misses a failure, without recreating the connection-chatter pollution SPEC-047 was created to fix.

Concretely, this delivers four things the user asked for as one push:

1. **Capture vanishing messages** — adopt Emacs's two-tier model: `(message)`/`logMessage` write to the log; a new `(echo)`/`setEchoOnly()` writes the transient status line only (which-key hints, prompts, `C-w` prefixes). Fill the gap in `normal-handler.ts` (the one handler that still sets `statusMessage` without ever logging).
2. **Richer context per entry** — extend the schema with full-date timestamps, optional `frameId` attribution, and program-run fields (`exitCode`, `durationMs`, `outputTail`, `pid`).
3. **Program-run capture** — route `shell-command`/`shell-exec`, `make-process` spawn+exit, and trt run results into dedicated buffers (`*Shell Output*`, `*Async Output*`, `*Tests*`) with their stdout/stderr tail + exit code + duration recorded, so "I ran a thing, where did it go?" is answerable.
4. **Persistence across runs** — write the ring to `~/.config/tmax/messages.log` as JSONL with size-based rotation, and tail-load the last N entries on startup so a fresh session shows prior context.

A stated prerequisite (RFC-017 deferral reason, SPEC-016 US-2 open item) is also addressed: **lazy/append rendering** replaces the current O(n) `render()`-on-every-write, unblocking high-frequency `make-process` streams from blowing the ring.

## User Story

**As a** tmax user (human or AI harness)
**I want** every editor event, shell command, subprocess, test run, and auto-save to be captured with full context into category-specific buffers that persist across daemon restarts
**So that** when something flashes by in the status line and disappears, I can always find what it was, why it happened, what output/exit code it produced, and what happened in prior sessions — instead of the information vanishing

## Problem Statement

Four concrete, documented gaps:

1. **Vanishing transient messages.** Setting `state.statusMessage =` does **not** append to `*Messages*`; the two systems are coupled per-call-site by hand. Roughly half the status-line writes never reach the log: every site in `normal-handler.ts` (the most-used mode) has zero `logMessage` calls, plus which-key popups, `read-string` prompts, `C-w` prefixes, and the save-error paths at `editor.ts:2616/2623/2639/2642`. The user's reported symptom — "I keep getting different keys, once it disappears I don't know where that information goes" — is this gap.

2. **Lost program output.** `shell-command` (editor profile, `tlisp-api.ts:1024`) **discards stderr and exit code entirely**. `make-process` (`tlisp-api.ts:1129`) **pipes stderr but never reads it** (`tlisp-api.ts:1158`), and stdout only lands somewhere if the caller's `:filter` writes to a buffer. trt runs invoked via M-x report only a summary string through `(message ...)`; the structured `{name, passed, error, durationMs, file}` data in `results.ts` never reaches the log. There is no `*compilation*`/`*shell*`/`*Async Output*` convention.

3. **No attribution or forensics.** Timestamps are `HH:MM:SS` (ambiguous across sessions). There is no `frameId` on entries, so multi-client sessions can't show *who* acted. Error entries carry a command name but no args. `[error] foo` is thin post-mortem material.

4. **Zero persistence.** SPEC-033 explicitly scoped persistence out. `MessageLog` is a pure in-memory array; `workspace.ts` does not serialize it; on restart the rings are re-created empty. After a crash, the entire session's history is gone.

A secondary, blocking issue: `MessageLog.render()` (`message-log.ts:45-50`) is **O(n) per write** and is called on every `logMessage`. RFC-017 deferred the agent-activity log *because* this is unacceptable on the high-frequency RPC/process path. Any feature that lets `make-process` stdout flow into the log hits this immediately.

## Solution Statement

Introduce a single `LogEntry` schema (`{ ts, level, category, text, command?, frameId?, exitCode?, durationMs?, outputTail?, pid? }`) and a single `Log` ring store that holds entries of **all** categories. Virtual buffers become **filtered renders** of the same store, keyed by category:

- `*Messages*` ← `category ∈ {editor, autosave}` ∪ (mirrored `warn`/`error` entries from all categories)
- `*daemon*` ← `category = daemon`
- `*Shell Output*` (new) ← `category = shell`
- `*Async Output*` (new) ← `category = process`
- `*Tests*` (new) ← `category = test`

Adopt Emacs's two-tier routing: `(message)`/`logMessage` (logs + echoes), `(echo)`/`setEchoOnly()` (echo only — for the deliberately-transient sites). Extend every program-run call site to record its structured fields into the store. Fix `render()` to be **append-based** (track a dirty range / cached string) so per-write cost is O(1) amortized. Persist the store to `~/.config/tmax/messages.log` as JSONL with rotation, and tail-load on startup. Extend the T-Lisp API and the daemon `query` surface to expose the unified schema with category filtering.

## Relevant Files

Use these files to implement the feature:

### Schema + store (the foundation)
- `src/editor/message-log.ts` — current `MessageLog`/`MessageEntry`. Extend `MessageEntry` → `LogEntry` (add `category`, full-date `ts`, `frameId?`, `exitCode?`, `durationMs?`, `outputTail?`, `pid?`). Replace O(n) `render()` with append-based cached render. Add `category` filter to `getEntries()`.
- `src/editor/editor.ts` — `messageLog`/`daemonLog` fields (`:102, :106`), `logMessage()` (`:2326-2334`), `logDaemonEvent()` (`:2341-2346`), `*Messages*`/`*daemon*` buffer creation (`:204-211`). The dual-ring becomes **one ring + category routing**. Add new `logShellCommand()`, `logProcess()`, `logTestRun()`, `logAutoSave()` entry points, all delegating to the single store. Add `setEchoOnly()` for transient status-line writes.
- `src/core/types.ts` — `statusMessage` field (`:273, :528`). Add optional `echoOnly?: boolean` flag so the status-line setter can skip the log when true (or implement as a separate setter — see Implementation Plan).

### Routing completeness (vanishing messages)
- `src/editor/handlers/normal-handler.ts` — the one handler with zero `logMessage` calls. Add `logMessage` to unbound keys (`'warn'` — elevated from SPEC-016's `debug` for alpha observability, see Mirror rule) and command errors (`'error'`) mirroring `command-handler.ts`/`visual-handler.ts`/`insert-handler.ts`. (Existing handlers that log unbound keys at `'debug'` — `command-handler.ts:109,116`, `visual-handler.ts:23,30`, `insert-handler.ts:76,83` — are also elevated to `'warn'` for consistency.)
- `src/editor/editor.ts:2616/2623/2639/2642` — save-error paths that set only `statusMessage`. Route through `logMessage(..., 'error')`.
- `src/editor/tlisp-api.ts:638-739` — `(message)`, `(log-message)`, `(messages-buffer)`. Add `(echo)` primitive for transient status-line writes (which-key hints, prompts). Keep `(message)` logging + echoing.
- `src/tlisp/core/commands/messages.tlisp` — `(view-messages)`, `C-h e` binding. Add `(view-shell-output)`, `(view-async-output)`, `(view-tests)` and key bindings.

### Program-run capture (D3)
- `src/editor/tlisp-api.ts:1023-1055` — `shell-command` (discards stderr+exit) and `shell-exec`. Wire both to `logShellCommand()` with `exitCode`, `durationMs`, `outputTail` (cap ~4 KB, combine stdout+stderr).
- `src/editor/tlisp-api.ts:1125-1194` — `make-process`. Add `logProcess('start', ...)` at spawn, `logProcess('exit', {exitCode, durationMs})` in the sentinel branch (`:1184-1186`). **Read stderr** (currently piped but unread at `:1158`) and fold into `outputTail`.
- `src/tlisp/trt/results.ts` — `TrtRunResult`/`TrtStats`. The store already has `{passed, failed, total, durationMs}` + per-test detail. Add a TS hook (or T-Lisp call from `trt-commands.tlisp`) that emits one `logTestRun()` entry per run with the aggregate stats and failing-name tail.
- `src/tlisp/core/commands/trt-commands.tlisp` — `trt-run-tests`/`trt-run-failing`/`trt-run-test` (`:3, :24, :62`). These already call `(message ...)` for the summary; that summary now lands in `*Messages*` via the existing coupling. Additionally emit a structured `(log-test-run ...)` entry to `*Tests*`.

### Persistence (B)
- `src/editor/editor.ts` — constructor (`:130-240`). On startup, after creating the store, tail-load last N entries from `~/.config/tmax/messages.log`. Add a flush hook (on every write or batched on idle — see Implementation Plan) and a shutdown flush in the daemon.
- `src/server/server.ts` — daemon shutdown path (`:1218, :1375, :1503`). Flush the store on graceful shutdown. The autosave path (`:444`) already calls `logMessage('Auto-save failed ...', 'error')`; extend successful autosave to emit a `category=autosave` debug/info entry (currently silent).
- New persistence module (see New Files).

### Daemon query + API
- `src/server/server.ts:2160-2168` — `case 'messages'`. Extend to accept `category` filter, return full `LogEntry` objects. Add `case 'log'` (or extend `messages`) that returns entries across all categories.
- `src/editor/tlisp-api.ts` — add `(log-query :category :level :last)` returning structured entries; `(observability-buffer "shell")` to switch to any category buffer by name.

### Tests
- `test/unit/` — new `log-entry.test.ts` (schema, routing, lazy-render, persistence round-trip). Extend `editor.test.ts` for `normal-handler` logging, `setEchoOnly`, program-run capture.
- `test/tlisp/modes.test.tlisp` — T-Lisp-level tests for `(echo)`, `(log-query)`, category buffers.

### New Files
- `src/editor/log-entry.ts` — the `LogEntry` type + `LogCategory` + render helpers (extracted from `message-log.ts` so the schema is importable without the ring class).
- `src/editor/log-store.ts` — the unified `Log` ring store (append-based render, category-filtered views, JSONL serialize/deserialize, rotation-aware). Replaces the in-editor role of `MessageLog`; `message-log.ts` either becomes a thin alias or is folded in.
- `src/editor/log-persist.ts` — JSONL append + rotation + tail-load for `~/.config/tmax/messages.log`.
- `src/tlisp/core/commands/observability.tlisp` — `(view-shell-output)`, `(view-async-output)`, `(view-tests)`, `(log-query ...)`, key bindings. (Could be folded into `messages.tlisp`; separate file keeps the new surface discoverable.)

## Implementation Plan

### Phase 1: Foundation — Unified schema + append-based store
Extract the `LogEntry` type, build the `Log` store with category routing and lazy render, and replace the dual `messageLog`/`daemonLog` rings with a single store. This phase delivers no new user-facing behavior — it's a refactor that fixes the O(n) render blocker (RFC-017 prerequisite) and centralizes the schema. All existing `*Messages*`/`*daemon*` behavior must remain identical after this phase.

### Phase 2: Core — Routing completeness + richer context
Fill the `normal-handler.ts` logging gap, introduce the two-tier `(message)`/`(echo)` split, classify the existing status-only sites, and add `frameId` + full-date timestamps to entries. After this phase, "it disappeared" stops happening — every transient message is either logged or explicitly marked echo-only.

### Phase 3: Program-run capture
Wire `shell-command`/`shell-exec`, `make-process` (spawn + exit + stderr), and trt runs into the store with their structured fields, and stand up the three new virtual buffers (`*Shell Output*`, `*Async Output*`, `*Tests*`) as category-filtered renders. The "mirror `warn`/`error` into `*Messages*`" rule applies automatically via the `messages` view.

### Phase 4: Integration — Persistence + daemon query + T-Lisp API
Add JSONL persistence with rotation + startup tail-load, extend the daemon `query` surface with category filtering, and expose `(log-query)`/`(observability-buffer)` in T-Lisp. After this phase, the log survives restarts and is queryable by agents.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Create the unified `LogEntry` schema
- Create `src/editor/log-entry.ts` exporting `LogCategory = 'editor' | 'daemon' | 'shell' | 'process' | 'test' | 'autosave'`, `LogLevel` (re-export from existing), and:
  ```ts
  interface LogEntry {
    ts: number;            // epoch ms — full date, unambiguous across sessions
    level: LogLevel;
    category: LogCategory;
    text: string;
    command?: string;
    frameId?: string;
    exitCode?: number;
    durationMs?: number;
    outputTail?: string;   // capped ~4 KB
    pid?: number;
  }
  ```
- Add `renderEntry(e: LogEntry): string` producing `[YYYY-MM-DD HH:MM:SS] [level] [category] text` plus, when present, ` [exit N] [Dms]` and a trailing output-tail block for program-run entries. Keep the existing `[HH:MM:SS] [level] text` shape as a compact variant for backward-compat with current `*Messages*` rendering.
- **Verify:** `bun run typecheck:src` passes; unit test for `renderEntry` covering each optional field.

### Build the append-based `Log` store
- Create `src/editor/log-store.ts` with a `Log` class:
  - Holds `entries: LogEntry[]`, `_maxSize` (default 1000), `_minLevel` (default `'info'`).
  - `log(entry: Omit<LogEntry, 'ts'> & { ts?: number }): void` — applies level filter, stamps `ts = Date.now()` if absent, pushes, evicts oldest if over max.
  - **Append-based render:** maintain `private cachedText: Map<string, string>` keyed by *view name* (not raw category) and a dirty set. On `log()`, mark dirty every view whose contents could change: the entry's own category view, plus the `messages` view (because `*Messages*` includes the `editor`/`autosave` categories plus all mirrored `warn`/`error` entries). `render(view)` recomputes only if dirty since last render, else returns cached string. This makes per-write cost O(1) amortized — the RFC-017 blocker.
- **Mirror rule — alpha-stage high observability:** `*Messages*` mirrors every `level ∈ {warn, error}` entry from any category. During this alpha stage, **unbound keys log at `warn` (not `debug`)** so they mirror automatically — "I pressed a key and nothing happened" is exactly the class of confusion the log exists to dispel. This is a deliberate elevation of the SPEC-016 default (which scoped unbound keys to `debug` to stay quiet); we flip it for alpha observability and can relax back to `debug` post-alpha. The SPEC-047 anti-pollution concern is preserved because daemon *connection* events (the noisy case) stay isolated in `*daemon*` — they are `info` level, not `warn`/`error`, so they don't mirror.
  - `messages` = `category ∈ {editor, autosave}` ∪ (`level ∈ {warn, error}` from any category) — the mirror rule
  - `daemon` = `category === 'daemon'`
  - `shell` = `category === 'shell'`
  - `process` = `category === 'process'`
  - `test` = `category === 'test'`
  - `getEntries({ category?, view?, level?, last? }): LogEntry[]` — filtered query. `view` returns the same set `render(view)` draws from (so `getEntries({ view: 'messages' })` includes mirrored `warn`/`error` entries); `category` is a raw single-category filter for the daemon query path.
  - `clear(category?)`, `setMax`/`getMax`, `setMinLevel`/`getMinLevel`.
  - `serializeJsonl(): string` and `static fromJsonl(lines: string[], max: number): LogEntry[]` (tail-cap to `max`).
- **Verify:** unit tests — ring eviction, level filter, category filter, lazy render (assert cache hit on second `render` with no intervening write), JSONL round-trip, mirror inclusion of `warn`/`error` in the `messages` view.

### Wire `Log` into the Editor, replacing the dual rings
- In `src/editor/editor.ts`:
  - Replace `private messageLog = new MessageLog()` and `private daemonLog = new MessageLog()` (`:102, :106`) with `private log = new Log()`. Keep `private messages: string[]` (`:101`) for now or remove if unused after audit (it appears vestigial — verify no readers).
  - Update `logMessage(msg, level='info', command?)` (`:2326-2334`) to call `this.log.log({ level, category: 'editor', text: msg, command })` and refresh the `*Messages*` buffer via `this.log.render('editor')`.
  - Update `logDaemonEvent(event, detail?)` (`:2341-2346`) to call `this.log.log({ level: 'info', category: 'daemon', text: detail ? \`${event} ${detail}\` : event })` and refresh `*daemon*` via `this.log.render('daemon')`.
  - Update `getMessageLog()`/`getDaemonLog()` accessors (`:2349` and the messageLog accessor ~`:3075`) to return the unified `Log` (or thin per-category views) so existing callers (daemon query, tests) keep working.
- **Verify:** `bun run typecheck:src` passes; existing `*Messages*`/`*daemon*` tests still pass with no behavior change.

### Fill the `normal-handler.ts` logging gap
- In `src/editor/handlers/normal-handler.ts`, add `(editor as any).logMessage(\`Unbound key: ${key}\`, 'warn')` and `(editor as any).logMessage(\`Command error: ${msg}\`, 'error')` at the status-message-only sites. This is the SPEC-016 Phase 2 item that was implemented in 3 of 4 handlers. **Also elevate the existing unbound-key logs in the other three handlers from `'debug'` to `'warn'`** — `command-handler.ts:109,116`, `visual-handler.ts:23,30`, `insert-handler.ts:76,83` — for alpha-stage consistency (so unbound keys mirror into `*Messages*` regardless of which mode they happen in).
- **Verify:** unit test — pressing an unbound key in normal mode appends a `warn` entry to the log (and it appears in the `messages` view); a command error appends an `error` entry.

### Introduce the two-tier `(message)`/`(echo)` split
- In `src/editor/editor.ts`, add `setEchoOnly(text: string): void` that sets `this.state.statusMessage = text` **without** logging. This is the explicit escape hatch for deliberately-transient messages.
- Audit the ~30 `state.statusMessage =` sites in `editor.ts` + handlers. Classify each:
  - **Keep logging** (route through `logMessage`): errors, file ops, command results.
  - **Echo-only** (use `setEchoOnly`): which-key hints, `read-string` prompts (`tlisp-api.ts:1019`), `C-w`/window prefixes, `Describe key` prompts. Document the classification in code comments.
- In `src/editor/tlisp-api.ts:671-688`, keep `(message ...)` as log+echo. Add `(echo TEXT)` → `setEchoOnly`.
- **Verify:** unit test — `(echo "hint")` sets statusMessage but does **not** append to the log; `(message "hi")` does both.

### Add richer context: full-date timestamps + frameId
- The `ts` field is already epoch ms (full date) from Phase 1. Update `renderEntry` so the `*Messages*`/category buffers show `YYYY-MM-DD HH:MM:SS` (the JSONL log already has full precision). Keep the compact `HH:MM:SS` form for the status line.
- Thread `frameId` into `logMessage`: the daemon knows the calling client id (`server.ts` request handlers have it in scope). Add an optional `frameId` param to `logMessage` and have server-side calls pass `this.editor.logMessage(msg, level, cmd, clientId)` where available. Default `undefined` for editor-local calls.
- **Verify:** unit test — a server-originated `logMessage` records the `frameId`; render shows it as `[frame:c-3]`.

### Capture shell commands (`category = shell`)
- In `src/editor/tlisp-api.ts:1023-1055`, wrap `shell-command` and `shell-exec` to record a `shell` entry. Measure `const t0 = Date.now()` before `Bun.spawnSync`, then after:
  ```ts
  const tail = (stdout + '\n' + stderr).slice(-4096);
  state.logShellCommand?.({ command: cmd, exitCode: output.exitCode ?? 0,
                           durationMs: Date.now() - t0, outputTail: tail,
                           level: output.exitCode === 0 ? 'info' : 'error' });
  ```
- For `shell-command` specifically, **capture stderr** that is currently discarded (`tlisp-api.ts:1030` only reads stdout) so the log entry is complete even though the return value stays stdout-only for backward compat.
- Add `logShellCommand(e)` to `editor.ts` delegating to `this.log.log({ category: 'shell', ... })`, refreshing `*Shell Output*` (via `render('shell')`), and — because the `messages` view includes all `error` entries — `*Messages*` is automatically refreshed too (the dirty-marking on `log()` handles this; no special-case code per call site).
- **Verify:** integration test — `(shell-exec "false")` produces an `error` shell entry with `exitCode: 1`, a duration, and an output tail; `*Messages*` (via the `messages` view) contains the mirrored `error` line; `*Shell Output*` contains the full entry. A `warn`-level shell entry (e.g. a non-zero-but-benign exit if we define one) also mirrors; an `info` entry does not.

### Capture async subprocesses (`category = process`)
- In `src/editor/tlisp-api.ts:1125-1194` (`make-process`):
  - At spawn (`:1155`), call `logProcess({ stage: 'start', pid, command })`.
  - **Read stderr** — currently piped but never read (`:1158`). Add a second async reader mirroring the stdout reader (`:1169-1181`) that accumulates stderr into a buffer.
  - In the sentinel branch (`:1184-1186`), after `proc.exited`, call `logProcess({ stage: 'exit', pid, exitCode: proc.exitCode ?? 0, durationMs: Date.now() - spawnTime, outputTail: combinedTail.slice(-4096) })`.
  - Because stdout is already streamed to the caller's `:filter`, the log's `outputTail` is a **best-effort capture** (last 4 KB of combined stream) for the buffer — it does not replace the filter. Document this.
- Add `logProcess(e)` to `editor.ts` → `this.log.log({ category: 'process', ... })`, refresh `*Async Output*`. Non-zero exit is `level: 'error'` (and a timeout could be `'warn'`), so the `messages` view mirrors it automatically (no special-case code).
- **Verify:** integration test — `(make-process :command "echo hi")` produces a `process` start entry and an exit entry with `exitCode: 0` (info, no mirror); `(make-process :command "sh -c 'exit 2'")` produces exit `exitCode: 2` (error) and a mirrored entry in `*Messages*`.

### Capture trt test runs (`category = test`)
- Add a TS bridge builtin `trt-log-run` (in `src/tlisp/trt/bootstrap.ts` alongside the existing `trt-*` builtins, `bootstrap.ts:34`) that reads the current `TrtRunResult` from `getResultStore().getRunResult()` (`results.ts:99`) and calls `editor.logTestRun({ stats, failingNames })`.
- In `src/tlisp/core/commands/trt-commands.tlisp:3,24,62`, after each `trt-run-*` call, invoke `(trt-log-run)` so the structured result lands in `*Tests*`.
- Add `logTestRun(e)` to `editor.ts` → `this.log.log({ category: 'test', level: stats.failed > 0 ? 'error' : 'info', text: summary, exitCode: stats.failed > 0 ? 1 : 0, durationMs: stats.durationMs, outputTail: failingNames })`. Refresh `*Tests*`. A failing run is `level: 'error'`, so `*Messages*` mirrors it automatically via the `messages` view (the existing `(message ...)` summary also lands the text there directly — both paths agree).
- **Verify:** M-x `trt-run-tests` with a failing suite produces a `test` `error` entry with `exitCode: 1`, the failing names in `outputTail`, and a mirrored line in `*Messages*`.

### Stand up the new category buffers
- In `src/editor/editor.ts` constructor (`:204-211`), alongside `*Messages*` and `*daemon*`, create `*Shell Output*`, `*Async Output*`, `*Tests*` as empty virtual buffers with `modified: false` metadata.
- Add refresh helpers that set each buffer's text from `this.log.render(category)`. Wire these into the `logShellCommand`/`logProcess`/`logTestRun` entry points (Phase 3 above).
- Mark all five observability buffers read-only (extend the existing `*Messages*` read-only guard to cover the set). Ensure they appear in `(buffer-list)`.
- In `src/tlisp/core/commands/observability.tlisp`, add `(view-shell-output)`, `(view-async-output)`, `(view-tests)` mirroring `(view-messages)`, and bind keys (e.g. `SPC h o` family or `C-h` prefixes — pick consistent with existing `C-h e`).
- **Verify:** switching to each buffer works; typing is rejected; each shows its category's entries.

### Add JSONL persistence with rotation
- Create `src/editor/log-persist.ts`:
  - `LOG_PATH = \`${process.env.HOME ?? '~'}/.config/tmax/messages.log\``
  - `MAX_BYTES = 5 * 1024 * 1024` (5 MB), keep `messages.log.1` on rotation.
  - `append(entry: LogEntry): void` — serialize to one JSONL line, append to file; if file exceeds `MAX_BYTES`, rotate before append.
  - `tailLoad(max: number): LogEntry[]` — read file from the end, parse up to `max` valid JSONL lines (resilient to a truncated final line from a crash).
- In `src/editor/editor.ts` constructor, after the `Log` is created, call `logPersist.tailLoad(maxSize)` and seed the store. Guard with try/catch — a corrupt log must never block startup.
- Write strategy: **append on every `log()` call** is simplest and crash-safe (no lost tail). To avoid an fsync-per-event cost, rely on Bun's buffered writes and add a `flush()` on daemon shutdown. Document the tradeoff.
- In `src/server/server.ts` shutdown path (`:1218, :1375, :1503`), call `editor.flushLog()` before exit. (The per-write append already means graceful shutdown flush is belt-and-suspenders; the real crash-safety comes from append-per-write.)
- **Verify:** unit test — append N entries, tailLoad returns them in order; rotation triggers at `MAX_BYTES`; a corrupted final line is skipped without error; round-trip preserves all fields including optional ones.

### Extend the daemon `query` surface + T-Lisp API
- In `src/server/server.ts:2160-2168`, extend `case 'messages'` to accept `category` param and return full `LogEntry` objects (with all optional fields). Add `case 'log'` (alias) returning cross-category entries with `{ category, level, last }` filtering.
- In `src/editor/tlisp-api.ts`, add:
  - `(log-query :category "shell" :level "error" :last 10)` → structured list of entries.
  - `(observability-buffer "shell"|"process"|"test"|"daemon")` → switch to the named category buffer.
- **Verify:** integration test — `query messages?category=shell&level=error` returns only shell errors with full fields; `(log-query)` returns the same data in T-Lisp form.

### Write tests
- `test/unit/log-entry.test.ts` — schema, `renderEntry` for every optional field, compact vs full-date forms.
- `test/unit/log-store.test.ts` — ring eviction, level/category filter, **lazy render cache hit**, mirror inclusion of `warn`/`error` in the `messages` view, JSONL round-trip.
- `test/unit/log-persist.test.ts` — append, tailLoad, rotation, corrupt-line resilience.
- Extend `test/unit/editor.test.ts` — `normal-handler` now logs; `setEchoOnly` doesn't; program-run capture for shell/process/test; `frameId` threading.
- `test/tlisp/modes.test.tlisp` — `(echo)`, `(log-query)`, `(observability-buffer)`.
- **Verify:** `bun test` passes with zero regressions.

### Run validation
- `bun run typecheck:src && bun run typecheck:test && bun run typecheck`
- `bun test`
- `bun run build`
- `bun run test:daemon` — daemon lifecycle events still route to `*daemon*`; new query params work over the socket.
- `bun run test:ui:renderer` — status-line rendering unaffected; new buffers render their categories.

## Testing Strategy

### Unit Tests
- `LogEntry` schema: every optional field present/absent in render.
- `Log` ring: push `maxSize+1` entries, oldest evicted; set min level `warn`, push `info`+`error`, only `error` stored; category filter returns only matching entries.
- **Lazy render:** call `render('messages')` twice with no intervening write — second call returns the cached string (assert via a spy or by counting work); after a write, cache is invalidated.
- Mirror rule: push a `shell` `error` entry → `getEntries({ view: 'messages' })` includes it (the mirror). Push a `shell` `warn` entry → also mirrored. Push a `shell` `info` entry → `getEntries({ view: 'messages' })` does **not** include it. `getEntries({ category: 'shell' })` returns the raw shell set in all cases.
- JSONL: serialize N entries, deserialize, deep-equal; truncate the final line and confirm `tailLoad` skips it.
- Rotation: write past `MAX_BYTES`, confirm `.log.1` created and new file started.
- `(echo "x")` sets statusMessage, `log.getEntries()` unchanged.
- `(message "x")` sets statusMessage **and** appends one `editor` entry.
- `setEchoOnly` classification: which-key hint does not log; save error does.

### Integration Tests
- Press unbound key in normal mode → `*Messages*` contains `[warn] Unbound key: ...` (elevated from `debug` for alpha; mirrors automatically).
- `(shell-exec "false")` → `*Shell Output*` has the entry with `exitCode: 1`; `*Messages*` has the mirrored `error` line.
- `(make-process :command "echo hi")` then wait → `*Async Output*` has start+exit entries with `exitCode: 0`.
- `(make-process :command "sh -c 'exit 2'")` → exit entry `exitCode: 2` (`error`) + mirrored entry in `*Messages*`.
- M-x `trt-run-tests` against a fixture with one failing test → `*Tests*` has the entry with the failing name in `outputTail`; `*Messages*` has the summary.
- Kill the daemon ungracefully, restart → `tailLoad` repopulates the last N entries; a fresh `*Messages*` shows prior-session context.

### Edge Cases
- `outputTail` exactly 4 KB (boundary of the cap).
- `make-process` whose `:filter` throws — the log entry is still recorded (capture is independent of filter).
- Empty trt run (`stats.total === 0`) → `exitCode: 2` per `runExitCode`, logged at `warn` → **does mirror** into `*Messages*` under the alpha rule (an empty run usually signals a discovery/runner problem worth surfacing).
- Corrupt JSONL line in the persisted log (truncated crash) → skipped, not fatal.
- Ring eviction happens **during** a `make-process` stream — the start entry may be evicted before the exit entry; both still individually correct.
- `setEchoOnly` followed by a real `(message ...)` — the echo is overwritten and the log has only the message.
- `(set-message-log-max 0)` disables logging entirely (existing behavior preserved).

## Acceptance Criteria
- A single `LogEntry` schema backs all observability; `messageLog`/`daemonLog` are replaced by one `Log` store.
- `*Messages*`, `*daemon*`, `*Shell Output*`, `*Async Output*`, `*Tests*` are all filtered renders of the same store; all five are read-only and appear in `(buffer-list)`.
- `normal-handler.ts` logs unbound keys (`warn`) and command errors (`error`) — closing the SPEC-016 gap. The three other handlers' unbound-key logs are elevated from `debug` to `warn` for consistency.
- `(message)` logs + echoes; `(echo)`/`setEchoOnly` echoes only. Deliberately-transient sites (which-key, prompts) are echo-only; errors/file-ops are logged.
- `shell-command` and `shell-exec` capture `exitCode`, `durationMs`, `outputTail` (stdout+stderr, ~4 KB cap) into `*Shell Output*`; `shell-command` no longer discards stderr.
- `make-process` captures start + exit entries into `*Async Output*` with `pid`, `exitCode`, `durationMs`, `outputTail`; stderr is read (not silently dropped).
- trt runs emit a structured `test` entry into `*Tests*` with aggregate stats, `exitCode` (0/1/2), and failing-name tail.
- Mirror rule (alpha-stage): every `warn`/`error` entry from any category mirrors into `*Messages*`; unbound keys log at `warn` (elevated from SPEC-016's `debug`) so they mirror automatically. Successful program runs (`info`) do not mirror. Daemon connection events (`info`) stay isolated in `*daemon*`.
- `Log.render()` is O(1) amortized per write (append-based caching) — the RFC-017 / SPEC-016 US-2 blocker is resolved.
- Entries carry full-date timestamps (`YYYY-MM-DD HH:MM:SS` in buffers, epoch ms in JSONL) and optional `frameId`.
- The store persists to `~/.config/tmax/messages.log` (JSONL, 5 MB rotation, keep `.1`); on startup the last `maxSize` entries are tail-loaded.
- `query messages?category=&level=&last=` and `query log` return full `LogEntry` objects over the daemon socket.
- `(log-query :category :level :last)` and `(observability-buffer NAME)` are available in T-Lisp.
- `bun test` passes with zero regressions.
- `bun run typecheck:src && bun run typecheck:test && bun run typecheck` pass with zero errors.
- `bun run build` succeeds.
- `bun run test:daemon` passes; `bun run test:ui:renderer` passes.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Every command must execute without errors.

- `bun run typecheck:src` — zero type errors in source (schema, store, persistence, call sites)
- `bun run typecheck:test` — zero type errors in tests
- `bun run typecheck` — full typecheck passes
- `bun test` — all tests pass with zero regressions, including new `log-entry`/`log-store`/`log-persist` tests and extended `editor.test.ts`
- `bun run build` — build succeeds
- `bun run test:daemon` — daemon lifecycle still routes to `*daemon*`; `query messages?category=shell&level=error` returns structured entries
- `bun run test:ui:renderer` — status line and new observability buffers render correctly
- Manual end-to-end smoke (documented in a test): start daemon, run `(shell-exec "false")` via `tmax -e`, switch to `*Shell Output*` (entry with exit 1), switch to `*Messages*` (mirrored `error` line), `tmax --stop`, restart daemon, switch to `*Messages*` (prior entries tail-loaded)

## Notes
- **Architecture decision — one schema, many buffers** (approved during brainstorming): respects the just-landed SPEC-047 `*daemon*` split while giving unified persistence and richer entries. The alternative (one bucket) was rejected because it would undo SPEC-047's anti-pollution decision; the faceted-views alternative (one ring, many windows) was rejected as the largest build for the same user value.
- **Mirror-on-error** is the unifying rule that makes the multi-buffer split safe: the user only has to learn "check `*Messages*`; if a program failed it'll be there too, full output in its own buffer." This directly addresses the reported "I don't know where it went" symptom without recreating pollution.
- **Lazy/append render** is a hard prerequisite, not a nice-to-have. RFC-017 deferred the agent-activity log specifically because O(n) `render()` on every write is unacceptable once `make-process` stdout flows in. Phase 1 must land this or Phase 3 regresses.
- **`(echo)` vs `setEchoOnly`** — the T-Lisp primitive is `(echo)`; the TS setter is `setEchoOnly`. The two-tier model mirrors Emacs, where `(message)` logs and the echo-area-only primitives (`(let ((message-log-max nil)) (message ...))` or `minibuffer-message`) don't. We make the distinction explicit rather than via a dynamic variable, for clarity.
- **Persistence write strategy** — append-per-write (crash-safe, simple) chosen over flush-on-shutdown (loses tail on crash) and periodic-flush (more complex). Bun's buffered writes keep the per-event cost acceptable; the shutdown `flush()` is belt-and-suspenders.
- **`outputTail` is best-effort for `make-process`** — stdout is owned by the caller's `:filter`; the log captures the last ~4 KB for the buffer, not the full stream. This is documented in the code so callers don't mistake the buffer for a complete transcript.
- **SPEC-047 compatibility** — `logDaemonEvent` signature and the `*daemon*` buffer are preserved; internally they now delegate to the unified store with `category: 'daemon'`. The `?.` optional-chaining for standalone-daemon mode (`server.ts:1029,1123`) is preserved.
- **`messages: string[]` legacy field** (`editor.ts:101`) appears vestigial — audit for readers during Phase 1; remove only if the changes orphan it (per AGENTS.md surgical-changes rule, don't delete pre-existing dead code unless asked).
- **Future (out of scope):** full RFC-017 agent-activity log (per-RPC mutation logging) becomes feasible once this lands — the lazy render + category routing + persistence are exactly its stated prerequisites. trt `*Test Explorer*` (SPEC-053) can layer on the `*Tests*` buffer introduced here.
- **No new dependencies.** All of this uses Bun's built-in `spawnSync`/`spawn` and `node:fs`. JSONL is hand-serialized (one `JSON.stringify` per line) — no logging library.
