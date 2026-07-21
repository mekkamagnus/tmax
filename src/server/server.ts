#!/usr/bin/env bun
/**
 * @file server.ts
 * @description Server infrastructure for tmax editor with Unix socket support
 * Implements JSON-RPC 2.0 protocol for client communication
 */

import { createServer, Server, Socket } from 'net';
import { userInfo } from 'os';
import { closeSync, existsSync, mkdirSync, openSync, unlinkSync, writeFileSync, readFileSync, promises as fsPromises } from 'fs';
import path from 'path';
import { Editor } from '../editor/editor.ts';
import { TerminalIOImpl } from '../core/terminal.ts';
import {
  routeRequest,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type RpcHandlers,
} from './rpc/router.ts';
import type {
  AproposCommandResult,
  BufferDetails,
  ClientStatusResult,
  DiagnosticResult,
  FrameStatusResult,
  FrameTarget,
  FunctionDocumentation,
  FunctionUsagesResult,
  JsonValue,
  NamedJsonValues,
  ObservabilityErrorResult,
  StatusResult,
  VariableDocumentation,
} from './rpc/types.ts';
import type { ServerContext, ClientRecord, FrameObservability } from './rpc/handlers/context.ts';
import { createEditingHandlers } from './rpc/handlers/editing.ts';
import { createFramesHandlers } from './rpc/handlers/frames.ts';
import { createWorkspaceHandlers } from './rpc/handlers/workspaces.ts';
import { createLifecycleHandlers } from './rpc/handlers/lifecycle.ts';
import { FileSystemImpl } from '../core/filesystem.ts';
import { TextBufferImpl } from '../core/buffer.ts';
import type { TextBuffer } from '../core/contracts/buffer.ts';
import type { EditorState } from '../core/contracts/editor.ts';
import type { Frame, WorkspaceState } from '../core/contracts/workspace.ts';
import { WorkspaceManager } from '../core/workspace.ts';
import { Either } from '../utils/task-either.ts';
import { loadTrtFrameworkSync } from '../tlisp/trt/bootstrap.ts';
import { cloneJsonValue } from '../tlisp/serialization.ts';
import { createBoolean, createHashmap, createList, createNil, createString } from '../tlisp/values.ts';
import type { TLispValue } from '../tlisp/types.ts';

// JSON-RPC 2.0 wire shapes are re-exported from rpc/router.ts (typed router
// boundary — AC5.8). The daemon's per-connection buffer + client record types
// remain here (socket/connection ownership stays in TmaxServer per AC5.6).

interface ClientConnection {
  id: string;
  pid?: number;
  socket: Socket;
  connectedAt: Date;
  clientType: string;
  clientName?: string;
  metadata?: Record<string, JsonValue>;
  lastRequestAt?: Date;
  requestCount: number;
  lastError?: string;
  frameId?: string;
  inputBuffer: string;
}

type ObservabilityError = ObservabilityErrorResult;

interface LockData {
  pid: number;
  socketPath: string;
  startedAt: string;
  cwd: string;
}

function lockPathFor(socketPath: string): string {
  return socketPath + '.lock';
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readLock(path: string): LockData | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeLock(path: string, data: LockData): void {
  writeFileSync(path, JSON.stringify(data), { mode: 0o644 });
}

function tryAcquireLock(path: string, data: LockData): boolean {
  try {
    const fd = openSync(path, 'wx');
    writeFileSync(fd, JSON.stringify(data));
    closeSync(fd);
    return true;
  } catch (err: any) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

function removeFile(path: string): void {
  try { unlinkSync(path); } catch { /* already gone */ }
}

export class TmaxServer {
  private server: Server;
  private socketPath: string;
  private editor: Editor;
  private clients: Map<string, ClientConnection>;
  private frames: Map<string, Frame> = new Map();
  private workspaces: Map<string, WorkspaceState> = new Map();
  private activeWorkspaceId: string = 'default';
  private workspaceManager: WorkspaceManager;
  private frameObservability: Map<string, FrameObservability> = new Map();
  private recentErrors: ObservabilityError[] = [];
  private startedAt: Date = new Date();
  private activeFrameId: string | null = null;
  private isRunning: boolean = false;
  private testMode: boolean = false;
  private ownsSocket: boolean = false;
  private ownsLock: boolean = false;
  private shuttingDown: boolean = false;
	  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
	  private debouncedSaveTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	  private lastSaveHashes: Map<string, string> = new Map();
	  private lastSavedAt: Map<string, number> = new Map();
	  private autoSaveIntervalMs: number;
	  private debounceSaveMs: number;
	  private maxDirtyIntervalMs: number;
	  private lastWorkspaceFile: string;

  constructor(socketPath?: string, testMode: boolean = false, editor?: Editor) {
    this.socketPath = socketPath || this.getDefaultSocketPath();
    this.server = createServer();
    this.clients = new Map();
    this.testMode = testMode;
	    this.workspaceManager = new WorkspaceManager();
	    this.autoSaveIntervalMs = Number(process.env.TMAX_WORKSPACE_AUTOSAVE_MS ?? 30_000);
	    this.debounceSaveMs = Number(process.env.TMAX_WORKSPACE_DEBOUNCE_MS ?? 5_000);
	    this.maxDirtyIntervalMs = Number(process.env.TMAX_WORKSPACE_MAX_DIRTY_MS ?? 120_000);
	    this.lastWorkspaceFile = path.join(
      process.env.HOME ?? '.', '.config', 'tmax', 'last-workspace'
    );

    if (editor) {
      // Embedded mode: reuse an existing Editor instance
      this.editor = editor;
    } else {
      // Daemon mode: create a fresh Editor instance
      const terminal = new TerminalIOImpl(true); // dev mode for server
      const filesystem = new FileSystemImpl();
      this.editor = new Editor(terminal, filesystem);

      // Load the self-hosted trt (T-Lisp Runtime Testing) framework. The framework is authored
      // in T-Lisp (src/tlisp/core/trt/*.tlisp); this bootstrap registers the bridge builtins and
      // loads those files into the interpreter (SPEC-049). Sync variant because the constructor
      // cannot await.
      const interpreter = this.editor.getInterpreter();
      loadTrtFrameworkSync(interpreter);

      // Initialize default state
      const initialState: EditorState = {
        currentBuffer: TextBufferImpl.create(""),
        cursorPosition: { line: 0, column: 0 },
        mode: 'normal' as const,
        statusMessage: 'Server started',
        viewportTop: 0,
        viewportLeft: 0,
        config: {
          theme: 'default',
          tabSize: 4,
          autoSave: false,
          keyBindings: {},
          maxUndoLevels: 100,
          showLineNumbers: true,
          relativeLineNumbers: false,
          wordWrap: false
        },
        currentFilename: undefined,
        commandLine: "",
        mxCommand: "",
        buffers: new Map(),
        currentMajorMode: 'fundamental',
        activeMinorModes: [],
        activeMinorModeLighters: [],
        minibufferState: undefined,
        minibufferView: undefined,
      };

      this.editor.setEditorState(initialState);
      this.editor.createBuffer("*scratch*", "");
    }
  }

  /**
   * Create a new frame (independent viewport)
   */
  createFrame(clientId?: string, clientType: string = 'tui'): string {
    return this.createFrameForWorkspace(clientId, clientType, this.activeWorkspaceId);
  }

  /**
   * Create a new frame bound to a workspace.
   */
  createFrameForWorkspace(clientId?: string, clientType: string = 'tui', workspaceId: string = this.activeWorkspaceId): string {
    const id = `frame-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const state = this.editor.getState();
    const frame: Frame = {
      id,
      cursorPosition: { ...state.cursorPosition },
      viewportTop: state.viewportTop,
      viewportLeft: state.viewportLeft ?? 0,
      mode: state.mode,
      commandLine: state.commandLine,
      mxCommand: state.mxCommand,
	      currentFilename: state.currentFilename,
	      currentBuffer: state.currentBuffer,
	      currentBufferName: this.currentBufferName(state) ?? undefined,
	      statusMessage: state.statusMessage,
      cursorFocus: 'buffer',
      currentMajorMode: state.currentMajorMode ?? 'fundamental',
      activeMinorModes: state.activeMinorModes ?? [],
      activeMinorModeLighters: state.activeMinorModeLighters ?? [],
      minibufferState: cloneJsonValue(state.minibufferState),
      minibufferView: state.minibufferView ? structuredClone(state.minibufferView) : undefined,
      lastActivity: new Date(),
      workspaceId,
    };
    this.frames.set(id, frame);
    this.frameObservability.set(id, {
      id,
      clientId,
      clientType,
      ready: false,
      renderCount: 0,
      rawModeReady: false,
    });
    this.activeFrameId = id;
    this.editor.logMessage(`Frame created: ${id}`, 'info', undefined, id);
    return id;
  }

  private async initializeWorkspaces(): Promise<void> {
    const init = await this.workspaceManager.init().run();
    if (Either.isLeft(init)) {
      throw new Error(init.left);
    }

    const list = await this.workspaceManager.list().run();
    if (Either.isRight(list) && list.right.length > 0) {
      // N2: prefer last-workspace if available, otherwise most-recently-accessed
      const lastWorkspace = await this.readLastWorkspace();
      this.activeWorkspaceId = lastWorkspace && list.right.some(m => m.name === lastWorkspace)
        ? lastWorkspace
        : (list.right[0]?.name ?? 'default');
      const loaded = await this.workspaceManager.load(this.activeWorkspaceId).run();
      if (Either.isRight(loaded)) {
        this.workspaces.set(this.activeWorkspaceId, loaded.right);
        this.logWorkspaceRestoreMessages(loaded.right);
        this.editor.applyWorkspace(loaded.right);
        return;
      }
    }

    const created = await this.workspaceManager.create('default').run();
    if (Either.isRight(created)) {
      this.workspaces.set('default', created.right);
      this.editor.applyWorkspace(created.right);
      return;
    }

    const loaded = await this.workspaceManager.load('default').run();
    if (Either.isRight(loaded)) {
      this.workspaces.set('default', loaded.right);
      this.logWorkspaceRestoreMessages(loaded.right);
      this.editor.applyWorkspace(loaded.right);
      return;
    }

    throw new Error(Either.isLeft(created) ? created.left : 'Failed to initialize default workspace');
  }

  private async loadWorkspace(name: string): Promise<WorkspaceState> {
    const existing = this.workspaces.get(name);
    if (existing) return existing;

    const loaded = await this.workspaceManager.load(name).run();
    if (Either.isRight(loaded)) {
      this.workspaces.set(name, loaded.right);
      this.logWorkspaceRestoreMessages(loaded.right);
      return loaded.right;
    }

    const created = await this.workspaceManager.create(name).run();
    if (Either.isRight(created)) {
      this.workspaces.set(name, created.right);
      return created.right;
    }

    throw new Error(Either.isLeft(loaded) ? loaded.left : created.left);
  }

  private logWorkspaceRestoreMessages(workspace: WorkspaceState): void {
    for (const warning of workspace.restoreWarnings ?? []) {
      this.editor.logMessage(warning, 'warn');
    }
  }

  private async activateWorkspace(workspaceId: string): Promise<void> {
    if (workspaceId === this.activeWorkspaceId && this.workspaces.has(workspaceId)) return;
    this.captureActiveWorkspace();
    const workspace = await this.loadWorkspace(workspaceId);
    this.activeWorkspaceId = workspaceId;
    this.editor.applyWorkspace(workspace);
  }

	  private captureActiveWorkspace(): void {
	    const current = this.workspaces.get(this.activeWorkspaceId);
	    if (!current) return;
	    this.workspaces.set(this.activeWorkspaceId, this.editor.exportWorkspace(current));
	  }

  private clearWorkspaceModifiedFlags(workspace: WorkspaceState): void {
	    for (const [bufName, meta] of workspace.bufferMetadata.entries()) {
	      if (meta.modified) {
	        workspace.bufferMetadata.set(bufName, { ...meta, modified: false });
	      }
	    }
	    if (workspace.metadata.name === this.activeWorkspaceId) {
	      this.editor.clearModifiedFlags();
	    }
	  }

  private cloneWorkspace(workspace: WorkspaceState): WorkspaceState {
    const buffers = new Map<string, TextBuffer>();
    for (const [name, buffer] of workspace.buffers.entries()) {
      const content = buffer.getContent();
      buffers.set(name, TextBufferImpl.create(Either.isRight(content) ? content.right : ''));
    }

    const resolveBuffer = (bufferName: string | undefined, fallback?: TextBuffer) => {
      if (bufferName && buffers.has(bufferName)) return buffers.get(bufferName)!;
      return fallback ?? buffers.get('*scratch*') ?? TextBufferImpl.create('');
    };

    return {
      metadata: { ...workspace.metadata },
      buffers,
      bufferMetadata: new Map(Array.from(workspace.bufferMetadata.entries()).map(([name, metadata]) => [name, { ...metadata }])),
      bufferModeStates: new Map(Array.from(workspace.bufferModeStates.entries()).map(([name, modeState]) => [name, {
        majorMode: modeState.majorMode,
        minorModes: modeState.minorModes ? [...modeState.minorModes] : undefined,
        lighters: modeState.lighters ? [...modeState.lighters] : undefined,
      }])),
      windows: workspace.windows.map(window => ({
        ...window,
        buffer: resolveBuffer(window.bufferName),
        scrollback: window.scrollback ? structuredClone(window.scrollback) : undefined,
      })),
      tabs: workspace.tabs.map(tab => ({
        ...tab,
        buffer: resolveBuffer(tab.bufferName),
      })),
      cursorState: { ...workspace.cursorState },
      viewportState: { ...workspace.viewportState },
      currentBufferName: workspace.currentBufferName,
      currentFilename: workspace.currentFilename,
      currentMajorMode: workspace.currentMajorMode,
      activeMinorModes: workspace.activeMinorModes ? [...workspace.activeMinorModes] : undefined,
      activeMinorModeLighters: workspace.activeMinorModeLighters ? [...workspace.activeMinorModeLighters] : undefined,
      restoreWarnings: workspace.restoreWarnings ? [...workspace.restoreWarnings] : undefined,
      restoreConflicts: workspace.restoreConflicts ? [...workspace.restoreConflicts] : undefined,
    };
  }

  private async saveWorkspaceSnapshot(workspace: WorkspaceState): Promise<void> {
    const result = await this.workspaceManager.saveWithContentHash(workspace, { force: true }).run();
    if (Either.isLeft(result)) throw new Error(result.left);
    this.lastSaveHashes.set(workspace.metadata.name, result.right.contentHash);
    this.lastSavedAt.set(workspace.metadata.name, Date.now());
  }

  private async saveWorkspace(name: string): Promise<void> {
    const workspace = this.workspaces.get(name);
    if (!workspace) return;
    await this.saveWorkspaceSnapshot(workspace);
  }

  private async saveAllWorkspaces(): Promise<void> {
    this.captureActiveWorkspace();
    for (const name of this.workspaces.keys()) {
      await this.saveWorkspace(name);
    }
  }

	  private async saveDirtyWorkspace(name: string): Promise<void> {
	    if (name === this.activeWorkspaceId) this.captureActiveWorkspace();
	    const workspace = this.workspaces.get(name);
	    if (!workspace) return;
	    const hasDirty = Array.from(workspace.bufferMetadata.values()).some(m => m.modified);
    const lastHash = this.lastSaveHashes.get(name);
    const lastSaved = this.lastSavedAt.get(name) ?? 0;
    const maxDirtyElapsed = Date.now() - lastSaved >= this.maxDirtyIntervalMs;
    const dirtyBuffers = Array.from(workspace.bufferMetadata.entries())
      .filter(([, meta]) => meta.modified)
      .map(([bufferName]) => bufferName);
    if (hasDirty) this.clearWorkspaceModifiedFlags(workspace);
    const result = await this.workspaceManager.saveWithContentHash(workspace, {
      lastHash,
      force: maxDirtyElapsed,
    }).run();
    if (Either.isLeft(result)) {
	      for (const bufferName of dirtyBuffers) {
	        const meta = workspace.bufferMetadata.get(bufferName);
	        if (meta) workspace.bufferMetadata.set(bufferName, { ...meta, modified: true });
	      }
	      if (name === this.activeWorkspaceId) {
	        this.editor.markBuffersModified(dirtyBuffers);
	      }
      this.editor.logMessage(`Auto-save failed for workspace "${name}": ${result.left}`, 'error');
      return;
    }
    this.lastSaveHashes.set(name, result.right.contentHash);
    this.lastSavedAt.set(name, Date.now());
    // SPEC-055: record successful autosave at debug (silent by default; does
    // not mirror into *Messages* because debug < warn). Available for
    // forensics when minLevel is lowered. Failures already log at error.
    this.editor.logProgram('autosave', {
      level: 'debug', text: `Auto-saved workspace "${name}"`,
    });
  }

	  // I1: save only dirty workspaces (called by auto-save timer)
	  private async saveAllDirtyWorkspaces(): Promise<void> {
	    this.captureActiveWorkspace();
	    for (const name of this.workspaces.keys()) {
	      await this.saveDirtyWorkspace(name);
	    }
	  }

	  private scheduleDirtyWorkspaceSave(name: string): void {
	    const existing = this.debouncedSaveTimers.get(name);
	    if (existing) clearTimeout(existing);
	    const timer = setTimeout(async () => {
	      this.debouncedSaveTimers.delete(name);
	      await this.saveDirtyWorkspace(name);
	    }, this.debounceSaveMs);
	    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
	    this.debouncedSaveTimers.set(name, timer);
	  }

  // C6: persist last-active workspace name to disk
  private async updateLastWorkspace(name: string): Promise<void> {
    try {
      const dir = path.dirname(this.lastWorkspaceFile);
      await fsPromises.mkdir(dir, { recursive: true });
      await fsPromises.writeFile(this.lastWorkspaceFile, name, 'utf-8');
    } catch {
      // Non-critical: last-workspace persistence is best-effort
    }
  }

  // C6: read last-active workspace name from disk
  private async readLastWorkspace(): Promise<string | undefined> {
    try {
      const content = await fsPromises.readFile(this.lastWorkspaceFile, 'utf-8');
      return content.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async activateFrameWorkspace(frame?: Frame, requestedWorkspaceId?: string): Promise<void> {
    await this.activateWorkspace(requestedWorkspaceId ?? frame?.workspaceId ?? this.activeWorkspaceId);
  }

  private isWorkspaceOverride(frame: Frame | undefined, requestedWorkspaceId: unknown): requestedWorkspaceId is string {
    return typeof requestedWorkspaceId === 'string'
      && requestedWorkspaceId.length > 0
      && requestedWorkspaceId !== (frame?.workspaceId ?? this.activeWorkspaceId);
  }

  private async restoreWorkspaceAfterOverride(workspaceOverride: boolean, workspaceId: string, frameId: string | null): Promise<void> {
    if (!workspaceOverride) return;
    if (this.activeWorkspaceId !== workspaceId) {
      await this.activateWorkspace(workspaceId);
    }
    this.activeFrameId = frameId;
  }

  /**
   * Get frame by id, throw if not found
   */
  private getFrame(id: string): Frame {
    const frame = this.frames.get(id);
    if (!frame) throw new Error(`Frame not found: ${id}`);
    return frame;
  }

  /**
   * Resolve frame from params or fall back to active frame
   */
  private resolveFrame(params: FrameTarget): Frame {
    if (params?.frameId) return this.getFrame(params.frameId);
    if (this.activeFrameId) return this.getFrame(this.activeFrameId);
    throw new Error('No active frame');
  }

  /**
   * Non-throwing variant: returns undefined when no frame is active.
   */
  private resolveFrameOptional(params: FrameTarget): Frame | undefined {
    try {
      return this.resolveFrame(params);
    } catch {
      return undefined;
    }
  }

  /**
   * Sync frame state TO the editor (before operations that use editor state)
   */
  private syncFrameToEditor(frame: Frame): void {
    const currentState = this.editor.getState();
    const resolvedBufferName = frame.currentBufferName && currentState.buffers?.has(frame.currentBufferName)
      ? frame.currentBufferName
      : frame.currentBuffer
        ? Array.from(currentState.buffers?.entries() ?? []).find(([, buffer]) => buffer === frame.currentBuffer)?.[0]
        : undefined;
    const resolvedBuffer = resolvedBufferName && currentState.buffers?.has(resolvedBufferName)
      ? currentState.buffers.get(resolvedBufferName)
      : currentState.currentBuffer;
    const workspaceId = frame.workspaceId ?? this.activeWorkspaceId;
    const workspaceFilename = resolvedBufferName
      ? this.workspaces.get(workspaceId)?.bufferMetadata.get(resolvedBufferName)?.filename
      : undefined;
    const currentStateBufferName = this.currentBufferName(currentState) ?? undefined;
    const currentStateFilename = resolvedBufferName === currentStateBufferName
      ? currentState.currentFilename
      : undefined;
    const resolvedFilename = frame.currentFilename ?? workspaceFilename ?? currentStateFilename;
    this.editor.setEditorState({
      currentBuffer: resolvedBuffer,
      cursorPosition: { ...frame.cursorPosition },
      mode: frame.mode,
      statusMessage: frame.statusMessage,
      viewportTop: frame.viewportTop,
      viewportLeft: frame.viewportLeft,
      config: currentState.config,
      commandLine: frame.commandLine,
      mxCommand: frame.mxCommand,
      currentFilename: resolvedFilename,
      currentMajorMode: frame.currentMajorMode,
      activeMinorModes: frame.activeMinorModes,
      activeMinorModeLighters: frame.activeMinorModeLighters,
      minibufferState: cloneJsonValue(frame.minibufferState),
      minibufferView: frame.minibufferView ? structuredClone(frame.minibufferView) : undefined,
      cursorFocus: frame.cursorFocus,
    });
    this.markFrameSync(frame.id, 'frame-to-editor');
  }

  /**
   * Sync editor state back TO the frame (after operations that mutated editor)
   */
  private syncEditorToFrame(frame: Frame): void {
    const state = this.editor.getState();
    frame.cursorPosition = { ...state.cursorPosition };
    frame.viewportTop = state.viewportTop;
    frame.viewportLeft = state.viewportLeft ?? 0;
    frame.mode = state.mode;
    frame.commandLine = state.commandLine;
	    frame.mxCommand = state.mxCommand;
	    frame.currentFilename = state.currentFilename;
	    frame.currentBuffer = state.currentBuffer;
	    frame.currentBufferName = this.currentBufferName(state) ?? undefined;
	    frame.statusMessage = state.statusMessage;
    frame.currentMajorMode = state.currentMajorMode ?? 'fundamental';
    frame.activeMinorModes = state.activeMinorModes ?? [];
    frame.activeMinorModeLighters = state.activeMinorModeLighters ?? [];
    frame.minibufferState = cloneJsonValue(state.minibufferState);
    frame.minibufferView = state.minibufferView ? structuredClone(state.minibufferView) : undefined;
    frame.cursorFocus = state.cursorFocus ?? 'buffer';
    frame.lastActivity = new Date();
    this.markFrameSync(frame.id, 'editor-to-frame');
  }

  /**
   * Sync editor state to every connected frame after daemon-side mutations.
   */
  private syncEditorToAllFrames(): void {
    for (const frame of this.frames.values()) {
      if ((frame.workspaceId ?? this.activeWorkspaceId) !== this.activeWorkspaceId) continue;
      const activeMinibuffer = frame.minibufferState === undefined ? undefined : {
        mode: frame.mode,
        mxCommand: frame.mxCommand,
        cursorFocus: frame.cursorFocus,
        state: cloneJsonValue(frame.minibufferState),
        view: frame.minibufferView ? structuredClone(frame.minibufferView) : undefined,
      };
      this.syncEditorToFrame(frame);
      if (activeMinibuffer) {
        frame.mode = activeMinibuffer.mode;
        frame.mxCommand = activeMinibuffer.mxCommand;
        frame.cursorFocus = activeMinibuffer.cursorFocus;
        frame.minibufferState = activeMinibuffer.state;
        frame.minibufferView = activeMinibuffer.view;
      }
    }
  }

  private markFrameSync(frameId: string, direction: 'frame-to-editor' | 'editor-to-frame'): void {
    const obs = this.frameObservability.get(frameId);
    if (!obs) return;
    obs.lastSyncDirection = direction;
    obs.lastSyncAt = new Date();
  }

  private recordError(source: string, error: unknown, clientId?: string, frameId?: string, diagnostic?: DiagnosticResult, requestId?: string | number | null): void {
    const message = error instanceof Error ? error.message : String(error);
    this.recentErrors.push({
      timestamp: new Date().toISOString(),
      source,
      message,
      clientId,
      frameId,
      requestId,
      diagnostic,
    });
    if (this.recentErrors.length > 50) {
      this.recentErrors = this.recentErrors.slice(-50);
    }
    if (clientId) {
      const client = this.clients.get(clientId);
      if (client) client.lastError = message;
    }
    if (frameId) {
      const frame = this.frameObservability.get(frameId);
      if (frame) frame.lastError = message;
    }
  }

  private currentBufferName(state: EditorState): string | null {
    if (state.currentFilename) return state.currentFilename;
    if (state.buffers) {
      for (const [name, buffer] of state.buffers.entries()) {
        if (buffer === state.currentBuffer) return name;
      }
    }
    return null;
  }

  private frameStatus(frame: Frame): FrameStatusResult {
    const obs = this.frameObservability.get(frame.id);
    return {
      id: frame.id,
      clientId: obs?.clientId,
      clientType: obs?.clientType ?? 'unknown',
      ready: obs?.ready ?? false,
      mode: frame.mode,
      currentFilename: frame.currentFilename ?? null,
      bufferName: frame.currentFilename ?? null,
      workspaceId: frame.workspaceId ?? this.activeWorkspaceId,
      cursorPosition: frame.cursorPosition,
      statusMessage: frame.statusMessage,
      currentMajorMode: frame.currentMajorMode ?? 'fundamental',
      activeMinorModes: frame.activeMinorModes ?? [],
      activeMinorModeLighters: frame.activeMinorModeLighters ?? [],
      firstRenderAt: obs?.firstRenderAt?.toISOString() ?? null,
      lastRenderAt: obs?.lastRenderAt?.toISOString() ?? null,
      renderCount: obs?.renderCount ?? 0,
      rawModeReady: obs?.rawModeReady ?? false,
      terminalSize: obs?.terminalSize ?? null,
      lastSyncDirection: obs?.lastSyncDirection ?? null,
      lastSyncAt: obs?.lastSyncAt?.toISOString() ?? null,
      lastError: obs?.lastError ?? null,
    };
  }

  private clientStatus(client: ClientConnection): ClientStatusResult {
    return {
      id: client.id,
      clientType: client.clientType,
      clientName: client.clientName ?? null,
      connectedAt: client.connectedAt.toISOString(),
      lastRequestAt: client.lastRequestAt?.toISOString() ?? null,
      requestCount: client.requestCount,
      lastError: client.lastError ?? null,
      frameId: client.frameId ?? null,
      metadata: client.metadata ?? {},
    };
  }

  private buildStatus(): StatusResult {
    const state = this.editor.getEditorState();
    const clients = Array.from(this.clients.values()).map(client => this.clientStatus(client));
    const frames = Array.from(this.frames.values()).map(frame => this.frameStatus(frame));
    return {
      daemonReady: this.isRunning,
      status: this.isRunning ? 'running' : 'starting',
      server: 'tmax',
      uptimeMs: Date.now() - this.startedAt.getTime(),
      startedAt: this.startedAt.toISOString(),
      socketPath: this.socketPath,
      clientCount: this.clients.size,
      frameCount: this.frames.size,
      activeFrameId: this.activeFrameId,
      activeWorkspaceId: this.activeWorkspaceId,
      workspaceCount: this.workspaces.size,
      editor: {
        mode: state.mode,
        currentFilename: state.currentFilename ?? null,
        bufferName: this.currentBufferName(state),
        cursorPosition: state.cursorPosition,
        statusMessage: state.statusMessage,
        currentMajorMode: state.currentMajorMode ?? 'fundamental',
        activeMinorModes: state.activeMinorModes ?? [],
        activeMinorModeLighters: state.activeMinorModeLighters ?? [],
      },
      clients,
      frames,
      recentErrors: this.recentErrors,
    };
  }

  /**
   * Delete a frame (on client disconnect)
   */
  private deleteFrame(id: string): void {
    this.frames.delete(id);
    this.frameObservability.delete(id);
    if (this.activeFrameId === id) {
      // Pick the most recent remaining frame
      let latest: Frame | null = null;
      for (const f of this.frames.values()) {
        if (!latest || f.lastActivity > latest.lastActivity) latest = f;
      }
      this.activeFrameId = latest?.id ?? null;
    }
    this.editor.logMessage(`Frame deleted: ${id}`, 'info', undefined, id);
  }

  /**
   * Get the default socket path for the server
   */
  private getDefaultSocketPath(): string {
    if (process.env.TMAX_SOCKET) return process.env.TMAX_SOCKET;
    const uid = process.env.SUDO_UID || userInfo().uid.toString();
    return `/tmp/tmax-${uid}/server`;
  }

  /**
   * Check if a live daemon is already listening at our socket path.
   * Returns true if a live daemon responded to a ping.
   */
  private async probeDaemon(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new Socket();
      const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 500);
      socket.connect(this.socketPath, () => {
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }) + '\n');
      });
      socket.on('data', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
      socket.on('error', () => { clearTimeout(timer); resolve(false); });
    });
  }

  /**
   * Acquire ownership of the socket path.
   * Uses atomic filesystem lock to prevent startup races.
   * Throws if a live daemon already owns it.
   * Removes stale socket/lock files when safe.
   */
  private async acquireSocket(): Promise<void> {
    const lockPath = lockPathFor(this.socketPath);

    // Check for a live daemon at the socket path
    if (existsSync(this.socketPath)) {
      if (await this.probeDaemon()) {
        throw new Error(`Daemon already running at ${this.socketPath}`);
      }
      // Stale socket — safe to remove
      removeFile(this.socketPath);
    }

    // Atomically acquire the lock. If it fails, check if stale and retry once.
    const lockData: LockData = {
      pid: process.pid,
      socketPath: this.socketPath,
      startedAt: new Date().toISOString(),
      cwd: process.cwd(),
    };

    if (tryAcquireLock(lockPath, lockData)) {
      this.ownsLock = true;
      return;
    }

    // Lock exists — check if stale. We only reach here when the socket file is
    // absent (a live, serving daemon would have thrown at the probe above). So a
    // lock whose holder is "alive" but has no socket is a hung/zombie daemon
    // that lost its socket — reclaim it rather than deadlocking startup.
    const existing = readLock(lockPath);
    if (
      existing &&
      isProcessAlive(existing.pid) &&
      existing.socketPath === this.socketPath &&
      existsSync(this.socketPath) &&
      await this.probeDaemon()
    ) {
      throw new Error(`Daemon starting (pid ${existing.pid}) at ${this.socketPath}`);
    }

    // Stale lock (dead PID, wrong path, or live-but-not-serving) — remove and retry.
    removeFile(lockPath);
    if (!tryAcquireLock(lockPath, lockData)) {
      throw new Error(`Cannot acquire lock at ${lockPath}`);
    }
    this.ownsLock = true;
  }

  /**
   * Convert a Frame into an EditorState suitable for editorStateToJson.
   * Uses frame-local state (mode, cursor, minibuffer, etc.) and shared
   * editor display metadata (windows, tabs, buffers).
   */
	  private frameToEditorState(frame: Frame): EditorState {
	    const shared = this.editor.getState();
	    const workspaceId = frame.workspaceId ?? this.activeWorkspaceId;
	    const workspace = workspaceId === this.activeWorkspaceId
	      ? undefined
	      : this.workspaces.get(workspaceId);
	    const workspaceBuffers = workspace?.buffers;
	    const bufferName = frame.currentBufferName ?? workspace?.currentBufferName;
	    const frameBuffer = bufferName && workspaceBuffers?.has(bufferName)
	      ? workspaceBuffers.get(bufferName)
	      : frame.currentBuffer;
	    return {
	      currentBuffer: frameBuffer,
	      cursorPosition: { ...frame.cursorPosition },
	      mode: frame.mode,
	      statusMessage: frame.statusMessage,
	      viewportTop: frame.viewportTop,
	      viewportLeft: frame.viewportLeft,
	      config: shared.config,
      commandLine: frame.commandLine,
      mxCommand: frame.mxCommand,
      currentFilename: frame.currentFilename,
      currentMajorMode: frame.currentMajorMode,
      activeMinorModes: frame.activeMinorModes,
      activeMinorModeLighters: frame.activeMinorModeLighters,
      minibufferState: cloneJsonValue(frame.minibufferState),
      minibufferView: frame.minibufferView ? structuredClone(frame.minibufferView) : undefined,
      cursorFocus: frame.cursorFocus,
	      buffers: workspaceBuffers ?? shared.buffers,
	      windows: workspace?.windows ?? shared.windows,
	      currentWindowIndex: shared.currentWindowIndex,
	      tabs: workspace?.tabs ?? shared.tabs,
	      currentTabIndex: shared.currentTabIndex,
		      whichKeyActive: shared.whichKeyActive,
		      whichKeyPrefix: shared.whichKeyPrefix,
		      whichKeyBindings: shared.whichKeyBindings,
		      whichKeyPopup: shared.whichKeyPopup,
	    };
	  }

  /**
   * Initialize editor (load bindings + init file).
   * Called by start() or directly for embedded use.
   */
  async startEditor(): Promise<void> {
    this.editor.logMessage('Server started', 'info');
    await this.initializeWorkspaces();

    await this.editor.ensureCoreBindingsLoadedPublic();
    await this.editor.loadInitFilePublic(undefined);
    this.registerWorkspaceBuiltins();

    // I1: auto-save timer — save dirty workspaces every 30s
	    this.autoSaveTimer = setInterval(async () => {
	      await this.saveAllDirtyWorkspaces();
	    }, this.autoSaveIntervalMs);
    // N5: don't prevent process exit if only the timer remains
    if (this.autoSaveTimer && typeof this.autoSaveTimer === 'object' && 'unref' in this.autoSaveTimer) {
      this.autoSaveTimer.unref();
    }
  }

  private registerWorkspaceBuiltins(): void {
    const interpreter = this.editor.getInterpreter();
    const err = (error: unknown) => Either.left({
      type: 'EvalError' as const,
      variant: 'RuntimeError' as const,
      message: error instanceof Error ? error.message : String(error),
    });
    const stringArg = (args: TLispValue[], index: number, name: string): string => {
      const value = args[index];
      if (!value || value.type !== 'string') {
        throw new Error(`${name} argument ${index + 1} must be a string`);
      }
      return value.value as string;
    };
    const asTlisp = (value: any): TLispValue => {
      if (value === null || value === undefined) return createNil();
      if (typeof value === 'string') return createString(value);
      if (typeof value === 'boolean') return createBoolean(value);
      if (Array.isArray(value)) return createList(value.map(asTlisp));
      if (typeof value === 'object') {
        return createHashmap(Object.entries(value).map(([key, item]) => [key, asTlisp(item)]));
      }
      return createString(String(value));
    };
    const asyncBuiltin = (
      name: string,
      fn: (args: TLispValue[]) => Promise<TLispValue>,
    ) => {
      interpreter.defineAsyncBuiltin(
        name,
        () => Either.right(createNil()),
        async (args) => {
          try {
            return Either.right(await fn(args));
          } catch (error) {
            return err(error);
          }
        },
      );
    };

    // CHORE-44 Change 5: workspace-* T-Lisp builtins delegate to the same
    // domain handlers as the JSON-RPC route (no duplicated bodies). Built
    // fresh here because the interpreter is a one-time registration site.
    const ws = createWorkspaceHandlers(this.serverContext());
    asyncBuiltin('workspace-list', async () => asTlisp(await ws['workspace-list']()));
    asyncBuiltin('workspace-new', async (args) => {
      return asTlisp(await ws['workspace-new']({ name: stringArg(args, 0, 'workspace-new') }));
    });
    asyncBuiltin('workspace-switch', async (args) => {
      return asTlisp(await ws['workspace-switch']({ name: stringArg(args, 0, 'workspace-switch') }));
    });
    asyncBuiltin('workspace-save', async () => asTlisp(await ws['workspace-save']({})));
    asyncBuiltin('workspace-load', async (args) => {
      return asTlisp(await ws['workspace-load']({ name: stringArg(args, 0, 'workspace-load') }));
    });
    asyncBuiltin('workspace-kill', async (args) => {
      return asTlisp(await ws['workspace-kill']({ name: stringArg(args, 0, 'workspace-kill') }));
    });
	    asyncBuiltin('workspace-rename', async (args) => {
	      return asTlisp(await ws['workspace-rename']({
	        oldName: stringArg(args, 0, 'workspace-rename'),
	        newName: stringArg(args, 1, 'workspace-rename'),
	      }));
	    });
	    asyncBuiltin('workspace-move-window', async (args) => {
	      return asTlisp(await ws['workspace-move-window']({ target: stringArg(args, 0, 'workspace-move-window') }));
	    });
  }

  /**
   * Start the socket listener.
   * Called by start() or non-blocking for embedded use.
   */
  async startSocket(): Promise<void> {
    // Ensure the socket directory exists
    const socketDir = this.socketPath.substring(0, this.socketPath.lastIndexOf('/'));
    mkdirSync(socketDir, { recursive: true });

    // Acquire socket ownership (fails if live daemon already holds it)
    await this.acquireSocket();

    this.server.on('connection', this.handleConnection.bind(this));

    await new Promise<void>((resolve, reject) => {
      this.server.on('error', (err) => {
        if (!this.testMode) {
          console.error('Server error:', err);
          process.exit(1);
        }
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        console.log(`tmax server listening on ${this.socketPath}`);
        this.isRunning = true;
        this.ownsSocket = true;
        resolve();
      });
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  /**
   * Start the server (editor + socket). Backward-compatible.
   */
  async start(): Promise<void> {
    await this.startEditor();
    console.log('Core bindings and init file loaded');
    await this.startSocket();
  }

  /**
   * Handle incoming client connections
   */
  private handleConnection(conn: Socket): void {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    let clientFrameId: string | null = null;

    const client: ClientConnection = {
      id: clientId,
      pid: conn.remotePort ? parseInt(conn.remotePort.toString()) : undefined,
      socket: conn,
      connectedAt: new Date(),
      clientType: 'cli',
      requestCount: 0,
      inputBuffer: '',
    };

    this.clients.set(clientId, client);
    // Record the connection in the *daemon* event buffer (SPEC-047). Falls back
    // to a no-op in standalone-daemon mode where no editor is attached.
    this.editor?.logDaemonEvent('client-connected', clientId);

    // Set up connection handlers with per-connection input buffering
    conn.on('data', async (data) => {
      client.inputBuffer += data.toString();

      let newline = client.inputBuffer.indexOf('\n');
      while (newline >= 0) {
        const line = client.inputBuffer.slice(0, newline).trim();
        client.inputBuffer = client.inputBuffer.slice(newline + 1);
        newline = client.inputBuffer.indexOf('\n');

        if (!line) continue;

        let request: JSONRPCRequest;
        try {
          request = JSON.parse(line);
        } catch {
          if (conn.writable) {
            conn.write(JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32700, message: 'Parse error: malformed JSON' }
            }) + '\n');
          }
          continue;
        }

        try {
          client.lastRequestAt = new Date();
          client.requestCount++;

          // Auto-create frame on connect-frame request
          if (request.method === 'connect-frame') {
            const params = (request.params ?? {}) as Record<string, unknown>;
            const clientTypeParam = typeof params.clientType === 'string' ? params.clientType : undefined;
            const clientNameParam = typeof params.clientName === 'string' ? params.clientName : undefined;
            const metadataParam = (params.metadata && typeof params.metadata === 'object' && !Array.isArray(params.metadata))
              ? params.metadata as Record<string, JsonValue>
              : {};
            client.clientType = clientTypeParam ?? 'tui';
            client.clientName = clientNameParam;
            client.metadata = metadataParam;
	            const requestedWorkspace = (typeof params.workspaceId === 'string' ? params.workspaceId : undefined)
	              ?? (typeof params.workspace === 'string' ? params.workspace : undefined)
	              ?? (await this.readLastWorkspace()) ?? this.activeWorkspaceId;
	            const explicitWorkspace = typeof params.workspaceId === 'string' || typeof params.workspace === 'string';
	            await this.activateWorkspace(requestedWorkspace);
	            if (explicitWorkspace) await this.updateLastWorkspace(requestedWorkspace);
	            clientFrameId = this.createFrameForWorkspace(clientId, client.clientType, requestedWorkspace);
            client.frameId = clientFrameId;
            if (conn.writable) {
              conn.write(JSON.stringify({
                jsonrpc: '2.0',
                id: request.id,
                result: { clientId, frameId: clientFrameId }
              }) + '\n');
            }
            continue;
          }

          const incomingParams = (request.params && typeof request.params === 'object' && !Array.isArray(request.params))
            ? request.params as Record<string, unknown>
            : {};
          const requestParams: Record<string, unknown> = { ...incomingParams, clientId };
          request.params = requestParams;

          // Inject frameId into frame-aware methods if client has a frame
          if (clientFrameId && !requestParams.frameId) {
            if (['keypress', 'render-state', 'client-event'].includes(request.method)) {
              requestParams.frameId = clientFrameId;
              request.params = requestParams;
            }
          }

          const response = await this.processRequest(request);

          if (conn.writable) {
            conn.write(JSON.stringify(response) + '\n');
          }
        } catch (error) {
          console.error('Error processing client request:', error);
          this.recordError('request', error, clientId, clientFrameId ?? undefined);
          const rawDiag = (error instanceof Error && (error as Error & { diagnostic?: unknown }).diagnostic)
            ? (error as Error & { diagnostic?: unknown }).diagnostic
            : undefined;
          const errorResponse: JSONRPCResponse = {
            jsonrpc: '2.0',
            id: request?.id ?? undefined,
            error: {
              code: -32603,
              message: `Internal error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              ...(rawDiag ? {
                data: {
                  kind: 'tlisp-diagnostic',
                  diagnostic: rawDiag as JsonValue,
                } as JsonValue
              } : {})
            }
          };

          if (conn.writable) {
            conn.write(JSON.stringify(errorResponse) + '\n');
          }
        }
      }
    });

    conn.on('close', () => {
      this.editor?.logDaemonEvent('client-disconnected', clientId);
      if (clientFrameId) this.deleteFrame(clientFrameId);
      this.clients.delete(clientId);
    });

    conn.on('error', (err) => {
      console.error(`Client ${clientId} error:`, err);
      this.recordError('client-socket', err, clientId, clientFrameId ?? undefined);
      if (clientFrameId) this.deleteFrame(clientFrameId);
      this.clients.delete(clientId);
    });
  }

  /**
   * Build the typed RPC handler table (CHORE-44 Change 5 AC5.2/AC5.9).
   *
   * Each method declared in `RpcMethodMap` maps to a handler built by one of
   * the four domain handler modules (handlers/{editing,frames,workspaces,
   * lifecycle}.ts). The handler bodies live THERE; `TmaxServer` supplies the
   * shared `ServerContext` (editor + frame/workspace state + sync helpers +
   * lifecycle) and the router owns version/lookup/param/error handling.
   */
  private rpcHandlers(): RpcHandlers {
    const ctx = this.serverContext();
    const editing = createEditingHandlers(ctx);
    const frames = createFramesHandlers(ctx);
    const workspaces = createWorkspaceHandlers(ctx);
    const lifecycle = createLifecycleHandlers(ctx);
    return {
      open: editing.open,
      eval: editing.eval,
      command: editing.command,
      query: editing.query,
      insert: editing.insert,
      keypress: editing.keypress,
      'render-state': frames['render-state'],
      'client-event': frames['client-event'],
      'save-file': editing['save-file'],
      capture: frames.capture,
      ping: lifecycle.ping,
      status: frames.status,
      clients: frames.clients,
      frames: frames.frames,
      shutdown: lifecycle.shutdown,
      'workspace-list': workspaces['workspace-list'],
      'workspace-new': workspaces['workspace-new'],
      'workspace-switch': workspaces['workspace-switch'],
      'workspace-save': workspaces['workspace-save'],
      'workspace-kill': workspaces['workspace-kill'],
      'workspace-rename': workspaces['workspace-rename'],
      'workspace-load': workspaces['workspace-load'],
      'workspace-move-window': workspaces['workspace-move-window'],
    };
  }

  /**
   * The typed `ServerContext` adapter. Exposes the shared daemon/editor state
   * and every helper the domain handlers need, as closures over `this`. This
   * is the single bridge between the concrete `TmaxServer` (socket/lifecycle
   * owner) and the handler modules (which never import `server.ts`). Handlers
   * declare their dependencies via the `ServerContext` interface only.
   */
  private serverContext(): ServerContext {
    return {
      editor: this.editor,
      frames: this.frames,
      workspaces: this.workspaces,
      frameObservability: this.frameObservability,
      clients: this.clients as unknown as Map<string, ClientRecord>,
      getActiveWorkspaceId: () => this.activeWorkspaceId,
      setActiveWorkspaceId: (id) => { this.activeWorkspaceId = id; },
      getActiveFrameId: () => this.activeFrameId,
      setActiveFrameId: (id) => { this.activeFrameId = id; },
      workspaceManager: this.workspaceManager,
      isDaemonRunning: () => this.isRunning,
      getStartedAt: () => this.startedAt,
      getSocketPath: () => this.socketPath,

      getFrame: (id) => this.getFrame(id),
      resolveFrameOptional: (params) => this.resolveFrameOptional(params),
      syncFrameToEditor: (frame) => this.syncFrameToEditor(frame),
      syncEditorToFrame: (frame) => this.syncEditorToFrame(frame),
      syncEditorToAllFrames: () => this.syncEditorToAllFrames(),

      isWorkspaceOverride: (frame, id) => this.isWorkspaceOverride(frame, id),
      activateFrameWorkspace: (frame, id) => this.activateFrameWorkspace(frame, id),
      activateWorkspace: (id) => this.activateWorkspace(id),
      restoreWorkspaceAfterOverride: (override, wsId, frameId) =>
        this.restoreWorkspaceAfterOverride(override, wsId, frameId),
      captureActiveWorkspace: () => this.captureActiveWorkspace(),
      loadWorkspace: (name) => this.loadWorkspace(name),
      saveWorkspace: (name) => this.saveWorkspace(name),
      saveWorkspaceSnapshot: (ws) => this.saveWorkspaceSnapshot(ws),
      cloneWorkspace: (ws) => this.cloneWorkspace(ws),
      scheduleDirtyWorkspaceSave: (name) => this.scheduleDirtyWorkspaceSave(name),
      updateLastWorkspace: (name) => this.updateLastWorkspace(name),
      workspaceDirtyBuffers: (ws) => this.workspaceDirtyBuffers(ws),
      clearWorkspaceModifiedFlags: (ws) => this.clearWorkspaceModifiedFlags(ws),

      frameToEditorState: (frame) => this.frameToEditorState(frame),
      currentBufferName: (state) => this.currentBufferName(state),
      frameStatus: (frame) => this.frameStatus(frame),
      clientStatus: (client) => this.clientStatus(client as unknown as ClientConnection),
      buildStatus: () => this.buildStatus(),
      bufferDetailsForWorkspace: (ws, name) => this.bufferDetailsForWorkspace(ws, name),

      tlispValueToJson: (value) => this.tlispValueToJson(value),
      diagnosticToJSON: (d) => this.diagnosticToJSON(d),
      getTlispFunctions: () => this.getTlispFunctions(),
      getTlispVariables: () => this.getTlispVariables(),
      getFunctionDocumentation: (name) => this.getFunctionDocumentation(name),
      getVariableDocumentation: (name) => this.getVariableDocumentation(name),
      findCommandsByPattern: (pattern) => this.findCommandsByPattern(pattern),
      findFunctionUsages: (name) => this.findFunctionUsages(name),

      recordError: (source, error, clientId, frameId, diagnostic, requestId) =>
        this.recordError(source, error, clientId, frameId, diagnostic, requestId ?? undefined),
      logMessage: (message, level, namespace, frameId) =>
        this.editor.logMessage(message, level, namespace, frameId),

      scheduleShutdown: (delayMs = 50) => {
        setTimeout(() => { void this.shutdown(); }, delayMs);
      },
    };
  }

  /**
   * Process a JSON-RPC request (AC5.8). The router owns version validation
   * (`-32600`), method lookup (`-32601`), parameter validation (`-32602`),
   * dispatch, request-ID preservation, and wire error mapping (`-32010` with
   * T-Lisp diagnostic data). `TmaxServer` only supplies the handler table and
   * the error-recording hook for its observability buffer.
   */
  private async processRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    return routeRequest(this.rpcHandlers(), request, (info) => {
      this.recordError(
        info.method,
        info.error,
        info.clientId,
        info.frameId,
        info.diagnostic,
        info.requestId ?? undefined,
      );
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // CHORE-44 Change 5 (AC5.9): the domain handle* bodies (open/eval/command/
  // query/insert/keypress/render-state/client-event/capture/status/clients/
  // frames/save-file/ping/shutdown and every workspace-* method) now live in
  // src/server/rpc/handlers/{editing,frames,workspaces,lifecycle}.ts. They
  // operate on the `ServerContext` built by `serverContext()` above.
  //
  // The helpers below remain on TmaxServer because the handlers call them
  // THROUGH the context (ctx.tlispValueToJson, ctx.frameStatus, etc.). They
  // are infrastructure — serialization, observability, T-Lisp bridge helpers
  // — not domain handler logic.
  // ────────────────────────────────────────────────────────────────────────

  private diagnosticToJSON(d: unknown): DiagnosticResult {
    const diag = (d ?? {}) as Record<string, unknown>;
    return {
      severity: diag.severity as JsonValue,
      code: diag.code as JsonValue,
      message: diag.message as JsonValue,
      ...(diag.source ? { source: diag.source as JsonValue } : {}),
      ...(diag.primarySpan ? { primarySpan: diag.primarySpan as JsonValue } : {}),
      ...(diag.expected ? { expected: diag.expected as JsonValue } : {}),
      ...(diag.actual ? { actual: diag.actual as JsonValue } : {}),
      ...(diag.help ? { help: diag.help as JsonValue } : {}),
      ...(diag.stack ? { stack: diag.stack as JsonValue } : {}),
    };
  }

  // handleInsert/handleKeypress/handleRenderState/handleCapture/handleClientEvent/
  // handleStatus/handleClients/handleFrames moved to handlers/{editing,frames}.ts.
  // workspaceNameFromParams moved to handlers/workspaces.ts (and re-exported for
  // any future callers).

	  private workspaceDirtyBuffers(workspace: WorkspaceState): string[] {
	    return Array.from(workspace.bufferMetadata.entries())
	      .filter(([, metadata]) => metadata.modified)
	      .map(([name]) => name);
	  }

	  private bufferDetailsForWorkspace(workspace: WorkspaceState, currentBufferName?: string): BufferDetails[] {
	    return Array.from(workspace.buffers.entries()).map(([name, buffer]) => {
	      const content = buffer.getContent();
	      const text = Either.isRight(content) ? content.right : '';
	      const lineCount = buffer.getLineCount();
	      const metadata = workspace.bufferMetadata.get(name);
	      const modeState = workspace.bufferModeStates.get(name);
	      return {
	        name,
	        content: text,
	        ...(metadata?.filename ? { filename: metadata.filename } : {}),
	        majorMode: modeState?.majorMode ?? metadata?.majorMode ?? 'fundamental',
	        modified: metadata?.modified ?? false,
	        characters: text.length,
	        lines: Either.isRight(lineCount) ? lineCount.right : 0,
	        current: name === currentBufferName,
	        special: name.startsWith('*') && name.endsWith('*'),
	        recency: 0,
	      };
	    });
	  }

  // All handleWorkspace* bodies (list/new/switch/save/kill/rename/load/move-window)
  // moved to handlers/workspaces.ts. The T-Lisp async builtins in
  // registerWorkspaceBuiltins() call those handlers directly.

  /**
   * Get documentation for a variable
   */
  private getVariableDocumentation(variableName: string): VariableDocumentation {
    const value = this.editor.lookupGlobalBinding(variableName);

    if (value === undefined) {
      return {
        name: variableName,
        value: null,
        type: 'unknown',
        documentation: `Variable ${variableName} is not defined.`,
        file: 'unknown',
        line: 0,
        customizable: false,
        defaultValue: null
      };
    }

    // Get the type and value
    const type = value.type || 'unknown';
    const jsonValue = this.tlispValueToJson(value);

    return {
      name: variableName,
      value: jsonValue,
      type: type,
      documentation: `Variable ${variableName} of type ${type}.`,
      file: 'tmax-interpreter',
      line: 0,
      customizable: variableName.startsWith('*') && variableName.endsWith('*'),
      defaultValue: null
    };
  }

  /**
   * Find commands matching a pattern
   */
  private findCommandsByPattern(pattern: string): AproposCommandResult {
    const allFunctions = this.getTlispFunctions();

    // Convert pattern to regex (handle * wildcards)
    const regexPattern = pattern.replace(/\*/g, '.*');
    const regex = new RegExp(regexPattern, 'i');
    const matches = allFunctions.filter(fn => regex.test(fn));

    return {
      matches: matches.map(name => {
        // Try to get keybinding for this function
        const bindings = this.editor.getKeyMappings();
        let binding = 'unknown';

        for (const [key, mappings] of bindings.entries()) {
          const mapping = mappings.find(m => m.command === name);
          if (mapping) {
            binding = key;
            break;
          }
        }

        return {
          name: name,
          binding: binding,
          documentation: `Function ${name}.`
        };
      })
    };
  }

  /**
   * Find usages of a function
   */
  private findFunctionUsages(functionName: string): FunctionUsagesResult {
    // For now, return an empty array as we don't track function call locations
    // This would require parsing all loaded T-Lisp files and tracking call sites
    return {
      function: functionName,
      usages: []
    };
  }

  /**
   * Convert T-Lisp value to JSON-serializable value
   */
  private tlispValueToJson(value: any): any {
    if (value === null || value === undefined) {
      return null;
    }

    // Handle T-Lisp value objects
    if (value.type !== undefined) {
      switch (value.type) {
        case 'nil':
          return null;
        case 'boolean':
        case 'number':
        case 'string':
          return value.value;
        case 'list':
          return value.value.map((v: any) => this.tlispValueToJson(v));
        case 'hashmap':
          const obj: Record<string, any> = {};
          value.value.forEach((v: any, k: string) => {
            obj[k] = this.tlispValueToJson(v);
          });
          return obj;
        case 'symbol':
          return value.value;
        default:
          return String(value);
      }
    }

    // Handle plain values
    return value;
  }

  /**
   * Get all variables from T-Lisp environment
   */
  private getTlispVariables(): NamedJsonValues {
    const variables: NamedJsonValues = {};

    // Get all variable bindings (using *name* convention)
    const rawVars = this.editor.getGlobalVariables();
    for (const [name, value] of Object.entries(rawVars)) {
      variables[name] = this.tlispValueToJson(value);
    }

    return variables;
  }

  /**
   * Get all functions from T-Lisp environment
   */
  private getTlispFunctions(): string[] {
    return this.editor.getGlobalFunctionNames();
  }

  /**
   * Handle query request
   */
  /**
   * Get documentation for a specific function
   */
  private getFunctionDocumentation(functionName: string): FunctionDocumentation {
    const value = this.editor.lookupGlobalBinding(functionName);

    if (value === undefined || (value.type !== 'function' && value.type !== 'macro')) {
      return {
        name: functionName,
        signature: `(${functionName} ...)`,
        documentation: `Function ${functionName} is not defined.`,
        file: 'unknown',
        line: 0,
        examples: [],
        relatedFunctions: []
      };
    }

    // For built-in functions, try to get documentation from function metadata
    // For now, return basic information
    return {
      name: functionName,
      signature: `(${functionName} ...)`,
      documentation: `Function ${functionName}.`,
      file: 'tmax-interpreter',
      line: 0,
      examples: [],
      relatedFunctions: []
    };
  }

  /**
   * Shutdown the server gracefully. Idempotent.
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    console.log('Shutting down tmax server...');

	    if (this.autoSaveTimer) {
	      clearInterval(this.autoSaveTimer);
	      this.autoSaveTimer = null;
	    }
	    for (const timer of this.debouncedSaveTimers.values()) {
	      clearTimeout(timer);
	    }
	    this.debouncedSaveTimers.clear();

    try {
      await this.saveAllWorkspaces();
    } catch (error) {
      console.error('Error saving workspaces during shutdown:', error);
    }

    // SPEC-055: flush the observability log on graceful shutdown. Append-per-write
    // already persists every entry, so this is belt-and-suspenders; it also serves
    // as the documented hook for a future periodic-flush strategy.
    try {
      this.editor.flushLog();
    } catch { /* best-effort */ }

    // Close all client connections
    for (const [clientId, client] of this.clients) {
      try {
        client.socket.destroy();
      } catch (error) {
        console.error(`Error closing client ${clientId}:`, error);
      }
    }

    this.clients.clear();

    // Close the server
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        console.log('tmax server closed');
        resolve();
      });
      // Ensure resolve fires even if close doesn't callback
      setTimeout(resolve, 2000);
    });

    // Clean up socket and lock if we own them
    if (this.ownsSocket) {
      removeFile(this.socketPath);
      this.ownsSocket = false;
    }
    if (this.ownsLock) {
      const lockPath = lockPathFor(this.socketPath);
      const lock = readLock(lockPath);
      // Only remove if lock still identifies this process
      if (lock && lock.pid === process.pid && lock.socketPath === this.socketPath) {
        removeFile(lockPath);
      }
      this.ownsLock = false;
    }

    // Only exit process if not in test mode
    if (!this.testMode) {
      process.exit(0);
    }
  }

  /**
   * Get the socket path
   */
  getSocketPath(): string {
    return this.socketPath;
  }

  /**
   * Check if server is running
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }
}

// Main entry point when run directly
if (import.meta.main) {
  const server = new TmaxServer(process.env.TMAX_SOCKET);
  server.start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
