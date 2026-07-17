/**
 * @file model.ts
 * @description EditorModel — the deterministic, pure-data core of the editor
 * (Elm Architecture "model" layer).
 *
 * EditorModel is a STANDALONE immutable interface — it deliberately does NOT
 * `extend` the public `EditorState` type (src/core/types.ts). The public
 * `EditorState` is handed to callers through `getState()` / `getEditorState()`
 * and its mutable collections (`Map<string, FunctionalTextBuffer>`, etc.) and
 * non-readonly fields must NOT leak into the editor's internal state. Extending
 * `EditorState` would make this immutability contract unsound, because every
 * inherited field would stay mutable. Instead, EditorModel re-declares each
 * field it needs with `readonly` and immutable collection variants
 * (`ReadonlyMap` / `readonly T[]`).
 *
 * EditorModel is the editor's own internal working state; it is projected /
 * cloned to the public `EditorState` shape at the boundary by
 * `modelToEditorState`, so callers can never mutate internal state by retaining
 * references. Immutability is enforced at the type level (every field is
 * `readonly`), at the reducer boundary (`update` returns fresh objects via
 * spreads), and at the public boundary (`modelToEditorState` clones mutable
 * collections on egress).
 */

import type {
  EditorConfig,
  EditorState,
  FunctionalTextBuffer,
  HighlightSpan,
  JsonValue,
  LSPDiagnostic,
  MinibufferRenderView,
  Position,
  Range,
  Tab,
  WhichKeyBinding,
  Window,
} from "../../core/types.ts";
import type { EditorSessionState } from "./domain-state.ts";
import { createEditorSessionState } from "./domain-state.ts";

/**
 * Editor mode union (mirrors the `mode` field on the public `EditorState`).
 * Declared here so EditorModel is fully standalone and does not `extend`
 * EditorState.
 */
type EditorMode = 'normal' | 'insert' | 'visual' | 'command' | 'mx' | 'replace';

/**
 * Internal editor model — a standalone, fully-readonly interface. It does NOT
 * extend the public `EditorState`; each field is re-declared here with `readonly`
 * and (for collections) immutable `ReadonlyMap` / `readonly T[]` variants.
 * Sources of truth: the public `EditorState` shape plus the three model-only
 * extensions below.
 */
export interface EditorModel {
  // Scalar / object fields (mirror EditorState, all readonly)
  /** Currently-focused buffer. */
  readonly currentBuffer?: FunctionalTextBuffer;
  /** Buffer cursor position (line, column). */
  readonly cursorPosition: Position;
  /** Active editor mode. */
  readonly mode: EditorMode;
  /** Status-line message. */
  readonly statusMessage: string;
  /** Viewport vertical scroll offset. */
  readonly viewportTop: number;
  /** Viewport horizontal scroll offset. */
  readonly viewportLeft?: number;
  /** Editor configuration. */
  readonly config: EditorConfig;
  /** Current `:` command-line input. */
  readonly commandLine: string;
  /** Current M-x command input. */
  readonly mxCommand: string;
  /** Last executed command. */
  readonly lastCommand?: string;
  /** Filename associated with the current buffer. */
  readonly currentFilename?: string;
  /** Where cursor focus should be rendered. */
  readonly cursorFocus?: 'buffer' | 'command';
  /** Whether the which-key popup is currently displayed. */
  readonly whichKeyActive?: boolean;
  /** Current which-key prefix being explored. */
  readonly whichKeyPrefix?: string;
  /** Bindings for the current which-key prefix. */
  readonly whichKeyBindings?: readonly WhichKeyBinding[];
  /** Configurable which-key timeout in milliseconds (default 1000). */
  readonly whichKeyTimeout?: number;
  /** Which-key popup overlay data (mutable shape mirrors `EditorState`). */
  readonly whichKeyPopup?: { prefixLabel: string; rows: { key: string; command: string; description?: string }[][]; height: number } | null;
  /** Waiting for a key press to describe. */
  readonly describeKeyPending?: boolean;
  /** Timeout for the describe-key prompt. */
  readonly describeKeyTimeout?: number;
  /** Waiting for a function name to describe. */
  readonly describeFunctionPending?: boolean;
  /** Waiting for a search pattern for apropos. */
  readonly aproposCommandPending?: boolean;
  /** Diagnostics from the language server. */
  readonly lspDiagnostics?: readonly LSPDiagnostic[];
  /** Index of the currently focused window. */
  readonly currentWindowIndex?: number;
  /** Index of the active tab. */
  readonly currentTabIndex?: number;
  /** Active major mode name. */
  readonly currentMajorMode?: string;
  /** Active minor mode names. */
  readonly activeMinorModes?: readonly string[];
  /** Active minor mode lighter strings. */
  readonly activeMinorModeLighters?: readonly string[];
  /** Whether the current buffer has unsaved changes. */
  readonly bufferModified?: boolean;
  /** Serialized minibuffer state. */
  readonly minibufferState?: JsonValue;
  /** Minibuffer render view model. */
  readonly minibufferView?: MinibufferRenderView;

  // Collection fields → immutable variants (ReadonlyMap / readonly T[])
  /** Named buffers (immutable map). */
  readonly buffers?: ReadonlyMap<string, FunctionalTextBuffer>;
  /** Open windows (immutable array). */
  readonly windows?: readonly Window[];
  /** Open tabs (immutable array). */
  readonly tabs?: readonly Tab[];
  /** Per-line syntax-highlight spans (immutable array of arrays). */
  readonly highlightSpans?: readonly (readonly HighlightSpan[])[];
  /** Current search match ranges (immutable array). */
  readonly searchMatches?: readonly Range[];
  /** Collapsed fold ranges keyed by start line (immutable map). */
  readonly foldRanges?: ReadonlyMap<number, number>;

  // Model-only extensions (CHORE-39 Phase 4) — also readonly / immutable
  /** Vim-style count prefix accumulator. */
  readonly countPrefix: number;
  /** T-Lisp load-paths. */
  readonly loadPaths: readonly string[];
  /** Currently-loaded module name. */
  readonly currentModuleName: string | undefined;

  // CHORE-44 Change 1: per-editor deterministic session state. Readonly
  // reference to a mutable nested container (kill ring, registers, yank-pop,
  // visual, macros, search, dired, syntax, replace, undo/redo, major-mode).
  // Reducer spreads preserve this reference for the editor's lifetime so the
  // ops can mutate the nested objects in place (the same pattern
  // `ctx.buffers`/`ctx.foldRanges` already use). NOT projected into the
  // public EditorState or ingress patch — session state stays model-internal
  // and is never serialized into workspace JSON.
  readonly session: EditorSessionState;
}

/**
 * A writable view of a model patch, used while building an ingress patch
 * (`editorStateToModelPatch`) before it is returned as `Partial<EditorModel>`.
 * `Partial<EditorModel>` preserves `readonly`, so accumulating fields via
 * assignment requires stripping `readonly` locally.
 */
type WritableModelPatch = { -readonly [K in keyof EditorModel]?: EditorModel[K] };

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
    session: createEditorSessionState(),
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
  const patch: WritableModelPatch = {
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
