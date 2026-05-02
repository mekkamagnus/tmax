/**
 * @file macro-recording.ts
 * @description Vim-style keyboard macro recording functionality (US-2.4.1)
 * Supports qa (start recording), q (stop recording), @a (execute macro), @@ (execute last)
 */

import { Either } from "../../utils/task-either.ts";
import type { TLispValue } from "../../tlisp/values.ts";

/**
 * Macro recording state
 */
interface MacroRecordingState {
  isRecording: boolean;
  currentRegister: string | null;
  recordedKeys: string[];
  macros: Map<string, string[]>;  // Register -> list of keys
  lastExecutedMacro: string | null;  // Last executed macro register
}

/**
 * Global macro recording state
 */
let macroState: MacroRecordingState = {
  isRecording: false,
  currentRegister: null,
  recordedKeys: [],
  macros: new Map(),
  lastExecutedMacro: null,
};

/**
 * Reset macro recording state (for testing)
 */
export function resetMacroRecordingState(): void {
  macroState = {
    isRecording: false,
    currentRegister: null,
    recordedKeys: [],
    macros: new Map(),
    lastExecutedMacro: null,
  };
}

/**
 * Start recording a macro to a register
 * @param register - The register to record to (a-z, 0-9)
 * @returns Either error or success value
 */
export function startRecording(register: string): Either<string, string> {
  // Validate register
  if (!isValidRegister(register)) {
    return Either.left(`Invalid register: ${register}`);
  }

  // Check if already recording
  if (macroState.isRecording) {
    return Either.left(`Already recording to register ${macroState.currentRegister}`);
  }

  // Start recording
  macroState.isRecording = true;
  macroState.currentRegister = register;
  macroState.recordedKeys = [];

  return Either.right(register);
}

/**
 * Stop recording and save the macro
 * @returns Either error or success value
 */
export function stopRecording(): Either<string, string> {
  // Check if recording
  if (!macroState.isRecording) {
    return Either.left("Not recording");
  }

  // Save the macro
  const register = macroState.currentRegister!;
  macroState.macros.set(register, [...macroState.recordedKeys]);

  // Reset recording state
  macroState.isRecording = false;
  macroState.currentRegister = null;
  macroState.recordedKeys = [];

  return Either.right(register);
}

/**
 * Record a key during macro recording
 * @param key - The key to record
 * @returns Either error or success value
 */
export function recordKey(key: string): Either<string, string> {
  // Check if recording
  if (!macroState.isRecording) {
    return Either.left("Not recording");
  }

  // Record the key
  macroState.recordedKeys.push(key);

  return Either.right(key);
}

/**
 * Check if currently recording
 * @returns True if recording, false otherwise
 */
export function isRecording(): boolean {
  return macroState.isRecording;
}

/**
 * Get the current recording register
 * @returns The current register or null
 */
export function getCurrentRegister(): string | null {
  return macroState.currentRegister;
}

/**
 * Get all recorded macros
 * @returns Map of register to keys
 */
export function getMacros(): Map<string, string[]> {
  return new Map(macroState.macros);
}

/**
 * Get a specific macro
 * @param register - The register to get
 * @returns Either error or the macro keys
 */
export function getMacro(register: string): Either<string, string[]> {
  if (!macroState.macros.has(register)) {
    return Either.left(`No macro in register ${register}`);
  }

  return Either.right(macroState.macros.get(register)!);
}

/**
 * Execute a macro
 * @param register - The register to execute
 * @returns Either error or success
 */
export function executeMacro(register: string): Either<string, string> {
  // Validate register
  if (!isValidRegister(register)) {
    return Either.left(`Invalid register: ${register}`);
  }

  // Get the macro
  const macroResult = getMacro(register);
  if (Either.isLeft(macroResult)) {
    return Either.left(`No macro in register ${register}`);
  }

  // Set as last executed
  macroState.lastExecutedMacro = register;

  return Either.right(register);
}

/**
 * Execute the last executed macro
 * @returns Either error or the register executed
 */
export function executeLastMacro(): Either<string, string> {
  if (!macroState.lastExecutedMacro) {
    return Either.left("No last macro to execute");
  }

  return executeMacro(macroState.lastExecutedMacro);
}

/**
 * Get the last executed macro register
 * @returns The last executed macro register or null
 */
export function getLastExecutedMacro(): string | null {
  return macroState.lastExecutedMacro;
}

/**
 * Clear all macros
 */
export function clearAllMacros(): void {
  macroState.macros.clear();
  macroState.lastExecutedMacro = null;
}

/**
 * Clear a specific macro
 * @param register - The register to clear
 * @returns Either error or success
 */
export function clearMacro(register: string): Either<string, string> {
  if (!macroState.macros.has(register)) {
    return Either.left(`No macro in register ${register}`);
  }

  macroState.macros.delete(register);

  // Clear last executed if it was this macro
  if (macroState.lastExecutedMacro === register) {
    macroState.lastExecutedMacro = null;
  }

  return Either.right(register);
}

/**
 * Check if a register name is valid
 * @param register - The register name to check
 * @returns True if valid, false otherwise
 */
function isValidRegister(register: string): boolean {
  // Valid registers: a-z and 0-9
  return /^[a-z0-9]$/.test(register);
}

/**
 * Get the recorded keys for the current recording (for testing)
 * @returns The current recorded keys
 */
export function getRecordedKeys(): string[] {
  return [...macroState.recordedKeys];
}

/**
 * Set the last executed macro (for testing)
 * @param register - The register to set as last executed
 */
export function setLastExecutedMacro(register: string): void {
  macroState.lastExecutedMacro = register;
}

/**
 * Set a macro directly (for loading from file)
 * @param register - The register to set
 * @param keys - The keys to store
 * @returns Either error or success
 */
export function setMacro(register: string, keys: string[]): Either<string, string> {
  // Validate register
  if (!isValidRegister(register)) {
    return Either.left(`Invalid register: ${register}`);
  }

  // Set the macro
  macroState.macros.set(register, keys);

  return Either.right(register);
}
