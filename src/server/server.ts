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
import { FileSystemImpl } from '../core/filesystem.ts';
import { FunctionalTextBufferImpl } from '../core/buffer.ts';
import { EditorState, Frame, WorkspaceState } from '../core/types.ts';
import { WorkspaceManager } from '../core/workspace.ts';
import { Either } from '../utils/task-either.ts';
import { loadTrtFrameworkSync } from '../tlisp/trt/bootstrap.ts';
import { editorStateToJson } from './serialize.ts';
import { cloneJsonValue } from '../tlisp/serialization.ts';
import { captureFrame } from '../render/capture-frame.ts';
import { ansiLinesToHtmlDocument } from '../render/ansi-to-html.ts';
import { createBoolean, createHashmap, createList, createNil, createString } from '../tlisp/values.ts';
import type { TLispValue } from '../tlisp/types.ts';

// JSON-RPC 2.0 interfaces
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: any;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface ClientConnection {
  id: string;
  pid?: number;
  socket: Socket;
  connectedAt: Date;
  clientType: string;
  clientName?: string;
  metadata?: Record<string, unknown>;
  lastRequestAt?: Date;
  requestCount: number;
  lastError?: string;
  frameId?: string;
  inputBuffer: string;
}

interface ObservabilityError {
  timestamp: string;
  source: string;
  message: string;
  clientId?: string;
  frameId?: string;
  requestId?: string | number;
  diagnostic?: Record<string, any>;
}

interface FrameObservability {
  id: string;
  clientId?: string;
  clientType: string;
  ready: boolean;
  firstRenderAt?: Date;
  lastRenderAt?: Date;
  renderCount: number;
  rawModeReady: boolean;
  terminalSize?: { width: number; height: number };
  lastSyncDirection?: 'frame-to-editor' | 'editor-to-frame';
  lastSyncAt?: Date;
  lastError?: string;
}

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
        currentBuffer: FunctionalTextBufferImpl.create(""),
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
    const buffers = new Map<string, import('../core/types.ts').FunctionalTextBuffer>();
    for (const [name, buffer] of workspace.buffers.entries()) {
      const content = buffer.getContent();
      buffers.set(name, FunctionalTextBufferImpl.create(Either.isRight(content) ? content.right : ''));
    }

    const resolveBuffer = (bufferName: string | undefined, fallback?: import('../core/types.ts').FunctionalTextBuffer) => {
      if (bufferName && buffers.has(bufferName)) return buffers.get(bufferName)!;
      return fallback ?? buffers.get('*scratch*') ?? FunctionalTextBufferImpl.create('');
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
  private resolveFrame(params: any): Frame {
    if (params?.frameId) return this.getFrame(params.frameId);
    if (this.activeFrameId) return this.getFrame(this.activeFrameId);
    throw new Error('No active frame');
  }

  /**
   * Non-throwing variant: returns undefined when no frame is active.
   */
  private resolveFrameOptional(params: any): Frame | undefined {
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

  private recordError(source: string, error: unknown, clientId?: string, frameId?: string, diagnostic?: Record<string, any>, requestId?: string | number): void {
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

  private frameStatus(frame: Frame): Record<string, unknown> {
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

  private clientStatus(client: ClientConnection): Record<string, unknown> {
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

  private buildStatus(): Record<string, unknown> {
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

    // Lock exists — check if stale
    const existing = readLock(lockPath);
    if (existing && isProcessAlive(existing.pid) && existing.socketPath === this.socketPath) {
      throw new Error(`Daemon starting (pid ${existing.pid}) at ${this.socketPath}`);
    }

    // Stale lock — remove and retry
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

    asyncBuiltin('workspace-list', async () => asTlisp(await this.handleWorkspaceList()));
    asyncBuiltin('workspace-new', async (args) => {
      return asTlisp(await this.handleWorkspaceNew({ name: stringArg(args, 0, 'workspace-new') }));
    });
    asyncBuiltin('workspace-switch', async (args) => {
      return asTlisp(await this.handleWorkspaceSwitch({ name: stringArg(args, 0, 'workspace-switch') }));
    });
    asyncBuiltin('workspace-save', async () => asTlisp(await this.handleWorkspaceSave({})));
    asyncBuiltin('workspace-load', async (args) => {
      return asTlisp(await this.handleWorkspaceLoad({ name: stringArg(args, 0, 'workspace-load') }));
    });
    asyncBuiltin('workspace-kill', async (args) => {
      return asTlisp(await this.handleWorkspaceKill({ name: stringArg(args, 0, 'workspace-kill') }));
    });
	    asyncBuiltin('workspace-rename', async (args) => {
	      return asTlisp(await this.handleWorkspaceRename({
	        oldName: stringArg(args, 0, 'workspace-rename'),
	        newName: stringArg(args, 1, 'workspace-rename'),
	      }));
	    });
	    asyncBuiltin('workspace-move-window', async (args) => {
	      return asTlisp(await this.handleWorkspaceMoveWindow({ target: stringArg(args, 0, 'workspace-move-window') }));
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
            const params = request.params ?? {};
            client.clientType = params.clientType ?? 'tui';
            client.clientName = params.clientName;
            client.metadata = params.metadata ?? {};
	            const requestedWorkspace = params.workspaceId ?? params.workspace ?? (await this.readLastWorkspace()) ?? this.activeWorkspaceId;
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

          request.params = { ...(request.params ?? {}), clientId };

          // Inject frameId into frame-aware methods if client has a frame
          if (clientFrameId && !request.params?.frameId) {
            if (['keypress', 'render-state', 'client-event'].includes(request.method)) {
              request.params = { ...request.params, frameId: clientFrameId };
            }
          }

          const response = await this.processRequest(request);

          if (conn.writable) {
            conn.write(JSON.stringify(response) + '\n');
          }
        } catch (error) {
          console.error('Error processing client request:', error);
          this.recordError('request', error, clientId, clientFrameId ?? undefined);
          const errorResponse: JSONRPCResponse = {
            jsonrpc: '2.0',
            id: request?.id ?? undefined,
            error: {
              code: -32603,
              message: `Internal error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              ...(error instanceof Error && (error as any).diagnostic ? {
                data: {
                  kind: 'tlisp-diagnostic',
                  diagnostic: (error as any).diagnostic,
                }
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
   * Process a JSON-RPC request
   */
  private async processRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    if (request.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32600,
          message: 'Invalid Request: JSON-RPC version must be 2.0'
        }
      };
    }

    try {
      let result: any;

      switch (request.method) {
        case 'open':
          result = await this.handleOpen(request.params);
          break;
        case 'eval':
          result = await this.handleEval(request.params);
          break;
        case 'command':
          result = await this.handleCommand(request.params);
          break;
        case 'query':
          result = await this.handleQuery(request.params);
          break;
        case 'ping':
          result = await this.handlePing();
          break;
        case 'insert':
          result = await this.handleInsert(request.params);
          break;
        case 'keypress':
          result = await this.handleKeypress(request.params);
          break;
        case 'render-state':
          result = await this.handleRenderState(request.params);
          break;
        case 'client-event':
          result = await this.handleClientEvent(request.params);
          break;
        case 'status':
          result = await this.handleStatus();
          break;
        case 'clients':
          result = await this.handleClients();
          break;
        case 'frames':
          result = await this.handleFrames();
          break;
        case 'workspace-list':
          result = await this.handleWorkspaceList();
          break;
        case 'workspace-new':
          result = await this.handleWorkspaceNew(request.params);
          break;
        case 'workspace-switch':
          result = await this.handleWorkspaceSwitch(request.params);
          break;
        case 'workspace-save':
          result = await this.handleWorkspaceSave(request.params);
          break;
        case 'workspace-kill':
          result = await this.handleWorkspaceKill(request.params);
          break;
        case 'workspace-rename':
          result = await this.handleWorkspaceRename(request.params);
          break;
	        case 'workspace-load':
	          result = await this.handleWorkspaceLoad(request.params);
	          break;
	        case 'workspace-move-window':
	          result = await this.handleWorkspaceMoveWindow(request.params);
	          break;
        case 'shutdown':
          result = { success: true };
          // Fire-and-forget shutdown so we can respond first
          setTimeout(() => { this.shutdown(); }, 50);
          break;
        case 'capture':
          result = this.handleCapture(request.params);
          break;
        case 'save-file':
          result = await this.handleSaveFile(request.params);
          break;
        default:
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`
            }
          };
      }

      return {
        jsonrpc: '2.0',
        id: request.id,
        result
      };
    } catch (error) {
      const diagnostic = (error instanceof Error && (error as any).diagnostic)
        ? { kind: 'tlisp-diagnostic', diagnostic: (error as any).diagnostic }
        : undefined;
      this.recordError(
        request.method,
        error,
        request.params?.clientId,
        request.params?.frameId,
        diagnostic?.diagnostic,
        request.id,
      );
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32010,
          message: `${error instanceof Error ? error.message : 'Unknown error'}`,
          ...(diagnostic ? { data: diagnostic } : {})
        }
      };
    }
  }

  /**
   * Handle save-file request: save current buffer to disk.
   * Accepts optional `filename` param for save-as.
   */
  private async handleSaveFile(params: any): Promise<any> {
    const frame = this.resolveFrameOptional(params);
    const workspaceOverride = this.isWorkspaceOverride(frame, params?.workspaceId);
    if (frame && !workspaceOverride) this.syncFrameToEditor(frame);

    const filename = params?.filename ?? this.editor.getState().currentFilename;
    if (!filename) {
      throw new Error('No filename to save to (open a file or provide a filename param)');
    }

    await this.editor.saveFile(filename);

    this.captureActiveWorkspace();
    if (frame && !workspaceOverride) this.syncEditorToFrame(frame); else this.syncEditorToAllFrames();

    return { success: true, saved: filename };
  }

  /**
   * Handle file open request
   */
  private async handleOpen(params: any): Promise<any> {
    const filepath = params.filepath;

    if (!filepath) {
      throw new Error('Filepath is required');
    }

    const frame = this.resolveFrameOptional(params);
    const workspaceOverride = this.isWorkspaceOverride(frame, params?.workspaceId);
    const previousWorkspaceId = this.activeWorkspaceId;
    const previousFrameId = this.activeFrameId;

    try {
      await this.activateFrameWorkspace(frame, params?.workspaceId);

      // Load the file content
      let content = '';
      try {
        content = await this.editor.getFilesystem().readFile(filepath);
      } catch (error) {
        // File doesn't exist, create empty buffer
        content = '';
      }

      this.editor.createBuffer(filepath, content);
      const currentState = this.editor.getState();
      const newState = {
        ...currentState,
        currentFilename: filepath,
        statusMessage: `Opened ${filepath}`,
      };

      this.editor.setEditorState(newState);
      this.editor.activateMajorModeForFile(filepath);
	    this.editor.logMessage(`Opened ${filepath}`, 'info', undefined, this.activeFrameId ?? undefined);

	    this.captureActiveWorkspace();
	    this.scheduleDirtyWorkspaceSave(this.activeWorkspaceId);
	    if (frame && !workspaceOverride) this.syncEditorToFrame(frame); else this.syncEditorToAllFrames();

      return {
        buffer: filepath,
        line: 1,
        column: 1,
        opened: true
      };
    } finally {
      await this.restoreWorkspaceAfterOverride(workspaceOverride, previousWorkspaceId, previousFrameId);
    }
  }

  /**
   * Handle T-Lisp evaluation request
   */
  private async handleEval(params: any): Promise<any> {
    const code = params.code;

    if (!code) {
      throw new Error('Code is required for eval');
    }

    const frame = this.resolveFrameOptional(params);
    const workspaceOverride = this.isWorkspaceOverride(frame, params?.workspaceId);
    const previousWorkspaceId = this.activeWorkspaceId;
    const previousFrameId = this.activeFrameId;

    try {
      await this.activateFrameWorkspace(frame, params?.workspaceId);
      if (frame && !workspaceOverride) {
        this.syncFrameToEditor(frame);
      }

      // Execute the T-Lisp code using the interpreter
      const interpreter = this.editor.getInterpreter();
      const result = interpreter.executeAsync
        ? await interpreter.executeAsync(code)
        : interpreter.execute(code);

      // Handle Either return type - check _tag property
      if (result._tag === 'Left') {
        const err = result.left as any;
        // Catch editor-quit signal and trigger graceful shutdown
        if (err.message === 'EDITOR_QUIT_SIGNAL') {
          this.syncEditorToAllFrames();
          setTimeout(() => { this.shutdown(); }, 50);
          return { quitSignal: true };
        }
        const diagnostic = err.diagnostic ? this.diagnosticToJSON(err.diagnostic) : undefined;
        this.recordError('eval', new Error(err.message), undefined, undefined, diagnostic);
        const e = new Error(err.message || 'T-Lisp evaluation error');
        (e as any).diagnostic = diagnostic;
        throw e;
      }

	      this.captureActiveWorkspace();
	      this.scheduleDirtyWorkspaceSave(this.activeWorkspaceId);
	      if (frame && !workspaceOverride) this.syncEditorToFrame(frame); else this.syncEditorToAllFrames();

      // Convert T-Lisp value to JSON-serializable format
      return this.tlispValueToJson(result.right);
    } catch (error) {
      if ((error as any).diagnostic) throw error;
      throw new Error(`T-Lisp evaluation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      await this.restoreWorkspaceAfterOverride(workspaceOverride, previousWorkspaceId, previousFrameId);
    }
  }

  private diagnosticToJSON(d: any): Record<string, any> {
    return {
      severity: d.severity,
      code: d.code,
      message: d.message,
      ...(d.source ? { source: d.source } : {}),
      ...(d.primarySpan ? { primarySpan: d.primarySpan } : {}),
      ...(d.expected ? { expected: d.expected } : {}),
      ...(d.actual ? { actual: d.actual } : {}),
      ...(d.help ? { help: d.help } : {}),
      ...(d.stack ? { stack: d.stack } : {}),
    };
  }

  /**
   * Handle insert request
   */
  private async handleInsert(params: any): Promise<any> {
    const text = params.text;

    if (!text) {
      throw new Error('Text is required for insert');
    }

    const frame = this.resolveFrameOptional(params);
    const workspaceOverride = this.isWorkspaceOverride(frame, params?.workspaceId);
    const previousWorkspaceId = this.activeWorkspaceId;
    const previousFrameId = this.activeFrameId;

    try {
      await this.activateFrameWorkspace(frame, params?.workspaceId);
      if (frame && !workspaceOverride) this.syncFrameToEditor(frame);

      const interpreter = this.editor.getInterpreter();
      const escaped = text
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
        .replace(/"/g, '\\"');
      const result = interpreter.execute(`(buffer-insert "${escaped}")`);
      if (result._tag === 'Left') {
        throw new Error(result.left.message || 'T-Lisp evaluation error');
      }

	      this.captureActiveWorkspace();
	      this.scheduleDirtyWorkspaceSave(this.activeWorkspaceId);
	      if (frame && !workspaceOverride) this.syncEditorToFrame(frame); else this.syncEditorToAllFrames();

      return this.tlispValueToJson(result.right);
    } catch (error) {
      throw new Error(`Insert error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      await this.restoreWorkspaceAfterOverride(workspaceOverride, previousWorkspaceId, previousFrameId);
    }
  }

  /**
   * Handle keypress from TUI client
   */
  private async handleKeypress(params: any): Promise<any> {
    const key = params.key;
    if (!key) {
      throw new Error('Key is required for keypress');
    }

    try {
      // If a frame is available, keypresses should mutate that frame-local
      // state. tmaxclient --key does not know the TUI frame id, so it targets
      // the active frame.
      const frameId = params.frameId ?? this.activeFrameId;
      if (frameId) {
        const frame = this.getFrame(frameId);
        const workspaceOverride = this.isWorkspaceOverride(frame, params?.workspaceId);
        const previousWorkspaceId = this.activeWorkspaceId;
        const previousFrameId = this.activeFrameId;
        try {
          this.activeFrameId = frameId;
          await this.activateFrameWorkspace(frame, params?.workspaceId);
          if (!workspaceOverride) this.syncFrameToEditor(frame);
          await this.editor.handleKey(key);
	        this.captureActiveWorkspace();
	        this.scheduleDirtyWorkspaceSave(this.activeWorkspaceId);
	        if (workspaceOverride) {
	          this.syncEditorToAllFrames();
	          return editorStateToJson(this.editor.getEditorState());
	        }
	        this.syncEditorToFrame(frame);
	        return editorStateToJson(this.frameToEditorState(frame));
        } finally {
          await this.restoreWorkspaceAfterOverride(workspaceOverride, previousWorkspaceId, previousFrameId);
        }
      }
      // No frameId — operate on editor directly, then sync all frames
      await this.activateWorkspace(params?.workspaceId ?? this.activeWorkspaceId);
      await this.editor.handleKey(key);
	      this.syncEditorToAllFrames();
	      this.captureActiveWorkspace();
	      this.scheduleDirtyWorkspaceSave(this.activeWorkspaceId);
	      return editorStateToJson(this.editor.getEditorState());
    } catch (error) {
      if (error instanceof Error && error.message === 'EDITOR_QUIT_SIGNAL') {
        this.syncEditorToAllFrames();
        const state = editorStateToJson(this.editor.getEditorState());
        setTimeout(() => { this.shutdown(); }, 50);
        return { ...state, quitSignal: true };
      }
      throw error;
    }
  }

  /**
   * Handle render-state request (frame-scoped).
   * READ-only: returns the frame's own state without mutating editor.
   */
  private async handleRenderState(params: any): Promise<any> {
    if (params?.frameId) {
      const frame = this.getFrame(params.frameId);
      // Read-only: return frame's own state directly, no workspace activation (C2)
      return editorStateToJson(this.frameToEditorState(frame));
    }
    return editorStateToJson(this.editor.getEditorState());
  }

  /**
   * Handle capture request — render current frame and return ANSI or HTML.
   */
  private handleCapture(params: any): any {
    const format = params?.format ?? "ansi";

    // Get terminal size from the active frame, or fall back to 80x24
    let width = 80;
    let height = 24;

    const frame = this.resolveFrameOptional(params);
    if (frame) {
      const obs = this.frameObservability.get(frame.id);
      if (obs?.terminalSize) {
        width = obs.terminalSize.width;
        height = obs.terminalSize.height;
      }
    }

    const state = frame
      ? this.frameToEditorState(frame)
      : this.editor.getEditorState();

    const lines = captureFrame(state, width, height);

    if (format === "html") {
      return { html: ansiLinesToHtmlDocument(lines, width), width, height };
    }
    return { lines, width, height };
  }

  /**
   * Handle lifecycle events from connected clients.
   */
  private async handleClientEvent(params: any): Promise<any> {
    const event = params.event;
    const clientId = params.clientId;
    const frameId = params.frameId;
    const now = new Date();

    if (!event) {
      throw new Error('Client event name is required');
    }

    const frame = frameId ? this.frameObservability.get(frameId) : undefined;
    const client = clientId ? this.clients.get(clientId) : undefined;

    if (client) {
      client.lastRequestAt = now;
      if (params.clientType) client.clientType = params.clientType;
      if (params.clientName) client.clientName = params.clientName;
    }

    if (event === 'error') {
      const message = params.message ?? 'Unknown client error';
      this.recordError('client-event', message, clientId, frameId);
      return { ok: true };
    }

    if (frame) {
      if (event === 'tui-started') {
        frame.clientType = params.clientType ?? frame.clientType;
      } else if (event === 'first-render') {
        frame.firstRenderAt = frame.firstRenderAt ?? now;
        frame.lastRenderAt = now;
        frame.renderCount++;
        frame.terminalSize = params.terminalSize ?? frame.terminalSize;
      } else if (event === 'raw-mode-ready') {
        frame.rawModeReady = true;
        frame.ready = Boolean(frame.firstRenderAt);
      } else if (event === 'render') {
        frame.lastRenderAt = now;
        frame.renderCount++;
        frame.terminalSize = params.terminalSize ?? frame.terminalSize;
        frame.ready = frame.ready || (frame.rawModeReady && Boolean(frame.firstRenderAt));
      } else if (event === 'resize') {
        frame.terminalSize = params.terminalSize ?? frame.terminalSize;
      } else if (event === 'shutdown') {
        frame.ready = false;
      }

      if (frame.rawModeReady && frame.firstRenderAt) {
        frame.ready = true;
      }
    }

    return { ok: true };
  }

  private async handleStatus(): Promise<any> {
    return this.buildStatus();
  }

  private async handleClients(): Promise<any> {
    return Array.from(this.clients.values()).map(client => this.clientStatus(client));
  }

  private async handleFrames(): Promise<any> {
    return Array.from(this.frames.values()).map(frame => this.frameStatus(frame));
  }

	  private workspaceNameFromParams(params: any, key: string = 'name'): string {
	    const value = params?.[key] ?? params?.workspace ?? params?.workspaceId;
	    if (typeof value !== 'string' || value.length === 0) {
	      throw new Error(`Workspace ${key} is required`);
	    }
	    return value;
	  }

	  private workspaceDirtyBuffers(workspace: WorkspaceState): string[] {
	    return Array.from(workspace.bufferMetadata.entries())
	      .filter(([, metadata]) => metadata.modified)
	      .map(([name]) => name);
	  }

	  private bufferDetailsForWorkspace(workspace: WorkspaceState, currentBufferName?: string): Array<Record<string, unknown>> {
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

  private async handleWorkspaceList(): Promise<any> {
    this.captureActiveWorkspace();
    const disk = await this.workspaceManager.list().run();
    if (Either.isLeft(disk)) throw new Error(disk.left);
    const loadedNames = new Set(this.workspaces.keys());
    return disk.right.map(metadata => ({
      name: metadata.name,
      id: metadata.id,
      active: metadata.name === this.activeWorkspaceId,
      loaded: loadedNames.has(metadata.name),
      lastAccessed: metadata.lastAccessed,
      projectRoot: metadata.projectRoot ?? null,
      windowCount: this.workspaces.get(metadata.name)?.windows.length ?? 0,
    }));
  }

  private async handleWorkspaceNew(params: any): Promise<any> {
    const name = this.workspaceNameFromParams(params);
    const result = await this.workspaceManager.create(name, { projectRoot: params?.projectRoot }).run();
    if (Either.isLeft(result)) throw new Error(result.left);
    this.workspaces.set(name, result.right);
    // R4-6: workspace-new is "create only" per spec — don't updateLastWorkspace
    return { success: true, name, id: result.right.metadata.id };
  }

  private async handleWorkspaceSwitch(params: any): Promise<any> {
    const name = this.workspaceNameFromParams(params);
    // R4-9: inline the switch logic to avoid double captureActiveWorkspace
    this.captureActiveWorkspace();
    await this.saveWorkspace(this.activeWorkspaceId);
    const workspace = await this.loadWorkspace(name);
    this.activeWorkspaceId = name;
    this.editor.applyWorkspace(workspace);
    await this.updateLastWorkspace(name); // C6
    if (params?.frameId) {
      const frame = this.getFrame(params.frameId);
      frame.workspaceId = name;
      this.syncEditorToFrame(frame);
    }
    return { success: true, activeWorkspaceId: name };
  }

  private async handleWorkspaceSave(params: any): Promise<any> {
    const name = params?.name ?? this.activeWorkspaceId;
    this.captureActiveWorkspace();
    await this.saveWorkspace(name);
    return { success: true, name };
  }

	  private async handleWorkspaceKill(params: any): Promise<any> {
	    const name = this.workspaceNameFromParams(params);
	    if (name === this.activeWorkspaceId) {
	      throw new Error('Cannot kill the active workspace; switch to another workspace first');
	    }
	    const workspace = await this.loadWorkspace(name);
	    const dirtyBuffers = this.workspaceDirtyBuffers(workspace);
	    if (dirtyBuffers.length > 0 && params?.confirm !== true) {
	      return {
	        success: false,
	        confirmationRequired: true,
	        name,
	        dirtyBuffers,
	        message: `Workspace "${name}" has unsaved buffers`,
	      };
	    }
	    const result = await this.workspaceManager.delete(name).run();
	    if (Either.isLeft(result)) throw new Error(result.left);
	    this.workspaces.delete(name);
    for (const frame of this.frames.values()) {
      if (frame.workspaceId === name) {
        frame.workspaceId = this.activeWorkspaceId;
        this.syncEditorToFrame(frame); // I2: reset frame state from active workspace
      }
    }
    return { success: true, name };
  }

  private async handleWorkspaceRename(params: any): Promise<any> {
    const oldName = this.workspaceNameFromParams(params, 'oldName');
    const newName = this.workspaceNameFromParams(params, 'newName');
    this.captureActiveWorkspace();
    const result = await this.workspaceManager.rename(oldName, newName).run();
    if (Either.isLeft(result)) throw new Error(result.left);
    const loaded = this.workspaces.get(oldName);
    if (loaded) {
      loaded.metadata.name = newName;
      this.workspaces.delete(oldName);
      this.workspaces.set(newName, loaded);
    }
    if (this.activeWorkspaceId === oldName) this.activeWorkspaceId = newName;
    for (const frame of this.frames.values()) {
      if (frame.workspaceId === oldName) frame.workspaceId = newName;
    }
    return { success: true, oldName, newName };
  }

	  private async handleWorkspaceLoad(params: any): Promise<any> {
	    const name = this.workspaceNameFromParams(params);
	    const workspace = await this.loadWorkspace(name);
	    return { success: true, name, id: workspace.metadata.id };
	  }

	  private async handleWorkspaceMoveWindow(params: any): Promise<any> {
	    const targetName = params?.target ?? params?.name ?? params?.workspace ?? params?.workspaceId;
	    if (typeof targetName !== 'string' || targetName.length === 0) {
	      throw new Error('workspace-move-window target is required');
	    }
	    const frame = this.resolveFrameOptional(params);
	    const sourceWorkspaceId = typeof params?.sourceWorkspaceId === 'string' ? params.sourceWorkspaceId : undefined;
	    const previousWorkspaceId = this.activeWorkspaceId;
	    const previousFrameId = this.activeFrameId;
	    const workspaceOverride = typeof sourceWorkspaceId === 'string'
	      && sourceWorkspaceId.length > 0
	      && sourceWorkspaceId !== previousWorkspaceId;

	    try {
	      await this.activateFrameWorkspace(frame, sourceWorkspaceId);
	      if (frame && !workspaceOverride) this.syncFrameToEditor(frame);

	      const state = this.editor.getState();
	      const windows = state.windows ?? [];
	      const currentWindowIndex = state.currentWindowIndex ?? 0;
	      const currentWindow = windows[currentWindowIndex];
	      const buffer = currentWindow?.buffer ?? state.currentBuffer;
	      const bufferName = currentWindow?.bufferName ?? this.currentBufferName(state);
	      if (!buffer || !bufferName) {
	        throw new Error('No current window buffer to move');
	      }
	      const contentResult = buffer.getContent();
	      if (Either.isLeft(contentResult)) {
	        throw new Error(`Failed to read buffer "${bufferName}": ${contentResult.left}`);
	      }

	      this.captureActiveWorkspace();
	      const sourceName = this.activeWorkspaceId;
	      if (targetName === sourceName) {
	        return { success: true, source: sourceName, target: targetName, moved: bufferName, noop: true };
	      }
	      const source = this.workspaces.get(sourceName);
	      if (!source) throw new Error(`Workspace "${sourceName}" is not loaded`);
	      const target = await this.loadWorkspace(targetName);
	      if (target.buffers.has(bufferName)) {
	        throw new Error(`Target workspace "${targetName}" already has buffer "${bufferName}"`);
	      }

	      const stagedSource = this.cloneWorkspace(source);
	      const stagedTarget = this.cloneWorkspace(target);
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

	      await this.saveWorkspaceSnapshot(stagedTarget);
	      await this.saveWorkspaceSnapshot(stagedSource);
	      this.workspaces.set(sourceName, stagedSource);
	      this.workspaces.set(targetName, stagedTarget);
	      this.editor.applyWorkspace(stagedSource);
	      if (frame && !workspaceOverride) this.syncEditorToFrame(frame); else this.syncEditorToAllFrames();
	      return { success: true, source: sourceName, target: targetName, moved: bufferName };
	    } finally {
	      await this.restoreWorkspaceAfterOverride(workspaceOverride, previousWorkspaceId, previousFrameId);
	    }
		  }

	  /**
	   * Handle editor command request
   */
  private async handleCommand(params: any): Promise<any> {
    const command = params.command;

    if (!command) {
      throw new Error('Command is required');
    }

    const frame = this.resolveFrameOptional(params);
    const workspaceOverride = this.isWorkspaceOverride(frame, params?.workspaceId);
    const previousWorkspaceId = this.activeWorkspaceId;
    const previousFrameId = this.activeFrameId;

    try {
      await this.activateFrameWorkspace(frame, params?.workspaceId);

      // Read-only commands don't need frame sync
      switch (command) {
      case 'list-buffers': {
        const buffers = this.editor.getState().buffers;
        const names: string[] = [];
        buffers?.forEach((_buf, name) => names.push(name));
        return names;
      }
      case 'kill-buffer': {
        const bufferName = params.bufferName;
        if (bufferName) {
          const state = this.editor.getState();
          if (state.buffers?.has(bufferName)) {
	            const newBuffers = new Map(state.buffers);
	            newBuffers.delete(bufferName);
	            this.editor.setEditorState({ ...state, buffers: newBuffers });
	            this.captureActiveWorkspace();
	            this.scheduleDirtyWorkspaceSave(this.activeWorkspaceId);
	            if (frame && !workspaceOverride) this.syncEditorToFrame(frame); else this.syncEditorToAllFrames();
	            return { success: true, killed: bufferName };
          } else {
            return { success: false, error: `Buffer ${bufferName} not found` };
          }
        }
        throw new Error('Buffer name required for kill-buffer');
      }
      case 'save-buffer': {
        if (frame && !workspaceOverride) this.syncFrameToEditor(frame);

        const currentFile = this.editor.getState().currentFilename;
        if (currentFile) {
          await this.editor.saveFile(currentFile);
          this.captureActiveWorkspace();
          if (frame && !workspaceOverride) this.syncEditorToFrame(frame); else this.syncEditorToAllFrames();
          return { success: true, saved: currentFile };
        }
        throw new Error('No file to save');
      }
      case 'server-info':
        return this.buildStatus();
      case 'describe-function':
        const functionName = params.functionName;
        if (functionName) {
          return this.getFunctionDocumentation(functionName);
        }
        throw new Error('Function name required for describe-function command');
      case 'describe-variable':
        const variableName = params.variableName;
        if (variableName) {
          return this.getVariableDocumentation(variableName);
        }
        throw new Error('Variable name required for describe-variable command');
      case 'apropos-command':
        const pattern = params.pattern;
        if (pattern) {
          return this.findCommandsByPattern(pattern);
        }
        throw new Error('Pattern required for apropos-command');
      case 'find-usages':
        const funcName = params.functionName;
        if (funcName) {
          return this.findFunctionUsages(funcName);
        }
        throw new Error('Function name required for find-usages command');
      default:
        throw new Error(`Unknown command: ${command}`);
      }
    } finally {
      await this.restoreWorkspaceAfterOverride(workspaceOverride, previousWorkspaceId, previousFrameId);
    }
  }

  /**
   * Get documentation for a variable
   */
  private getVariableDocumentation(variableName: string): any {
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
  private findCommandsByPattern(pattern: string): any {
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
  private findFunctionUsages(functionName: string): any {
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
  private getTlispVariables(): Record<string, any> {
    const variables: Record<string, any> = {};

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
	  private async handleQuery(params: any): Promise<any> {
	    const query = params.query;
	    // N4: read-only query — do not mutate editor state via activateFrameWorkspace
	    const frame = this.resolveFrameOptional(params);
	    const frameWorkspaceId = frame?.workspaceId;
	    const frameWorkspace = frameWorkspaceId && frameWorkspaceId !== this.activeWorkspaceId
	      ? this.workspaces.get(frameWorkspaceId)
	      : undefined;
	    const state = frame && frameWorkspace
	      ? this.frameToEditorState(frame)
	      : this.editor.getState();

	    switch (query) {
	      case 'buffers': {
	        return frameWorkspace
	          ? this.bufferDetailsForWorkspace(frameWorkspace, frame?.currentBufferName ?? frameWorkspace.currentBufferName)
	          : this.editor.getBufferDetails();
	      }
      case 'variables':
        // Return variables from T-Lisp interpreter
        return this.getTlispVariables();
      case 'keybindings':
        return state.config.keyBindings;
	      case 'full-state': {
	        const bufferDetails = frameWorkspace
	          ? this.bufferDetailsForWorkspace(frameWorkspace, frame?.currentBufferName ?? frameWorkspace.currentBufferName)
	          : this.editor.getBufferDetails();
	        const currentBuffer = bufferDetails.find(buffer => buffer.current)?.name ?? null;

        return {
          buffers: bufferDetails,
          currentBuffer,
          mode: state.mode,
          variables: this.getTlispVariables(),
          keybindings: state.config.keyBindings,
          cursorPosition: state.cursorPosition,
          viewportTop: state.viewportTop,
          config: state.config
        };
      }
      case 'functions':
        // Query the T-Lisp interpreter for available functions
        return this.getTlispFunctions();
      case 'messages': {
        // SPEC-055: optional `category` filter routes through the unified store
        // (raw category) when present; otherwise the messages view (mirror rule).
        if (params?.category) {
          const store = this.editor.getUnifiedLog();
          return { messages: store.getEntries({ category: params.category, level: params?.level, last: params?.last }) };
        }
        const log = this.editor.getMessageLog();
        if (!log) return { messages: [] };
        const entries = log.getEntries({
          level: params?.level,
          last: params?.last,
        });
        return { messages: entries };
      }
      case 'log': {
        // SPEC-055: unified query across all categories with view/category/level/last filters.
        const store = this.editor.getUnifiedLog();
        const entries = store.getEntries({
          view: params?.view,
          category: params?.category,
          level: params?.level,
          last: params?.last,
        });
        return { entries };
      }
      case 'function-documentation':
        const functionName = params.functionName;
        if (functionName) {
          return this.getFunctionDocumentation(functionName);
        }
        throw new Error('Function name required for function-documentation query');
      default:
        throw new Error(`Unknown query: ${query}`);
    }
  }

  /**
   * Get documentation for a specific function
   */
  private getFunctionDocumentation(functionName: string): any {
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
   * Handle ping request
   */
  private async handlePing(): Promise<any> {
    return {
      status: 'running',
      server: 'tmax',
      frames: this.frames.size
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
