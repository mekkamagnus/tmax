/**
 * @file domain-state.ts
 * @description Per-editor session state (CHORE-44 Change 1).
 *
 * `EditorSessionState` is the single mutable, per-editor state container for
 * every deterministic session state group (kill ring, registers, yank-pop,
 * visual selection, macros, search, Dired, syntax, replace, undo/redo, and
 * the major-mode registry). It lives as a readonly nested field on
 * `EditorModel` (`model.session`) so the Elm-architecture model remains the
 * single state container; `initialModel()` seeds it via
 * `createEditorSessionState()`. Reducer spreads preserve the `model.session`
 * reference for the editor's lifetime — the ops mutate the nested objects in
 * place (the same pattern `ctx.buffers`/`ctx.foldRanges` already use).
 *
 * `EditorSession` is now a thin accessor layer: it binds the operator-style
 * factories (`bindKillRing`, `bindRegisters`, `bindYankPop`, `bindMacros`,
 * `createVisualState`) over the model-supplied `EditorSessionState` so the
 * `EditorSession` shape consumers depend on (`.killRing`, `.registers`, …)
 * keeps working without owning any separate mutable truth. Two concurrently
 * running `Editor` instances are therefore fully independent (AC1.2/AC1.3)
 * with no module globals (AC1.1).
 *
 * Non-serializable derived caches (AST/parse trees) live separately on
 * `EditorRuntimeCaches` (see runtime/caches.ts) and are never serialized.
 */

import { bindKillRing, createKillRingState } from "../api/kill-ring.ts";
import type { KillRingState, KillRingOps } from "../api/kill-ring.ts";
import { bindRegisters, createRegisterState } from "../api/evil-integration.ts";
import type { RegisterState, RegisterOps } from "../api/evil-integration.ts";
import { bindYankPop, createYankPopState } from "../api/yank-pop-ops.ts";
import type { YankPopState, YankPopOps } from "../api/yank-pop-ops.ts";
import { createVisualState } from "../api/visual-ops.ts";
import type { VisualOps, VisualSelection } from "../api/visual-ops.ts";
import { bindMacros, createMacroState } from "../api/macro-recording.ts";
import type { MacroState, MacroOps } from "../api/macro-recording.ts";
import type { Range } from "../../core/types.ts";
import type { HighlightSpan } from "../../core/types.ts";
import type { MajorModeConfig, AutoModeRule } from "../mode-state.ts";
import type { UndoRedoDomainState } from "../api/undo-redo-ops.ts";

/**
 * A simple mutable string cell (the legacy `deleteRegister` / `yankRegister`
 * module globals, now per-editor). The cell reads/writes the matching field
 * on the supplied {@link EditorSessionState} so the model remains the single
 * state container.
 */
export interface SimpleRegister {
  get(): string;
  set(text: string): void;
}

/**
 * Mutable search session state (was the factory-local `let` scalars in
 * `createSearchOps`). Bundled here so two editors hold independent searches
 * and incremental-search state.
 */
export interface SearchDomainState {
  lastSearchPattern: string;
  lastSearchDirection: "forward" | "backward";
  isearchActive: boolean;
  isearchPattern: string;
  isearchDirection: "forward" | "backward";
  isearchOriginLine: number;
  isearchOriginColumn: number;
  isearchHighlightRanges: Range[];
}

/**
 * Mutable Dired session state (was the factory-local `let` scalars in
 * `createDiredOps`). Each editor tracks its own Dired path, marked rows,
 * and hidden-file visibility.
 */
export interface DiredDomainState {
  path: string;
  markedForDelete: Set<number>;
  showHidden: boolean;
}

/**
 * Mutable syntax-highlighting session state (was the factory-local `let`
 * scalars in `createSyntaxOps`). Each editor tracks its own active language,
 * enabled flag, and stored spans.
 */
export interface SyntaxDomainState {
  activeLanguage: string;
  highlightEnabled: boolean;
  storedSpans: HighlightSpan[][];
}

/**
 * Undo/redo history entry list + cursor (matches the non-exported
 * `UndoRedoState` shape in `api/undo-redo-ops.ts`). Bundled here with the
 * loose pending/initial buffer+cursor scalars so the whole group is one
 * model-held object. The canonical type lives in
 * `api/undo-redo-ops.ts` (`UndoRedoDomainState`); re-exported here so
 * callers reading the model can name it without importing the factory module.
 */
export type { UndoRedoDomainState } from "../api/undo-redo-ops.ts";

/**
 * Mutable major-mode registry state (was the module-globals in
 * `api/major-mode-ops.ts`). Per-editor so registering a custom mode on one
 * editor never leaks into another.
 */
export interface MajorModeDomainState {
  registry: Map<string, MajorModeConfig>;
  autoModeRules: AutoModeRule[];
  fallback: string;
}

/**
 * All mutable, per-editor session state. Lives at `model.session` and is
 * mutated in place by the operator factories.
 */
export interface EditorSessionState {
  readonly killRing: KillRingState;
  readonly registers: RegisterState;
  readonly deleteRegister: { value: string };
  readonly yankRegister: { value: string };
  readonly yankPop: YankPopState;
  readonly visual: { selection: VisualSelection | null };
  readonly macros: MacroState;
  readonly search: SearchDomainState;
  readonly dired: DiredDomainState;
  readonly syntax: SyntaxDomainState;
  readonly replace: ReplaceState;
  readonly undoRedo: UndoRedoDomainState;
  readonly majorMode: MajorModeDomainState;
}

/**
 * Re-exported from replace-ops so callers can name the replace session shape
 * without importing the factory module.
 */
export interface ReplaceState {
  findPattern: string;
  replaceText: string;
  matches: { line: number; startCol: number; endCol: number }[];
  currentIndex: number;
  count: number;
  active: boolean;
}

/**
 * Construct a fresh, independent editor session state with empty subsystem
 * state for every group. `fundamental` is seeded into the major-mode registry
 * (matches the previous module-init behavior).
 */
export function createEditorSessionState(): EditorSessionState {
  return {
    killRing: createKillRingState(),
    registers: createRegisterState(),
    deleteRegister: { value: "" },
    yankRegister: { value: "" },
    yankPop: createYankPopState(),
    visual: { selection: null },
    macros: createMacroState(),
    search: {
      lastSearchPattern: "",
      lastSearchDirection: "forward",
      isearchActive: false,
      isearchPattern: "",
      isearchDirection: "forward",
      isearchOriginLine: 0,
      isearchOriginColumn: 0,
      isearchHighlightRanges: [],
    },
    dired: {
      path: "",
      markedForDelete: new Set<number>(),
      showHidden: false,
    },
    syntax: {
      activeLanguage: "",
      highlightEnabled: false,
      storedSpans: [],
    },
    replace: {
      findPattern: "",
      replaceText: "",
      matches: [],
      currentIndex: 0,
      count: 0,
      active: false,
    },
    undoRedo: {
      history: [],
      currentIndex: -1,
      initialBuffer: null,
      initialCursorLine: undefined,
      initialCursorColumn: undefined,
      pendingBuffer: null,
      pendingCursorLine: undefined,
      pendingCursorColumn: undefined,
    },
    majorMode: {
      registry: new Map<string, MajorModeConfig>([
        ["fundamental", { name: "fundamental", extensions: [] }],
      ]),
      autoModeRules: [],
      fallback: "fundamental",
    },
  };
}

function bindSimpleRegister(cell: { value: string }): SimpleRegister {
  return {
    get: () => cell.value,
    set: (text: string) => { cell.value = text; },
  };
}

/**
 * Accessor layer over a model-supplied {@link EditorSessionState}. Owns no
 * separate mutable truth — every field is bound to the matching nested state
 * group on `state`. Consumers depend on the `.killRing`, `.registers`, …
 * shape; the layer preserves it.
 */
export interface EditorSession {
  readonly killRing: KillRingOps;
  readonly registers: RegisterOps;
  readonly deleteRegister: SimpleRegister;
  readonly yankRegister: SimpleRegister;
  readonly yankPop: YankPopOps;
  readonly visual: VisualOps;
  readonly macros: MacroOps;
}

/**
 * Construct an accessor layer over the given model-held session state. Binds
 * the operator-style factories (`bindKillRing`, `bindRegisters`,
 * `bindYankPop`, `bindMacros`) over `state`, plus a fresh `VisualOps`
 * accessor holder seeded from `state.visual.selection` so external readers
 * observe the live per-editor selection.
 */
export function createEditorSession(state: EditorSessionState): EditorSession {
  const killRing = bindKillRing(state.killRing);
  const registers = bindRegisters(state.registers, killRing);
  const yankPop = bindYankPop(state.yankPop, killRing);
  // visual-ops installs per-editor get/set/clear over this holder at factory
  // construction, capturing its local selection. Seed the holder from the
  // model-held selection so the two stay in sync.
  const visual = createVisualState();
  if (state.visual.selection !== null) {
    visual.set(state.visual.selection);
  }
  // Route the visual accessors back into the model-held cell so the operator
  // factory's `set` keeps `state.visual.selection` as the source of truth.
  const visualSelectionHolder = state.visual;
  visual.get = () => visualSelectionHolder.selection;
  visual.set = (s: VisualSelection | null) => { visualSelectionHolder.selection = s; };
  visual.clear = () => { visualSelectionHolder.selection = null; };
  const macros = bindMacros(state.macros);
  return {
    killRing,
    registers,
    deleteRegister: bindSimpleRegister(state.deleteRegister),
    yankRegister: bindSimpleRegister(state.yankRegister),
    yankPop,
    visual,
    macros,
  };
}
