# Bug Fix: Workspace Restore Rebinds a *Messages* Window to *scratch* (#264)

## Goal

A window (or tab) parked on a special buffer — `*Messages*` — must survive a workspace save/load round-trip with its binding intact, observably reported if a referenced buffer is missing from the persisted data.

GitHub issue: #264 (window-management, priority:low)

## Problem Statement (deterministic root cause, pinned by repro)

`WorkspaceRuntime.serializeWorkspace` deliberately excludes `*Messages*` from the serialized buffer list (it is regenerated from the log at restore) but serializes windows verbatim — so a workspace saved with the main window on `*Messages*` persists a window referencing a buffer that is not in the data. On load, `WorkspaceManager`'s `dataToWorkspace` rebuilt the registry from the persisted list only and warn-and-fell-back the window to `*scratch*` (`console.warn` + silent rebind). `Editor.applyWorkspace` then re-resolved through the name map, making the fallback sticky even though `reconcileWorkspace` re-creates the live `*Messages*` buffer unconditionally — the restored session showed `*scratch*` where the user parked the message log.

## Solution

In `dataToWorkspace` (`src/core/workspace.ts`), for both windows and tabs: a reference to a named buffer missing from the registry now **re-creates an empty buffer under that name** (binding survives; `reconcileWorkspace` immediately refills `*Messages*` from the log render) and records the miss in the existing `restoreWarnings` channel (surfaced as `*Messages*` log entries by the server) instead of `console.warn` + `*scratch*` fallback. A reference with no name at all still falls back to `*scratch*`. The serialize-side exclusion contract is pinned by test (exclusion stays — the buffer is regenerable).

The twin `dataToWorkspace` in `src/server/serialize.ts` (wire-format library, not the daemon restore path) keeps its old fallback — noted in the ADR as a documented divergence.

Out of scope: `*daemon*` (persisted like a regular buffer today — no known miss), #260/#261/#263.

## Completion Criteria

1. A workspace saved with `window-main` on `*Messages*` (the exact shape `serializeWorkspace` emits — buffer list without it, window referencing it) loads with `windows[0].bufferName === "*Messages*"`, the buffer present in the restored registry, and a `restoreWarnings` entry naming the window and buffer — verified by `test/unit/workspace-special-buffer-restore.test.ts` ("a window on *Messages* survives the save/load round-trip"; red before the fix).
2. A tab on `*Messages*` survives the same round-trip — verified by `test/unit/workspace-special-buffer-restore.test.ts` ("a tab on *Messages* survives the round-trip too"; red before the fix).
3. `serializeWorkspace` still excludes `*Messages*` from the buffer list while windows reference it — the pinned contract the restore handles — verified by `test/unit/workspace-special-buffer-restore.test.ts` ("serializeWorkspace still excludes *Messages* while windows reference it").
4. End-to-end: `applyWorkspace` of the loaded workspace rebinds the window to the **live reconciled `*Messages*` instance** (identity with the model's current buffer; content carries the log render, not the stale serialized content, not empty placeholder content beyond the render) — verified by `test/unit/workspace-special-buffer-restore.test.ts` ("applyWorkspace rebinds the restored window to the live *Messages* buffer"; red before the fix).
5. No regressions: the workspace suites (`workspace-serialization`, any `WorkspaceManager` tests), window suites, and the full unit gate pass; `bun run typecheck:src` + `typecheck:test` are clean.
