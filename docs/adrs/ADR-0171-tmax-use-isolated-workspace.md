# ADR-0171 — tmax-use isolates the daemon workspace per instance (#110 / BUG-61)

## Status

Accepted

## Context

`tmax-use` spawned each test daemon with `{ ...process.env, TMAX_SOCKET, ...spec.env }`
(`tmax-use/src/instance.ts` `spawnDaemonReal`). The socket was isolated (unique
`TMAX_SOCKET`) but **`HOME` was the real one**, so the daemon restored
`~/.config/tmax/workspaces/default.json` on startup (`src/core/workspace.ts:42`
defaulted to `${HOME}/.config/tmax/workspaces` when `TMAX_WORKSPACE_DIR` was unset).

Consequence: playbook runs were **not hermetic**. Buffers left in the persisted
workspace by a prior run (e.g. a leftover `eval-28-src.txt`) were restored, so
buffer-counting playbooks broke — `eval-24-next-previous-buffer` (3-buffer cycle
`C→B→A→C`) FAILED against the real HOME and passed only with `HOME=$(mktemp -d)`.
This was a real contributor to tmax-use flakiness (paired with BUG-60/72).

## Decision

Isolate the workspace per instance via the env var the daemon already honors:
`launch` sets `TMAX_WORKSPACE_DIR` to a per-instance path **derived from the unique
`socketPath`** (`${socketPath}-ws`) and folds it into `spec.env` (which
`spawnDaemonReal` already spreads into the daemon env after `TMAX_SOCKET`). The
daemon then uses the isolated dir (`core/workspace.ts:42` prefers
`TMAX_WORKSPACE_DIR`), so it never reads or restores the real
`~/.config/tmax/workspaces`. Cleanup mirrors the socket: `stopDaemonReal` and the
`preCleanup` step `fs.rm(`${socketPath}-ws`, { recursive, force })` alongside
unlinking the socket.

Deriving from `socketPath` (rather than `mkdtemp`) needs no new temp-dir machinery
and guarantees the workspace dir pairs 1:1 with the socket for cleanup. Workspace
persistence — a user feature for the real daemon — is untouched; only tmax-use
spawns get the isolated dir.

## Consequences

- **Easier:** playbook runs are hermetic — stale workspace buffers no longer leak
  in. `eval-24` passes against the real HOME (verified; was FAIL). Cross-run state
  pollution is gone.
- **Easier:** pairs with the unique socket for a fully-isolated per-instance
  daemon (socket + workspace).
- **Harder:** each tmax-use spawn now creates + must clean a workspace dir; the
  cleanup is best-effort alongside socket cleanup (a crashed runner leaves
  `${socket}-ws` dirs in the temp folder, same failure mode as leftover sockets).
- **Out of scope:** `~/.config/tmax/init.tlisp` is still HOME-based (a user init
  file could affect a test daemon). BUG-61 is specifically workspace restoration;
  init-file isolation is a separate concern if it surfaces.
- **Latent hole (filed BUG-73):** `src/server/server.ts:163` last-workspace
  tracking (`lastWorkspaceFile = ${HOME}/.config/tmax/last-workspace`) is also
  HOME-based and ignores `TMAX_WORKSPACE_DIR`. Confirmed NOT manifesting today:
  no tmax-use playbook/client sends a `workspaceId` param, so `explicitWorkspace`
  is always false and `updateLastWorkspace` (the write path) is dormant; and the
  `readLastWorkspace` result is filtered against the isolated
  `workspaceManager.list()`, so a stale real-home name falls back to `default`
  (self-neutralizing). But it is a latent state-flows-out hermeticity hole if a
  future path sends `workspaceId`; tracked in BUG-73, not addressed here.
