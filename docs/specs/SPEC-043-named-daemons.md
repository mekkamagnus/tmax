# Feature: Named Daemons and Daemon Discovery

**Depends on:** RFC-014 (workspace system), existing daemon/client architecture

### Prerequisites (must pass before implementation)

1. **Existing daemon** — `src/server/server.ts` with socket lock + probe mechanism works
2. **`bin/tmax`** — `ensure_daemon` / `is_running` / `wait_for_daemon` bash helpers exist
3. **Lock files** — `{socket}.lock` with `{pid, socketPath, startedAt, cwd}` already recorded

## Feature Description

Named daemon instances with discoverability. Each daemon gets a human-readable name reflected in its socket filename (`/tmp/tmax-{uid}/{name}`), a `tmax ls` command lists all running instances, and a `*daemons*` virtual buffer inside tmax provides an interactive management view. The default unnamed socket remains `/tmp/tmax-{uid}/server` for backward compatibility.

## User Story

As a tmax user working across multiple projects,
I want to run named daemon instances (e.g. `tmax --daemon=project-a`, `tmax --daemon=project-b`) and list/connect to them,
So that I can keep separate editor sessions with independent workspaces, buffers, and state without collisions.

## Problem Statement

Today tmax supports exactly one daemon per user at `/tmp/tmax-{uid}/server`. Running `tmax --daemon` when one is already running prints "Daemon already running" and exits. There is no way to:
- Run multiple daemons for different projects
- See what daemons are running
- Connect a TUI to a specific named daemon
- Clean up stale sockets from crashed daemons

The `TMAX_SOCKET` env var provides an escape hatch but is invisible — you can't discover what sockets exist or which are alive.

## Solution Statement

1. Extend daemon startup to accept a `--daemon=NAME` argument that sets the socket path to `/tmp/tmax-{uid}/{NAME}`.
2. Add a `tmax ls` CLI command that scans the socket directory, probes each socket, reads lock files, and prints a table of running instances.
3. Add a `--daemon=NAME` / `-d NAME` flag to `tmaxclient` and `tmax` for connecting to a named instance.
4. Add a `*daemons*` virtual buffer inside tmax that renders the same discovery data as an editable/viewable buffer.
5. Add stale socket cleanup to `tmax ls` with a `--prune` flag.

## Architecture Constraints

| Area | Governing Doc | Rule |
|------|--------------|------|
| Socket protocol | `rules/daemon-client.md` | JSON-RPC 2.0 over Unix domain socket, newline-delimited |
| Socket ownership | `rules/daemon-client.md` §Socket Ownership | One owner per socket, lock file + ping probe, stale cleanup |
| Daemon entry point | `bin/tmax` | Bash wrapper handles daemon lifecycle; `TMAX_SOCKET` env overrides socket path |
| Server startup | `src/server/server.ts` | `acquireSocket()` handles lock acquisition and probe |
| Client connection | `bin/tmaxclient` | `getDefaultSocketPath()` resolves socket from env or uid |
| Special buffers | `src/editor/editor.ts` | `createBuffer("*name*", content)` pattern (see `*scratch*`, `*Messages*`) |
| T-Lisp evaluation | `src/editor/CLAUDE.md` | TypeScript provides primitives only; display logic for `*daemons*` is acceptable as a rendering primitive |

## Relevant Files

### Existing Files to Modify

| File | Change | Constraints |
|------|--------|-------------|
| `bin/tmax` | Add `--daemon=NAME` parsing, `ls` subcommand, `-d NAME` connect flag | Backward compatible — no-arg `--daemon` still uses default socket |
| `bin/tmaxclient` | Add `-d NAME` / `--daemon NAME` socket resolution | Reuses existing `getDefaultSocketPath()` logic |
| `src/server/server.ts` | Add `server-info` RPC response fields (daemon name, uptime) | `rules/daemon-client.md` — new RPC method documented there |
| `src/editor/editor.ts` | Add `*daemons*` virtual buffer creation primitive | `src/editor/CLAUDE.md` — primitive only, no logic |
| `src/editor/tlisp-api.ts` | Expose `daemon-list` primitive to T-Lisp | Returns array of daemon info objects |
| `rules/daemon-client.md` | Document named daemon conventions, `ls` method, `server-info` additions | Update method tables |

### New Files

| File | Purpose | Constraints |
|------|---------|-------------|
| `src/server/daemon-discovery.ts` | Socket directory scanning, lock file reading, probe logic | Pure functions, no side effects except socket probe |
| `test/unit/daemon-discovery.test.ts` | Unit tests for discovery module | `rules/testing.md` — bun test patterns |

### Reference Files (read-only)

| File | Why |
|------|-----|
| `src/server/server.ts` lines 86-100 | `LockData` interface and `lockPathFor`, `readLock` helpers |
| `src/server/server.ts` line 761-830 | `getDefaultSocketPath`, `probeDaemon`, `acquireSocket` |
| `bin/tmax` lines 78-106 | `ensure_daemon` bash function |
| `src/editor/message-log.ts` | Pattern for virtual buffer (`*Messages*`) |

## Implementation Phases

### Phase 1: Foundation — Named socket resolution

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] `bin/tmax` argument parsing handles `--daemon` (no value) correctly today
- [ ] `TMAX_SOCKET` env var overrides socket path in both `bin/tmax` and `bin/tmaxclient`

#### Step 1: Add `--daemon=NAME` to `bin/tmax`

**User story:** As a user, I want to start a named daemon so I can run multiple instances side by side.

**Description:** Extend the `--daemon` flag to accept an optional `=NAME` suffix. When `NAME` is provided, set `SOCKET` to `/tmp/tmax-{uid}/{NAME}`. When omitted, keep the default `/tmp/tmax-{uid}/server`.

**MUST:**
- Parse `--daemon=NAME` in the argument loop (bash pattern: `--daemon=*`)
- Set `SOCKET="/tmp/tmax-${TMAX_UID}/${NAME}"` when name provided
- `--daemon` (bare) still uses `/tmp/tmax-${TMAX_UID}/server`
- `--stop` works with named daemons (reads `SOCKET` the same way)
- `-d NAME` shorthand for connecting to a named daemon (sets `SOCKET` and launches TUI)
- Update `usage()` text with new examples

**MUST NOT:**
- Change default socket path for existing `--daemon` (backward compat)
- Remove `TMAX_SOCKET` env var override

**Convention source:** `bin/tmax` — existing argument parsing pattern

**Acceptance criteria:**
- [ ] `tmax --daemon=myproject` starts daemon at `/tmp/tmax-{uid}/myproject`
- [ ] `tmax --daemon` starts daemon at `/tmp/tmax-{uid}/server` (unchanged)
- [ ] `tmax -d myproject` connects TUI to named daemon
- [ ] `tmax --stop` with `TMAX_SOCKET` set stops that specific daemon

#### Step 2: Add `-d NAME` to `bin/tmaxclient`

**User story:** As a user, I want `tmaxclient` to resolve named daemons the same way `tmax` does.

**Description:** Add `-d NAME` / `--daemon NAME` flag that resolves socket path from name, mirroring the `bin/tmax` logic.

**MUST:**
- `-d NAME` resolves to `/tmp/tmax-{uid}/{NAME}`
- Existing `-s PATH` continues to work (explicit socket path takes priority)
- `getDefaultSocketPath()` in `TmaxClient` class gets a `daemonName` parameter

**MUST NOT:**
- Change default behavior when no `-d` or `-s` is given

**Convention source:** `bin/tmaxclient` — existing flag parsing

**Acceptance criteria:**
- [ ] `tmaxclient -d myproject --ping` connects to named daemon
- [ ] `tmaxclient --ping` connects to default daemon (backward compat)

#### Step 3: Add `daemonName` to server startup and lock data

**User story:** As a developer, I want the server to know its own name so it can report it in status queries.

**Description:** Accept a `--name` argument in `server.ts` (or derive from socket path). Store name in lock file and make available via `server-info` RPC.

**MUST:**
- Add `name` field to `LockData` interface
- `TmaxServer` constructor accepts optional `name` parameter
- `server-info` RPC response includes `name`, `pid`, `uptime`, `socketPath`
- Default name is `"server"` when socket path ends in `/server`

**MUST NOT:**
- Require name argument (backward compat — derive from socket path)

**Convention source:** `src/server/server.ts` — existing `LockData` and `acquireSocket`

**Acceptance criteria:**
- [ ] Lock file includes `name` field
- [ ] `tmaxclient --status` (using `server-info` RPC) returns daemon name
- [ ] Default unnamed daemon reports name `"server"`

### Phase 2: Discovery — `tmax ls` and daemon scanning

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Phase 1 complete — named daemons start and connect correctly
- [ ] Lock files contain `name` field

#### Step 4: Create `src/server/daemon-discovery.ts`

**User story:** As a developer, I want a reusable module that scans for running tmax daemons.

**Description:** Pure function module that reads the socket directory, parses lock files, and probes sockets to determine alive/dead status.

**MUST:**
- `listDaemons(socketDir: string): DaemonInfo[]` — scan directory for socket/lock pairs
- `DaemonInfo` type: `{ name, socketPath, pid, startedAt, cwd, alive }`
- Probe each socket with ping (1s timeout) to determine `alive`
- Skip non-socket files and files without matching lock
- `pruneStale(socketDir: string): string[]` — remove sockets where lock PID is dead AND socket probe fails, return pruned paths

**MUST NOT:**
- Start or stop any daemons
- Modify lock files

**Convention source:** `src/server/server.ts` — existing `probeDaemon` pattern

**Acceptance criteria:**
- [ ] `listDaemons()` returns array with `alive: true/false` for each entry
- [ ] `pruneStale()` removes dead sockets and returns their paths
- [ ] Unit tests cover: empty directory, one alive daemon, one dead daemon, mixed

#### Step 5: Add `tmax ls` CLI command

**User story:** As a user, I want to see all running tmax daemons in a table.

**Description:** Add a `ls` subcommand to `bin/tmax` that calls the discovery module and prints a formatted table.

**MUST:**
- `tmax ls` prints: `NAME  PID  STATUS  UPTIME  CWD`
- `tmax ls --prune` also removes stale sockets and prints what was cleaned
- `tmax ls --json` outputs machine-readable JSON array
- No daemon needs to be running for `tmax ls` to work (it reads the filesystem)
- Highlight the default `server` instance

**MUST NOT:**
- Start a daemon
- Require daemon to be running

**Convention source:** `bin/tmax` — existing command structure

**Acceptance criteria:**
- [ ] `tmax ls` shows running daemons with name, PID, status
- [ ] `tmax ls --prune` removes stale entries
- [ ] `tmax ls --json` outputs valid JSON

#### Step 6: Add `list-daemons` RPC method

**User story:** As a TUI client or remote tool, I want to query what daemons exist via the JSON-RPC protocol.

**Description:** Add a `list-daemons` RPC method to `server.ts` that runs the discovery module and returns the result.

**MUST:**
- `list-daemons` RPC returns `DaemonInfo[]` array
- `prune-daemons` RPC cleans stale sockets and returns pruned paths
- Update `rules/daemon-client.md` method table

**MUST NOT:**
- Stop running daemons through this method

**Convention source:** `rules/daemon-client.md` — RPC method conventions

**Acceptance criteria:**
- [ ] `tmaxclient --eval '(daemon-list)'` returns daemon info from T-Lisp
- [ ] RPC method documented in `rules/daemon-client.md`

### Phase 3: Integration — `*daemons*` buffer

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Phase 2 complete — `tmax ls` works from CLI
- [ ] `*scratch*` and `*Messages*` buffers exist as patterns

#### Step 7: Add `*daemons*` virtual buffer

**User story:** As a user inside tmax, I want to see running daemons in a buffer so I can manage them without leaving the editor.

**Description:** Create a `*daemons*` virtual buffer that renders the daemon list in a readable format. Expose `daemon-list` as a T-Lisp primitive so it can be called from the minibuffer.

**MUST:**
- `*daemons*` buffer created on demand (not at startup)
- Content rendered by calling `listDaemons()` and formatting as text
- T-Lisp primitive `(daemon-list)` returns formatted string
- T-Lisp primitive `(daemon-switch "name")` connects to named daemon (future: for now just displays info)
- Buffer refreshes on each open (not live-updating)

**MUST NOT:**
- Auto-create `*daemons*` at startup
- Add interactive daemon management (stop, restart) — deferred to follow-up
- Change buffer switching mechanism — use existing `(switch-to-buffer "*daemons*")`

**Convention source:** `src/editor/message-log.ts` — virtual buffer pattern

**Acceptance criteria:**
- [ ] `(switch-to-buffer "*daemons*")` shows daemon list
- [ ] Buffer lists name, PID, status, uptime, cwd for each daemon
- [ ] `bun run typecheck:src` passes

### Phase 4: Tests and validation

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Phase 3 complete — `*daemons*` buffer renders
- [ ] `rules/testing.md` — test patterns

#### Step 8: Unit tests for daemon-discovery

**User story:** As a developer, I want tests for the discovery module so I can catch regressions.

**Description:** Create `test/unit/daemon-discovery.test.ts` testing socket scanning logic.

**MUST:**
- Test `listDaemons()` with temp directory containing socket + lock pairs
- Test alive vs dead daemon detection
- Test `pruneStale()` removes only dead entries
- Test empty directory returns empty array
- Test malformed lock file handling

**MUST NOT:**
- Start real daemons in tests — use filesystem fixtures only

**Convention source:** `rules/testing.md` — bun test patterns

**Acceptance criteria:**
- [ ] `bun test test/unit/daemon-discovery.test.ts` — all tests pass
- [ ] Tests cover at least 5 distinct scenarios

#### Step 9: Final validation

**User story:** As a developer, I want zero regressions so the feature is safe to merge.

**Description:** Run full validation suite.

**MUST:**
- All typecheck commands pass
- All build commands pass
- Full test suite passes
- Manual smoke test: start named daemon, list, connect, stop

**MUST NOT:**
- Skip any validation command

**Convention source:** `CLAUDE.md` §8 — verify before reporting complete

**Acceptance criteria:**
- [ ] `bun run typecheck:src` — zero errors
- [ ] `bun run typecheck:test` — zero errors
- [ ] `bun run build` — succeeds
- [ ] `bun test` — full suite passes
- [ ] `tmax --daemon=test1 && tmax ls | grep test1 && tmax -d test1 --stop` — named daemon lifecycle works

## Acceptance Criteria

1. `tmax --daemon=myproject` starts a daemon at `/tmp/tmax-{uid}/myproject` (distinct from default)
2. `tmax ls` prints a table of all running tmax daemons with name, PID, status, uptime, cwd
3. `tmax ls --prune` removes stale sockets from crashed daemons
4. `tmax -d myproject` connects TUI to named daemon
5. `tmaxclient -d myproject --ping` verifies named daemon is alive
6. Lock files contain daemon name, enabling discovery without connecting
7. Default `--daemon` (no name) is fully backward compatible
8. `*daemons*` buffer renders daemon list inside the editor
9. All existing tests pass, typecheck clean, build succeeds

## Validation Commands

- `bun run typecheck:src` — zero TypeScript errors in source
- `bun run typecheck:test` — zero TypeScript errors in tests
- `bun run build` — build compiles without errors
- `bun test test/unit/daemon-discovery.test.ts` — new discovery tests pass
- `bun test` — full suite passes
- `tmax --daemon=test1 && sleep 1 && tmax ls | grep test1` — named daemon appears in list
- `tmax -d test1 --stop && sleep 1 && tmax ls | grep -c test1` — returns 0 after stop
- `tmax ls --prune` — cleans stale entries without error

## Design Decisions

| Decision | Rationale | Alternative rejected |
|----------|-----------|---------------------|
| Socket filename = daemon name | Simple, filesystem-native discovery — scan directory to find all instances | Separate registry file — single point of failure, extra cleanup burden |
| `tmax ls` as bash subcommand | Matches tmux `tmux ls` UX — familiar to terminal users | Separate `tmax-ls` binary — unnecessary, `bin/tmax` is the unified entry |
| Lock file as source of truth | Already exists with PID, timestamps — just add `name` field | New `.json` manifest — duplication, drift risk |
| `*daemons*` buffer on demand | Avoids startup overhead; most users don't need it | Always-on buffer — wastes resources for single-daemon users |
| Probe-based liveness | Ping each socket to confirm alive — handles stale locks from PID reuse | PID-only check — unreliable on macOS/BSD where PIDs recycle |
| `-d NAME` shorthand | Shorter than `-s /tmp/tmax-501/myproject` for common case | Only `--daemon NAME` — too verbose for interactive use |

**Deferred to follow-up:**
- Interactive `*daemons*` buffer — stop/restart daemons from inside tmax
- `tmax --daemon-switch NAME` — hot-switch TUI to a different daemon
- Daemon health monitoring — auto-restart crashed daemons
- Remote daemon connections — TCP socket support for remote editing
- Daemon groups — organize daemons by project/tags

## Edge Cases

- Two daemons with same name — `acquireSocket` rejects with "Daemon already running" (existing behavior)
- Socket directory doesn't exist — `tmax ls` creates it or prints "No daemons running"
- Lock file with dead PID but live socket — probe detects alive, doesn't prune
- Lock file with live PID but dead socket — daemon crashed without cleanup; `pruneStale` removes both
- Daemon name with `/` or special chars — validate name to `[a-zA-Z0-9_-]+`, reject others
- Concurrent `tmax ls` and `tmax --stop` — race condition on lock file reads; stale data is acceptable (list is a snapshot)
- Very large number of daemons — `tmax ls` probes each with 1s timeout; batch or parallelize probes
- macOS vs Linux socket paths — use `os.tmpdir()` + `tmax-{uid}/` consistently
- `TMAX_SOCKET` overrides name-based resolution — env var always wins (existing precedence)
