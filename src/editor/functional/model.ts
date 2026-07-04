/**
 * @file model.ts
 * @description EditorModel — the deterministic, pure-data core of the editor
 * (Elm Architecture "model" layer).
 *
 * EditorModel is intentionally SEPARATE from the public `EditorState` type
 * (src/core/types.ts). The public `EditorState` is handed to callers through
 * `getState()` / `getEditorState()` and its mutable collections
 * (e.g. `Map<string, FunctionalTextBuffer>`) must NOT be shared with internal
 * state. EditorModel is the editor's own internal working state; it is
 * projected/cloned to the public `EditorState` shape at the boundary by
 * `modelToEditorState`, so callers can never mutate internal state by
 * retaining references.
 *
 * EditorModel mirrors the EditorState field shape (the deterministic fields
 * that live in the editor's state object). Deterministic editor-internal
 * fields that the State-monad API primitives need (countPrefix, …) are added
 * here as they are migrated (CHORE-39 Phase 4). Other editor-internal fields
 * that are NOT part of the public state object and not yet migrated
 * (keyMappings, bufferModeStates, etc.) remain as separate private fields on
 * the Editor runtime. Immutability/isolation is enforced at the reducer
 * boundary (`update` returns fresh objects via spreads) and the public
 * boundary (`modelToEditorState` clones mutable collections on egress).
 */

import type { EditorState } from "../../core/types.ts";

/**
 * Internal editor model — structurally mirrors the public EditorState but is
 * a distinct nominal type used inside the editor.
 */
export interface EditorModel extends EditorState {
  /** Vim-style count prefix accumulator (CHORE-39 Phase 4 model extension). */
  countPrefix: number;
  /** T-Lisp load-paths (CHORE-39 Phase 4 model extension). */
  loadPaths: string[];
  /** Currently-loaded module name (CHORE-39 Phase 4 model extension). */
  currentModuleName: string | undefined;
}

/**
 * Build an initial model mirroring the Editor constructor's deterministic
 * field defaults. No terminal/filesystem parameters — those are impure runtime
 * dependencies owned by the EditorRuntime.
 */
export function initialModel(options?: { readonly initFilePath?: string }): EditorModel {
  return {
    cursorPosition: { line: 0, column: 0 },
    mode: "normal",
    statusMessage: "Welcome to tmax",
    viewportTop: 0,
    viewportLeft: 0,
    config: {
      theme: "default",
      tabSize: 4,
      autoSave: false,
      keyBindings: {},
      maxUndoLevels: 100,
      showLineNumbers: true,
      relativeLineNumbers: false,
      wordWrap: false,
    },
    commandLine: "",
    mxCommand: "",
    currentFilename: undefined,
    buffers: new Map(),
    cursorFocus: "buffer",
    whichKeyActive: false,
    whichKeyPrefix: "",
    whichKeyBindings: [],
    whichKeyTimeout: 1000,
    lspDiagnostics: [],
    windows: [],
    currentWindowIndex: 0,
    tabs: [],
    currentTabIndex: 0,
    highlightSpans: [],
    foldRanges: new Map(),
    countPrefix: 0,
    loadPaths: [],
    currentModuleName: undefined,
  };
}

function cloneWindow(w: NonNullable<EditorState["windows"]>[number]): NonNullable<EditorState["windows"]>[number] {
  return { ...w };
}

/**
 * Boundary adapter: project the internal model into a FRESH public
 * `EditorState`, cloning mutable collection fields so callers cannot mutate
 * internal model state by retaining references. Used by `getEditorState()` /
 * `getState()` and the render path.
 */
export function modelToEditorState(model: EditorModel): EditorState {
  return {
    currentBuffer: model.currentBuffer,
    cursorPosition: { ...model.cursorPosition },
    mode: model.mode,
    statusMessage: model.statusMessage,
    viewportTop: model.viewportTop,
    viewportLeft: model.viewportLeft,
    config: { ...model.config, keyBindings: { ...model.config.keyBindings } },
    commandLine: model.commandLine,
    mxCommand: model.mxCommand,
    lastCommand: model.lastCommand,
    currentFilename: model.currentFilename,
    buffers: new Map(model.buffers ?? new Map()),
    cursorFocus: model.cursorFocus,
    whichKeyActive: model.whichKeyActive,
    whichKeyPrefix: model.whichKeyPrefix,
    whichKeyBindings: model.whichKeyBindings ? [...model.whichKeyBindings] : undefined,
    whichKeyTimeout: model.whichKeyTimeout,
    whichKeyPopup: model.whichKeyPopup,
    describeKeyPending: model.describeKeyPending,
    describeKeyTimeout: model.describeKeyTimeout,
    describeFunctionPending: model.describeFunctionPending,
    aproposCommandPending: model.aproposCommandPending,
    lspDiagnostics: model.lspDiagnostics ? [...model.lspDiagnostics] : undefined,
    windows: model.windows ? model.windows.map(cloneWindow) : undefined,
    currentWindowIndex: model.currentWindowIndex,
    tabs: model.tabs ? model.tabs.map(t => ({ ...t })) : undefined,
    currentTabIndex: model.currentTabIndex,
    highlightSpans: model.highlightSpans ? model.highlightSpans.map(spans => [...spans]) : undefined,
    searchMatches: model.searchMatches ? [...model.searchMatches] : undefined,
    currentMajorMode: model.currentMajorMode,
    activeMinorModes: model.activeMinorModes ? [...model.activeMinorModes] : undefined,
    activeMinorModeLighters: model.activeMinorModeLighters ? [...model.activeMinorModeLighters] : undefined,
    bufferModified: model.bufferModified,
    minibufferState: model.minibufferState,
    minibufferView: model.minibufferView,
    foldRanges: new Map(model.foldRanges ?? new Map()),
  };
}

/**
 * Ingress adapter: copy caller-owned public `EditorState` values into a model
 * patch WITHOUT retaining caller-owned Map/array/object references. Used by
 * `setEditorState(external)`.
 */
export function editorStateToModelPatch(external: EditorState): Partial<EditorModel> {
  const patch: Partial<EditorModel> = {
    cursorPosition: { ...external.cursorPosition },
    mode: external.mode,
    statusMessage: external.statusMessage,
    viewportTop: external.viewportTop,
    viewportLeft: external.viewportLeft ?? 0,
    config: { ...external.config, keyBindings: { ...external.config.keyBindings } },
    commandLine: external.commandLine,
    mxCommand: external.mxCommand,
    currentFilename: external.currentFilename,
    cursorFocus: external.cursorFocus,
    whichKeyActive: external.whichKeyActive ?? false,
    whichKeyPrefix: external.whichKeyPrefix ?? "",
    whichKeyTimeout: external.whichKeyTimeout ?? 1000,
    describeKeyPending: external.describeKeyPending,
    describeFunctionPending: external.describeFunctionPending,
    aproposCommandPending: external.aproposCommandPending,
    currentWindowIndex: external.currentWindowIndex,
    currentTabIndex: external.currentTabIndex,
    bufferModified: external.bufferModified,
    minibufferState: external.minibufferState,
    minibufferView: external.minibufferView,
    currentMajorMode: external.currentMajorMode,
  };

  if (external.buffers !== undefined) patch.buffers = new Map(external.buffers);
  if (external.windows !== undefined) patch.windows = external.windows.map(cloneWindow);
  if (external.tabs !== undefined) patch.tabs = external.tabs.map(t => ({ ...t }));
  if (external.highlightSpans !== undefined) patch.highlightSpans = external.highlightSpans.map(spans => [...spans]);
  if (external.activeMinorModes !== undefined) patch.activeMinorModes = [...external.activeMinorModes];
  if (external.activeMinorModeLighters !== undefined) patch.activeMinorModeLighters = [...external.activeMinorModeLighters];
  if (external.searchMatches !== undefined) patch.searchMatches = [...external.searchMatches];
  if (external.foldRanges !== undefined) patch.foldRanges = new Map(external.foldRanges);
  if (external.whichKeyBindings !== undefined) patch.whichKeyBindings = [...external.whichKeyBindings];
  if (external.lspDiagnostics !== undefined) patch.lspDiagnostics = [...external.lspDiagnostics];
  if (external.currentBuffer !== undefined) patch.currentBuffer = external.currentBuffer;
  if (external.lastCommand !== undefined) patch.lastCommand = external.lastCommand;

  return patch;
}
