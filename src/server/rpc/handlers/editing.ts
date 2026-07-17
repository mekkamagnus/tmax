/**
 * @file rpc/handlers/editing.ts
 * @description CHORE-44 Change 5 — editing-domain RPC handlers (AC5.9).
 *
 * Handler bodies moved verbatim from `TmaxServer`:
 *   handleSaveFile, handleOpen, handleEval, handleInsert, handleKeypress,
 *   handleCommand, handleQuery.
 *
 * Every frame-sync call site, every error code, every result shape, and the
 * workspaceOverride exception are preserved bit-for-bit. Handlers operate
 * purely on `ServerContext` — no import of the concrete `TmaxServer` class.
 *
 * The sync-policy invariants (AC5.3–5.5) are encoded by where these handlers
 * call the ctx.sync* helpers (see the SYNC_POLICY table in router.ts for the
 * authoritative per-method declaration; the spies in server-frame-sync.test.ts
 * assert the resulting call counts).
 */

import type { ServerContext } from "./context.ts";
import type {
  OpenParams, OpenResult,
  EvalParams, EvalResult,
  CommandParams, CommandResult,
  QueryParams, QueryResult,
  InsertParams, InsertResult,
  KeypressParams, KeypressResult,
  SaveFileParams, SaveFileResult,
} from "../types.ts";
import { editorStateToJson } from "../../serialize.ts";

/** Build the editing-domain handlers bound to a `ServerContext`. */
export function createEditingHandlers(ctx: ServerContext): {
  open: (params: OpenParams) => Promise<OpenResult>;
  eval: (params: EvalParams) => Promise<EvalResult>;
  command: (params: CommandParams) => Promise<CommandResult>;
  query: (params: QueryParams) => Promise<QueryResult>;
  insert: (params: InsertParams) => Promise<InsertResult>;
  keypress: (params: KeypressParams) => Promise<KeypressResult>;
  "save-file": (params: SaveFileParams) => Promise<SaveFileResult>;
} {
  // ── save-file ───────────────────────────────────────────────────────────
  const saveFile = async (params: SaveFileParams): Promise<SaveFileResult> => {
    const frame = ctx.resolveFrameOptional(params);
    const workspaceOverride = ctx.isWorkspaceOverride(frame, params?.workspaceId);
    if (frame && !workspaceOverride) ctx.syncFrameToEditor(frame);

    const filename = params?.filename ?? ctx.editor.getState().currentFilename;
    if (!filename) {
      throw new Error('No filename to save to (open a file or provide a filename param)');
    }

    await ctx.editor.saveFile(filename);

    ctx.captureActiveWorkspace();
    if (frame && !workspaceOverride) ctx.syncEditorToFrame(frame); else ctx.syncEditorToAllFrames();

    return { success: true, saved: filename };
  };

  // ── open ────────────────────────────────────────────────────────────────
  const open = async (params: OpenParams): Promise<OpenResult> => {
    const filepath = params.filepath;

    if (!filepath) {
      throw new Error('Filepath is required');
    }

    const frame = ctx.resolveFrameOptional(params);
    const workspaceOverride = ctx.isWorkspaceOverride(frame, params?.workspaceId);
    const previousWorkspaceId = ctx.getActiveWorkspaceId();
    const previousFrameId = ctx.getActiveFrameId();

    try {
      await ctx.activateFrameWorkspace(frame, params?.workspaceId);

      // Load the file content
      let content = '';
      try {
        content = await ctx.editor.getFilesystem().readFile(filepath);
      } catch {
        // File doesn't exist, create empty buffer
        content = '';
      }

      ctx.editor.createBuffer(filepath, content);
      const currentState = ctx.editor.getState();
      const newState = {
        ...currentState,
        currentFilename: filepath,
        statusMessage: `Opened ${filepath}`,
      };

      ctx.editor.setEditorState(newState);
      ctx.editor.activateMajorModeForFile(filepath);
      ctx.logMessage(`Opened ${filepath}`, 'info', undefined, ctx.getActiveFrameId() ?? undefined);

      ctx.captureActiveWorkspace();
      ctx.scheduleDirtyWorkspaceSave(ctx.getActiveWorkspaceId());
      if (frame && !workspaceOverride) ctx.syncEditorToFrame(frame); else ctx.syncEditorToAllFrames();

      return { buffer: filepath, line: 1, column: 1, opened: true };
    } finally {
      await ctx.restoreWorkspaceAfterOverride(workspaceOverride, previousWorkspaceId, previousFrameId);
    }
  };

  // ── eval ────────────────────────────────────────────────────────────────
  const evalHandler = async (params: EvalParams): Promise<EvalResult> => {
    const code = params.code;

    if (!code) {
      throw new Error('Code is required for eval');
    }

    const frame = ctx.resolveFrameOptional(params);
    const workspaceOverride = ctx.isWorkspaceOverride(frame, params?.workspaceId);
    const previousWorkspaceId = ctx.getActiveWorkspaceId();
    const previousFrameId = ctx.getActiveFrameId();

    try {
      await ctx.activateFrameWorkspace(frame, params?.workspaceId);
      if (frame && !workspaceOverride) {
        ctx.syncFrameToEditor(frame);
      }

      // Execute the T-Lisp code using the interpreter
      const interpreter = ctx.editor.getInterpreter();
      const result = interpreter.executeAsync
        ? await interpreter.executeAsync(code)
        : interpreter.execute(code);

      // Handle Either return type - check _tag property
      if (result._tag === 'Left') {
        const err = result.left as { message: string; diagnostic?: unknown };
        // Catch editor-quit signal and trigger graceful shutdown
        if (err.message === 'EDITOR_QUIT_SIGNAL') {
          ctx.syncEditorToAllFrames();
          ctx.scheduleShutdown(50);
          return { quitSignal: true };
        }
        const diagnostic = err.diagnostic ? ctx.diagnosticToJSON(err.diagnostic) : undefined;
        ctx.recordError('eval', new Error(err.message), undefined, undefined, diagnostic);
        const e = new Error(err.message || 'T-Lisp evaluation error');
        (e as Error & { diagnostic?: Record<string, unknown> }).diagnostic = diagnostic;
        throw e;
      }

      ctx.captureActiveWorkspace();
      ctx.scheduleDirtyWorkspaceSave(ctx.getActiveWorkspaceId());
      if (frame && !workspaceOverride) ctx.syncEditorToFrame(frame); else ctx.syncEditorToAllFrames();

      // Convert T-Lisp value to JSON-serializable format
      return ctx.tlispValueToJson(result.right);
    } catch (error) {
      if ((error as Error & { diagnostic?: unknown }).diagnostic) throw error;
      throw new Error(`T-Lisp evaluation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      await ctx.restoreWorkspaceAfterOverride(workspaceOverride, previousWorkspaceId, previousFrameId);
    }
  };

  // ── insert ──────────────────────────────────────────────────────────────
  const insert = async (params: InsertParams): Promise<InsertResult> => {
    const text = params.text;

    if (!text) {
      throw new Error('Text is required for insert');
    }

    const frame = ctx.resolveFrameOptional(params);
    const workspaceOverride = ctx.isWorkspaceOverride(frame, params?.workspaceId);
    const previousWorkspaceId = ctx.getActiveWorkspaceId();
    const previousFrameId = ctx.getActiveFrameId();

    try {
      await ctx.activateFrameWorkspace(frame, params?.workspaceId);
      if (frame && !workspaceOverride) ctx.syncFrameToEditor(frame);

      const interpreter = ctx.editor.getInterpreter();
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

      ctx.captureActiveWorkspace();
      ctx.scheduleDirtyWorkspaceSave(ctx.getActiveWorkspaceId());
      if (frame && !workspaceOverride) ctx.syncEditorToFrame(frame); else ctx.syncEditorToAllFrames();

      return ctx.tlispValueToJson(result.right);
    } catch (error) {
      throw new Error(`Insert error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      await ctx.restoreWorkspaceAfterOverride(workspaceOverride, previousWorkspaceId, previousFrameId);
    }
  };

  // ── keypress ────────────────────────────────────────────────────────────
  const keypress = async (params: KeypressParams): Promise<KeypressResult> => {
    const key = params.key;
    if (!key) {
      throw new Error('Key is required for keypress');
    }

    try {
      // If a frame is available, keypresses should mutate that frame-local
      // state. tmaxclient --key does not know the TUI frame id, so it targets
      // the active frame.
      const frameId = params.frameId ?? ctx.getActiveFrameId();
      if (frameId) {
        const frame = ctx.getFrame(frameId);
        const workspaceOverride = ctx.isWorkspaceOverride(frame, params?.workspaceId);
        const previousWorkspaceId = ctx.getActiveWorkspaceId();
        const previousFrameId = ctx.getActiveFrameId();
        try {
          ctx.setActiveFrameId(frameId);
          await ctx.activateFrameWorkspace(frame, params?.workspaceId);
          if (!workspaceOverride) ctx.syncFrameToEditor(frame);
          await ctx.editor.handleKey(key);
          ctx.captureActiveWorkspace();
          ctx.scheduleDirtyWorkspaceSave(ctx.getActiveWorkspaceId());
          if (workspaceOverride) {
            ctx.syncEditorToAllFrames();
            return editorStateToJson(ctx.editor.getEditorState());
          }
          ctx.syncEditorToFrame(frame);
          return editorStateToJson(ctx.frameToEditorState(frame));
        } finally {
          await ctx.restoreWorkspaceAfterOverride(workspaceOverride, previousWorkspaceId, previousFrameId);
        }
      }
      // No frameId — operate on editor directly, then sync all frames
      await ctx.activateWorkspace(params?.workspaceId ?? ctx.getActiveWorkspaceId());
      await ctx.editor.handleKey(key);
      ctx.syncEditorToAllFrames();
      ctx.captureActiveWorkspace();
      ctx.scheduleDirtyWorkspaceSave(ctx.getActiveWorkspaceId());
      return editorStateToJson(ctx.editor.getEditorState());
    } catch (error) {
      if (error instanceof Error && error.message === 'EDITOR_QUIT_SIGNAL') {
        ctx.syncEditorToAllFrames();
        const state = editorStateToJson(ctx.editor.getEditorState());
        ctx.scheduleShutdown(50);
        return { ...state, quitSignal: true };
      }
      throw error;
    }
  };

  // ── command ─────────────────────────────────────────────────────────────
  const command = async (params: CommandParams): Promise<CommandResult> => {
    const cmd = params.command;

    if (!cmd) {
      throw new Error('Command is required');
    }

    const frame = ctx.resolveFrameOptional(params);
    const workspaceOverride = ctx.isWorkspaceOverride(frame, params?.workspaceId);
    const previousWorkspaceId = ctx.getActiveWorkspaceId();
    const previousFrameId = ctx.getActiveFrameId();

    try {
      await ctx.activateFrameWorkspace(frame, params?.workspaceId);

      // Read-only commands don't need frame sync
      switch (cmd) {
      case 'list-buffers': {
        const buffers = ctx.editor.getState().buffers;
        const names: string[] = [];
        buffers?.forEach((_buf, name) => names.push(name));
        return names;
      }
      case 'kill-buffer': {
        const bufferName = params.bufferName;
        if (bufferName) {
          const state = ctx.editor.getState();
          if (state.buffers?.has(bufferName)) {
            const newBuffers = new Map(state.buffers);
            newBuffers.delete(bufferName);
            ctx.editor.setEditorState({ ...state, buffers: newBuffers });
            ctx.captureActiveWorkspace();
            ctx.scheduleDirtyWorkspaceSave(ctx.getActiveWorkspaceId());
            if (frame && !workspaceOverride) ctx.syncEditorToFrame(frame); else ctx.syncEditorToAllFrames();
            return { success: true, killed: bufferName };
          } else {
            return { success: false, error: `Buffer ${bufferName} not found` };
          }
        }
        throw new Error('Buffer name required for kill-buffer');
      }
      case 'save-buffer': {
        if (frame && !workspaceOverride) ctx.syncFrameToEditor(frame);

        const currentFile = ctx.editor.getState().currentFilename;
        if (currentFile) {
          await ctx.editor.saveFile(currentFile);
          ctx.captureActiveWorkspace();
          if (frame && !workspaceOverride) ctx.syncEditorToFrame(frame); else ctx.syncEditorToAllFrames();
          return { success: true, saved: currentFile };
        }
        throw new Error('No file to save');
      }
      case 'server-info':
        return ctx.buildStatus();
      case 'describe-function': {
        const functionName = params.functionName;
        if (functionName) {
          return ctx.getFunctionDocumentation(functionName);
        }
        throw new Error('Function name required for describe-function command');
      }
      case 'describe-variable': {
        const variableName = params.variableName;
        if (variableName) {
          return ctx.getVariableDocumentation(variableName);
        }
        throw new Error('Variable name required for describe-variable command');
      }
      case 'apropos-command': {
        const pattern = params.pattern;
        if (pattern) {
          return ctx.findCommandsByPattern(pattern);
        }
        throw new Error('Pattern required for apropos-command');
      }
      case 'find-usages': {
        const funcName = params.functionName;
        if (funcName) {
          return ctx.findFunctionUsages(funcName);
        }
        throw new Error('Function name required for find-usages command');
      }
      default:
        throw new Error(`Unknown command: ${cmd}`);
      }
    } finally {
      await ctx.restoreWorkspaceAfterOverride(workspaceOverride, previousWorkspaceId, previousFrameId);
    }
  };

  // ── query ───────────────────────────────────────────────────────────────
  const query = async (params: QueryParams): Promise<QueryResult> => {
    const q = params.query;
    // N4: read-only query — do not mutate editor state via activateFrameWorkspace
    const frame = ctx.resolveFrameOptional(params);
    const frameWorkspaceId = frame?.workspaceId;
    const frameWorkspace = frameWorkspaceId && frameWorkspaceId !== ctx.getActiveWorkspaceId()
      ? ctx.workspaces.get(frameWorkspaceId)
      : undefined;
    const state = frame && frameWorkspace
      ? ctx.frameToEditorState(frame)
      : ctx.editor.getState();

    switch (q) {
      case 'buffers': {
        return frameWorkspace
          ? ctx.bufferDetailsForWorkspace(frameWorkspace, frame?.currentBufferName ?? frameWorkspace.currentBufferName)
          : ctx.editor.getBufferDetails();
      }
      case 'variables':
        // Return variables from T-Lisp interpreter
        return ctx.getTlispVariables();
      case 'keybindings':
        return state.config.keyBindings;
      case 'full-state': {
        const bufferDetails = frameWorkspace
          ? ctx.bufferDetailsForWorkspace(frameWorkspace, frame?.currentBufferName ?? frameWorkspace.currentBufferName)
          : ctx.editor.getBufferDetails();
        const currentBuffer = bufferDetails.find(buffer => buffer.current)?.name ?? null;

        return {
          buffers: bufferDetails,
          currentBuffer,
          mode: state.mode,
          variables: ctx.getTlispVariables(),
          keybindings: state.config.keyBindings,
          cursorPosition: state.cursorPosition,
          viewportTop: state.viewportTop,
          config: state.config
        };
      }
      case 'functions':
        // Query the T-Lisp interpreter for available functions
        return ctx.getTlispFunctions();
      case 'messages': {
        // SPEC-055: optional `category` filter routes through the unified store
        // (raw category) when present; otherwise the messages view (mirror rule).
        if (params?.category) {
          const store = ctx.editor.getUnifiedLog();
          return { messages: store.getEntries({ category: params.category, level: params?.level, last: params?.last }) };
        }
        const log = ctx.editor.getMessageLog();
        if (!log) return { messages: [] };
        const entries = log.getEntries({
          level: params?.level,
          last: params?.last,
        });
        return { messages: entries };
      }
      case 'log': {
        // SPEC-055: unified query across all categories with view/category/level/last filters.
        const store = ctx.editor.getUnifiedLog();
        const entries = store.getEntries({
          view: params?.view,
          category: params?.category,
          level: params?.level,
          last: params?.last,
        });
        return { entries };
      }
      case 'function-documentation': {
        const functionName = params.functionName;
        if (functionName) {
          return ctx.getFunctionDocumentation(functionName);
        }
        throw new Error('Function name required for function-documentation query');
      }
      default:
        throw new Error(`Unknown query: ${q}`);
    }
  };

  return {
    open,
    eval: evalHandler,
    command,
    query,
    insert,
    keypress,
    "save-file": saveFile,
  };
}
