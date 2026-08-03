/**
 * @file occur-ops.ts
 * @description occur listing source-buffer bookkeeping (SPEC-082)
 *
 * The `occur` command (T-Lisp, `src/tlisp/core/commands/occur.tlisp`) gathers
 * every line matching a pattern into a navigable `*Occur*` buffer. The match
 * finding (`search-find-all-matches`), line reading (`buffer-line`), and source
 * jump (`jump-to-line`) all live in existing modules. The ONE piece that cannot
 * be computed from existing primitives is the *occur-buffer ↔ source-buffer*
 * mapping: when the user presses RET inside `*Occur*`, `occur-jump` must know
 * which buffer to switch back to before jumping. That mapping is module state
 * keyed by occur-buffer name.
 *
 * Per `src/editor/CLAUDE.md` this module is PRIMITIVES ONLY — it records and
 * returns the source-buffer name; it makes no editor decisions (no search, no
 * formatting, no jumping). Editor logic lives in T-Lisp.
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createString, createNil } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import {
  validateArgsCount,
  validateArgType,
} from "../../utils/validation.ts";
import {
  createValidationError,
  AppError,
} from "../../error/types.ts";

/** Canonical `*Occur*` buffer name. */
export const OCCUR_BUFFER_NAME = "*Occur*";

/**
 * Create occur operations API functions.
 *
 * Holds a module-internal `Map<occur-buf-name, source-buf-name>` so `occur-jump`
 * can recover the source buffer after `occur` built the listing. The map is
 * owned by this factory closure (per-editor, AC7.5: no module-global mutable
 * state participates in contribution construction).
 *
 * @returns Map of occur primitive names to implementations.
 */
export function createOccurOps(): Map<string, TLispFunctionImpl> {
  // occur-buffer-name → source-buffer-name. Defaults *Occur* → "" (no source
  // yet). A single *Occur* buffer is reused across runs, so one entry covers
  // the normal case; the map keyed-by-name allows multiple occur buffers in
  // principle.
  const sourceMap = new Map<string, string>();
  if (!sourceMap.has(OCCUR_BUFFER_NAME)) {
    sourceMap.set(OCCUR_BUFFER_NAME, "");
  }

  const api = new Map<string, TLispFunctionImpl>();

  /**
   * occur-set-source (occur-buf-name source-buf-name) — record that the occur
   * buffer OCUR-BUF-NAME was built from SOURCE-BUF-NAME. Called by `occur`
   * after it (re)builds the `*Occur*` body. Returns OCUR-BUF-NAME.
   *
   * Not a user command (no docstring) — stays out of M-x.
   */
  api.set("occur-set-source", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "occur-set-source");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const occurNameArg = args[0]!;
    const occurNameType = validateArgType(occurNameArg, "string", 0, "occur-set-source");
    if (Either.isLeft(occurNameType)) {
      return Either.left(occurNameType.left);
    }

    const sourceNameArg = args[1]!;
    const sourceNameType = validateArgType(sourceNameArg, "string", 1, "occur-set-source");
    if (Either.isLeft(sourceNameType)) {
      return Either.left(sourceNameType.left);
    }

    const occurName = occurNameArg.value as string;
    const sourceName = sourceNameArg.value as string;
    sourceMap.set(occurName, sourceName);

    return Either.right(createString(occurName));
  });

  /**
   * occur-source-get (&optional occur-buf-name) — return the source buffer
   * name recorded for the occur buffer OCUR-BUF-NAME, or nil if none.
   *
   * Default resolution: when called with no argument, look up the canonical
   * `*Occur*` buffer. This matches `occur-jump`'s normal case (it runs inside
   * `*Occur*`).
   *
   * Not a user command (no docstring) — stays out of M-x.
   */
  api.set("occur-source-get", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'occur-source-get requires 0 or 1 argument: optional occur-buffer name',
        'args',
        args.length,
        '0 or 1 arguments',
      ));
    }

    let occurName = OCCUR_BUFFER_NAME;
    if (args.length === 1) {
      const nameArg = args[0]!;
      // Accept nil as "use default *Occur*" so T-Lisp can pass the current
      // buffer name without a guard when it isn't *Occur*.
      if (nameArg.type !== "string" && nameArg.type !== "nil") {
        return Either.left(createValidationError(
          'TypeError',
          'occur-source-get occur-buffer name must be a string',
          'occurBufName',
          nameArg,
          'string',
        ));
      }
      if (nameArg.type === "string") {
        occurName = nameArg.value as string;
      }
    }

    const source = sourceMap.get(occurName);
    if (source === undefined || source === "") {
      return Either.right(createNil());
    }
    return Either.right(createString(source));
  });

  /**
   * occur-buffer-name — return the canonical `*Occur*` buffer name.
   *
   * Exposed so the T-Lisp layer does not hardcode the string literal in two
   * places (the build side and the jump side); renaming the buffer only needs
   * one edit here. Not a user command (no docstring) — stays out of M-x.
   */
  api.set("occur-buffer-name", (_args: TLispValue[]): Either<AppError, TLispValue> => {
    if (_args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'occur-buffer-name takes no arguments',
        'args',
        _args.length,
        '0 arguments',
      ));
    }
    return Either.right(createString(OCCUR_BUFFER_NAME));
  });

  return api;
}
