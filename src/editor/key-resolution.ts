/** A single key→command mapping with optional mode/major-mode constraints. */
export interface KeyMapping {
  key: string;
  command: string;
  mode?: "normal" | "insert" | "visual" | "command" | "mx" | "replace";
  majorMode?: string;
}

/**
 * Resolve the best key mapping from candidates, considering editor mode
 * and major mode. Precedence: mode+majorMode > mode > majorMode > global.
 * (CHORE-44 Change 6: moved from editor.ts so handlers don't import editor.ts — AC6.1)
 */
export function resolveMapping(
  mappings: KeyMapping[],
  editorMode: string,
  currentMajorMode?: string,
): KeyMapping | undefined {
  if (currentMajorMode) {
    const exact = mappings.find(m => m.mode === editorMode && m.majorMode === currentMajorMode);
    if (exact) return exact;
  }
  const modeOnly = mappings.find(m => m.mode === editorMode && !m.majorMode);
  if (modeOnly) return modeOnly;
  if (currentMajorMode) {
    const majorOnly = mappings.find(m => !m.mode && m.majorMode === currentMajorMode);
    if (majorOnly) return majorOnly;
  }
  return mappings.find(m => !m.mode && !m.majorMode);
}

export interface KeyBindingCandidate {
  key: string;
  command: string;
  source: "modal" | "minor" | "major" | "mode" | "global";
  sourceMode?: string;
  documentation?: string;
}

export interface KeyResolutionContext {
  modalBindings?: KeyBindingCandidate[];
  activeMinorModes?: string[];
  minorModeBindings?: Record<string, Record<string, string>>;
  currentMajorMode?: string;
  majorModeBindings?: Record<string, Record<string, string>>;
  modeBindings?: Record<string, string>;
  globalBindings?: Record<string, string>;
}

export interface KeyResolutionResult {
  command: string;
  source: KeyBindingCandidate["source"];
  sourceMode?: string;
  documentation?: string;
}

export const resolveKeyBinding = (
  context: KeyResolutionContext,
  key: string
): KeyResolutionResult | null => {
  const modal = context.modalBindings?.find((binding) => binding.key === key);
  if (modal) {
    return {
      command: modal.command,
      source: modal.source,
      sourceMode: modal.sourceMode,
      documentation: modal.documentation,
    };
  }

  for (const mode of [...(context.activeMinorModes ?? [])].reverse()) {
    const command = context.minorModeBindings?.[mode]?.[key];
    if (command) return { command, source: "minor", sourceMode: mode };
  }

  const major = context.currentMajorMode
    ? context.majorModeBindings?.[context.currentMajorMode]?.[key]
    : undefined;
  if (major) {
    return { command: major, source: "major", sourceMode: context.currentMajorMode };
  }

  const modeCommand = context.modeBindings?.[key];
  if (modeCommand) return { command: modeCommand, source: "mode" };

  const globalCommand = context.globalBindings?.[key];
  if (globalCommand) return { command: globalCommand, source: "global" };

  return null;
};
