# Bug: last-workspace tracking is HOME-based — latent tmax-use hermeticity hole

## Bug Description
The daemon persists the name of the last-active workspace to a file that is
hardwired to the **real** user home (`~/.config/tmax/last-workspace`), ignoring
the `TMAX_WORKSPACE_DIR` sandbox used everywhere else. Under the tmax-use test
harness, the daemon's workspaces live in an isolated
`${socketPath}-ws` dir (`tmax-use/src/instance.ts:134`), but the last-workspace
marker still resolves to the operator's real home. That is a latent
state-flows-out-of-the-sandbox hole.

Filed from the BUG-61 / #110 verify-gate (ADR-0171 out-of-scope).

## Goals
- Make the last-workspace marker resolve under the **same root** as the
  workspace dir, so a daemon sandboxed by `TMAX_WORKSPACE_DIR` never reads or
  writes the real `~/.config/tmax/last-workspace`.
- Close the latent hermeticity hole so a future tmax-use playbook that sends a
  `workspaceId` (the currently-dormant write path) cannot leak state out of the
  sandbox.
- Keep the non-sandboxed (production) path bit-for-bit identical: the marker
  stays at `~/.config/tmax/last-workspace` when `TMAX_WORKSPACE_DIR` is unset.

## Completion Criteria (Definition of Done)
- [ ] `lastWorkspaceFile` is derived from the **same root** as the workspace dir
      (honoring `TMAX_WORKSPACE_DIR`), not hardcoded to `process.env.HOME`.
      Asserted by a unit test that constructs a `TmaxServer` with
      `TMAX_WORKSPACE_DIR` set and checks the resolved path.
- [ ] With `TMAX_WORKSPACE_DIR=/tmp/x-ws`, no file is created at the real
      `~/.config/tmax/last-workspace` after a workspace activation + write
      (`updateLastWorkspace`).
- [ ] With `TMAX_WORKSPACE_DIR` unset, the marker path is still
      `~/.config/tmax/last-workspace` (no behavior change for production).
- [ ] The daemon never reads the real `last-workspace` when
      `TMAX_WORKSPACE_DIR` is set (read path also sandboxed).
- [ ] A tmax-use run that sends a `workspaceId` param (exercising the dormant
      write path at `server.ts:1141`) writes the marker under the isolated dir,
      not the real home.
- [ ] `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`
      all clean.
- [ ] Existing workspace / daemon tests stay green (no regression to the
      restore-on-startup logic at `server.ts:290-304`).

## Root Cause (investigated 2026-08-06)
`src/server/server.ts:163-165` constructs the marker path directly from the
real home and never consults the workspace root:

```ts
this.lastWorkspaceFile = path.join(
  process.env.HOME ?? '.', '.config', 'tmax', 'last-workspace'
);
```

The marker is used in two places, both keyed off this field:
- **Read** — `readLastWorkspace()` (`server.ts:506-513`, called at startup
  `server.ts:293`) reads the **real** home file.
- **Write** — `updateLastWorkspace(name)` (`server.ts:495-503`, called at
  `server.ts:1141` when a client sends an explicit `workspaceId`/`workspace`
  param) **writes** the real home file.

This diverges from every other workspace path: `src/core/workspace.ts:41-43`
defines `defaultWorkspaceDir()` as
`process.env.TMAX_WORKSPACE_DIR ?? ${HOME}/.config/tmax/workspaces`, and the
tmax-use launcher (`tmax-use/src/instance.ts:134-135`) sandboxs the daemon by
setting `TMAX_WORKSPACE_DIR=${socketPath}-ws`. The last-workspace marker is the
**only** workspace-adjacent path that bypasses this sandbox.

### Why it is NOT manifesting today (latent, not active)
1. **Write path is dormant.** No tmax-use playbook/client sends a
   `workspaceId`/`workspace` param, so `explicitWorkspace`
   (`server.ts:1139`) is always `false` and `updateLastWorkspace`
   (`server.ts:1141`) never fires. Nothing writes the marker today.
2. **Read path is self-neutralizing.** `readLastWorkspace()`'s result is
   filtered at `server.ts:294` against the **isolated**
   `workspaceManager.list()` (`list.right.some(m => m.name === lastWorkspace)`).
   A stale real-home name points at a workspace absent from the isolated dir, so
   it falls through to `list.right[0]?.name ?? 'default'` — harmless today.

The hole opens the moment a tmax-use path starts sending `workspaceId` (then the
write path fires and state flows out of the real home), or the moment the read
filter is loosened. It must be closed at the source.

> Note on the original framing: the issue is correctly characterized in the
> filing. The fix target is the path derivation at `server.ts:163`, not the
> read filter at `server.ts:294` (the filter is a useful defense-in-depth and
> should be left in place).

## Codex adversarial review (2026-08-06) — correction
The original proposed code `path.join(manager.workspaceDir, 'last-workspace')`
was **wrong**: it would nest the marker under the workspace dir, producing
`~/.config/tmax/workspaces/last-workspace` in production — contradicting the
required production path `~/.config/tmax/last-workspace`. The marker is not a
symmetric child of the workspace dir. It is a **sibling** under the same env
root, and the env root differs by case: production root is
`~/.config/tmax` (the workspace dir's parent, because `defaultWorkspaceDir()`
appends `workspaces`); sandbox root is `TMAX_WORKSPACE_DIR` itself (the manager
uses the env var verbatim, no suffix). Derive the marker from the env root, not
the workspace dir. Corrected scheme (and in-place edit above):
- Production: `~/.config/tmax/last-workspace` (unchanged).
- Sandbox: `$TMAX_WORKSPACE_DIR/last-workspace` (e.g. `/tmp/x-ws/last-workspace`).
Both paths are now covered by the Test Plan (unit assertions for each branch).

## Implementation Plan
The fix is a single-source-of-truth change to where the marker path is derived.
Mirror the convention already established in `defaultWorkspaceDir()`
(`src/core/workspace.ts:41-43`): honor `TMAX_WORKSPACE_DIR`, fall back to the
HOME-based config dir.

1. **Expose the workspace root on `WorkspaceManager`** — `src/core/workspace.ts:79`
   declares `private workspaceDir: string;` with no getter. Add a public
   accessor (e.g. `get workspaceDir(): string { return this.#workspaceDir; }`
   or a plain `public readonly`), so the server can ask the manager it already
   owns where the root is. (Alternative: re-derive in server.ts by inlining the
   `process.env.TMAX_WORKSPACE_DIR ?? ${HOME}/.config/tmax` expression — but
   that duplicates the convention; prefer the getter so the root stays defined
   in one place.) The chosen accessor must reflect whatever directory the
   manager was constructed with (it accepts a `workspaceDir?` ctor arg at
   `workspace.ts:83`).

2. **Derive `lastWorkspaceFile` from the workspace root** — in
   `src/server/server.ts:163-165`, replace the hardcoded HOME join with a path
   that sits alongside the workspace dir under the **same** root. The workspace
   dir is `${root}/workspaces`; the marker should be `${root}/last-workspace`
   (i.e. the parent of the workspace dir). Concretely:
   - Production (`TMAX_WORKSPACE_DIR` unset): root = `~/.config/tmax`, workspace
     dir = `~/.config/tmax/workspaces`, marker = `~/.config/tmax/last-workspace`
     — **identical to today**.
   - Sandboxed (`TMAX_WORKSPACE_DIR=/tmp/x-ws`): workspace dir = `/tmp/x-ws`
     (the manager is constructed with this exact path), marker =
     `/tmp/x-ws/last-workspace` — inside the sandbox.
   - Since the server constructs its `WorkspaceManager` with no arg
     (`server.ts:159`), the manager resolves `TMAX_WORKSPACE_DIR` itself. The
     marker is **not** a symmetric function of `manager.workspaceDir`: it is a
     **sibling** of the workspace dir under a shared root, derived from the same
     env root the manager uses. Concretely:
     - Production (`TMAX_WORKSPACE_DIR` unset): the manager's root is
       `~/.config/tmax`, the workspace dir is `~/.config/tmax/workspaces`, and
       the marker is `~/.config/tmax/last-workspace` — the workspace dir's
       parent. (So `path.dirname(manager.workspaceDir)` is correct here.)
     - Sandboxed (`TMAX_WORKSPACE_DIR=/tmp/x-ws`): the manager's root **is**
       the env dir itself (`/tmp/x-ws`); the workspace dir is `/tmp/x-ws`
       (the manager uses `TMAX_WORKSPACE_DIR` verbatim, no `workspaces/`
       suffix). The marker is `/tmp/x-ws/last-workspace` — a child of the env
       dir, NOT `dirname` of the workspace dir (which would be `/tmp`).
     - Therefore derive the marker from the **env root**, not from the
       workspace dir: `const root = process.env.TMAX_WORKSPACE_DIR ?? path.join(HOME, '.config', 'tmax'); this.lastWorkspaceFile = path.join(root, 'last-workspace');`. (Production yields the
       parent of `workspaces/` because `defaultWorkspaceDir()` appends
       `workspaces` to that same root; sandbox yields the env dir directly
       because the manager does not append the suffix there.)
   - Order matters: move the `lastWorkspaceFile` assignment to **after** the
     `this.workspaceManager = new WorkspaceManager();` line (`server.ts:159`)
     so the manager exists.

3. **Leave the read filter in place** — do not touch `server.ts:290-304`. The
   `list.right.some(m => m.name === lastWorkspace)` check is correct
   defense-in-depth and now operates on a sandbox-consistent marker.

4. **Do not change the dormant write path** — `server.ts:1136-1141` is correct
   as written; once the marker path is sandboxed, an explicit `workspaceId`
   will write inside the sandbox.

### Pattern to mirror
`defaultWorkspaceDir()` (`src/core/workspace.ts:41-43`) is the established
convention for "workspace-adjacent path that must honor the sandbox". The fix
makes `lastWorkspaceFile` follow it.

## Test Plan
- **Unit (new):** construct a `TmaxServer` (or directly exercise the
  `WorkspaceManager` + path derivation) with `TMAX_WORKSPACE_DIR` pointed at a
  temp dir; assert the resolved `lastWorkspaceFile` is
  `<temp>/last-workspace`, NOT `~/.config/tmax/last-workspace`. May require
  exposing the path for test (e.g. a package-private getter or by reading the
  field via the same accessor added in step 1).
- **Unit (new, write path):** with `TMAX_WORKSPACE_DIR` set to a temp dir,
  drive `updateLastWorkspace('foo')` (or the `initialize`/client-connect path
  that triggers it) and assert the marker file appears under the temp dir and
  that the real `~/.config/tmax/last-workspace` is **untouched** (capture its
  pre-state, assert unchanged post).
- **Unit (regression):** with `TMAX_WORKSPACE_DIR` unset, assert the marker path
  is still `~/.config/tmax/last-workspace`.
- **tmax-use (latent-hole coverage):** extend an existing tmax-use instance test
  (`test/unit/tmax-use/instance.test.ts`) — or add one — that launches the
  daemon with a `workspaceId` param and asserts no file is created at the real
  `~/.config/tmax/last-workspace`. This covers the dormant write path becoming
  active.
- **Validation commands:** `bun run typecheck:src`, `bun run typecheck:test`,
  `bun run typecheck`; `bun test test/unit/server-daemon-hardening.test.ts
  test/unit/server-frame-sync.test.ts test/unit/tmax-use/instance.test.ts
  test/integration/workspace-lifecycle.test.ts`.

## Relevant Files
Read these before editing:

- `src/server/server.ts` — `lastWorkspaceFile` declaration (`:150`), hardcoded
  derivation (`:163-165`), startup read + filter (`:290-304`, esp. `:293-296`),
  write helper `updateLastWorkspace` (`:495-503`), read helper
  `readLastWorkspace` (`:506-513`), write call site on explicit workspace
  (`:1136-1141`).
- `src/core/workspace.ts` — `defaultWorkspaceDir()` (`:41-43`), private
  `workspaceDir` field (`:79`), ctor arg (`:83-84`). Add the getter here.
- `tmax-use/src/instance.ts` — `:128-135` shows the sandbox convention
  (`TMAX_WORKSPACE_DIR=${socketPath}-ws`) the marker must honor.
- `test/unit/tmax-use/instance.test.ts` — `:58-87` the hermeticity-assertion
  pattern to extend.
- `test/integration/workspace-lifecycle.test.ts`,
  `test/unit/server-daemon-hardening.test.ts`,
  `test/unit/server-frame-sync.test.ts` — existing workspace/daemon tests to keep
  green.

### New Files
None.

## Notes
- This is a **latent** bug (no live symptom). The DoD is about closing the hole
  so the dormant write path cannot leak state when a tmax-use path eventually
  sends a `workspaceId`, and so the read path stops touching the real home.
- The original issue's framing is accurate; the only correction is emphasis —
  the fix belongs at the path derivation (`server.ts:163`), not the read filter
  (`server.ts:294`), which should be preserved as defense-in-depth.
- Related: BUG-61 / #110 (tmax-use workspace isolation via
  `TMAX_WORKSPACE_DIR`), ADR-0171 (the verify-gate that deferred this as
  out-of-scope).
