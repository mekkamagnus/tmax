/**
 * @file mode-state.ts
 * @description Shared mode-state types and pure helpers for buffer-local major/minor mode state.
 *
 * Major modes are file-type-specific (one per buffer).
 * Minor modes are feature-specific (any number per buffer).
 * Some minor modes can be globalized (active across all buffers).
 */

/**
 * Per-buffer mode state
 */
export interface BufferModeState {
  majorMode: string;
  activeMinorModes: string[];
  /** Order matters for key precedence: later entries shadow earlier */
  minorModeActivationOrder: string[];
  /** Source of each active minor mode. Local activations survive global disable. */
  minorModeSources: Record<string, "local" | "global">;
  /** Explicit buffer-local decisions made while a global mode is active. */
  localMinorModeOverrides: Record<string, "enabled" | "disabled">;
  /** Previous boolean config values saved by minor modes that modify config. */
  minorModeSavedConfig: Record<string, Record<string, boolean>>;
}

/**
 * Registered minor mode configuration
 */
export interface MinorModeConfig {
  name: string;
  description: string;
  lighter: string;
  /** T-Lisp keymap value name if set */
  keymap?: string;
  /** Whether this mode provides a globalized wrapper */
  global: boolean;
  /** Default initial value (false = off) */
  initValue: boolean;
  /** Hook to run on activation */
  activateHook: string;
  /** Hook to run on deactivation */
  deactivateHook: string;
}

/**
 * Registered major mode configuration
 */
export interface MajorModeConfig {
  name: string;
  /** File extensions (normalized: no leading dot) */
  extensions: string[];
  syntaxLanguage?: string;
  indentIncrease?: string[];
  indentDecrease?: string[];
  /** T-Lisp keymap value name if set */
  keymap?: string;
}

/**
 * Auto-mode rule for matching filenames to modes
 */
export interface AutoModeRule {
  /** Extension (no dot) or regexp pattern */
  pattern: string;
  /** Whether pattern is a regexp */
  isRegexp: boolean;
  /** Mode to activate */
  mode: string;
}

/**
 * Get or initialize mode state for a buffer key
 */
export function getOrCreateModeState(
  states: Map<string, BufferModeState>,
  bufferKey: string
): BufferModeState {
  let state = states.get(bufferKey);
  if (!state) {
    state = {
      majorMode: "fundamental",
      activeMinorModes: [],
      minorModeActivationOrder: [],
      minorModeSources: {},
      localMinorModeOverrides: {},
      minorModeSavedConfig: {},
    };
    states.set(bufferKey, state);
  } else {
    state.minorModeSources ??= {};
    state.localMinorModeOverrides ??= {};
    state.minorModeSavedConfig ??= {};
  }
  return state;
}

/**
 * Activate a minor mode for a buffer, preserving activation order
 */
export function activateMinorMode(
  state: BufferModeState,
  modeName: string,
  source: "local" | "global" = "local"
): BufferModeState {
  if (state.activeMinorModes.includes(modeName)) {
    return {
      ...state,
      minorModeSources: { ...state.minorModeSources, [modeName]: source },
    };
  }
  return {
    ...state,
    activeMinorModes: [...state.activeMinorModes, modeName],
    minorModeActivationOrder: [...state.minorModeActivationOrder, modeName],
    minorModeSources: { ...state.minorModeSources, [modeName]: source },
  };
}

/**
 * Deactivate a minor mode for a buffer
 */
export function deactivateMinorMode(
  state: BufferModeState,
  modeName: string
): BufferModeState {
  const nextSources = { ...state.minorModeSources };
  delete nextSources[modeName];
  return {
    ...state,
    activeMinorModes: state.activeMinorModes.filter((m) => m !== modeName),
    minorModeActivationOrder: state.minorModeActivationOrder.filter(
      (m) => m !== modeName
    ),
    minorModeSources: nextSources,
  };
}

/**
 * Apply active global minor modes to a buffer state, honoring local disables.
 */
export function applyGlobalMinorModes(
  state: BufferModeState,
  globalModes: Set<string>
): BufferModeState {
  let next = state;
  for (const modeName of globalModes) {
    if (next.localMinorModeOverrides[modeName] === "disabled") {
      continue;
    }
    if (!next.activeMinorModes.includes(modeName)) {
      next = activateMinorMode(next, modeName, "global");
    }
  }
  return next;
}

/**
 * Compute active minor-mode lighters from configs
 */
export function computeLighters(
  activeModes: string[],
  configs: Map<string, MinorModeConfig>
): string[] {
  return activeModes
    .map((name) => {
      const config = configs.get(name);
      return config ? config.lighter : "";
    })
    .filter((l) => l !== "");
}

/**
 * Normalize an extension by stripping leading dot
 */
export function normalizeExtension(ext: string): string {
  return ext.startsWith(".") ? ext.substring(1) : ext;
}
