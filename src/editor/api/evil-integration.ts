/**
 * @file evil-integration.ts
 * @description Evil Integration - Vim register system with Emacs kill ring (US-1.9.3)
 *
 * Integrates Vim's register system with Emacs' kill ring:
 * - Unnamed register (") for most recent delete/yank
 * - Register 0 for yanks only
 * - Registers 1-9 for delete history (rotate through)
 * - Named registers a-z for specific storage
 * - Register + for system clipboard
 * - All delete/yank operations also store in kill-ring
 *
 * Register Storage Layout:
 * - Index -1: Unnamed register (")
 * - Index 0: Yank register (0)
 * - Index 1-9: Numbered delete registers
 * - Index 10-35: Named registers a-z
 * - Index 36: Clipboard register (+)
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createString, createNil, createList, createHashMap } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import {
  createValidationError,
  AppError
} from "../../error/types.ts";
import { killRingSave } from "./kill-ring.ts";

/**
 * Register indices
 */
export const REGISTER_UNNAMED = -1;
export const REGISTER_YANK = 0;
export const REGISTER_NUMBERED_COUNT = 9;
export const REGISTER_NUMBERED_START = 1;
export const REGISTER_NUMBERED_END = 9;
export const REGISTER_NAMED_START = 10;
export const REGISTER_NAMED_END = 35; // 10 + 26 - 1
export const REGISTER_CLIPBOARD = 36;

/**
 * Total number of registers
 */
export const REGISTER_COUNT = 38;

/**
 * Register storage array
 * Index mapping:
 * - -1 (unused in array): Unnamed register stored separately
 * - 0: Yank register
 * - 1-9: Numbered delete registers
 * - 10-35: Named registers a-z
 * - 36: Clipboard register
 */
let registerStorage: string[] = new Array(REGISTER_COUNT).fill("");

/**
 * Unnamed register (stored separately for easy access)
 */
let unnamedRegister: string = "";

/**
 * Reset all registers to empty state
 * Useful for testing and cleanup
 */
export function resetRegisterState(): void {
  registerStorage = new Array(REGISTER_COUNT).fill("");
  unnamedRegister = "";
}

/**
 * Map register character to storage index
 * Returns -1 for unnamed register
 */
export function getRegisterIndex(register: string): number {
  if (register.length !== 1) {
    return REGISTER_UNNAMED;
  }

  const char = register[0]!;

  // Unnamed register
  if (char === '"') {
    return REGISTER_UNNAMED;
  }

  // Yank register
  if (char === '0') {
    return REGISTER_YANK;
  }

  // Numbered registers 1-9
  if (char >= '1' && char <= '9') {
    return parseInt(char, 10);
  }

  // Named registers a-z
  if (char >= 'a' && char <= 'z') {
    return REGISTER_NAMED_START + (char.charCodeAt(0) - 'a'.charCodeAt(0));
  }

  // Named registers A-Z (append to lowercase)
  if (char >= 'A' && char <= 'Z') {
    return REGISTER_NAMED_START + (char.charCodeAt(0) - 'A'.charCodeAt(0));
  }

  // Clipboard register
  if (char === '+') {
    return REGISTER_CLIPBOARD;
  }

  return REGISTER_UNNAMED;
}

/**
 * Get content from a register
 * @param register - Register name (e.g., '"', '0', 'a', '+')
 * @returns Register content or empty string if not set
 */
export function getRegister(register: string): string {
  const index = getRegisterIndex(register);

  if (index === REGISTER_UNNAMED) {
    return unnamedRegister;
  }

  if (index >= 0 && index < registerStorage.length) {
    return registerStorage[index]!;
  }

  return "";
}

/**
 * Set content in a register
 * @param register - Register name (e.g., '"', '0', 'a', '+', 'A' to append to 'a')
 * @param content - Content to store
 * @param append - If true, append to existing content (auto-detected for uppercase)
 */
export function setRegister(register: string, content: string, append: boolean = false): void {
  const index = getRegisterIndex(register);

  // Auto-detect uppercase for append mode
  const isUppercase = register.length === 1 && register[0]! >= 'A' && register[0]! <= 'Z';
  const shouldAppend = append || isUppercase;

  if (index === REGISTER_UNNAMED) {
    unnamedRegister = content;
    return;
  }

  if (index >= 0 && index < registerStorage.length) {
    if (shouldAppend) {
      registerStorage[index] = registerStorage[index]! + content;
    } else {
      registerStorage[index] = content;
    }
  }
}

/**
 * Store yanked text in registers
 * - Stores in unnamed register (")
 * - Stores in yank register (0)
 * - Stores in kill-ring
 * @param text - Yanked text
 */
export function registerYank(text: string): void {
  // Store in unnamed register
  unnamedRegister = text;

  // Store in yank register (0)
  registerStorage[REGISTER_YANK] = text;

  // Store in kill-ring
  killRingSave(text);
}

/**
 * Store deleted text in registers
 * - Stores in unnamed register (")
 * - If line delete, shifts numbered registers and stores in register 1
 * - Stores in kill-ring
 * @param text - Deleted text
 * @param isLineDelete - True if this is a line delete (dd), false for other deletes
 */
export function registerDelete(text: string, isLineDelete: boolean = false): void {
  // Store in unnamed register
  unnamedRegister = text;

  // If line delete, use numbered registers
  if (isLineDelete) {
    // Shift registers 1-8 down (1->2, 2->3, ..., 8->9)
    for (let i = REGISTER_NUMBERED_END; i > REGISTER_NUMBERED_START; i--) {
      registerStorage[i] = registerStorage[i - 1]!;
    }

    // Store in register 1
    registerStorage[REGISTER_NUMBERED_START] = text;
  }

  // Store in kill-ring
  killRingSave(text);
}

/**
 * Paste from a register
 * @param register - Register name (e.g., '"', '0', 'a', '+')
 * @returns Register content
 */
export function registerPaste(register: string): string {
  return getRegister(register);
}

/**
 * Create Evil Integration API functions for T-Lisp
 * @returns Map of function names to implementations
 */
export function createEvilIntegrationOps(): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * get-register - get content from a register
   * Usage: (get-register "a") or (get-register "+")
   */
  api.set("get-register", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'get-register requires 1 argument: register name',
        'args',
        args,
        '1 argument'
      ));
    }

    const registerArg = args[0];
    if (registerArg.type !== 'string') {
      return Either.left(createValidationError(
        'TypeError',
        'get-register argument must be a string',
        'args[0]',
        registerArg,
        'string'
      ));
    }

    const register = registerArg.value;
    const content = getRegister(register);

    return Either.right(createString(content));
  });

  /**
   * set-register - set content in a register
   * Usage: (set-register "a" "text") or (set-register "+" "clipboard")
   */
  api.set("set-register", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 2) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'set-register requires 2 arguments: register name and content',
        'args',
        args,
        '2 arguments'
      ));
    }

    const registerArg = args[0];
    if (registerArg.type !== 'string') {
      return Either.left(createValidationError(
        'TypeError',
        'set-register first argument must be a string (register name)',
        'args[0]',
        registerArg,
        'string'
      ));
    }

    const contentArg = args[1];
    if (contentArg.type !== 'string') {
      return Either.left(createValidationError(
        'TypeError',
        'set-register second argument must be a string (content)',
        'args[1]',
        contentArg,
        'string'
      ));
    }

    const register = registerArg.value;
    const content = contentArg.value;

    // Check if uppercase (append mode)
    const isAppend = register.length === 1 &&
                     register[0]! >= 'A' &&
                     register[0]! <= 'Z';

    setRegister(register, content, isAppend);

    return Either.right(createNil());
  });

  /**
   * register-get - alias for get-register
   * Usage: (register-get "a")
   */
  api.set("register-get", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'register-get requires 1 argument: register name',
        'args',
        args,
        '1 argument'
      ));
    }

    const registerArg = args[0];
    if (registerArg.type !== 'string') {
      return Either.left(createValidationError(
        'TypeError',
        'register-get argument must be a string',
        'args[0]',
        registerArg,
        'string'
      ));
    }

    const register = registerArg.value;
    const content = getRegister(register);

    return Either.right(createString(content));
  });

  /**
   * register-set - set content in a register
   * Usage: (register-set "a" "text")
   */
  api.set("register-set", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 2) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'register-set requires 2 arguments: register name and content',
        'args',
        args,
        '2 arguments'
      ));
    }

    const registerArg = args[0];
    if (registerArg.type !== 'string') {
      return Either.left(createValidationError(
        'TypeError',
        'register-set first argument must be a string (register name)',
        'args[0]',
        registerArg,
        'string'
      ));
    }

    const contentArg = args[1];
    if (contentArg.type !== 'string') {
      return Either.left(createValidationError(
        'TypeError',
        'register-set second argument must be a string (content)',
        'args[1]',
        contentArg,
        'string'
      ));
    }

    const register = registerArg.value;
    const content = contentArg.value;

    // Check if uppercase (append mode)
    const isAppend = register.length === 1 &&
                     register[0]! >= 'A' &&
                     register[0]! <= 'Z';

    setRegister(register, content, isAppend);

    return Either.right(createNil());
  });

  /**
   * yank-delete-store - store text in specific register (for testing)
   * Usage: (yank-delete-store "a" "text")
   */
  api.set("yank-delete-store", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 2) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'yank-delete-store requires 2 arguments: register name and content',
        'args',
        args,
        '2 arguments'
      ));
    }

    const registerArg = args[0];
    if (registerArg.type !== 'string') {
      return Either.left(createValidationError(
        'TypeError',
        'yank-delete-store first argument must be a string (register name)',
        'args[0]',
        registerArg,
        'string'
      ));
    }

    const contentArg = args[1];
    if (contentArg.type !== 'string') {
      return Either.left(createValidationError(
        'TypeError',
        'yank-delete-store second argument must be a string (content)',
        'args[1]',
        contentArg,
        'string'
      ));
    }

    const register = registerArg.value;
    const content = contentArg.value;

    setRegister(register, content);

    return Either.right(createNil());
  });

  /**
   * register-list - list all registers and their contents
   * Usage: (register-list)
   */
  api.set("register-list", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'register-list requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    // Build list of register entries
    const entries: TLispValue[] = [];

    // Unnamed register
    if (unnamedRegister) {
      entries.push(createString(`": ${unnamedRegister}`));
    }

    // Yank register
    if (registerStorage[REGISTER_YANK]) {
      entries.push(createString(`0: ${registerStorage[REGISTER_YANK]}`));
    }

    // Numbered registers
    for (let i = REGISTER_NUMBERED_START; i <= REGISTER_NUMBERED_END; i++) {
      if (registerStorage[i]) {
        entries.push(createString(`${i}: ${registerStorage[i]}`));
      }
    }

    // Named registers
    for (let i = 0; i < 26; i++) {
      const content = registerStorage[REGISTER_NAMED_START + i];
      if (content) {
        const char = String.fromCharCode('a'.charCodeAt(0) + i);
        entries.push(createString(`${char}: ${content}`));
      }
    }

    // Clipboard register
    if (registerStorage[REGISTER_CLIPBOARD]) {
      entries.push(createString(`+: ${registerStorage[REGISTER_CLIPBOARD]}`));
    }

    return Either.right(createList(entries));
  });

  /**
   * paste-from-register - paste from a specific register
   * Usage: (paste-from-register "a")
   */
  api.set("paste-from-register", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'paste-from-register requires 1 argument: register name',
        'args',
        args,
        '1 argument'
      ));
    }

    const registerArg = args[0];
    if (registerArg.type !== 'string') {
      return Either.left(createValidationError(
        'TypeError',
        'paste-from-register argument must be a string',
        'args[0]',
        registerArg,
        'string'
      ));
    }

    const register = registerArg.value;
    const content = registerPaste(register);

    // Return content (actual pasting is done by caller)
    return Either.right(createString(content));
  });

  return api;
}
