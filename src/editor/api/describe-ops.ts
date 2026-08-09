/**
 * @file describe-ops.ts
 * @description SPEC-083 — self-documentation primitives.
 *
 * Factual introspection primitives backing the Emacs-style `describe-*`
 * command surface. Each primitive answers a factual question (what command
 * does this key run, what is this variable's value, what does this mode bind)
 * and returns a structured value; all editor LOGIC (rendering to the `*Help*`
 * buffer, minibuffer prompts, mode switching) lives in
 * `src/tlisp/core/commands/describe.tlisp`.
 *
 * These primitives deliberately do NOT mutate editor state. They read three
 * things the editor owns and threads in via accessors (mirroring the
 * `createMajorModeOps(getCurrentMajorMode)` injection pattern, since
 * `keyMappings`, `resolveCallable`, and the global environment are NOT on the
 * `EditorAPIContext`):
 *
 * - the editor's `keyMappings` map (key → KeyMapping[]),
 * - the editor's `resolveCallable(name)` callable resolver (returns the
 *   function value + module origin for a command name), and
 * - the editor's `collectVisibleGlobalBindings()` snapshot (the variable
 *   environment chain, used by `describe-variable`).
 *
 * Plus the deterministic state reads `getMode` / `getCurrentMajorMode`
 * available through {@link EditorModelAccess} / ctx callbacks.
 *
 * The existing `describe-key` / `describe-function` on `editor.ts` are
 * `defineRaw` calls; this module provides the SPEC-083-shaped primitives the
 * T-Lisp command library composes. The coordinator decides whether to alias
 * the legacy names onto these or wire them under new names — either way the
 * signatures below are the source of truth for what the T-Lisp layer calls.
 */

import type { TLispValue, TLispFunctionImpl, TLispFunction, TLispEnvironment } from "../../tlisp/types.ts";
import { createNil, createString, createList, createHashmap } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { validateArgsCount, validateArgType } from "../../utils/validation.ts";
import { createValidationError, AppError } from "../../error/types.ts";
import type { KeyMapping } from "../key-resolution.ts";
import { getDocumentation, formatDocumentation } from "./documentation.ts";

/**
 * The editor-side callable resolver result: a function value plus the module
 * it came from (when exported from a module). Mirrors the private
 * `Editor.resolveCallable` shape so the editor can pass it straight through.
 */
export interface ResolvedCallable {
  value: TLispValue;
  moduleName?: string;
}

/**
 * Injected accessors the editor supplies to {@link createDescribeOps}. Each is
 * a thin factual query; the primitives below hold no editor-specific knowledge.
 */
export interface DescribeOpsAccess {
  /** The editor's key → mappings table (read-only snapshot is fine). */
  getKeyMappings: () => Map<string, KeyMapping[]>;
  /** Resolve a command/function NAME to its function value + module origin. */
  resolveCallable: (name: string) => ResolvedCallable | undefined;
  /** Snapshot of the visible global variable bindings (name → value). */
  collectVisibleGlobalBindings: () => Map<string, TLispValue>;
  /** The raw global environment (for a single direct `lookup`). */
  globalEnv: TLispEnvironment;
  /** Current editor (minor) mode name. */
  getMode: () => string;
  /** Current buffer's major mode name (e.g. "fundamental"). */
  getCurrentMajorMode: () => string;
}

/** Regex matching a `^\(([^\s()]+)\)$` command cell, as used by callable-command-details. */
const COMMAND_CELL = /^\(([^\s()]+)\)$/;

/**
 * Pull the command NAME out of a `mapping.command` string of the form
 * `(name)`. Returns undefined for non-command-cell bindings (e.g. raw eval
 * strings the editor cannot resolve to a named callable).
 */
function commandNameOf(command: string): string | undefined {
  const match = command.match(COMMAND_CELL);
  return match?.[1];
}

/**
 * Resolve the docstring for a bound command: prefer the function value's own
 * `docstring`, fall back to the static `documentation.ts` entry's
 * `description`, then the placeholder. This is the SPEC-083 fix for the
 * previously-hardcoded "No documentation available" slot in `describe-key`.
 */
function resolveCommandDocstring(
  access: DescribeOpsAccess,
  command: string
): string {
  const name = commandNameOf(command);
  if (name) {
    const resolved = access.resolveCallable(name);
    const value = resolved?.value;
    if (value && value.type === "function") {
      const fn = value as TLispFunction;
      if (fn.docstring && fn.docstring.length > 0) return fn.docstring;
    }
    const doc = getDocumentation(name);
    if (doc) return doc.description;
  }
  return "No documentation available";
}

/**
 * Create the SPEC-083 describe-* introspection primitives.
 *
 * Each primitive validates its args, performs the factual lookup, and returns
 * a structured value. The `*Help*` rendering / minibuffer prompting is the
 * T-Lisp layer's job.
 */
export function createDescribeOps(
  access: DescribeOpsAccess
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  // Primitives use a `-data` suffix because the user-facing T-Lisp commands
  // (describe-function / describe-mode / describe-variable / describe-key) are
  // defuns in describe.tlisp that wrap these and render to *Help*. A defun and
  // a builtin cannot share a name in the global env without one shadowing the
  // other, so the primitive keeps the structured-data name and the defun owns
  // the canonical command name (SPEC-083 Completion Criteria call these out by
  // their defun names).

  // ── describe-function-data (NAME) → hashmap | nil ─────────────────────
  // Resolves a named callable and returns its name, signature, docstring, and
  // a formatted Documentation block (from documentation.ts) when one exists.
  // Wraps the existing documentation.ts DB; returns nil for an unknown name.
  api.set("describe-function-data", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const countValidation = validateArgsCount(args, 1, "describe-function-data");
    if (Either.isLeft(countValidation)) return Either.left(countValidation.left);

    const nameArg = args[0]!;
    const typeValidation = validateArgType(nameArg, "string", 0, "describe-function-data");
    if (Either.isLeft(typeValidation)) return Either.left(typeValidation.left);

    const name = nameArg.value as string;
    const resolved = access.resolveCallable(name);
    const value = resolved?.value;

    if (!value || value.type !== "function") {
      return Either.right(createNil());
    }
    const fn = value as TLispFunction;

    const displayName = fn.name || name;
    const parameters = fn.parameters ?? [];
    const docstring = fn.docstring && fn.docstring.length > 0
      ? fn.docstring
      : (getDocumentation(name)?.description ?? "No documentation available");

    const signature = resolved?.moduleName
      ? `${displayName} (${parameters.join(" ")}) — from module ${resolved.moduleName}`
      : `${displayName} (${parameters.join(" ")})`;

    const entry: [string, TLispValue][] = [
      ["name", createString(displayName)],
      ["signature", createString(signature)],
      ["docstring", createString(docstring)],
    ];
    if (fn.source) entry.push(["source", createString(fn.source)]);
    if (resolved?.moduleName) entry.push(["module", createString(resolved.moduleName)]);

    const staticDoc = getDocumentation(name);
    if (staticDoc) {
      entry.push(["documentation", createString(formatDocumentation(staticDoc))]);
      // SPEC-113 (#180) helpful-style sections: Related + Examples.
      if (staticDoc.related.length > 0) {
        entry.push(["related", createList(staticDoc.related.map(r => createString(r)))]);
      }
      if (staticDoc.examples.length > 0) {
        entry.push(["examples", createList(staticDoc.examples.map(e => createString(e)))]);
      }
    }

    // SPEC-113 (#180) helpful-style "Key Bindings" — the keys that invoke this
    // command. Bindings are full T-Lisp expressions (e.g. `(cursor-move ...)`,
    // `(progn (save-buffer ...))`), not just `(name)` cells, so we scan each
    // binding's command string for `(NAME` as the invoked command.
    const keyRe = new RegExp("\\(" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
    const keys: string[] = [];
    const seenKey = new Set<string>();
    for (const [key, mappings] of access.getKeyMappings()) {
      if (seenKey.has(key)) continue;
      for (const m of mappings) {
        if (keyRe.test(m.command)) { keys.push(key); seenKey.add(key); break; }
      }
    }
    if (keys.length > 0) entry.push(["keys", createList(keys.map(k => createString(k)))]);

    return Either.right(createHashmap(entry));
  });

  // ── describe-mode-data (&optional mode) → hashmap ─────────────────────
  // Returns the current buffer's major mode, the editor minor mode, and the
  // list of bindings active for the resolved editor mode (each entry:
  // [key command docstring]). docstring is resolved via resolveCallable +
  // documentation.ts, the same path describe-key uses.
  api.set("describe-mode-data", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 1) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        "describe-mode-data requires 0 or 1 argument: optional editor mode",
        "args", args, "0 or 1 arguments"
      ));
    }

    let editorMode: string;
    if (args.length === 1) {
      const modeArg = args[0]!;
      if (modeArg.type !== "string") {
        return Either.left(createValidationError(
          "TypeError", "describe-mode-data mode must be a string",
          "mode", String(modeArg.value), "string"
        ));
      }
      editorMode = modeArg.value as string;
    } else {
      editorMode = access.getMode();
    }

    const majorMode = access.getCurrentMajorMode();
    const keyMappings = access.getKeyMappings();

    const bindings: TLispValue[] = [];
    for (const [key, mappings] of keyMappings) {
      for (const mapping of mappings) {
        // A binding is active for the queried mode when it has no mode
        // constraint (global) or its mode matches the editor mode.
        if (mapping.mode && mapping.mode !== editorMode) continue;
        const docstring = resolveCommandDocstring(access, mapping.command);
        bindings.push(createList([
          createString(key),
          createString(mapping.command),
          createString(mapping.mode ?? editorMode),
          createString(docstring),
        ]));
      }
    }

    return Either.right(createHashmap([
      ["editor-mode", createString(editorMode)],
      ["major-mode", createString(majorMode)],
      ["bindings", createList(bindings)],
    ]));
  });

  // ── describe-variable-data (NAME) → hashmap ───────────────────────────
  // Looks NAME up in the visible global environment chain. On hit returns
  // name/value/(optional documentation); on miss returns a hashmap with
  // bound=nil so the T-Lisp layer can render "NAME is not defined".
  api.set("describe-variable-data", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const countValidation = validateArgsCount(args, 1, "describe-variable-data");
    if (Either.isLeft(countValidation)) return Either.left(countValidation.left);

    const nameArg = args[0]!;
    const typeValidation = validateArgType(nameArg, "string", 0, "describe-variable-data");
    if (Either.isLeft(typeValidation)) return Either.left(typeValidation.left);

    const name = nameArg.value as string;
    const value = access.globalEnv.lookup(name);

    if (value === undefined) {
      return Either.right(createHashmap([
        ["name", createString(name)],
        ["bound", createNil()],
      ]));
    }

    const entry: [string, TLispValue][] = [
      ["name", createString(name)],
      ["bound", createString("t")],
      ["value", value],
    ];

    const doc = getDocumentation(name);
    if (doc) {
      entry.push(["documentation", createString(doc.description)]);
    }

    return Either.right(createHashmap(entry));
  });

  // ── describe-variables-list () → list of names ────────────────────────
  // Optional helper for the `describe-variable` minibuffer: returns the names
  // of every visible global binding whose value is NOT a function (i.e. the
  // user variables), so completing-read can offer real variable names.
  api.set("describe-variables-list", (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const names: TLispValue[] = [];
    for (const [name, value] of access.collectVisibleGlobalBindings()) {
      if (value.type !== "function") names.push(createString(name));
    }
    return Either.right(createList(names));
  });

  // ── describe-key-data (KEY &optional MODE) → hashmap | nil ────────────
  // SPEC-083 fix: the docstring slot is the bound command's REAL docstring
  // (resolved via resolveCallable, falling back to documentation.ts, then the
  // placeholder), not a hardcoded "No documentation available". Named `-data`
  // so the T-Lisp describe-key defun (the user-facing command) can wrap it
  // without shadowing; the coordinator may also alias the legacy editor.ts
  // describe-key onto this implementation.
  api.set("describe-key-data", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1 || args.length > 2) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        "describe-key-data requires 1 or 2 arguments: key, optional mode",
        "args", args, "1 or 2 arguments"
      ));
    }

    const keyArg = args[0]!;
    if (keyArg.type !== "string") {
      return Either.left(createValidationError(
        "TypeError", "describe-key-data requires a string key",
        "key", String(keyArg.value), "string"
      ));
    }
    const key = keyArg.value as string;

    let mode: string | undefined;
    if (args.length === 2) {
      const modeArg = args[1]!;
      if (modeArg.type !== "string") {
        return Either.left(createValidationError(
          "TypeError", "describe-key mode must be a string",
          "mode", String(modeArg.value), "string"
        ));
      }
      mode = modeArg.value as string;
    } else {
      mode = access.getMode();
    }

    const mappings = access.getKeyMappings().get(key);
    if (!mappings || mappings.length === 0) {
      return Either.right(createNil()); // Unbound key.
    }

    // Best-match resolution: prefer the mode-specific binding, else a global
    // (mode-less) binding, else the first binding. Mirrors the legacy
    // describe-key precedence so the docstring lookup is consistent.
    let mapping = mappings.find(m => m.mode === mode);
    if (!mapping && mode) mapping = mappings.find(m => !m.mode);
    if (!mapping) mapping = mappings[0]!;

    const docstring = resolveCommandDocstring(access, mapping.command);

    return Either.right(createHashmap([
      ["command", createString(mapping.command)],
      ["key", createString(key)],
      ["mode", createString(mapping.mode ?? mode ?? "all")],
      ["docstring", createString(docstring)],
    ]));
  });

  return api;
}
