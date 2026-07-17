/**
 * @file domain-state.ts
 * @description Per-editor session state aggregator (CHORE-44 Change 1).
 *
 * `EditorSession` bundles the mutable, per-editor session state that several
 * editor API subsystems share (kill ring, registers, delete/yank registers,
 * yank-pop, visual selection, macros). Each `Editor` constructs exactly one
 * session via `createEditorSession()` and threads it through `createEditorAPI`
 * into the relevant `create*Ops` factories, so two concurrently running editors
 * keep fully independent session state (AC1.2/AC1.3) with no module globals
 * (AC1.1).
 *
 * Non-serializable derived caches (AST/parse trees) live separately on
 * `EditorRuntimeCaches` (see runtime/caches.ts) and are never serialized.
 */

import { bindKillRing, createKillRingState } from "../api/kill-ring.ts";
import { bindRegisters, createRegisterState } from "../api/evil-integration.ts";
import { bindYankPop, createYankPopState } from "../api/yank-pop-ops.ts";
import { createVisualState } from "../api/visual-ops.ts";
import { bindMacros, createMacroState } from "../api/macro-recording.ts";
import type { KillRingOps } from "../api/kill-ring.ts";
import type { RegisterOps } from "../api/evil-integration.ts";
import type { YankPopOps } from "../api/yank-pop-ops.ts";
import type { VisualOps } from "../api/visual-ops.ts";
import type { MacroOps } from "../api/macro-recording.ts";

/**
 * A simple mutable string cell (the legacy `deleteRegister` / `yankRegister`
 * module globals, now per-editor).
 */
export interface SimpleRegister {
  get(): string;
  set(text: string): void;
}

function createSimpleRegister(): SimpleRegister {
  let value = "";
  return {
    get: () => value,
    set: (text: string) => { value = text; },
  };
}

/**
 * All mutable, per-editor session state for the coupled editor API subsystems.
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
 * Construct a fresh, independent editor session with empty subsystem state.
 */
export function createEditorSession(): EditorSession {
  const killRing = bindKillRing(createKillRingState());
  const registers = bindRegisters(createRegisterState(), killRing);
  const yankPop = bindYankPop(createYankPopState(), killRing);
  // visual-ops installs per-editor get/set/clear over this holder at factory
  // construction, capturing its local selection.
  const visual = createVisualState();
  const macros = bindMacros(createMacroState());
  return {
    killRing,
    registers,
    deleteRegister: createSimpleRegister(),
    yankRegister: createSimpleRegister(),
    yankPop,
    visual,
    macros,
  };
}
