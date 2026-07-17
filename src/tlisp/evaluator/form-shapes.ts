/**
 * @file form-shapes.ts
 * @description CHORE-44 Change 4 — pure special-form argument validation and
 * parsed form shapes shared by the synchronous and asynchronous evaluator paths
 * (AC4.1). Both `evalIf` and `evalIfAsync` (and, as further forms migrate,
 * `evalLet`/`evalLetAsync`, etc.) call these validators so argument-shape errors
 * cannot drift between the two execution modes.
 *
 * Validators are PURE: they inspect only the parsed element list and return
 * either a structured `EvalError` or a parsed shape; they never evaluate.
 */

import type { TLispValue } from "../types.ts";
import type { EvalError } from "../../error/types.ts";
import { Either } from "../../utils/task-either.ts";
import { createNil } from "../values.ts";

export type { EvalError };

/** Parsed `(if cond then [else])` shape. */
export interface IfShape {
  condition: TLispValue;
  then: TLispValue;
  else: TLispValue;
}

/** Validate an `if` form's argument shape (2–3 args: condition, then, [else]). */
export function validateIf(elements: TLispValue[]): Either<EvalError, IfShape> {
  if (elements.length < 3 || elements.length > 4) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "if requires 2-3 arguments: condition, then-expr, [else-expr]",
      details: { expected: "3-4", actual: elements.length },
    });
  }
  const conditionExpr = elements[1];
  const thenExpr = elements[2];
  const elseExpr = elements[3] ?? createNil();
  if (!conditionExpr || !thenExpr) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "if missing required arguments",
      details: { hasCondition: !!conditionExpr, hasThen: !!thenExpr, hasElse: !!elseExpr },
    });
  }
  return Either.right({ condition: conditionExpr, then: thenExpr, else: elseExpr });
}

/** Parsed let / let-star / async-let shape: bindings + body (upfront structure). */
export interface LetShape {
  isSequential: boolean;
  bindings: TLispValue;
  body: TLispValue[];
}

/**
 * Validate a `let`/`let*`/`async-let` form's UPFRONT structure (≥3 elements,
 * bindings present + a list, non-empty body). Per-binding shape validation stays
 * interleaved with evaluation in each handler (it reports errors in evaluation
 * order); only the shared upfront checks live here. The form name in the arity
 * error is derived from `elements[0]` so it is correct for all three variants.
 */
export function validateLet(elements: TLispValue[]): Either<EvalError, LetShape> {
  if (elements.length < 3) {
    const name = elements[0]?.type === "symbol" ? elements[0].value : "let";
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: `${name} requires bindings and body`,
      details: { actual: elements.length },
    });
  }
  const isSequential = elements[0]?.type === "symbol" && elements[0]?.value === "let*";
  const bindings = elements[1];
  if (!bindings) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "let missing bindings",
      details: { hasBindings: false },
    });
  }
  if (bindings.type !== "list") {
    return Either.left({
      type: "EvalError",
      variant: "TypeError",
      message: "let bindings must be a list",
      details: { bindingsType: bindings.type },
    });
  }
  const body = elements.slice(2);
  if (body.length === 0 || !body[0]) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "let missing body",
      details: { hasBody: false },
    });
  }
  return Either.right({ isSequential, bindings, body });
}
