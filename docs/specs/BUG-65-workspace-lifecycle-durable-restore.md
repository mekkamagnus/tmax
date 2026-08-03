# Bug (pre-existing): workspace-lifecycle integration — durable buffer not restored after daemon restart

## Goals

- `test:integration` green on the workspace durability path: a buffer marked durable survives a daemon restart and is restored to its frame.

## Completion Criteria (Definition of Done)

- [ ] `bun test test/integration/workspace-lifecycle.test.ts` → all green (currently 1 fail).
- [ ] After a daemon restart, a frame whose window held a durable buffer restores that buffer (not just `*scratch*`).
- [ ] `bun run test:integration` exit 0.

## Bug Description

`test/integration/workspace-lifecycle.test.ts:626` — "workspace-move-window target save failure leaves source durable on disk" — fails:

```
expect(restoredRender.windows.map(w => w.bufferName)).toContain("durable.ts")
Expected to contain: "durable.ts"
Received: [ "*scratch*" ]
```

After a daemon restart, the restored frame's window shows only `*scratch*` instead of the durable `durable.ts` buffer. **Pre-existing** — confirmed by stashing all Emacs-M×-gap `src/` changes and re-running; identical failure. Not caused by that work. (`test:integration` overall: 81 pass / 1 fail.)

## Problem Statement

Workspace persistence restores the buffer *list* but not the per-frame window→buffer assignment for the durable buffer on the restart path (the frame comes back pointing at `*scratch*`). Related territory to BUG-61 (daemon workspace restore) but distinct: BUG-61 is test hermeticity (stale buffers leak in); this is durability (a buffer that should survive doesn't come back to its window).

## Solution Statement

Trace the restart path: on daemon start, `loadWorkspace`/frame restore must reattach each restored frame's windows to their recorded `bufferName` from the persisted workspace, not default to `*scratch*`. Compare the persisted frame shape (does it record window.bufferName?) with the restore logic.

## Relevant Files

- `test/integration/workspace-lifecycle.test.ts` — the failing test (≈line 615-626).
- `src/server/` — workspace load + frame restore on daemon start.
- Related: BUG-61 (workspace restore), `src/core/` workspace persistence.

## Severity / Notes

- **Priority:** medium. Pre-existing; data-durability surface (a buffer marked durable is silently dropped on restart). Not from the Emacs-M× gap work.
