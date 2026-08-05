# ADR-0174 — last-workspace marker honors `TMAX_WORKSPACE_DIR` (#123 / BUG-73)

## Status

Accepted

## Context

The daemon persists the name of the last-active workspace to a marker file.
`src/server/server.ts` derived that path directly from the real home:

```ts
this.lastWorkspaceFile = path.join(process.env.HOME ?? '.', '.config', 'tmax', 'last-workspace');
```

This **ignored `TMAX_WORKSPACE_DIR`** — the sandbox every other workspace path
honors (`src/core/workspace.ts` `defaultWorkspaceDir()` prefers
`TMAX_WORKSPACE_DIR`; the tmax-use launcher sets it to `${socketPath}-ws` per
instance). The marker was the only workspace-adjacent path that bypassed the
sandbox, a latent hermeticity hole: the read path (`readLastWorkspace`) touched
the real `~/.config/tmax/last-workspace` at startup, and the dormant write path
(`updateLastWorkspace`, fired only when a client sends an explicit
`workspaceId`) would have leaked state **out** of the sandbox the moment a
tmax-use path started sending `workspaceId`.

Today the hole is latent (no tmax-use client sends `workspaceId`, and the read
result is filtered against the isolated `workspaceManager.list()` so a stale
real-home name self-neutralizes). Filed from the BUG-61 / #110 verify-gate
(ADR-0171) as out-of-scope.

## Decision

Derive the marker from the **same env root** the workspace manager uses, via a
single pure helper added next to `defaultWorkspaceDir()`:

```ts
// src/core/workspace.ts
export function resolveLastWorkspaceFile(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const root = env.TMAX_WORKSPACE_DIR ?? path.join(env.HOME ?? '.', '.config', 'tmax');
  return path.join(root, 'last-workspace');
}
```

`src/server/server.ts` now calls `this.lastWorkspaceFile = resolveLastWorkspaceFile();`.

The marker is a **sibling** of the workspace dir under a shared env root, not a
child of it (the original proposed `path.join(manager.workspaceDir, …)` was
rejected by the Codex review — it would nest the marker under `workspaces/` in
production):

- **Production** (`TMAX_WORKSPACE_DIR` unset): root = `~/.config/tmax` (the
  workspace dir's parent, because `defaultWorkspaceDir()` appends `workspaces`),
  marker = `~/.config/tmax/last-workspace` — **identical to today**.
- **Sandboxed** (`TMAX_WORKSPACE_DIR=/tmp/x-ws`): the manager uses the env dir
  verbatim (no `workspaces/` suffix), so root = `/tmp/x-ws`, marker =
  `/tmp/x-ws/last-workspace` — inside the sandbox.

The helper is parameterized (defaults to `process.env`) so the derivation can be
unit-tested hermetically without env mutation or constructing a full server.

The read filter at `server.ts:294` (`list.right.some(m => m.name === lastWorkspace)`)
is left in place — it remains correct defense-in-depth and now operates on a
sandbox-consistent marker.

## Consequences

- A daemon sandboxed by `TMAX_WORKSPACE_DIR` (notably every tmax-use instance)
  never reads or writes the real `~/.config/tmax/last-workspace`. The dormant
  write path can no longer leak state out of the sandbox when a future client
  sends `workspaceId`.
- Production behavior is unchanged: the marker stays at
  `~/.config/tmax/last-workspace` when `TMAX_WORKSPACE_DIR` is unset.
- The existing integration test `connect-frame with explicit workspace persists
  last-workspace` (which sets `TMAX_WORKSPACE_DIR`) was asserting the pre-fix
  HOME-based location; it now asserts the correct sandboxed location and that
  the real HOME path is never created — turning a latent-hole assertion into a
  hermeticity lock.
- `resolveLastWorkspaceFile` is the single source of truth for the marker path,
  mirroring `defaultWorkspaceDir()`'s sandbox convention.
