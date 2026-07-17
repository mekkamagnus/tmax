/**
 * @file rpc/handlers/workspaces.ts
 * @description CHORE-44 Change 5 — workspace-domain RPC handlers (AC5.9).
 *
 * Handler bodies moved verbatim from `TmaxServer`:
 *   handleWorkspaceList, handleWorkspaceNew, handleWorkspaceSwitch,
 *   handleWorkspaceSave, handleWorkspaceKill, handleWorkspaceRename,
 *   handleWorkspaceLoad, handleWorkspaceMoveWindow.
 *
 * Workspace ops use the `workspace-override` sync policy: each handler
 * manages workspace activation/restore and frame sync internally (the legacy
 * `workspaceOverride` exception). The SYNC_POLICY table in router.ts is the
 * authoritative declaration; server-frame-sync.test.ts covers the resulting
 * call patterns.
 */

import type { ServerContext } from "./context.ts";
import type {
  WorkspaceNewParams, WorkspaceNewResult,
  WorkspaceSwitchParams, WorkspaceSwitchResult,
  WorkspaceSaveParams, WorkspaceSaveResult,
  WorkspaceKillParams, WorkspaceKillResult,
  WorkspaceRenameParams, WorkspaceRenameResult,
  WorkspaceLoadParams, WorkspaceLoadResult,
  WorkspaceMoveWindowParams, WorkspaceMoveWindowResult,
  WorkspaceListResult, WorkspaceListRow,
} from "../types.ts";
import type { FrameTarget } from "../types.ts";
import { FunctionalTextBufferImpl } from "../../../core/buffer.ts";
import type { WorkspaceState } from "../../../core/types.ts";
import { Either } from "../../../utils/task-either.ts";

/** Resolve a workspace name from params, mirroring the legacy helper. */
function workspaceNameFromParams(ctx: ServerContext, params: FrameTarget, key: string = 'name'): string {
  const value = (params as Record<string, unknown>)?.[key]
    ?? (params as Record<string, unknown>)?.workspace
    ?? (params as Record<string, unknown>)?.workspaceId;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Workspace ${key} is required`);
  }
  return value;
}

/** Build the workspace-domain handlers bound to a `ServerContext`. */
export function createWorkspaceHandlers(ctx: ServerContext): {
  "workspace-list": () => Promise<WorkspaceListResult>;
  "workspace-new": (params: WorkspaceNewParams) => Promise<WorkspaceNewResult>;
  "workspace-switch": (params: WorkspaceSwitchParams) => Promise<WorkspaceSwitchResult>;
  "workspace-save": (params: WorkspaceSaveParams) => Promise<WorkspaceSaveResult>;
  "workspace-kill": (params: WorkspaceKillParams) => Promise<WorkspaceKillResult>;
  "workspace-rename": (params: WorkspaceRenameParams) => Promise<WorkspaceRenameResult>;
  "workspace-load": (params: WorkspaceLoadParams) => Promise<WorkspaceLoadResult>;
  "workspace-move-window": (params: WorkspaceMoveWindowParams) => Promise<WorkspaceMoveWindowResult>;
} {
  // ── workspace-list ──────────────────────────────────────────────────────
  const workspaceList = async (): Promise<WorkspaceListResult> => {
    ctx.captureActiveWorkspace();
    const disk = await ctx.workspaceManager.list().run();
    if (Either.isLeft(disk)) throw new Error(disk.left);
    const loadedNames = new Set(ctx.workspaces.keys());
    return disk.right.map((metadata): WorkspaceListRow => ({
      name: metadata.name,
      id: metadata.id,
      active: metadata.name === ctx.getActiveWorkspaceId(),
      loaded: loadedNames.has(metadata.name),
      lastAccessed: metadata.lastAccessed,
      projectRoot: metadata.projectRoot ?? null,
      windowCount: ctx.workspaces.get(metadata.name)?.windows.length ?? 0,
    }));
  };

  // ── workspace-new ───────────────────────────────────────────────────────
  const workspaceNew = async (params: WorkspaceNewParams): Promise<WorkspaceNewResult> => {
    const name = workspaceNameFromParams(ctx, params);
    const result = await ctx.workspaceManager.create(name, { projectRoot: params?.projectRoot }).run();
    if (Either.isLeft(result)) throw new Error(result.left);
    ctx.workspaces.set(name, result.right);
    // R4-6: workspace-new is "create only" per spec — don't updateLastWorkspace
    return { success: true, name, id: result.right.metadata.id };
  };

  // ── workspace-switch ────────────────────────────────────────────────────
  const workspaceSwitch = async (params: WorkspaceSwitchParams): Promise<WorkspaceSwitchResult> => {
    const name = workspaceNameFromParams(ctx, params);
    // R4-9: inline the switch logic to avoid double captureActiveWorkspace
    ctx.captureActiveWorkspace();
    await ctx.saveWorkspace(ctx.getActiveWorkspaceId());
    const workspace = await ctx.loadWorkspace(name);
    ctx.setActiveWorkspaceId(name);
    ctx.editor.applyWorkspace(workspace);
    await ctx.updateLastWorkspace(name); // C6
    if (params?.frameId) {
      const frame = ctx.getFrame(params.frameId);
      frame.workspaceId = name;
      ctx.syncEditorToFrame(frame);
    }
    return { success: true, activeWorkspaceId: name };
  };

  // ── workspace-save ──────────────────────────────────────────────────────
  const workspaceSave = async (params: WorkspaceSaveParams): Promise<WorkspaceSaveResult> => {
    const name = params?.name ?? ctx.getActiveWorkspaceId();
    ctx.captureActiveWorkspace();
    await ctx.saveWorkspace(name);
    return { success: true, name };
  };

  // ── workspace-kill ──────────────────────────────────────────────────────
  const workspaceKill = async (params: WorkspaceKillParams): Promise<WorkspaceKillResult> => {
    const name = workspaceNameFromParams(ctx, params);
    if (name === ctx.getActiveWorkspaceId()) {
      throw new Error('Cannot kill the active workspace; switch to another workspace first');
    }
    const workspace = await ctx.loadWorkspace(name);
    const dirtyBuffers = ctx.workspaceDirtyBuffers(workspace);
    if (dirtyBuffers.length > 0 && params?.confirm !== true) {
      return {
        success: false,
        confirmationRequired: true,
        name,
        dirtyBuffers,
        message: `Workspace "${name}" has unsaved buffers`,
      };
    }
    const result = await ctx.workspaceManager.delete(name).run();
    if (Either.isLeft(result)) throw new Error(result.left);
    ctx.workspaces.delete(name);
    for (const frame of ctx.frames.values()) {
      if (frame.workspaceId === name) {
        frame.workspaceId = ctx.getActiveWorkspaceId();
        ctx.syncEditorToFrame(frame); // I2: reset frame state from active workspace
      }
    }
    return { success: true, name };
  };

  // ── workspace-rename ────────────────────────────────────────────────────
  const workspaceRename = async (params: WorkspaceRenameParams): Promise<WorkspaceRenameResult> => {
    const oldName = workspaceNameFromParams(ctx, params, 'oldName');
    const newName = workspaceNameFromParams(ctx, params, 'newName');
    ctx.captureActiveWorkspace();
    const result = await ctx.workspaceManager.rename(oldName, newName).run();
    if (Either.isLeft(result)) throw new Error(result.left);
    const loaded = ctx.workspaces.get(oldName);
    if (loaded) {
      loaded.metadata.name = newName;
      ctx.workspaces.delete(oldName);
      ctx.workspaces.set(newName, loaded);
    }
    if (ctx.getActiveWorkspaceId() === oldName) ctx.setActiveWorkspaceId(newName);
    for (const frame of ctx.frames.values()) {
      if (frame.workspaceId === oldName) frame.workspaceId = newName;
    }
    return { success: true, oldName, newName };
  };

  // ── workspace-load ──────────────────────────────────────────────────────
  const workspaceLoad = async (params: WorkspaceLoadParams): Promise<WorkspaceLoadResult> => {
    const name = workspaceNameFromParams(ctx, params);
    const workspace = await ctx.loadWorkspace(name);
    return { success: true, name, id: workspace.metadata.id };
  };

  // ── workspace-move-window ───────────────────────────────────────────────
  const workspaceMoveWindow = async (params: WorkspaceMoveWindowParams): Promise<WorkspaceMoveWindowResult> => {
    const targetName = params?.target
      ?? (params as Record<string, unknown>)?.name
      ?? (params as Record<string, unknown>)?.workspace
      ?? params?.workspaceId;
    if (typeof targetName !== 'string' || targetName.length === 0) {
      throw new Error('workspace-move-window target is required');
    }
    const frame = ctx.resolveFrameOptional(params);
    const sourceWorkspaceId = typeof params?.sourceWorkspaceId === 'string' ? params.sourceWorkspaceId : undefined;
    const previousWorkspaceId = ctx.getActiveWorkspaceId();
    const previousFrameId = ctx.getActiveFrameId();
    const workspaceOverride = typeof sourceWorkspaceId === 'string'
      && sourceWorkspaceId.length > 0
      && sourceWorkspaceId !== previousWorkspaceId;

    try {
      await ctx.activateFrameWorkspace(frame, sourceWorkspaceId);
      if (frame && !workspaceOverride) ctx.syncFrameToEditor(frame);

      const state = ctx.editor.getState();
      const windows = state.windows ?? [];
      const currentWindowIndex = state.currentWindowIndex ?? 0;
      const currentWindow = windows[currentWindowIndex];
      const buffer = currentWindow?.buffer ?? state.currentBuffer;
      const bufferName = currentWindow?.bufferName ?? ctx.currentBufferName(state);
      if (!buffer || !bufferName) {
        throw new Error('No current window buffer to move');
      }
      const contentResult = buffer.getContent();
      if (Either.isLeft(contentResult)) {
        throw new Error(`Failed to read buffer "${bufferName}": ${contentResult.left}`);
      }

      ctx.captureActiveWorkspace();
      const sourceName = ctx.getActiveWorkspaceId();
      if (targetName === sourceName) {
        return { success: true, source: sourceName, target: targetName, moved: bufferName, noop: true };
      }
      const source = ctx.workspaces.get(sourceName);
      if (!source) throw new Error(`Workspace "${sourceName}" is not loaded`);
      const target = await ctx.loadWorkspace(targetName);
      if (target.buffers.has(bufferName)) {
        throw new Error(`Target workspace "${targetName}" already has buffer "${bufferName}"`);
      }

      const stagedSource = ctx.cloneWorkspace(source);
      const stagedTarget = ctx.cloneWorkspace(target);
      const sourceMeta = stagedSource.bufferMetadata.get(bufferName);
      const copiedBuffer = FunctionalTextBufferImpl.create(contentResult.right);

      stagedTarget.buffers.set(bufferName, copiedBuffer);
      stagedTarget.bufferMetadata.set(bufferName, {
        name: bufferName,
        filename: sourceMeta?.filename,
        modified: sourceMeta?.modified ?? false,
        majorMode: sourceMeta?.majorMode,
        cursorLine: currentWindow?.cursorLine ?? state.cursorPosition.line,
        cursorColumn: currentWindow?.cursorColumn ?? state.cursorPosition.column,
      });
      stagedTarget.bufferModeStates.set(bufferName, stagedSource.bufferModeStates.get(bufferName) ?? {});
      stagedTarget.windows.push({
        id: `window-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        buffer: copiedBuffer,
        bufferName,
        cursorLine: currentWindow?.cursorLine ?? state.cursorPosition.line,
        cursorColumn: currentWindow?.cursorColumn ?? state.cursorPosition.column,
        viewportTop: currentWindow?.viewportTop ?? state.viewportTop,
        viewportLeft: currentWindow?.viewportLeft ?? state.viewportLeft ?? 0,
        splitType: currentWindow?.splitType,
        height: currentWindow?.height,
        width: currentWindow?.width,
        row: currentWindow?.row,
        col: currentWindow?.col,
        scrollback: currentWindow?.scrollback ? structuredClone(currentWindow.scrollback) : undefined,
      });

      stagedSource.windows = stagedSource.windows.filter((window) => window.id !== currentWindow?.id);
      const bufferStillReferenced = stagedSource.windows.some((window) => window.bufferName === bufferName)
        || stagedSource.tabs.some((tab) => tab.bufferName === bufferName);
      if (!bufferStillReferenced) {
        stagedSource.buffers.delete(bufferName);
        stagedSource.bufferMetadata.delete(bufferName);
        stagedSource.bufferModeStates.delete(bufferName);
      }
      if (stagedSource.windows.length === 0) {
        const scratch = stagedSource.buffers.get('*scratch*') ?? FunctionalTextBufferImpl.create('');
        stagedSource.buffers.set('*scratch*', scratch);
        if (!stagedSource.bufferMetadata.has('*scratch*')) {
          stagedSource.bufferMetadata.set('*scratch*', {
            name: '*scratch*',
            modified: false,
            cursorLine: 0,
            cursorColumn: 0,
          });
        }
        stagedSource.windows = [{
          id: 'window-main',
          buffer: scratch,
          bufferName: '*scratch*',
          cursorLine: 0,
          cursorColumn: 0,
          viewportTop: 0,
          viewportLeft: 0,
        }];
        stagedSource.currentBufferName = '*scratch*';
        stagedSource.currentFilename = undefined;
      } else if (stagedSource.currentBufferName === bufferName) {
        stagedSource.currentBufferName = stagedSource.windows[0]?.bufferName ?? '*scratch*';
        stagedSource.currentFilename = stagedSource.currentBufferName
          ? stagedSource.bufferMetadata.get(stagedSource.currentBufferName)?.filename
          : undefined;
      }

      await ctx.saveWorkspaceSnapshot(stagedTarget);
      await ctx.saveWorkspaceSnapshot(stagedSource);
      ctx.workspaces.set(sourceName, stagedSource);
      ctx.workspaces.set(targetName, stagedTarget);
      ctx.editor.applyWorkspace(stagedSource);
      if (frame && !workspaceOverride) ctx.syncEditorToFrame(frame); else ctx.syncEditorToAllFrames();
      return { success: true, source: sourceName, target: targetName, moved: bufferName };
    } finally {
      await ctx.restoreWorkspaceAfterOverride(workspaceOverride, previousWorkspaceId, previousFrameId);
    }
  };

  return {
    "workspace-list": workspaceList,
    "workspace-new": workspaceNew,
    "workspace-switch": workspaceSwitch,
    "workspace-save": workspaceSave,
    "workspace-kill": workspaceKill,
    "workspace-rename": workspaceRename,
    "workspace-load": workspaceLoad,
    "workspace-move-window": workspaceMoveWindow,
  };
}

// Re-exported so server.ts can reuse the same param-name resolution for the
// workspace-* T-Lisp async builtins (preserving the legacy registerWorkspaceBuiltins).
export { workspaceNameFromParams };
