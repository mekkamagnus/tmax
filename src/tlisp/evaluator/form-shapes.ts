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
 *
 * Every validator here MUST be called from BOTH the sync and async handlers
 * for the corresponding form. Validation-error messages, variants, and
 * `details` shapes are part of the observable contract (covered by
 * `test/unit/evaluator-sync-async-parity.test.ts`); changing them is a
 * behavior change, not a refactor.
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

/** Parsed `quote`/`quasiquote` shape: exactly 1 argument. */
export interface OneArgShape {
  expr: TLispValue;
}

/**
 * Validate a `quote` form's argument shape (exactly 1 argument). The same
 * shape is used by `quasiquote` via {@link validateQuasiquote}. This mirrors
 * the historical error message/variant of `evalQuote` byte-for-byte.
 */
export function validateQuote(elements: TLispValue[]): Either<EvalError, OneArgShape> {
  if (elements.length !== 2) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "quote requires exactly 1 argument",
      details: { expected: 2, actual: elements.length },
    });
  }
  const expr = elements[1];
  if (!expr) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "quote missing argument",
      details: { elements },
    });
  }
  return Either.right({ expr });
}

/**
 * Validate a `quasiquote` form's argument shape (exactly 1 argument). Mirrors
 * the historical error message/variant of `evalQuasiquote` byte-for-byte.
 */
export function validateQuasiquote(elements: TLispValue[]): Either<EvalError, OneArgShape> {
  if (elements.length !== 2) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "quasiquote requires exactly 1 argument",
      details: { expected: 2, actual: elements.length },
    });
  }
  const expr = elements[1];
  if (!expr) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "quasiquote missing argument",
      details: { elements },
    });
  }
  return Either.right({ expr });
}

/** Parsed `cond` shape: ≥1 clause, every clause is a 2-element list. */
export interface CondShape {
  clauses: { condition: TLispValue; expression: TLispValue }[];
}

/**
 * Validate a `cond` form's argument shape (≥1 clause; every clause is a list
 * with exactly 2 elements: condition + expression). Mirrors the historical
 * error messages/variants of `evalCond` byte-for-byte.
 */
export function validateCond(elements: TLispValue[]): Either<EvalError, CondShape> {
  if (elements.length < 2) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "cond requires at least 1 clause",
      details: { expectedMin: 2, actual: elements.length },
    });
  }
  const clauses: { condition: TLispValue; expression: TLispValue }[] = [];
  for (let i = 1; i < elements.length; i++) {
    const clause = elements[i];
    if (!clause) {
      return Either.left({
        type: "EvalError",
        variant: "SyntaxError",
        message: "cond clause missing",
        details: { clauseIndex: i },
      });
    }
    if (clause.type !== "list") {
      return Either.left({
        type: "EvalError",
        variant: "TypeError",
        message: "cond clause must be a list",
        details: { clauseType: clause.type, clauseIndex: i },
      });
    }
    const clauseElements = clause.value as TLispValue[];
    if (clauseElements.length !== 2) {
      return Either.left({
        type: "EvalError",
        variant: "SyntaxError",
        message: "cond clause must have exactly 2 elements: condition and expression",
        details: { expected: 2, actual: clauseElements.length, clauseIndex: i },
      });
    }
    const condition = clauseElements[0];
    const expression = clauseElements[1];
    if (!condition || !expression) {
      return Either.left({
        type: "EvalError",
        variant: "SyntaxError",
        message: "cond clause missing condition or expression",
        details: { clauseIndex: i, hasCondition: !!condition, hasExpression: !!expression },
      });
    }
    clauses.push({ condition, expression });
  }
  return Either.right({ clauses });
}

/** Parsed `progn`/`and`/`or` shape: any number of body expressions. */
export interface BodyShape {
  body: TLispValue[];
}

/**
 * Validate a `progn` form's argument shape. progn accepts any number of
 * arguments (including zero, which yields nil); the validator therefore never
 * fails and exists for symmetry + future tightening. It returns the body
 * expressions (everything after the form symbol).
 */
export function validateProgn(elements: TLispValue[]): Either<EvalError, BodyShape> {
  return Either.right({ body: elements.slice(1) });
}

/**
 * Validate an `and` form's argument shape. `and` accepts any number of
 * arguments; the validator returns the body expressions for symmetry with
 * {@link validateProgn}.
 */
export function validateAnd(elements: TLispValue[]): Either<EvalError, BodyShape> {
  return Either.right({ body: elements.slice(1) });
}

/**
 * Validate an `or` form's argument shape. `or` accepts any number of arguments;
 * the validator returns the body expressions for symmetry with
 * {@link validateProgn}.
 */
export function validateOr(elements: TLispValue[]): Either<EvalError, BodyShape> {
  return Either.right({ body: elements.slice(1) });
}

/** Parsed `while` shape: test expression + non-empty body. */
export interface WhileShape {
  test: TLispValue;
  body: TLispValue[];
}

/**
 * Validate a `while` form's argument shape (≥1 test + ≥1 body form). Mirrors
 * the historical error message/variant of `evalWhile` byte-for-byte.
 */
export function validateWhile(elements: TLispValue[]): Either<EvalError, WhileShape> {
  if (elements.length < 3) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "while requires test and body",
      details: { actual: elements.length },
    });
  }
  const test = elements[1]!;
  const body = elements.slice(2);
  return Either.right({ test, body });
}

/** Parsed `dolist` shape: binding var + list expression + body. */
export interface DolistShape {
  varName: TLispValue;
  listExpr: TLispValue;
  body: TLispValue[];
}

/**
 * Validate a `dolist` form's argument shape. The binding spec must be a list
 * of `(var list-expr)` and `var` must be a symbol. Mirrors the historical
 * error messages/variants of `evalDolist` byte-for-byte.
 */
export function validateDolist(elements: TLispValue[]): Either<EvalError, DolistShape> {
  if (elements.length < 2) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "dolist requires a binding spec and optional body",
      details: { actual: elements.length },
    });
  }
  const spec = elements[1]!;
  if (spec.type !== "list") {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "dolist binding spec must be a list: (var list)",
      details: { actual: spec.type },
    });
  }
  const specParts = spec.value as TLispValue[];
  if (specParts.length < 2) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "dolist binding spec requires (var list)",
      details: { actual: specParts.length },
    });
  }
  const varName = specParts[0]!;
  if (varName.type !== "symbol") {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "dolist variable must be a symbol",
      details: { actual: varName.type },
    });
  }
  const listExpr = specParts[1]!;
  const body = elements.slice(2);
  return Either.right({ varName, listExpr, body });
}

/** Parsed function-definition shape (defun/lambda share this). */
export interface FunctionDefShape {
  /** Defined name symbol (absent for anonymous `lambda`). */
  name?: TLispValue;
  parameters: TLispValue;
  docstring?: TLispValue;
  body: TLispValue;
}

/** Parse the common (defun|lambda name? params [docstring] body...) shape. */
function parseFunctionDef(
  elements: TLispValue[],
  kind: "defun" | "lambda",
): Either<EvalError, FunctionDefShape> {
  // defun: (defun name params [docstring] body...) → ≥4 elements.
  // lambda: (lambda params [docstring] body...) → ≥3 elements.
  const minElements = kind === "defun" ? 4 : 3;
  if (elements.length < minElements) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: kind === "defun"
        ? "defun requires 3 or 4 arguments: name, parameters, [docstring], and body"
        : "lambda requires 2 or 3 arguments: parameters, [docstring], and body",
      details: { expected: "at least " + minElements, actual: elements.length },
    });
  }

  let idx = 1;
  let name: TLispValue | undefined;
  if (kind === "defun") {
    name = elements[idx++];
  }
  const parameters = elements[idx++];
  // Detect optional docstring slot.
  let docstring: TLispValue | undefined;
  const docSlot = elements[idx];
  const tailStart = docSlot?.type === "string" && elements.length > idx + 1
    ? idx + 1
    : idx;
  if (docSlot?.type === "string" && elements.length > idx + 1) {
    docstring = docSlot;
  }
  const bodyExprs = elements.slice(tailStart);
  if (bodyExprs.length === 0) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: kind === "defun" ? "defun missing body" : "lambda missing body",
      details: { actual: elements.length },
    });
  }
  if (docstring && docstring.type !== "string") {
    return Either.left({
      type: "EvalError",
      variant: "TypeError",
      message: kind === "defun" ? "defun docstring must be a string" : "lambda docstring must be a string",
      details: { docstringType: docstring.type },
    });
  }
  // Reconstruct the body progn form (single → as-is, multiple → wrapped).
  const body = bodyExprs.length === 1
    ? bodyExprs[0]!
    : { type: "list" as const, value: [{ type: "symbol" as const, value: "progn" }, ...bodyExprs] };

  // Required-arg presence + type checks.
  if (kind === "defun" && (!name || !parameters || !body)) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "defun missing required arguments",
      details: { hasName: !!name, hasParameters: !!parameters, hasBody: !!body },
    });
  }
  if (kind === "lambda" && (!parameters || !body)) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: "lambda missing required arguments",
      details: { hasParameters: !!parameters, hasBody: !!body },
    });
  }
  if (kind === "defun" && name && name.type !== "symbol") {
    return Either.left({
      type: "EvalError",
      variant: "TypeError",
      message: "defun name must be a symbol",
      details: { nameType: name.type },
    });
  }
  if (parameters && parameters.type !== "list") {
    return Either.left({
      type: "EvalError",
      variant: "TypeError",
      message: kind === "defun" ? "defun parameters must be a list" : "lambda parameters must be a list",
      details: { parametersType: parameters.type },
    });
  }

  return Either.right({ name, parameters: parameters!, docstring, body });
}

/** Validate a `defun` form's argument shape (name + params + optional docstring + body). */
export function validateDefun(elements: TLispValue[]): Either<EvalError, FunctionDefShape> {
  return parseFunctionDef(elements, "defun");
}

/** Validate a `lambda` form's argument shape (params + optional docstring + body). */
export function validateLambda(elements: TLispValue[]): Either<EvalError, FunctionDefShape> {
  return parseFunctionDef(elements, "lambda");
}

/** Parsed `provide`/`featurep`/`require` shape: feature-name string. */
export interface FeatureShape {
  feature: string;
}

function validateFeatureName(
  elements: TLispValue[],
  form: "provide" | "featurep" | "require",
): Either<EvalError, FeatureShape> {
  if (elements.length < 2) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: `${form} requires a feature name string`,
      details: { expected: "2+", actual: elements.length },
    });
  }
  const featureArg = elements[1]!;
  if (featureArg.type !== "string") {
    return Either.left({
      type: "EvalError",
      variant: "TypeError",
      message: `${form} requires a feature name string`,
      details: { expected: "string", actual: featureArg.type },
    });
  }
  return Either.right({ feature: featureArg.value as string });
}

/** Validate a `provide` form. */
export function validateProvide(elements: TLispValue[]): Either<EvalError, FeatureShape> {
  return validateFeatureName(elements, "provide");
}

/** Validate a `featurep` form. */
export function validateFeaturep(elements: TLispValue[]): Either<EvalError, FeatureShape> {
  return validateFeatureName(elements, "featurep");
}

/** Validate a `require` form. */
export function validateRequire(elements: TLispValue[]): Either<EvalError, FeatureShape> {
  return validateFeatureName(elements, "require");
}

/** Parsed test-form shape (deftest / deftest-async): name + params + body. */
export interface TestDefShape {
  name: TLispValue;
  parameters: TLispValue;
  body: TLispValue[];
}

/**
 * Validate a `deftest` or `deftest-async` form's argument shape. These
 * TypeScript handlers are dormant (the live test framework is the T-Lisp
 * `trt` framework; `deftest` is a macro in `trt.tlisp`), but they are still
 * extracted as `test-forms.ts` per AC4.7 and the validator is shared between
 * the (currently unused) sync handlers and any future caller.
 */
export function validateDeftest(elements: TLispValue[], kind: "deftest" | "deftest-async" = "deftest"): Either<EvalError, TestDefShape> {
  if (elements.length < 3) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: kind === "deftest"
        ? "deftest requires at least 2 arguments: name, parameters, and body"
        : "deftest-async requires at least 2 arguments: name, parameters (with 'done'), and body",
      details: { expectedMin: 3, actual: elements.length },
    });
  }
  const name = elements[1];
  const parameters = elements[2];
  if (!name || !parameters) {
    return Either.left({
      type: "EvalError",
      variant: "SyntaxError",
      message: `${kind} missing required arguments`,
      details: { hasName: !!name, hasParameters: !!parameters },
    });
  }
  if (name.type !== "symbol") {
    return Either.left({
      type: "EvalError",
      variant: "TypeError",
      message: `${kind} name must be a symbol`,
      details: { nameType: name.type },
    });
  }
  if (parameters.type !== "list") {
    return Either.left({
      type: "EvalError",
      variant: "TypeError",
      message: `${kind} parameters must be a list`,
      details: { parametersType: parameters.type },
    });
  }
  return Either.right({ name, parameters, body: elements.slice(3) });
}
