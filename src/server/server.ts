#!/usr/bin/env bun
/**
 * @file server.ts
 * @description Server infrastructure for tmax editor with Unix socket support
 * Implements JSON-RPC 2.0 protocol for client communication
 */

import { createServer, Server, Socket } from 'net';
import { userInfo } from 'os';
import { closeSync, existsSync, mkdirSync, openSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import { Editor } from '../editor/editor.ts';
import { TerminalIOImpl } from '../core/terminal.ts';
import { FileSystemImpl } from '../core/filesystem.ts';
import { FunctionalTextBufferImpl } from '../core/buffer.ts';
import { EditorState, Frame } from '../core/types.ts';
import { registerTestingFramework } from '../tlisp/test-framework.ts';
import { editorStateToJson } from './serialize.ts';
import { cloneJsonValue } from '../tlisp/serialization.ts';

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
  private frameObservability: Map<string, FrameObservability> = new Map();
  private recentErrors: ObservabilityError[] = [];
  private startedAt: Date = new Date();
  private activeFrameId: string | null = null;
  private isRunning: boolean = false;
  private testMode: boolean = false;
  private ownsSocket: boolean = false;
  private ownsLock: boolean = false;
  private shuttingDown: boolean = false;

  constructor(socketPath?: string, testMode: boolean = false) {
    this.socketPath = socketPath || this.getDefaultSocketPath();
    this.server = createServer();
    this.clients = new Map();
    this.testMode = testMode;

    // Create editor instance with T-Lisp interpreter
    const terminal = new TerminalIOImpl(true); // dev mode for server
    const filesystem = new FileSystemImpl();
    this.editor = new Editor(terminal, filesystem);

    // Load test framework to provide defvar and other testing utilities
    const interpreter = this.editor.getInterpreter();
    registerTestingFramework(interpreter);

    // Initialize default state
    const initialState: EditorState = {
      currentBuffer: FunctionalTextBufferImpl.create(""),
      cursorPosition: { line: 0, column: 0 },
      mode: 'normal' as const,
      statusMessage: 'Server started',
      viewportTop: 0,
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

  /**
   * Create a new frame (independent viewport)
   */
  createFrame(clientId?: string, clientType: string = 'tui'): string {
    const id = `frame-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const state = this.editor.getState();
    const frame: Frame = {
      id,
      cursorPosition: { ...state.cursorPosition },
      viewportTop: state.viewportTop,
      mode: state.mode,
      commandLine: state.commandLine,
      mxCommand: state.mxCommand,
      currentFilename: state.currentFilename,
      currentBuffer: state.currentBuffer,
      statusMessage: state.statusMessage,
      cursorFocus: 'buffer',
      currentMajorMode: state.currentMajorMode ?? 'fundamental',
      activeMinorModes: state.activeMinorModes ?? [],
      activeMinorModeLighters: state.activeMinorModeLighters ?? [],
      minibufferState: cloneJsonValue(state.minibufferState),
      minibufferView: state.minibufferView ? structuredClone(state.minibufferView) : undefined,
      lastActivity: new Date(),
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
    (this.editor as any).logMessage(`Frame created: ${id}`);
    return id;
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
   * Sync frame state TO the editor (before operations that use editor state)
   */
  private syncFrameToEditor(frame: Frame): void {
    this.editor.setEditorState({
      currentBuffer: frame.currentBuffer,
      cursorPosition: { ...frame.cursorPosition },
      mode: frame.mode,
      statusMessage: frame.statusMessage,
      viewportTop: frame.viewportTop,
      config: this.editor.getState().config,
      commandLine: frame.commandLine,
      mxCommand: frame.mxCommand,
      currentFilename: frame.currentFilename,
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
    frame.mode = state.mode;
    frame.commandLine = state.commandLine;
    frame.mxCommand = state.mxCommand;
    frame.currentFilename = state.currentFilename;
    frame.currentBuffer = state.currentBuffer;
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
    (this.editor as any).logMessage(`Frame deleted: ${id}`);
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
    return {
      currentBuffer: frame.currentBuffer,
      cursorPosition: { ...frame.cursorPosition },
      mode: frame.mode,
      statusMessage: frame.statusMessage,
      viewportTop: frame.viewportTop,
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
      // Shared display metadata — not frame-local
      buffers: shared.buffers,
      windows: shared.windows,
      currentWindowIndex: shared.currentWindowIndex,
      tabs: shared.tabs,
      currentTabIndex: shared.currentTabIndex,
    };
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    (this.editor as any).logMessage('Server started');

    // Load core bindings and init file before starting
    await (this.editor as any).ensureCoreBindingsLoaded();
    await (this.editor as any).loadInitFile(undefined);
    console.log('Core bindings and init file loaded');

    // Ensure the socket directory exists
    const socketDir = this.socketPath.substring(0, this.socketPath.lastIndexOf('/'));
    mkdirSync(socketDir, { recursive: true });

    // Acquire socket ownership (fails if live daemon already holds it)
    await this.acquireSocket();

    this.server.on('connection', this.handleConnection.bind(this));

    // start() resolves only after listen succeeds, rejects on error
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
    console.log(`Client connected: ${clientId}`);

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
            clientFrameId = this.createFrame(clientId, client.clientType);
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
      console.log(`Client disconnected: ${clientId}`);
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
        case 'shutdown':
          result = { success: true };
          // Fire-and-forget shutdown so we can respond first
          setTimeout(() => { this.shutdown(); }, 50);
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
   * Handle file open request
   */
  private async handleOpen(params: any): Promise<any> {
    const filepath = params.filepath;
    const wait = params.wait ?? true;

    if (!filepath) {
      throw new Error('Filepath is required');
    }

    // Load the file content
    let content = '';
    try {
      const fs = new FileSystemImpl();
      content = await fs.readFile(filepath);
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
    (this.editor as any).logMessage(`Opened ${filepath}`);

    this.syncEditorToAllFrames();

    return {
      buffer: filepath,
      line: 1,
      column: 1,
      opened: true
    };
  }

  /**
   * Handle T-Lisp evaluation request
   */
  private async handleEval(params: any): Promise<any> {
    const code = params.code;

    if (!code) {
      throw new Error('Code is required for eval');
    }

    try {
      // Execute the T-Lisp code using the interpreter
      const interpreter = this.editor.getInterpreter();
      const result = interpreter.execute(code);

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

      this.syncEditorToAllFrames();

      // Convert T-Lisp value to JSON-serializable format
      return this.tlispValueToJson(result.right);
    } catch (error) {
      if ((error as any).diagnostic) throw error;
      throw new Error(`T-Lisp evaluation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

    try {
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
      this.syncEditorToAllFrames();
      return this.tlispValueToJson(result.right);
    } catch (error) {
      throw new Error(`Insert error: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
        this.activeFrameId = frameId;
        this.syncFrameToEditor(frame);
        await this.editor.handleKey(key);
        this.syncEditorToFrame(frame);
        return editorStateToJson(this.frameToEditorState(frame));
      }
      // No frameId — operate on editor directly, then sync all frames
      await this.editor.handleKey(key);
      this.syncEditorToAllFrames();
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
      return editorStateToJson(this.frameToEditorState(frame));
    }
    return editorStateToJson(this.editor.getEditorState());
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

  /**
   * Handle editor command request
   */
  private async handleCommand(params: any): Promise<any> {
    const command = params.command;

    if (!command) {
      throw new Error('Command is required');
    }

    // For now, we'll handle a few basic commands
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
          const buffers = this.editor.getState().buffers;
          if (buffers?.has(bufferName)) {
            buffers.delete(bufferName);
            return { success: true, killed: bufferName };
          } else {
            return { success: false, error: `Buffer ${bufferName} not found` };
          }
        }
        throw new Error('Buffer name required for kill-buffer');
      }
      case 'save-buffer': {
        const currentFile = this.editor.getState().currentFilename;
        if (currentFile) {
          await this.editor.saveFile(currentFile);
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
  }

  /**
   * Get documentation for a variable
   */
  private getVariableDocumentation(variableName: string): any {
    const interpreter = this.editor.getInterpreter();
    const value = interpreter.globalEnv.lookup(variableName);

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
    const interpreter = this.editor.getInterpreter();
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
    const interpreter = this.editor.getInterpreter();

    // Get all bindings from global environment
    interpreter.globalEnv.bindings.forEach((value, name) => {
      // Only include variables (not functions, and use naming convention)
      if (name.startsWith('*') && name.endsWith('*')) {
        variables[name] = this.tlispValueToJson(value);
      }
    });

    return variables;
  }

  /**
   * Get all functions from T-Lisp environment
   */
  private getTlispFunctions(): string[] {
    const functions: string[] = [];
    const interpreter = this.editor.getInterpreter();

    // Get all bindings from global environment
    interpreter.globalEnv.bindings.forEach((value, name) => {
      // Include functions and special forms
      if (value.type === 'function' || value.type === 'macro') {
        functions.push(name);
      }
    });

    return functions.sort();
  }

  /**
   * Handle query request
   */
  private async handleQuery(params: any): Promise<any> {
    const query = params.query;
    const state = this.editor.getState();

    switch (query) {
      case 'buffers': {
        return this.editor.getBufferDetails();
      }
      case 'variables':
        // Return variables from T-Lisp interpreter
        return this.getTlispVariables();
      case 'keybindings':
        return state.config.keyBindings;
      case 'full-state': {
        const bufferDetails = this.editor.getBufferDetails();
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
        const msgs = (this.editor as any).messages as string[];
        return { messages: msgs };
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
    const interpreter = this.editor.getInterpreter();
    const value = interpreter.globalEnv.lookup(functionName);

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
