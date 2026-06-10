# Feature: Embedded Server (No-tmux Single-Process Launch)

**Depends on:** [SPEC-034](./SPEC-034-emacs-daemon-client-parity.md) — Frame abstraction and unified CLI (already implemented)

### Prerequisites (must pass before implementation)

1. **SPEC-034** — Provides the Frame system, `bin/tmax` unified CLI, and frame-scoped RPC. This spec builds on top by embedding the socket server inside the TUI process.

## Feature Description

Make `tmax file.txt` start a single process that embeds both the TUI frontend and the socket server — exactly like Emacs, where `emacs` starts the editor and `M-x server-start` opens the socket for remote clients. No tmux, no background process management, no separate daemon window. The local TUI talks to the Editor directly (zero-copy, no serialization). Remote `tmaxclient` connections arrive via the socket and get their own Frames.

## User Story

As a tmax user
I want to type `tmax file.txt` in any terminal and have the editor just start — no tmux, no daemon window, no background process juggling
So that the editor feels like a normal CLI tool with Emacs-style remote access when needed

## Problem Statement

Today `bin/tmax` spawns a background daemon process (`bun src/server/server.ts &`) and then `exec`s the TUI client, which connects back via Unix socket. This has three problems:

1. **Requires tmux for demos/testing.** The background daemon's stdout bleeds into the launching terminal if not in tmux.
2. **Process management complexity.** The bash script has lock files, PID tracking, socket polling, and cleanup logic — all fragile.
3. **Unnecessary serialization overhead.** The local TUI serializes state to JSON, sends it over a socket, then deserializes it back — for a process that could just call `editor.handleKey()` directly.

Meanwhile, `src/main.tsx` already has a working single-process mode (Editor + SteepFrontend, direct calls), but it doesn't start a socket server.

## Solution Statement

1. Split `TmaxServer` into reusable components: the Editor initialization + the socket listener.
2. Modify `src/main.tsx` to start the socket listener alongside SteepFrontend.
3. Simplify `bin/tmax` to exec `src/main.tsx` for the default case (no background spawning).

## Architecture Constraints

| Area | Governing Doc | Rule |
|------|--------------|------|
| Server construction | `src/server/server.ts` | `TmaxServer` must accept an external `Editor` instance |
| TUI frontend | `src/steep/assam.ts` | SteepFrontend calls `editor.handleKey()` directly — no socket layer |
| CLI entry point | `bin/tmax` | Default path must be a single `exec` — no background spawning |
| T-Lisp API | `src/editor/CLAUDE.md` | TypeScript provides primitives only; server-start would be a T-Lisp command calling a primitive |
| Socket lifecycle | `rules/daemon-client.md` | Socket path at `/tmp/tmax-{uid}/server`, `.lock` file for atomic ownership |

## Relevant Files

### Existing Files to Modify

| File | Change | Constraints |
|------|--------|-------------|
| `src/server/server.ts` | Accept external `Editor`; split `start()` into `startEditor()` + `startSocket()` | Must remain backward-compatible for `--daemon` mode |
| `src/main.tsx` | Create `TmaxServer` with existing Editor; call `startEditor()` + non-blocking `startSocket()` | SteepFrontend loop unchanged |
| `bin/tmax` | Default path: `exec bun src/main.tsx "$file"` instead of spawn+exec | Keep `--stop`, `-e`, `--capture` using tmaxclient |

### New Files

| File | Purpose | Constraints |
|------|---------|-------------|
| None | All changes to existing files | — |

## Implementation Phases

### Phase 1: Split TmaxServer — Editor + Socket — Allow embedded use

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] `TmaxServer` constructor currently creates its own `Editor` (line 149)
- [ ] `start()` currently does both editor init and socket binding (lines 557-595)

#### Step 1: Accept external Editor in constructor

**User story:** As a developer, I want to pass an existing Editor to TmaxServer so the same instance serves both the local TUI and remote socket clients.

**Description:** Add an optional `editor` parameter to the `TmaxServer` constructor. When provided, skip creating `TerminalIOImpl`, `FileSystemImpl`, and `Editor`. Skip `registerTestingFramework` and initial state setup (the caller already did that).

**MUST:**
- Accept `editor?: Editor` parameter in constructor
- Reuse the provided editor's interpreter, state, and buffers
- Skip `*scratch*` buffer creation when external editor is provided

**MUST NOT:**
- Change the existing `new TmaxServer()` path — daemon-only mode must work unchanged
- Create a second Editor instance when external one is provided

**Convention source:** `src/server/server.ts` constructor pattern

**Acceptance criteria:**
- [ ] `new TmaxServer(myEditor)` uses the provided editor instance
- [ ] `new TmaxServer()` still creates its own editor (backward-compatible)
- [ ] `bun run typecheck` passes

#### Step 2: Split start() into startEditor() and startSocket()

**User story:** As an embedded caller, I want to initialize the editor (bindings, init file) separately from starting the socket listener.

**Description:** Extract two methods from `start()`:
- `startEditor()` — loads core bindings (`ensureCoreBindingsLoaded`) and init file
- `startSocket()` — creates socket directory, acquires lock, starts listening

`start()` calls both in sequence (backward-compatible). Embedded callers call `startEditor()` then `startSocket()` non-blocking.

**MUST:**
- `startEditor()` is async, loads bindings + init file
- `startSocket()` is async, binds socket and starts listening
- `start()` calls both (existing behavior unchanged)

**MUST NOT:**
- Change the socket path resolution logic
- Remove the `SIGTERM`/`SIGINT` handlers from socket startup

**Convention source:** `src/server/server.ts` lines 557-595

**Acceptance criteria:**
- [ ] `tmax --daemon` still works (calls `start()` which calls both)
- [ ] `startEditor()` + `startSocket()` produce same result as `start()`
- [ ] `startSocket()` can be called non-blocking (returns promise, doesn't block event loop)

### Phase 2: Wire embedded server into main.tsx

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] `src/main.tsx` creates an `Editor` and passes it to `SteepFrontend.run()`
- [ ] The Editor is fully initialized before the frontend starts

#### Step 3: Start embedded server in main.tsx

**User story:** As a user running `tmax file.txt`, I want the socket server to be available for remote clients without running a separate daemon.

**Description:** After creating the Editor and loading the file (Phase 4 in current `main()`), create a `TmaxServer` with that Editor. Call `startEditor()` then fire `startSocket()` as a non-blocking promise (don't await it). The SteepFrontend loop continues as before.

**MUST:**
- Create `TmaxServer` with the existing `editor` instance
- Call `startEditor()` before starting SteepFrontend
- Start socket listener non-blocking (`.catch()` for graceful error)
- If socket is already taken (another tmax instance running), log a warning and continue without socket

**MUST NOT:**
- Change the SteepFrontend loop
- Block the TUI startup on socket binding
- Fail if socket is already in use (another tmax instance is running)

**Convention source:** `src/main.tsx` lines 154-306

**Acceptance criteria:**
- [ ] `bun src/main.tsx file.txt` opens editor AND `tmaxclient --ping` succeeds
- [ ] `tmaxclient -e '(buffer-text)'` returns the buffer content
- [ ] If socket already owned, editor starts without socket (warning logged)
- [ ] `bun run typecheck` passes

### Phase 3: Simplify bin/tmax

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] `bin/tmax` currently has `ensure_daemon()` + background spawn + `exec TUI` flow
- [ ] `src/main.tsx` now embeds the socket server

#### Step 4: Replace daemon spawn with single-process exec

**User story:** As a user, I want `tmax file.txt` to be a single process so it works in any terminal.

**Description:** Replace the default path in `bin/tmax` (lines 180-189) with `exec bun src/main.tsx "$file"`. Keep `--daemon`, `--stop`, `-e`, `--capture` paths unchanged — they use `tmaxclient` to talk to the socket.

Remove `ensure_daemon()`, `wait_for_daemon()`, `is_running()` helper functions from the default path. They're still needed for `--stop`, `-e`, and `--capture` (which need to reach a running instance).

**MUST:**
- Default path: `exec bun "$PROJECT_DIR/src/main.tsx" "${FILES[@]}"` (single process)
- `--daemon` still available as explicit opt-in
- `--stop` works against the embedded server's socket
- `-e` and `--capture` work against the embedded server's socket

**MUST NOT:**
- Remove `--daemon` mode
- Remove `tmaxclient` dependency (still needed for `-e`, `--capture`, `--stop`)
- Change socket path conventions

**Convention source:** `bin/tmax` bash script

**Acceptance criteria:**
- [ ] `tmax file.txt` in a plain terminal (no tmux) opens the editor
- [ ] `tmax --stop` shuts it down
- [ ] `tmax -e '(+ 1 2)'` works while editor is running
- [ ] `tmax --daemon` still starts daemon-only mode

### Phase 4: Cleanup and verify

#### Step 5: Update tests and validate end-to-end

**User story:** As a developer, I want confidence that the embedded server works correctly.

**Description:** Run typecheck, unit tests, and manual verification.

**MUST:**
- All existing tests pass (no regressions)
- Manual verification: start editor, open file, verify socket connectivity

**MUST NOT:**
- Skip any existing test

**Acceptance criteria:**
- [ ] `bun run typecheck` passes
- [ ] `bun test` — no new failures
- [ ] `tmax README.md` in plain terminal works
- [ ] `tmaxclient --ping` returns success while editor is open
- [ ] `tmax --stop` shuts down cleanly

## Acceptance Criteria

1. `tmax file.txt` starts a single process in any terminal (no tmux required)
2. Socket server is available for remote `tmaxclient` connections
3. `tmax --stop`, `tmax -e`, `tmax --capture` all work against the embedded server
4. Local TUI uses direct `editor.handleKey()` calls (no serialization overhead)
5. `tmax --daemon` still available for headless server mode
6. All existing tests pass with zero regressions
7. If socket is already in use, editor starts without socket (graceful degradation)

## Validation Commands

- `bun run typecheck` — passes
- `bun test` — no new failures
- `tmax README.md` — editor opens in plain terminal
- `tmaxclient --ping` — succeeds while editor is running
- `tmax -e '(buffer-text)'` — returns buffer content
- `tmax --stop` — shuts down
- `tmax --daemon` — starts headless daemon (unchanged behavior)

## Design Decisions

| Decision | Rationale | Alternative rejected |
|----------|-----------|---------------------|
| Split `start()` into two methods | Clean separation: editor init is needed always, socket is optional | Conditional logic inside `start()` |
| Non-blocking socket startup | TUI must not wait for socket binding; editor must be responsive immediately | Await socket before showing TUI |
| Graceful socket conflict | Multiple `tmax` windows should work; second one just skips socket | Fail hard if socket taken |
| Keep `bin/tmax` as bash | Simpler than rewriting in TypeScript; bash `exec` is idiomatic | Rewrite bin/tmax as TypeScript |

**Deferred to follow-up:**
- T-Lisp `(server-start)` / `(server-stop)` commands for runtime socket control
- `tmax -t` to open a second TUI connected to the embedded server's socket
- Shared-memory optimization for buffer content across Frame sync

## Edge Cases

- Socket already owned by another tmax process — graceful degradation, continue without socket
- Socket directory doesn't exist — `mkdirSync` with `{ recursive: true }`
- Editor quit (EDITOR_QUIT_SIGNAL) — must clean up socket + lock file
- `tmax --stop` while editor is running — should trigger graceful shutdown via socket, not SIGTERM
- `tmax` launched from within tmux vs plain terminal — both must work identically
- Lock file from crashed process — must detect stale lock and recover
