/**
 * @file editor-dispatch-port.ts
 * @description CHORE-44 Change 6 — narrow interface used by key handlers
 * instead of the concrete `Editor` class (AC6.1: no handler imports editor.ts).
 *
 * Handlers normalize/route keys and invoke this dispatch surface only; they do
 * NOT make command/mode/insert-policy decisions (AC6.2/AC6.3).
 */

import type { KeyMapping } from "../key-resolution.ts";

/** The interpreter surface handlers use (execute + defineBuiltin). */
export interface HandlerInterpreter {
  execute(source: string, env?: unknown, sourceName?: string): unknown;
  executeAsync?(source: string, env?: unknown, sourceName?: string): Promise<unknown>;
  defineBuiltin(name: string, fn: unknown): unknown;
}

/** Which-key timer handle (has deactivate/schedule for cancel/reschedule). */
export interface WhichKeyHandle {
  deactivate(): void;
  schedule(prefix: string, bindings: unknown[], callback: () => void): void;
}

/** The model fields handlers read. */
export interface HandlerModel {
  commandLine: string;
  mode: string;
  currentMajorMode?: string;
  mxCommand: string;
}

/**
 * The narrow port handlers depend on. `Editor` satisfies this structurally.
 * Only methods/properties handlers actually call are listed.
 */
export interface EditorDispatchPort {
  applyUpdate(msg: unknown): void;
  escapeKeyForTLisp(key: string): string;
  executeCommand(command: string): unknown;
  executeCommandAsync(command: string): Promise<unknown>;
  getCurrentMajorMode(): string;
  getKeyMappings(): Map<string, KeyMapping[]>;
  getInterpreter(): HandlerInterpreter;
  getModel(): {
    commandLine: string;
    mxCommand: string;
    mode: string;
    whichKeyPrefix?: string;
    currentMajorMode?: string;
    cursorPosition: { line: number; column: number };
  };
  getTerminal(): { getSize(): { width: number; height: number } };
  getWhichKeyHandle(): WhichKeyHandle | null;
  logMessage(msg: string, level?: string): void;
  resetCount(): void;
  spacePressed: boolean;
}
