/**
 * @file evaluator.ts
 * @description T-Lisp evaluator implementation with functional error handling
 */

import type { TLispValue, TLispEnvironment, TLispFunction, TLispList, TLispMacro } from "./types.ts";
import { TLispEnvironmentImpl } from "./environment.ts";
import {
  createNil,
  createBoolean,
  createNumber,
  createString,
  createSymbol,
  createList,
  createFunction,
  createMacro,
  isNil,
  isTruthy,
  isMacro,
  valuesEqual,
  valueToString
} from "./values.ts";
import { Either } from "../utils/task-either";
import { createValidationError, type EvalError } from "../error/types";
import { TLispParser } from "./parser.ts";
import { registerStdlibFunctions } from "./stdlib.ts";
import { registerTestingFramework } from "./test-framework.ts";


/**
 * Tail call result - represents a function call that should be optimized
 */
interface TailCall {
  type: "tail-call";
  funcExpr: TLispValue;
  argExprs: TLispValue[];
  env: TLispEnvironment;
}

/**
 * Evaluation result - either a value or a tail call
 */
type EvalResult = TLispValue | TailCall;

/**
 * Check if result is a tail call
 */
function isTailCall(result: EvalResult): result is TailCall {
  return typeof result === "object" && result !== null && "type" in result && result.type === "tail-call";
}

/**
 * Create a tail call result
 */
function createTailCall(funcExpr: TLispValue, argExprs: TLispValue[], env: TLispEnvironment): TailCall {
  return { type: "tail-call", funcExpr, argExprs, env };
}

// Test registry to store defined tests
const testRegistry: Map<string, { body: TLispValue[], name: string, params: TLispValue }> = new Map();

// Suite registry to store test suites
interface TestSuite {
  name: string;
  description?: string;
  tests: string[]; // Test names
  setup?: TLispValue[];
  teardown?: TLispValue[];
  parent?: string; // For nested suites
}

const suiteRegistry: Map<string, TestSuite> = new Map();

// Track current suite being defined
let currentSuite: string | null = null;

/**
 * T-Lisp evaluator for executing T-Lisp expressions
 */
export class TLispEvaluator {
  /**
   * Evaluate a T-Lisp expression with tail-call optimization
   * @param expr - Expression to evaluate
   * @param env - Environment for evaluation
   * @returns Either with error or evaluated result
   */
  eval(expr: TLispValue, env: TLispEnvironment): Either<EvalError, TLispValue> {
    const result = this.evalInternal(expr, env);

    if (Either.isLeft(result)) {
      return result;
    }

    let currentResult: EvalResult = result.right;

    // Trampoline: keep evaluating tail calls until we get a value
    while (isTailCall(currentResult)) {
      // Evaluate function and arguments in the trampoline
      const tailCall = currentResult as TailCall;

      const funcResult = this.eval(tailCall.funcExpr, tailCall.env);
      if (Either.isLeft(funcResult)) {
        return funcResult;
      }

      const func = funcResult.right;

      const argsResults: Either<EvalError, TLispValue>[] = [];
      for (const expr of tailCall.argExprs) {
        const argResult = this.eval(expr, tailCall.env);
        if (Either.isLeft(argResult)) {
          return argResult;
        }
        argsResults.push(argResult);
      }

      const args = argsResults.map(r => r.right);
      const callResult = this.evalFunctionCallInternal(func, args, tailCall.env);

      if (Either.isLeft(callResult)) {
        return callResult;
      }

      currentResult = callResult.right;
    }

    return Either.right(currentResult);
  }
  
  /**
   * Internal evaluation method that can return tail calls
   * @param expr - Expression to evaluate
   * @param env - Environment for evaluation
   * @param inTailPosition - Whether this evaluation is in tail position
   * @returns Either with error or evaluated result or tail call
   */
  private evalInternal(expr: TLispValue, env: TLispEnvironment, inTailPosition: boolean = false): Either<EvalError, EvalResult> {
    switch (expr.type) {
      case "nil":
      case "boolean":
      case "number":
      case "string":
        // Self-evaluating literals
        return Either.right(expr);

      case "symbol":
        return this.evalSymbol(expr, env);

      case "list":
        return this.evalList(expr, env, inTailPosition);

      case "function":
        return Either.right(expr);

      default:
        return Either.left({
          type: 'EvalError',
          variant: 'SyntaxError',
          message: `Unknown expression type: ${(expr as any).type}`,
          details: { exprType: (expr as any).type }
        });
    }
  }

  /**
   * Evaluate assert-type special form
   * @param elements - List elements (excluding 'assert-type')
   * @param env - Environment
   * @returns Either with error or success
   */
  private evalAssertType(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (elements.length < 3) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "assert-type requires exactly 2 arguments: value and type",
        details: { expected: 2, actual: elements.length - 1 }
      });
    }

    const valueArg = elements[1]; // Will be evaluated
    const typeArg = elements[2]; // NOT evaluated

    if (typeArg.type !== "symbol") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "assert-type second argument must be a symbol (type name)",
        details: { argType: typeArg.type }
      });
    }

    // Evaluate the value
    const valueResult = this.eval(valueArg, env);
    if (Either.isLeft(valueResult)) {
      return valueResult;
    }

    const expectedType = typeArg.value as string;
    const actualType = valueResult.right.type;

    if (actualType !== expectedType) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: `Assertion failed: expected type ${expectedType}, but got ${actualType}`,
        details: {
          expected: expectedType,
          actual: actualType,
          value: valueToString(valueResult.right)
        }
      });
    }

    return Either.right(createBoolean(true));
  }

  /**
   * Evaluate a symbol by looking it up in the environment
   * @param symbol - Symbol to evaluate
   * @param env - Environment for lookup
   * @returns Either with error or symbol value
   */
  private evalSymbol(symbol: TLispValue, env: TLispEnvironment): Either<EvalError, TLispValue> {
    const name = symbol.value as string;
    const value = env.lookup(name);

    if (value === undefined) {
      return Either.left({
        type: 'EvalError',
        variant: 'UndefinedSymbol',
        message: `Undefined symbol: ${name}`,
        details: { symbol: name }
      });
    }

    return Either.right(value);
  }

  /**
   * Evaluate a list expression
   * @param list - List to evaluate
   * @param env - Environment for evaluation
   * @param inTailPosition - Whether this evaluation is in tail position
   * @returns Either with error or evaluated result or tail call
   */
  private evalList(list: TLispValue, env: TLispEnvironment, inTailPosition: boolean = false): Either<EvalError, EvalResult> {
    const elements = list.value as TLispValue[];

    if (elements.length === 0) {
      return Either.right(createList([]));
    }

    const first = elements[0];
    if (!first) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "Empty list cannot be evaluated",
        details: { elements }
      });
    }

    // Handle special forms
    if (first.type === "symbol") {
      const symbol = first.value as string;

      switch (symbol) {
        case "quote":
          return this.evalQuote(elements, env);
        case "quasiquote":
          return this.evalQuasiquote(elements, env);
        case "unquote":
          return Either.left({
            type: 'EvalError',
            variant: 'SyntaxError',
            message: "unquote can only be used inside quasiquote",
            details: { symbol }
          });
        case "unquote-splicing":
          return Either.left({
            type: 'EvalError',
            variant: 'SyntaxError',
            message: "unquote-splicing can only be used inside quasiquote",
            details: { symbol }
          });
        case "defmacro":
          return this.evalDefmacro(elements, env);
        case "if":
          return this.evalIf(elements, env, inTailPosition);
        case "let":
          return this.evalLet(elements, env, inTailPosition);
        case "lambda":
          return this.evalLambda(elements, env);
        case "defun":
          return this.evalDefun(elements, env);
        case "cond":
          return this.evalCond(elements, env, inTailPosition);
        case "deftest":
          return this.evalDeftest(elements, env);
        case "deftest-suite":
          return this.evalDeftestSuite(elements, env);
        case "suite-setup":
          return this.evalSuiteSetup(elements, env);
        case "suite-teardown":
          return this.evalSuiteTeardown(elements, env);
        case "deffixture":
          return this.evalDeffixture(elements, env);
        case "use-fixtures":
          return this.evalUseFixtures(elements, env);
        case "defvar":
          return this.evalDefvar(elements, env);
        case "set!":
          return this.evalSetBang(elements, env);
        case "assert-type":
          return this.evalAssertType(elements, env);
        case "assert-error":
          return this.evalAssertError(elements, env);
        default:
          return this.evalFunctionCall(elements, env, inTailPosition);
      }
    }

    // Function call - evaluate first element as function
    return this.evalFunctionCall(elements, env, inTailPosition);
  }

  /**
   * Evaluate quote special form
   * @param elements - List elements
   * @param env - Environment
   * @returns Either with error or quoted expression
   */
  private evalQuote(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (elements.length !== 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "quote requires exactly 1 argument",
        details: { expected: 2, actual: elements.length }
      });
    }

    const expr = elements[1];
    if (!expr) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "quote missing argument",
        details: { elements }
      });
    }

    return Either.right(expr);
  }

  /**
   * Evaluate if special form
   * @param elements - List elements
   * @param env - Environment
   * @param inTailPosition - Whether this evaluation is in tail position
   * @returns Either with error or conditional result
   */
  private evalIf(elements: TLispValue[], env: TLispEnvironment, inTailPosition: boolean = false): Either<EvalError, EvalResult> {
    if (elements.length !== 4) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "if requires exactly 3 arguments: condition, then-expr, else-expr",
        details: { expected: 4, actual: elements.length }
      });
    }

    const conditionExpr = elements[1];
    const thenExpr = elements[2];
    const elseExpr = elements[3];

    if (!conditionExpr || !thenExpr || !elseExpr) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "if missing required arguments",
        details: { hasCondition: !!conditionExpr, hasThen: !!thenExpr, hasElse: !!elseExpr }
      });
    }

    const conditionResult = this.eval(conditionExpr, env);
    if (Either.isLeft(conditionResult)) {
      return conditionResult;
    }

    const condition = conditionResult.right;

    if (isTruthy(condition)) {
      return this.evalInternal(thenExpr, env, inTailPosition);
    } else {
      return this.evalInternal(elseExpr, env, inTailPosition);
    }
  }

  /**
   * Evaluate let special form
   * @param elements - List elements
   * @param env - Environment
   * @param inTailPosition - Whether this evaluation is in tail position
   * @returns Either with error or let body result
   */
  private evalLet(elements: TLispValue[], env: TLispEnvironment, inTailPosition: boolean = false): Either<EvalError, EvalResult> {
    if (elements.length !== 3) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "let requires exactly 2 arguments: bindings and body",
        details: { expected: 3, actual: elements.length }
      });
    }

    const bindings = elements[1];
    const body = elements[2];

    if (!bindings || !body) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "let missing required arguments",
        details: { hasBindings: !!bindings, hasBody: !!body }
      });
    }

    if (bindings.type !== "list") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "let bindings must be a list",
        details: { bindingsType: bindings.type }
      });
    }

    // Create new environment for let bindings
    const letEnv = new TLispEnvironmentImpl(env);

    // Process bindings
    const bindingList = bindings.value as TLispValue[];
    for (const binding of bindingList) {
      if (binding.type !== "list") {
        return Either.left({
          type: 'EvalError',
          variant: 'TypeError',
          message: "let binding must be a list",
          details: { bindingType: binding.type }
        });
      }

      const bindingElements = binding.value as TLispValue[];
      if (bindingElements.length !== 2) {
        return Either.left({
          type: 'EvalError',
          variant: 'SyntaxError',
          message: "let binding must have exactly 2 elements: name and value",
          details: { expected: 2, actual: bindingElements.length }
        });
      }

      const name = bindingElements[0];
      const value = bindingElements[1];

      if (!name || !value) {
        return Either.left({
          type: 'EvalError',
          variant: 'SyntaxError',
          message: "let binding missing name or value",
          details: { hasName: !!name, hasValue: !!value }
        });
      }

      if (name.type !== "symbol") {
        return Either.left({
          type: 'EvalError',
          variant: 'TypeError',
          message: "let binding name must be a symbol",
          details: { nameType: name.type }
        });
      }

      const evaluatedValueResult = this.eval(value, env);
      if (Either.isLeft(evaluatedValueResult)) {
        return evaluatedValueResult;
      }

      const evaluatedValue = evaluatedValueResult.right;
      letEnv.define(name.value as string, evaluatedValue);
    }

    // Evaluate body in new environment
    return this.evalInternal(body, letEnv, inTailPosition);
  }

  /**
   * Evaluate lambda special form
   * @param elements - List elements
   * @param env - Environment
   * @returns Either with error or lambda function
   */
  private evalLambda(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (elements.length !== 3) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "lambda requires exactly 2 arguments: parameters and body",
        details: { expected: 3, actual: elements.length }
      });
    }

    const parameters = elements[1];
    const body = elements[2];

    if (!parameters || !body) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "lambda missing required arguments",
        details: { hasParameters: !!parameters, hasBody: !!body }
      });
    }

    if (parameters.type !== "list") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "lambda parameters must be a list",
        details: { parametersType: parameters.type }
      });
    }

    const paramList = parameters.value as TLispValue[];
    for (const param of paramList) {
      if (param.type !== "symbol") {
        return Either.left({
          type: 'EvalError',
          variant: 'TypeError',
          message: "lambda parameter must be a symbol",
          details: { paramType: param.type }
        });
      }
    }

    // Create closure with tail-call optimization support
    const lambdaFunction = (args: TLispValue[]): Either<EvalError, TLispValue> => {
      if (args.length !== paramList.length) {
        return Either.left({
          type: 'EvalError',
          variant: 'RuntimeError',
          message: `lambda expects ${paramList.length} arguments, got ${args.length}`,
          details: { expected: paramList.length, actual: args.length, args }
        });
      }

      // Create new environment for function call
      const callEnv = new TLispEnvironmentImpl(env);

      // Bind parameters to arguments
      for (let i = 0; i < paramList.length; i++) {
        const param = paramList[i];
        const arg = args[i];
        if (!param || !arg) {
          return Either.left({
            type: 'EvalError',
            variant: 'RuntimeError',
            message: "lambda parameter or argument missing",
            details: { paramIndex: i, hasParam: !!param, hasArg: !!arg }
          });
        }
        const paramName = param.value as string;
        callEnv.define(paramName, arg);
      }

      // Evaluate body in tail position
      const result = this.eval(body, callEnv);
      return result;
    };

    return Either.right(createFunction(lambdaFunction));
  }

  /**
   * Evaluate defun special form
   * @param elements - List elements
   * @param env - Environment
   * @returns Either with error or function symbol
   */
  private evalDefun(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (elements.length !== 4) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "defun requires exactly 3 arguments: name, parameters, and body",
        details: { expected: 4, actual: elements.length }
      });
    }

    const name = elements[1];
    const parameters = elements[2];
    const body = elements[3];

    if (!name || !parameters || !body) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "defun missing required arguments",
        details: { hasName: !!name, hasParameters: !!parameters, hasBody: !!body }
      });
    }

    if (name.type !== "symbol") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "defun name must be a symbol",
        details: { nameType: name.type }
      });
    }

    // Create lambda and bind it to the name
    const lambdaExpr = createList([createSymbol("lambda"), parameters, body]);
    const lambdaFunctionResult = this.eval(lambdaExpr, env);
    if (Either.isLeft(lambdaFunctionResult)) {
      return lambdaFunctionResult;
    }

    const lambdaFunction = lambdaFunctionResult.right;

    env.define(name.value as string, lambdaFunction);

    return Either.right(name);
  }

  /**
   * Evaluate cond special form
   * @param elements - List elements
   * @param env - Environment
   * @param inTailPosition - Whether this evaluation is in tail position
   * @returns Either with error or result of first matching condition
   */
  private evalCond(elements: TLispValue[], env: TLispEnvironment, inTailPosition: boolean = false): Either<EvalError, EvalResult> {
    if (elements.length < 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "cond requires at least 1 clause",
        details: { expectedMin: 2, actual: elements.length }
      });
    }

    // Process each clause (condition expression) pair
    for (let i = 1; i < elements.length; i++) {
      const clause = elements[i];
      if (!clause) {
        return Either.left({
          type: 'EvalError',
          variant: 'SyntaxError',
          message: "cond clause missing",
          details: { clauseIndex: i }
        });
      }

      if (clause.type !== "list") {
        return Either.left({
          type: 'EvalError',
          variant: 'TypeError',
          message: "cond clause must be a list",
          details: { clauseType: clause.type, clauseIndex: i }
        });
      }

      const clauseElements = clause.value as TLispValue[];
      if (clauseElements.length !== 2) {
        return Either.left({
          type: 'EvalError',
          variant: 'SyntaxError',
          message: "cond clause must have exactly 2 elements: condition and expression",
          details: { expected: 2, actual: clauseElements.length, clauseIndex: i }
        });
      }

      const condition = clauseElements[0];
      const expression = clauseElements[1];

      if (!condition || !expression) {
        return Either.left({
          type: 'EvalError',
          variant: 'SyntaxError',
          message: "cond clause missing condition or expression",
          details: { clauseIndex: i, hasCondition: !!condition, hasExpression: !!expression }
        });
      }

      // Special case for 't' (always true) condition - commonly used as else clause
      if (condition.type === "symbol" && condition.value === "t") {
        return this.evalInternal(expression, env, inTailPosition);
      }

      // Evaluate condition
      const conditionResult = this.eval(condition, env);
      if (Either.isLeft(conditionResult)) {
        return conditionResult;
      }

      // If condition is truthy, evaluate and return the expression
      if (isTruthy(conditionResult.right)) {
        return this.evalInternal(expression, env, inTailPosition);
      }
    }

    // No condition matched, return nil
    return Either.right(createNil());
  }

  /**
   * Evaluate quasiquote special form
   * @param elements - List elements
   * @param env - Environment
   * @returns Either with error or quasiquoted expression
   */
  private evalQuasiquote(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (elements.length !== 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "quasiquote requires exactly 1 argument",
        details: { expected: 2, actual: elements.length }
      });
    }

    const expr = elements[1];
    if (!expr) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "quasiquote missing argument",
        details: { elements }
      });
    }

    const result = this.expandQuasiquote(expr, env, 1);
    return result; // Return the Either result directly
  }

  /**
   * Expand quasiquote expression
   * @param expr - Expression to expand
   * @param env - Environment
   * @param depth - Nesting depth of quasiquotes
   * @returns Either with error or expanded expression
   */
  private expandQuasiquote(expr: TLispValue, env: TLispEnvironment, depth: number = 1): Either<EvalError, TLispValue> {
    if (expr.type !== "list") {
      return Either.right(expr);
    }

    const elements = expr.value as TLispValue[];
    if (elements.length === 0) {
      return Either.right(createList([]));
    }

    const first = elements[0];
    if (!first) {
      return Either.right(createList([]));
    }

    // Handle quasiquote - increase depth
    if (first.type === "symbol" && first.value === "quasiquote") {
      if (elements.length !== 2) {
        return Either.left({
          type: 'EvalError',
          variant: 'SyntaxError',
          message: "quasiquote requires exactly 1 argument",
          details: { expected: 2, actual: elements.length }
        });
      }
      const quasiExpr = elements[1];
      if (!quasiExpr) {
        return Either.left({
          type: 'EvalError',
          variant: 'SyntaxError',
          message: "quasiquote missing argument",
          details: { elements }
        });
      }

      const expandedResult = this.expandQuasiquote(quasiExpr, env, depth + 1);
      if (Either.isLeft(expandedResult)) {
        return expandedResult;
      }

      return Either.right(createList([first, expandedResult.right]));
    }

    // Handle unquote
    if (first.type === "symbol" && first.value === "unquote") {
      if (elements.length !== 2) {
        return Either.left({
          type: 'EvalError',
          variant: 'SyntaxError',
          message: "unquote requires exactly 1 argument",
          details: { expected: 2, actual: elements.length }
        });
      }
      const unquoteExpr = elements[1];
      if (!unquoteExpr) {
        return Either.left({
          type: 'EvalError',
          variant: 'SyntaxError',
          message: "unquote missing argument",
          details: { elements }
        });
      }

      if (depth === 1) {
        // We're at the top level - evaluate the expression
        return this.eval(unquoteExpr, env);
      } else {
        // We're nested - decrease depth and continue
        const expandedResult = this.expandQuasiquote(unquoteExpr, env, depth - 1);
        if (Either.isLeft(expandedResult)) {
          return expandedResult;
        }

        return Either.right(createList([first, expandedResult.right]));
      }
    }

    // Handle unquote-splicing
    if (first.type === "symbol" && first.value === "unquote-splicing") {
      if (depth === 1) {
        return Either.left({
          type: 'EvalError',
          variant: 'SyntaxError',
          message: "unquote-splicing can only be used inside a list",
          details: { depth }
        });
      } else {
        // We're nested - decrease depth and continue
        if (elements.length !== 2) {
          return Either.left({
            type: 'EvalError',
            variant: 'SyntaxError',
            message: "unquote-splicing requires exactly 1 argument",
            details: { expected: 2, actual: elements.length }
          });
        }
        const spliceExpr = elements[1];
        if (!spliceExpr) {
          return Either.left({
            type: 'EvalError',
            variant: 'SyntaxError',
            message: "unquote-splicing missing argument",
            details: { elements }
          });
        }

        const expandedResult = this.expandQuasiquote(spliceExpr, env, depth - 1);
        if (Either.isLeft(expandedResult)) {
          return expandedResult;
        }

        return Either.right(createList([first, expandedResult.right]));
      }
    }

    // Process list elements
    const result: TLispValue[] = [];
    for (const element of elements) {
      if (element.type === "list") {
        const elementList = element.value as TLispValue[];
        if (elementList.length >= 2 && elementList[0]?.type === "symbol" && elementList[0].value === "unquote-splicing") {
          if (depth === 1) {
            // Splice the elements
            const spliceExpr = elementList[1];
            if (!spliceExpr) {
              return Either.left({
                type: 'EvalError',
                variant: 'SyntaxError',
                message: "unquote-splicing missing argument",
                details: { elementList }
              });
            }

            const spliceValueResult = this.eval(spliceExpr, env);
            if (Either.isLeft(spliceValueResult)) {
              return spliceValueResult;
            }

            const spliceValue = spliceValueResult.right;
            if (spliceValue.type === "list") {
              const spliceList = spliceValue.value as TLispValue[];
              result.push(...spliceList);
            } else {
              return Either.left({
                type: 'EvalError',
                variant: 'TypeError',
                message: "unquote-splicing requires a list",
                details: { spliceValueType: spliceValue.type }
              });
            }
          } else {
            // Nested - process recursively
            const expandedResult = this.expandQuasiquote(element, env, depth);
            if (Either.isLeft(expandedResult)) {
              return expandedResult;
            }
            result.push(expandedResult.right);
          }
        } else {
          const expandedResult = this.expandQuasiquote(element, env, depth);
          if (Either.isLeft(expandedResult)) {
            return expandedResult;
          }
          result.push(expandedResult.right);
        }
      } else {
        const expandedResult = this.expandQuasiquote(element, env, depth);
        if (Either.isLeft(expandedResult)) {
          return expandedResult;
        }
        result.push(expandedResult.right);
      }
    }

    return Either.right(createList(result));
  }

  /**
   * Evaluate defmacro special form
   * @param elements - List elements
   * @param env - Environment
   * @returns Either with error or macro symbol
   */
  private evalDefmacro(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (elements.length !== 4) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "defmacro requires exactly 3 arguments: name, parameters, and body",
        details: { expected: 4, actual: elements.length }
      });
    }

    const name = elements[1];
    const parameters = elements[2];
    const body = elements[3];

    if (!name || !parameters || !body) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "defmacro missing required arguments",
        details: { hasName: !!name, hasParameters: !!parameters, hasBody: !!body }
      });
    }

    if (name.type !== "symbol") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "defmacro name must be a symbol",
        details: { nameType: name.type }
      });
    }

    if (parameters.type !== "list") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "defmacro parameters must be a list",
        details: { parametersType: parameters.type }
      });
    }

    const paramList = parameters.value as TLispValue[];
    for (const param of paramList) {
      if (param.type !== "symbol") {
        return Either.left({
          type: 'EvalError',
          variant: 'TypeError',
          message: "defmacro parameter must be a symbol",
          details: { paramType: param.type }
        });
      }
    }

    // Create macro function
    const macroFunction = (args: TLispValue[]): Either<EvalError, TLispValue> => {
      if (args.length !== paramList.length) {
        return Either.left({
          type: 'EvalError',
          variant: 'RuntimeError',
          message: `macro ${name.value} expects ${paramList.length} arguments, got ${args.length}`,
          details: { expected: paramList.length, actual: args.length, args }
        });
      }

      // Create new environment for macro expansion
      const macroEnv = new TLispEnvironmentImpl(env);

      // Bind parameters to arguments (unevaluated)
      for (let i = 0; i < paramList.length; i++) {
        const param = paramList[i];
        const arg = args[i];
        if (!param || !arg) {
          return Either.left({
            type: 'EvalError',
            variant: 'RuntimeError',
            message: "macro parameter or argument missing",
            details: { paramIndex: i, hasParam: !!param, hasArg: !!arg }
          });
        }
        const paramName = param.value as string;
        macroEnv.define(paramName, arg);
      }

      // Evaluate body to generate code
      const result = this.eval(body, macroEnv);
      return result;
    };

    const macro = createMacro(macroFunction, name.value as string);
    env.define(name.value as string, macro);

    return Either.right(name);
  }

  /**
   * Evaluate function call
   * @param elements - List elements
   * @param env - Environment
   * @param inTailPosition - Whether this evaluation is in tail position
   * @returns Either with error or function result or tail call
   */
  private evalFunctionCall(elements: TLispValue[], env: TLispEnvironment, inTailPosition: boolean = false): Either<EvalError, EvalResult> {
    const funcExpr = elements[0];
    if (!funcExpr) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "Function call missing function expression",
        details: { elements }
      });
    }

    const argExprs = elements.slice(1);

    // Check if this is a macro call
    if (funcExpr.type === "symbol") {
      const symbolName = funcExpr.value as string;
      const value = env.lookup(symbolName);
      if (value && isMacro(value)) {
        // Macro expansion - pass unevaluated arguments
        const macroImpl = value.value as (args: TLispValue[]) => Either<EvalError, TLispValue>;
        const expandedResult = macroImpl(argExprs);
        if (Either.isLeft(expandedResult)) {
          return expandedResult;
        }

        const expanded = expandedResult.right;
        // Evaluate the expanded form
        return this.evalInternal(expanded, env, inTailPosition);
      }
    }

    if (inTailPosition) {
      // Return tail call for optimization - defer evaluation
      return Either.right(createTailCall(funcExpr, argExprs, env));
    } else {
      // Direct function call - evaluate immediately
      const funcResult = this.eval(funcExpr, env);
      if (Either.isLeft(funcResult)) {
        return funcResult;
      }

      const func = funcResult.right;

      const argsResults: Either<EvalError, TLispValue>[] = [];
      for (const expr of argExprs) {
        const argResult = this.eval(expr, env);
        if (Either.isLeft(argResult)) {
          return argResult;
        }
        argsResults.push(argResult);
      }

      const args = argsResults.map(r => r.right);
      return this.evalFunctionCallInternal(func, args, env);
    }
  }
  
  /**
   * Internal function call evaluation
   * @param func - Function to call
   * @param args - Arguments to pass
   * @param env - Environment
   * @returns Either with error or function result or tail call
   */
  private evalFunctionCallInternal(func: TLispValue, args: TLispValue[], env: TLispEnvironment): Either<EvalError, EvalResult> {
    if (!func) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "Function call missing function",
        details: { args }
      });
    }

    if (func.type === "function") {
      const functionImpl = func.value as (args: TLispValue[]) => Either<EvalError, TLispValue> | TLispValue;
      const result = functionImpl(args);

      // Handle both cases: functions returning Either or TLispValue directly
      // (for backward compatibility with stdlib functions that haven't been migrated)
      if (result && typeof result === 'object' && '_tag' in result) {
        return result as Either<EvalError, TLispValue>;
      }

      // Wrap direct TLispValue returns in Either.right
      return Either.right(result);
    }

    if (func.type === "macro") {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "Macro cannot be called as function - this should be handled in evalFunctionCall",
        details: { args }
      });
    }

    return Either.left({
      type: 'EvalError',
      variant: 'TypeError',
      message: `Cannot call non-function: ${func.type}`,
      details: { funcType: func.type, args }
    });
  }

  /**
   * Evaluate deftest special form
   * @param elements - List elements
   * @param env - Environment
   * @returns Either with error or function symbol
   */
  private evalDeftest(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (elements.length < 3) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "deftest requires at least 2 arguments: name, parameters, and body",
        details: { expectedMin: 3, actual: elements.length }
      });
    }

    const name = elements[1];
    const parameters = elements[2];
    const body = elements.length > 3 ? elements[3] : createNil(); // For now, just take the first body expression

    if (!name || !parameters) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "deftest missing required arguments",
        details: { hasName: !!name, hasParameters: !!parameters }
      });
    }

    if (name.type !== "symbol") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "deftest name must be a symbol",
        details: { nameType: name.type }
      });
    }

    if (parameters.type !== "list") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "deftest parameters must be a list",
        details: { parametersType: parameters.type }
      });
    }

    // Extract test name
    const testName = name.value as string;

    // Store the body expressions (from index 3 onwards)
    const testBody = elements.slice(3);

    // Store test in the registry
    testRegistry.set(testName, { body: testBody, name: testName, params: parameters });

    // Return the test name as a symbol to indicate success
    return Either.right(name);
  }

  /**
   * Evaluate deftest-suite special form
   * @param elements - List elements
   * @param env - Environment
   * @returns Either with error or suite name
   */
  private evalDeftestSuite(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (elements.length < 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "deftest-suite requires at least 1 argument: suite name",
        details: { expectedMin: 2, actual: elements.length }
      });
    }

    const nameArg = elements[1];
    if (!nameArg || (nameArg.type !== "string" && nameArg.type !== "symbol")) {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "deftest-suite name must be a string or symbol",
        details: { nameType: nameArg?.type }
      });
    }

    const suiteName = nameArg.value as string;

    // Parse optional description
    let description: string | undefined;
    let contentStart = 2;

    if (elements.length > 2 && elements[2].type === "string") {
      description = elements[2].value as string;
      contentStart = 3;
    }

    // Create suite
    const suite: TestSuite = {
      name: suiteName,
      description,
      tests: [],
      parent: currentSuite || undefined
    };

    // Set as current suite for nested definitions
    const previousSuite = currentSuite;
    currentSuite = suiteName;

    // Process suite body
    for (let i = contentStart; i < elements.length; i++) {
      const element = elements[i];

      // Check for suite-setup
      if (element.type === "list" && element.value.length > 0) {
        const first = element.value[0];
        if (first.type === "symbol" && first.value === "suite-setup") {
          suite.setup = element.value.slice(1);
          continue;
        }
        if (first.type === "symbol" && first.value === "suite-teardown") {
          suite.teardown = element.value.slice(1);
          continue;
        }
        if (first.type === "symbol" && first.value === "deftest") {
          // Execute the deftest to register it in testRegistry
          const testResult = this.evalDeftest(element.value, env);
          if (Either.isLeft(testResult)) {
            // Log error but continue
            console.warn(`Failed to define test in suite: ${testResult.left.message}`);
          } else {
            // Add test to suite's test list
            const testName = element.value[1];
            if (testName && testName.type === "symbol") {
              suite.tests.push(testName.value as string);
            }
          }
        }
        if (first.type === "symbol" && first.value === "deftest-suite") {
          // Execute nested suite definition
          const suiteResult = this.evalDeftestSuite(element.value, env);
          if (Either.isLeft(suiteResult)) {
            console.warn(`Failed to define nested suite: ${suiteResult.left.message}`);
          } else {
            // Add nested suite to parent's test list
            const nestedName = element.value[1];
            if (nestedName && (nestedName.type === "string" || nestedName.type === "symbol")) {
              suite.tests.push(nestedName.value as string);
            }
          }
        }
      }
    }

    // Restore previous suite
    currentSuite = previousSuite;

    // Register suite
    suiteRegistry.set(suiteName, suite);

    // Return suite name
    return Either.right(createString(suiteName));
  }

  /**
   * Evaluate suite-setup special form
   * @param elements - List elements
   * @param env - Environment
   * @returns Either with error or success
   */
  private evalSuiteSetup(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (!currentSuite) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "suite-setup must be used inside deftest-suite",
        details: {}
      });
    }

    // suite-setup is handled by deftest-suite, this is just a placeholder
    // The actual setup body is stored in the suite object
    return Either.right(createNil());
  }

  /**
   * Evaluate suite-teardown special form
   * @param elements - List elements
   * @param env - Environment
   * @returns Either with error or success
   */
  private evalSuiteTeardown(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (!currentSuite) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "suite-teardown must be used inside deftest-suite",
        details: {}
      });
    }

    // suite-teardown is handled by deftest-suite, this is just a placeholder
    // The actual teardown body is stored in the suite object
    return Either.right(createNil());
  }

  /**
   * Evaluate deffixture special form
   * @param elements - List elements
   * @param env - Environment
   * @returns Either with error or fixture name
   */
  private evalDeffixture(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (elements.length < 3) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "deffixture requires at least 2 arguments: name, parameters, and body",
        details: { expectedMin: 3, actual: elements.length }
      });
    }

    const name = elements[1];
    const parameters = elements[2];

    if (!name || !parameters) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "deffixture missing required arguments",
        details: { hasName: !!name, hasParameters: !!parameters }
      });
    }

    if (name.type !== "symbol") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "deffixture name must be a symbol",
        details: { nameType: name.type }
      });
    }

    if (parameters.type !== "list") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "deffixture parameters must be a list",
        details: { parametersType: parameters.type }
      });
    }

    // Extract fixture name
    const fixtureName = name.value as string;

    // Parse optional scope keyword from body
    let scope: 'each' | 'once' | 'all' = 'each';
    let bodyStartIndex = 3;

    // Check if first body element is a scope keyword list like (:scope each)
    if (elements.length > 3 && elements[3].type === "list") {
      const scopeList = elements[3].value as TLispValue[];
      if (scopeList.length >= 2) {
        const keyword = scopeList[0];
        const scopeValue = scopeList[1];
        if (keyword.type === "symbol" && keyword.value === "scope" && scopeValue.type === "symbol") {
          const scopeStr = scopeValue.value as string;
          if (scopeStr === "each" || scopeStr === "once" || scopeStr === "all") {
            scope = scopeStr;
            bodyStartIndex = 4;
          }
        }
      }
    }

    // Extract setup, teardown, and body from remaining elements
    let setupBody: TLispValue[] = [];
    let teardownBody: TLispValue[] = [];
    let body: TLispValue[] = [];

    for (let i = bodyStartIndex; i < elements.length; i++) {
      const arg = elements[i];
      if (arg.type === "list") {
        const listItems = arg.value as TLispValue[];
        if (listItems.length > 0) {
          const first = listItems[0];
          if (first.type === "symbol") {
            if (first.value === "setup") {
              setupBody = listItems.slice(1);
            } else if (first.value === "teardown") {
              teardownBody = listItems.slice(1);
            } else {
              // Regular body expression
              body.push(arg);
            }
          } else {
            // Regular body expression (non-symbol first element)
            body.push(arg);
          }
        }
      } else {
        // Non-list body expression
        body.push(arg);
      }
    }

    // Import the necessary types and functions from test-framework
    // We need to access the fixture registry, so we'll use a global approach
    // The fixture registry is in test-framework.ts, so we need to make it accessible

    // For now, let's use a workaround: store fixture info in the global environment
    // This isn't ideal but will work for the MVP
    const fixtureData = {
      name: fixtureName,
      params: parameters,
      body,
      setupBody,
      teardownBody,
      scope
    };

    // Store in global environment as a special variable
    // The test-framework will access this
    (globalThis as any).__deffixture_data__ = (globalThis as any).__deffixture_data__ || new Map();
    (globalThis as any).__deffixture_data__.set(fixtureName, fixtureData);

    // Return the fixture name as a symbol to indicate success
    return Either.right(name);
  }

  /**
   * Evaluate use-fixtures special form
   * @param elements - List elements (excluding 'use-fixtures')
   * @param env - Environment
   * @returns Either with error or success
   */
  private evalUseFixtures(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (elements.length < 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "use-fixtures requires at least 1 argument: fixture name",
        details: { expectedMin: 2, actual: elements.length }
      });
    }

    // Collect fixture names from arguments (elements[0] is 'use-fixtures', elements[1+] are args)
    const fixtureNames: string[] = [];
    for (let i = 1; i < elements.length; i++) {
      const arg = elements[i];
      if (arg.type === "symbol") {
        fixtureNames.push(arg.value as string);
      } else if (arg.type === "string") {
        fixtureNames.push(arg.value as string);
      } else {
        return Either.left({
          type: 'EvalError',
          variant: 'TypeError',
          message: "use-fixtures arguments must be symbols or strings (fixture names)",
          details: { argType: arg.type }
        });
      }
    }

    // Get fixtures from global storage
    const globalFixtures = (globalThis as any).__deffixture_data__;
    if (!globalFixtures) {
      return Either.right(createBoolean(true)); // No fixtures to apply
    }

    // Apply each fixture in order
    for (const name of fixtureNames) {
      const fixtureData = globalFixtures.get(name);
      if (!fixtureData) {
        return Either.left({
          type: 'EvalError',
          variant: 'RuntimeError',
          message: `Fixture '${name}' not found`,
          details: { fixtureName: name }
        });
      }

      // Execute fixture body
      for (const expr of fixtureData.body || []) {
        const result = this.eval(expr, env);
        if (Either.isLeft(result)) {
          return result;
        }
      }

      // Execute fixture setup
      for (const expr of fixtureData.setupBody || []) {
        const result = this.eval(expr, env);
        if (Either.isLeft(result)) {
          return result;
        }
      }

      // Store teardown for later - we'll need a way to track this
      // For now, store in a special variable in the environment
      const teardowns = env.lookup("__fixture_teardowns__") || createList([]);
      const teardownList = teardowns.type === "list" ? [...teardowns.value] : [];
      teardownList.push({ fixture: name, teardown: fixtureData.teardownBody || [] });
      env.define("__fixture_teardowns__", createList(teardownList));
    }

    return Either.right(createBoolean(true));
  }

  /**
   * Evaluate defvar special form
   * @param elements - List elements (excluding 'defvar')
   * @param env - Environment
   * @returns Either with error or the defined value
   */
  private evalDefvar(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (elements.length < 3) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "defvar requires exactly 2 arguments: name and value",
        details: { expected: 2, actual: elements.length - 1 }
      });
    }

    const nameArg = elements[1]; // Not evaluated
    const valueArg = elements[2]; // Will be evaluated

    if (!nameArg || nameArg.type !== "symbol") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "defvar first argument must be a symbol (variable name)",
        details: { argType: nameArg?.type }
      });
    }

    const varName = nameArg.value as string;

    // Evaluate the value expression
    const valueResult = this.eval(valueArg, env);
    if (Either.isLeft(valueResult)) {
      return valueResult;
    }

    // Define the variable in the global environment
    // We need to find the root environment (the top-level global env)
    // For now, define in the current environment
    // TODO: Find the actual global environment
    env.define(varName, valueResult.right);

    return Either.right(valueResult.right);
  }

  /**
   * Evaluate set! special form
   * @param elements - List elements (excluding 'set!')
   * @param env - Environment
   * @returns Either with error or the new value
   */
  private evalSetBang(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (elements.length < 3) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "set! requires exactly 2 arguments: name and new value",
        details: { expected: 2, actual: elements.length - 1 }
      });
    }

    const nameArg = elements[1]; // Not evaluated
    const valueArg = elements[2]; // Will be evaluated

    if (!nameArg || nameArg.type !== "symbol") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "set! first argument must be a symbol (variable name)",
        details: { argType: nameArg?.type }
      });
    }

    const varName = nameArg.value as string;

    // Evaluate the new value expression
    const valueResult = this.eval(valueArg, env);
    if (Either.isLeft(valueResult)) {
      return valueResult;
    }

    // Set the variable in the environment
    try {
      env.set(varName, valueResult.right);
      return Either.right(valueResult.right);
    } catch (error) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: `set!: variable '${varName}' is not defined`,
        details: { varName, error: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  /**
   * Evaluate assert-type special form
   * @param elements - List elements (excluding 'assert-type')
   * @param env - Environment
   * @returns Either with error or success
   */
  private evalAssertType(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (elements.length < 3) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "assert-type requires exactly 2 arguments: value and type",
        details: { expected: 2, actual: elements.length - 1 }
      });
    }

    const valueArg = elements[1]; // Will be evaluated
    const typeArg = elements[2]; // NOT evaluated

    if (typeArg.type !== "symbol") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "assert-type second argument must be a symbol (type name)",
        details: { argType: typeArg.type }
      });
    }

    // Evaluate the value
    const valueResult = this.eval(valueArg, env);
    if (Either.isLeft(valueResult)) {
      return valueResult;
    }

    const expectedType = typeArg.value as string;
    const actualType = valueResult.right.type;

    if (actualType !== expectedType) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: `Assertion failed: expected type ${expectedType}, but got ${actualType}`,
        details: {
          expected: expectedType,
          actual: actualType,
          value: valueToString(valueResult.right)
        }
      });
    }

    return Either.right(createBoolean(true));
  }

  /**
   * Get test definition by name
   * @param name - Name of the test
   * @returns Test definition or undefined if not found
   */
  getTestDefinition(name: string): { body: TLispValue[], name: string, params: TLispValue } | undefined {
    return testRegistry.get(name);
  }

  /**
   * Get all test names
   * @returns Array of test names
   */
  getAllTestNames(): string[] {
    return Array.from(testRegistry.keys());
  }

  /**
   * Get suite definition by name
   * @param name - Name of the suite
   * @returns Suite definition or undefined if not found
   */
  getSuiteDefinition(name: string): TestSuite | undefined {
    return suiteRegistry.get(name);
  }

  /**
   * Get all suite names
   * @returns Array of suite names
   */
  getAllSuiteNames(): string[] {
    return Array.from(suiteRegistry.keys());
  }

  /**
   * Evaluate assert-error special form
   * @param elements - List elements
   * @param env - Environment
   * @returns Either with error or boolean result
   */
  private evalAssertError(elements: TLispValue[], env: TLispEnvironment): Either<EvalError, TLispValue> {
    if (elements.length !== 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'SyntaxError',
        message: "assert-error requires exactly 1 argument: form",
        details: { expected: 2, actual: elements.length } // 2 because first element is 'assert-error'
      });
    }

    const form = elements[1];

    // Try to evaluate the form
    const result = this.eval(form, env);

    if (Either.isLeft(result)) {
      // Form raised an error as expected - return true
      return Either.right(createBoolean(true));
    } else {
      // Form succeeded when it should have failed - return an error
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: `Expected error but form evaluated successfully to ${valueToString(result.right)}`,
        details: { result: valueToString(result.right) }
      });
    }
  }
}

/**
 * Create evaluator with built-in functions
 * @returns Evaluator with standard library
 */
export const createEvaluatorWithBuiltins = (): { evaluator: TLispEvaluator; env: TLispEnvironment } => {
  const evaluator = new TLispEvaluator();
  const env = new TLispEnvironmentImpl();
  
  // Arithmetic functions
  env.define("+", createFunction((args: TLispValue[]) => {
    let sum = 0;
    for (const arg of args) {
      if (arg.type !== "number") {
        return Either.left({
          type: 'EvalError',
          variant: 'TypeError',
          message: "+ requires numeric arguments",
          details: { argType: arg.type }
        });
      }
      sum += arg.value as number;
    }
    return Either.right(createNumber(sum));
  }, "+"));

  env.define("-", createFunction((args: TLispValue[]) => {
    if (args.length === 0) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "- requires at least 1 argument",
        details: { actual: args.length }
      });
    }
    const firstArg = args[0];
    if (!firstArg || firstArg.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "- requires numeric arguments",
        details: { firstArgType: firstArg?.type }
      });
    }

    let result = firstArg.value as number;
    if (args.length === 1) {
      return Either.right(createNumber(-result));
    }

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (!arg || arg.type !== "number") {
        return Either.left({
          type: 'EvalError',
          variant: 'TypeError',
          message: "- requires numeric arguments",
          details: { argIndex: i, argType: arg?.type }
        });
      }
      result -= arg.value as number;
    }
    return Either.right(createNumber(result));
  }, "-"));

  env.define("*", createFunction((args: TLispValue[]) => {
    let product = 1;
    for (const arg of args) {
      if (arg.type !== "number") {
        return Either.left({
          type: 'EvalError',
          variant: 'TypeError',
          message: "* requires numeric arguments",
          details: { argType: arg.type }
        });
      }
      product *= arg.value as number;
    }
    return Either.right(createNumber(product));
  }, "*"));

  env.define("/", createFunction((args: TLispValue[]) => {
    if (args.length === 0) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "/ requires at least 1 argument",
        details: { actual: args.length }
      });
    }
    const firstArg = args[0];
    if (!firstArg || firstArg.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "/ requires numeric arguments",
        details: { firstArgType: firstArg?.type }
      });
    }

    let result = firstArg.value as number;
    if (args.length === 1) {
      return Either.right(createNumber(1 / result));
    }

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (!arg || arg.type !== "number") {
        return Either.left({
          type: 'EvalError',
          variant: 'TypeError',
          message: "/ requires numeric arguments",
          details: { argIndex: i, argType: arg?.type }
        });
      }
      const divisor = arg.value as number;
      if (divisor === 0) {
        return Either.left({
          type: 'EvalError',
          variant: 'ArithmeticError',
          message: "Division by zero",
          details: { divisor }
        });
      }
      result /= divisor;
    }
    return Either.right(createNumber(result));
  }, "/"));
  
  // Comparison functions
  env.define("=", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "= requires exactly 2 arguments",
        details: { expected: 2, actual: args.length }
      });
    }

    const a = args[0];
    const b = args[1];

    if (!a || !b) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "= missing arguments",
        details: { hasA: !!a, hasB: !!b }
      });
    }

    if (a.type !== b.type) {
      return Either.right(createBoolean(false));
    }

    return Either.right(createBoolean(a.value === b.value));
  }, "="));

  env.define("<", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "< requires exactly 2 arguments",
        details: { expected: 2, actual: args.length }
      });
    }

    const a = args[0];
    const b = args[1];

    if (!a || !b) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "< missing arguments",
        details: { hasA: !!a, hasB: !!b }
      });
    }

    if (a.type !== "number" || b.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "< requires numeric arguments",
        details: { aType: a.type, bType: b.type }
      });
    }

    return Either.right(createBoolean((a.value as number) < (b.value as number)));
  }, "<"));

  env.define(">", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "> requires exactly 2 arguments",
        details: { expected: 2, actual: args.length }
      });
    }

    const a = args[0];
    const b = args[1];

    if (!a || !b) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "> missing arguments",
        details: { hasA: !!a, hasB: !!b }
      });
    }

    if (a.type !== "number" || b.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "> requires numeric arguments",
        details: { aType: a.type, bType: b.type }
      });
    }

    return Either.right(createBoolean((a.value as number) > (b.value as number)));
  }, ">"));
  
  // List functions
  env.define("cons", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "cons requires exactly 2 arguments",
        details: { expected: 2, actual: args.length }
      });
    }

    const elem = args[0];
    const list = args[1];

    if (!elem || !list) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "cons missing arguments",
        details: { hasElem: !!elem, hasList: !!list }
      });
    }

    if (list.type !== "list") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "cons requires second argument to be a list",
        details: { listType: list.type }
      });
    }

    const listElements = list.value as TLispValue[];
    return Either.right(createList([elem, ...listElements]));
  }, "cons"));

  env.define("car", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "car requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const list = args[0];
    if (!list) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "car missing argument",
        details: { args }
      });
    }

    if (list.type !== "list") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "car requires a list argument",
        details: { listType: list.type }
      });
    }

    const listElements = list.value as TLispValue[];
    if (listElements.length === 0) {
      return Either.right(createNil());
    }

    const first = listElements[0];
    if (!first) {
      return Either.right(createNil());
    }

    return Either.right(first);
  }, "car"));

  env.define("cdr", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "cdr requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const list = args[0];
    if (!list) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "cdr missing argument",
        details: { args }
      });
    }

    if (list.type !== "list") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "cdr requires a list argument",
        details: { listType: list.type }
      });
    }

    const listElements = list.value as TLispValue[];
    if (listElements.length === 0) {
      return Either.right(createList([]));
    }

    return Either.right(createList(listElements.slice(1)));
  }, "cdr"));

  // List constructor
  env.define("list", createFunction((args: TLispValue[]) => {
    return Either.right(createList(args));
  }, "list"));

  // Predicate functions
  env.define("null", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "null requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "null missing argument",
        details: { args }
      });
    }

    return Either.right(createBoolean(isNil(arg) || (arg.type === "list" && (arg.value as TLispValue[]).length === 0)));
  }, "null"));

  env.define("atom", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "atom requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "atom missing argument",
        details: { args }
      });
    }

    return Either.right(createBoolean(arg.type !== "list"));
  }, "atom"));

  env.define("eq", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "eq requires exactly 2 arguments",
        details: { expected: 2, actual: args.length }
      });
    }

    const a = args[0];
    const b = args[1];

    if (!a || !b) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "eq missing arguments",
        details: { hasA: !!a, hasB: !!b }
      });
    }

    return Either.right(createBoolean(a === b));
  }, "eq"));
  
  // ============================================================================
  // STANDARD LIBRARY FUNCTIONS
  // ============================================================================
  
  // String functions
  env.define("length", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "length requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "length missing argument",
        details: { args }
      });
    }

    if (arg.type === "string") {
      return Either.right(createNumber((arg.value as string).length));
    } else if (arg.type === "list") {
      return Either.right(createNumber((arg.value as TLispValue[]).length));
    } else {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "length requires string or list argument",
        details: { argType: arg.type }
      });
    }
  }, "length"));

  env.define("substring", createFunction((args: TLispValue[]) => {
    if (args.length !== 3) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "substring requires exactly 3 arguments: string, start, end",
        details: { expected: 3, actual: args.length }
      });
    }

    const str = args[0];
    const start = args[1];
    const end = args[2];

    if (!str || !start || !end) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "substring missing arguments",
        details: { hasStr: !!str, hasStart: !!start, hasEnd: !!end }
      });
    }

    if (str.type !== "string") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "substring first argument must be a string",
        details: { strType: str.type }
      });
    }

    if (start.type !== "number" || end.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "substring start and end must be numbers",
        details: { startType: start.type, endType: end.type }
      });
    }

    const s = str.value as string;
    const startIdx = start.value as number;
    const endIdx = end.value as number;

    return Either.right(createString(s.substring(startIdx, endIdx)));
  }, "substring"));

  env.define("string-append", createFunction((args: TLispValue[]) => {
    let result = "";
    for (const arg of args) {
      if (arg.type !== "string") {
        return Either.left({
          type: 'EvalError',
          variant: 'TypeError',
          message: "string-append requires string arguments",
          details: { argType: arg.type }
        });
      }
      result += arg.value as string;
    }
    return Either.right(createString(result));
  }, "string-append"));

  env.define("string=", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "string= requires exactly 2 arguments",
        details: { expected: 2, actual: args.length }
      });
    }

    const a = args[0];
    const b = args[1];

    if (!a || !b) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "string= missing arguments",
        details: { hasA: !!a, hasB: !!b }
      });
    }

    if (a.type !== "string" || b.type !== "string") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "string= requires string arguments",
        details: { aType: a.type, bType: b.type }
      });
    }

    return Either.right(createBoolean(a.value === b.value));
  }, "string="));

  env.define("string<", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "string< requires exactly 2 arguments",
        details: { expected: 2, actual: args.length }
      });
    }

    const a = args[0];
    const b = args[1];

    if (!a || !b) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "string< missing arguments",
        details: { hasA: !!a, hasB: !!b }
      });
    }

    if (a.type !== "string" || b.type !== "string") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "string< requires string arguments",
        details: { aType: a.type, bType: b.type }
      });
    }

    return Either.right(createBoolean((a.value as string) < (b.value as string)));
  }, "string<"));

  env.define("string>", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "string> requires exactly 2 arguments",
        details: { expected: 2, actual: args.length }
      });
    }

    const a = args[0];
    const b = args[1];

    if (!a || !b) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "string> missing arguments",
        details: { hasA: !!a, hasB: !!b }
      });
    }

    if (a.type !== "string" || b.type !== "string") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "string> requires string arguments",
        details: { aType: a.type, bType: b.type }
      });
    }

    return Either.right(createBoolean((a.value as string) > (b.value as string)));
  }, "string>"));

  env.define("string-upcase", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "string-upcase requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "string-upcase missing argument",
        details: { args }
      });
    }

    if (arg.type !== "string") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "string-upcase requires string argument",
        details: { argType: arg.type }
      });
    }

    return Either.right(createString((arg.value as string).toUpperCase()));
  }, "string-upcase"));

  env.define("string-downcase", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "string-downcase requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "string-downcase missing argument",
        details: { args }
      });
    }

    if (arg.type !== "string") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "string-downcase requires string argument",
        details: { argType: arg.type }
      });
    }

    return Either.right(createString((arg.value as string).toLowerCase()));
  }, "string-downcase"));
  
  // Advanced list functions
  env.define("append", createFunction((args: TLispValue[]) => {
    const result: TLispValue[] = [];
    for (const arg of args) {
      if (arg.type !== "list") {
        return Either.left({
          type: 'EvalError',
          variant: 'TypeError',
          message: "append requires list arguments",
          details: { argType: arg.type }
        });
      }
      result.push(...(arg.value as TLispValue[]));
    }
    return Either.right(createList(result));
  }, "append"));

  env.define("reverse", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "reverse requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "reverse missing argument",
        details: { args }
      });
    }

    if (arg.type !== "list") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "reverse requires list argument",
        details: { argType: arg.type }
      });
    }

    const list = arg.value as TLispValue[];
    return Either.right(createList([...list].reverse()));
  }, "reverse"));

  env.define("nth", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "nth requires exactly 2 arguments: index, list",
        details: { expected: 2, actual: args.length }
      });
    }

    const index = args[0];
    const list = args[1];

    if (!index || !list) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "nth missing arguments",
        details: { hasIndex: !!index, hasList: !!list }
      });
    }

    if (index.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "nth index must be a number",
        details: { indexType: index.type }
      });
    }

    if (list.type !== "list") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "nth second argument must be a list",
        details: { listType: list.type }
      });
    }

    const idx = index.value as number;
    const elements = list.value as TLispValue[];

    if (idx < 0 || idx >= elements.length) {
      return Either.right(createNil());
    }

    const element = elements[idx];
    return Either.right(element || createNil());
  }, "nth"));

  env.define("last", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "last requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "last missing argument",
        details: { args }
      });
    }

    if (arg.type !== "list") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "last requires list argument",
        details: { argType: arg.type }
      });
    }

    const list = arg.value as TLispValue[];
    if (list.length === 0) {
      return Either.right(createNil());
    }

    const lastElement = list[list.length - 1];
    return Either.right(lastElement || createNil());
  }, "last"));

  env.define("member", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "member requires exactly 2 arguments: item, list",
        details: { expected: 2, actual: args.length }
      });
    }

    const item = args[0];
    const list = args[1];

    if (!item || !list) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "member missing arguments",
        details: { hasItem: !!item, hasList: !!list }
      });
    }

    if (list.type !== "list") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "member second argument must be a list",
        details: { listType: list.type }
      });
    }

    const elements = list.value as TLispValue[];
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      if (element && element.type === item.type && element.value === item.value) {
        return Either.right(createList(elements.slice(i)));
      }
    }

    return Either.right(createNil());
  }, "member"));
  
  // Type predicates
  env.define("numberp", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "numberp requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "numberp missing argument",
        details: { args }
      });
    }

    return Either.right(createBoolean(arg.type === "number"));
  }, "numberp"));

  env.define("stringp", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "stringp requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "stringp missing argument",
        details: { args }
      });
    }

    return Either.right(createBoolean(arg.type === "string"));
  }, "stringp"));

  env.define("symbolp", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "symbolp requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "symbolp missing argument",
        details: { args }
      });
    }

    return Either.right(createBoolean(arg.type === "symbol"));
  }, "symbolp"));

  env.define("listp", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "listp requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "listp missing argument",
        details: { args }
      });
    }

    return Either.right(createBoolean(arg.type === "list"));
  }, "listp"));

  env.define("functionp", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "functionp requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "functionp missing argument",
        details: { args }
      });
    }

    return Either.right(createBoolean(arg.type === "function"));
  }, "functionp"));

  env.define("zerop", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "zerop requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "zerop missing argument",
        details: { args }
      });
    }

    if (arg.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "zerop requires number argument",
        details: { argType: arg.type }
      });
    }

    return Either.right(createBoolean(arg.value === 0));
  }, "zerop"));

  env.define("evenp", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "evenp requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "evenp missing argument",
        details: { args }
      });
    }

    if (arg.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "evenp requires number argument",
        details: { argType: arg.type }
      });
    }

    const num = arg.value as number;
    return Either.right(createBoolean(Math.floor(num) === num && num % 2 === 0));
  }, "evenp"));

  env.define("oddp", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "oddp requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "oddp missing argument",
        details: { args }
      });
    }

    if (arg.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "oddp requires number argument",
        details: { argType: arg.type }
      });
    }

    const num = arg.value as number;
    return Either.right(createBoolean(Math.floor(num) === num && num % 2 !== 0));
  }, "oddp"));

  // Mathematical functions
  env.define("abs", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "abs requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "abs missing argument",
        details: { args }
      });
    }

    if (arg.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "abs requires number argument",
        details: { argType: arg.type }
      });
    }

    return Either.right(createNumber(Math.abs(arg.value as number)));
  }, "abs"));

  env.define("min", createFunction((args: TLispValue[]) => {
    if (args.length === 0) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "min requires at least 1 argument",
        details: { actual: args.length }
      });
    }

    let min = Number.POSITIVE_INFINITY;
    for (const arg of args) {
      if (arg.type !== "number") {
        return Either.left({
          type: 'EvalError',
          variant: 'TypeError',
          message: "min requires numeric arguments",
          details: { argType: arg.type }
        });
      }
      const num = arg.value as number;
      if (num < min) {
        min = num;
      }
    }

    return Either.right(createNumber(min));
  }, "min"));

  env.define("max", createFunction((args: TLispValue[]) => {
    if (args.length === 0) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "max requires at least 1 argument",
        details: { actual: args.length }
      });
    }

    let max = Number.NEGATIVE_INFINITY;
    for (const arg of args) {
      if (arg.type !== "number") {
        return Either.left({
          type: 'EvalError',
          variant: 'TypeError',
          message: "max requires numeric arguments",
          details: { argType: arg.type }
        });
      }
      const num = arg.value as number;
      if (num > max) {
        max = num;
      }
    }

    return Either.right(createNumber(max));
  }, "max"));

  env.define("sqrt", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "sqrt requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "sqrt missing argument",
        details: { args }
      });
    }

    if (arg.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "sqrt requires number argument",
        details: { argType: arg.type }
      });
    }

    const num = arg.value as number;
    if (num < 0) {
      return Either.left({
        type: 'EvalError',
        variant: 'ArithmeticError',
        message: "sqrt of negative number",
        details: { number: num }
      });
    }

    return Either.right(createNumber(Math.sqrt(num)));
  }, "sqrt"));

  env.define("expt", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "expt requires exactly 2 arguments: base, exponent",
        details: { expected: 2, actual: args.length }
      });
    }

    const base = args[0];
    const exponent = args[1];

    if (!base || !exponent) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "expt missing arguments",
        details: { hasBase: !!base, hasExponent: !!exponent }
      });
    }

    if (base.type !== "number" || exponent.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "expt requires numeric arguments",
        details: { baseType: base.type, exponentType: exponent.type }
      });
    }

    return Either.right(createNumber(Math.pow(base.value as number, exponent.value as number)));
  }, "expt"));

  env.define("mod", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "mod requires exactly 2 arguments: dividend, divisor",
        details: { expected: 2, actual: args.length }
      });
    }

    const dividend = args[0];
    const divisor = args[1];

    if (!dividend || !divisor) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "mod missing arguments",
        details: { hasDividend: !!dividend, hasDivisor: !!divisor }
      });
    }

    if (dividend.type !== "number" || divisor.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "mod requires numeric arguments",
        details: { dividendType: dividend.type, divisorType: divisor.type }
      });
    }

    const divisorNum = divisor.value as number;
    if (divisorNum === 0) {
      return Either.left({
        type: 'EvalError',
        variant: 'ArithmeticError',
        message: "mod by zero",
        details: { divisor: divisorNum }
      });
    }

    return Either.right(createNumber((dividend.value as number) % divisorNum));
  }, "mod"));

  env.define("floor", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "floor requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "floor missing argument",
        details: { args }
      });
    }

    if (arg.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "floor requires number argument",
        details: { argType: arg.type }
      });
    }

    return Either.right(createNumber(Math.floor(arg.value as number)));
  }, "floor"));

  env.define("ceiling", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "ceiling requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "ceiling missing argument",
        details: { args }
      });
    }

    if (arg.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "ceiling requires number argument",
        details: { argType: arg.type }
      });
    }

    return Either.right(createNumber(Math.ceil(arg.value as number)));
  }, "ceiling"));

  env.define("round", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "round requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "round missing argument",
        details: { args }
      });
    }

    if (arg.type !== "number") {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "round requires number argument",
        details: { argType: arg.type }
      });
    }

    return Either.right(createNumber(Math.round(arg.value as number)));
  }, "round"));
  
  // Logical functions
  env.define("not", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "not requires exactly 1 argument",
        details: { expected: 1, actual: args.length }
      });
    }

    const arg = args[0];
    if (!arg) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: "not missing argument",
        details: { args }
      });
    }

    return Either.right(createBoolean(!isTruthy(arg)));
  }, "not"));

  // I/O functions
  env.define("print", createFunction((args: TLispValue[]) => {
    const output = args.map(arg => {
      if (arg.type === "string") {
        return arg.value as string;
      } else if (arg.type === "number") {
        return (arg.value as number).toString();
      } else if (arg.type === "boolean") {
        return (arg.value as boolean) ? "t" : "nil";
      } else if (arg.type === "nil") {
        return "nil";
      } else if (arg.type === "symbol") {
        return arg.value as string;
      } else if (arg.type === "list") {
        const elements = arg.value as TLispValue[];
        const elementStrings = elements.map(el => {
          if (el.type === "string") return `"${el.value}"`;
          if (el.type === "number") return (el.value as number).toString();
          if (el.type === "boolean") return (el.value as boolean) ? "t" : "nil";
          if (el.type === "nil") return "nil";
          if (el.type === "symbol") return el.value as string;
          return "[complex]";
        });
        return `(${elementStrings.join(" ")})`;
      } else {
        return "[function]";
      }
    }).join(" ");

    console.log(output);
    return Either.right(createNil());
  }, "print"));

  // Register standard library functions
  const interpreterMock = {
    defineBuiltin: (name: string, fn: any) => {
      env.define(name, createFunction(fn, name));
    },
    globalEnv: env,
    eval: (expr: TLispValue) => evaluator.eval(expr, env),
    execute: (source: string) => {
      // Simple execute implementation for the mock
      const parser = new TLispParser();
      const result = parser.parse(source);
      if (Either.isLeft(result)) {
        return result;
      }
      return evaluator.eval(result.right, env);
    },
    getTestDefinition: (name: string) => evaluator.getTestDefinition(name),
    getAllTestNames: () => evaluator.getAllTestNames(),
    getSuiteDefinition: (name: string) => evaluator.getSuiteDefinition(name),
    getAllSuiteNames: () => evaluator.getAllSuiteNames()
  } as any;
  registerStdlibFunctions(interpreterMock as any);

  // Register testing framework functions
  registerTestingFramework(interpreterMock as any);

  return { evaluator, env };
};