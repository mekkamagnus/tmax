/**
 * @file eval-ops.ts
 * @description SPEC-075 / SPEC-076 — T-Lisp evaluation primitives.
 *
 * TypeScript provides PRIMITIVES ONLY (src/editor/CLAUDE.md): this module
 * answers the factual question "what does this T-Lisp string evaluate to in
 * the live interpreter?" and "what is the source text of the sexp before
 * point?". The editor LOGIC — minibuffer flow, history, *Messages* echo,
 * result formatting — lives in `src/tlisp/core/commands/eval.tlisp`.
 *
 * The evaluation path is the SAME one the daemon `eval` RPC drives
 * (`src/server/rpc/handlers/editing.ts:151-154` → `interpreter.execute`),
 * exposed in-process here through `ctx.evalTlisp`. So a form that mutates
 * editor state — e.g. `(set-buffer-filename "/tmp/x")` — actually changes
 * state observable by the next M-x / :w, identically to `tmax -e`.
 *
 * Two primitives:
 *
 *  - `editor-eval-tlisp` (form) → hashmap { ok, value, error }.
 *    Evaluates FORM (a string) in the live interpreter. Returns a structured
 *    hashmap rather than throwing so the T-Lisp caller can branch cleanly on
 *    success vs error without try/catch. The value is rendered with the same
 *    `valueToString` the CLI/REPL use, so `(hashmap "a" 1)` / list results
 *    are readable, not `[object Object]`.
 *
 *  - `buffer-sexp-before-point` () → hashmap { ok, start, sexp } | { ok:nil, error }.
 *    Factual current-line backward scan: returns the index of the open paren
 *    that opens the balanced sexp immediately before point (within the current
 *    line) and that sexp's source text. This is a character-scanning
 *    primitive (explicitly sanctioned by src/editor/CLAUDE.md); the decision
 *    of what to do with the text (evaluate it, echo it, …) is T-Lisp.
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createString, createNumber, createBoolean, createNil, createHashmap } from "../../tlisp/values.ts";
import { valueToString } from "../../tlisp/values.ts";
import type { TextBuffer } from "../../core/contracts/buffer.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
import { Either } from "../../utils/task-either.ts";
import { validateArgsCount, validateArgType } from "../../utils/validation.ts";
import { createValidationError, type EvalError, AppError } from "../../error/types.ts";

/**
 * Dependencies the eval primitives need from the editor.
 *
 * Mirrors the `load-ops.ts` shape: `access` for deterministic model reads
 * (cursor position, current buffer), and `evalTlisp` — the live interpreter
 * entry wired by the editor runtime through `EditorAPIContext.evalTlisp`
 * (which itself routes through `Editor.executeCommand` →
 * `interpreter.execute`).
 */
export interface EvalPrimitiveDeps {
  access: EditorModelAccess;
  evalTlisp?: (expr: string) => Either<EvalError, TLispValue>;
}

/**
 * Build the eval T-Lisp primitives.
 *
 * Returns a `Map<string, TLispFunctionImpl>` following the established
 * `create*Ops` factory convention so the coordinator registers it via the
 * declarative contribution registry (`src/editor/api/registry.ts`).
 */
export function createEvalOps(deps: EvalPrimitiveDeps): Map<string, TLispFunctionImpl> {
  const getCursorLine = (): number => runModel(deps.access, readModelField("cursorPosition")).line;
  const getCursorColumn = (): number => runModel(deps.access, readModelField("cursorPosition")).column;
  const getCurrentBuffer = (): TextBuffer | null =>
    runModel(deps.access, readModelField("currentBuffer")) ?? null;
  const api = new Map<string, TLispFunctionImpl>();

  // (editor-eval-tlisp form) → hashmap { ok value error }
  //
  // Evaluates FORM (a string) against the live interpreter. Always returns
  // Either.right (a hashmap); argument/runtime errors at the primitive layer
  // become Either.left. Eval errors are reported through the hashmap's "error"
  // field so the T-Lisp accept function can branch without try/catch.
  api.set("editor-eval-tlisp", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "editor-eval-tlisp");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const formArg = args[0]!;
    const typeValidation = validateArgType(formArg, "string", 0, "editor-eval-tlisp");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const code = formArg.value as string;

    // No interpreter wired (e.g. some test contexts). Report as an eval error
    // rather than crashing so the T-Lisp layer still gets a structured reply.
    const evalFn = deps.evalTlisp;
    if (!evalFn) {
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["value", createNil()],
          ["error", createString("editor-eval-tlisp: interpreter not available")],
        ]),
      );
    }

    let result: Either<EvalError, TLispValue>;
    try {
      result = evalFn(code);
    } catch (error) {
      // Defensive: evalTlisp should return Either, never throw for a normal
      // eval error. If it does throw (e.g. EDITOR_QUIT_SIGNAL propagation),
      // surface it as a structured eval error rather than crashing the editor.
      const message = error instanceof Error ? error.message : String(error);
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["value", createNil()],
          ["error", createString(message)],
        ]),
      );
    }

    if (Either.isLeft(result)) {
      const err = result.left;
      // EvalError carries `message`; fall back to a generic label if absent.
      const message = (err && typeof err.message === "string" && err.message.length > 0)
        ? err.message
        : "T-Lisp evaluation error";
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["value", createNil()],
          ["error", createString(message)],
        ]),
      );
    }

    // Success: render the value with the same printer the CLI/REPL/daemon
    // path uses so hashmaps/lists are readable, not "[object Object]".
    const printed = valueToString(result.right);
    return Either.right(
      createHashmap([
        ["ok", createBoolean(true)],
        ["value", createString(printed)],
        ["error", createNil()],
      ]),
    );
  });

  // (buffer-sexp-before-point) → hashmap
  //   { ok t "start" <col> "end" <col> "sexp" <text> }   — found
  //   { ok nil "error" "no-sexp-before-point" }          — none on this line
  //
  // Factual current-line backward scan. Reads the line at the cursor and
  // walks left from the cursor column tracking paren depth; the sexp starts
  // at the `(` where depth returns to 0. Multi-line sexps (sexp opening on an
  // earlier line) are out of scope for this cut — SPEC-076 explicitly defers
  // them. Returns the source substring and offsets so T-Lisp owns the
  // decision of what to do with it (evaluate / echo).
  api.set("buffer-sexp-before-point", (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const buf = getCurrentBuffer();
    if (!buf) {
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["error", createString("no-current-buffer")],
        ]),
      );
    }

    const lineResult = buf.getLine(getCursorLine());
    if (Either.isLeft(lineResult)) {
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["error", createString("no-sexp-before-point")],
        ]),
      );
    }
    const line = lineResult.right;

    // The cursor's own character is included so point immediately after `)`
    // evaluates the whole form. When column == line.length (cursor at EOL),
    // start the scan from the last character.
    let i = getCursorColumn();
    if (i >= line.length) {
      i = line.length - 1;
    }
    if (i < 0) {
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["error", createString("no-sexp-before-point")],
        ]),
      );
    }

    let depth = 0;
    let start = -1;
    while (i >= 0) {
      const ch = line[i]!;
      if (ch === ")") {
        depth++;
      } else if (ch === "(") {
        if (depth === 0) {
          // Unmatched "(" (no ")" to its right at or before point) — this is
          // the start of an unclosed form. Emacs would signal "unbalanced"
          // but for the before-point scan we treat it as the sexp start.
          start = i;
          break;
        }
        depth--;
        if (depth === 0) {
          // This "(" matches the innermost ")" we passed — it is the start of
          // the balanced sexp that closes at/before point.
          start = i;
          break;
        }
      }
      i--;
    }

    if (start < 0) {
      return Either.right(
        createHashmap([
          ["ok", createBoolean(false)],
          ["error", createString("no-sexp-before-point")],
        ]),
      );
    }

    // Walk forward from `start` to find the matching close paren, so the
    // returned sexp text is the WHOLE balanced form regardless of where point
    // sits within it (point on an inner char still yields the full form).
    let end = start + 1;
    let fwdDepth = 1;
    while (end < line.length && fwdDepth > 0) {
      const ch = line[end]!;
      if (ch === "(") fwdDepth++;
      else if (ch === ")") fwdDepth--;
      end++;
    }
    // If the form never closes on this line (unbalanced), end falls through to
    // line.length; slice still returns the best-effort text.
    const sexp = line.slice(start, end);
    return Either.right(
      createHashmap([
        ["ok", createBoolean(true)],
        ["start", createNumber(start)],
        ["end", createNumber(end)],
        ["sexp", createString(sexp)],
      ]),
    );
  });

  return api;
}
