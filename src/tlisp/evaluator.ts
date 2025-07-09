/**
 * @file evaluator.ts
 * @description T-Lisp evaluator implementation
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
} from "./values.ts";

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

/**
 * T-Lisp evaluator for executing T-Lisp expressions
 */
export class TLispEvaluator {
  /**
   * Evaluate a T-Lisp expression with tail-call optimization
   * @param expr - Expression to evaluate
   * @param env - Environment for evaluation
   * @returns Evaluated result
   */
  eval(expr: TLispValue, env: TLispEnvironment): TLispValue {
    let result: EvalResult = this.evalInternal(expr, env);
    
    // Trampoline: keep evaluating tail calls until we get a value
    while (isTailCall(result)) {
      // Evaluate function and arguments in the trampoline
      const tailCall = result as TailCall;
      const func = this.eval(tailCall.funcExpr, tailCall.env);
      const args = tailCall.argExprs.map(expr => this.eval(expr, tailCall.env));
      result = this.evalFunctionCallInternal(func, args, tailCall.env);
    }
    
    return result;
  }
  
  /**
   * Internal evaluation method that can return tail calls
   * @param expr - Expression to evaluate
   * @param env - Environment for evaluation
   * @param inTailPosition - Whether this evaluation is in tail position
   * @returns Evaluated result or tail call
   */
  private evalInternal(expr: TLispValue, env: TLispEnvironment, inTailPosition: boolean = false): EvalResult {
    switch (expr.type) {
      case "nil":
      case "boolean":
      case "number":
      case "string":
        // Self-evaluating literals
        return expr;
        
      case "symbol":
        return this.evalSymbol(expr, env);
        
      case "list":
        return this.evalList(expr, env, inTailPosition);
        
      case "function":
        return expr;
        
      default:
        throw new Error(`Unknown expression type: ${expr.type}`);
    }
  }

  /**
   * Evaluate a symbol by looking it up in the environment
   * @param symbol - Symbol to evaluate
   * @param env - Environment for lookup
   * @returns Symbol value
   */
  private evalSymbol(symbol: TLispValue, env: TLispEnvironment): TLispValue {
    const name = symbol.value as string;
    const value = env.lookup(name);
    
    if (value === undefined) {
      throw new Error(`Undefined symbol: ${name}`);
    }
    
    return value;
  }

  /**
   * Evaluate a list expression
   * @param list - List to evaluate
   * @param env - Environment for evaluation
   * @param inTailPosition - Whether this evaluation is in tail position
   * @returns Evaluated result or tail call
   */
  private evalList(list: TLispValue, env: TLispEnvironment, inTailPosition: boolean = false): EvalResult {
    const elements = list.value as TLispValue[];
    
    if (elements.length === 0) {
      return createList([]);
    }
    
    const first = elements[0];
    if (!first) {
      throw new Error("Empty list cannot be evaluated");
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
          throw new Error("unquote can only be used inside quasiquote");
        case "unquote-splicing":
          throw new Error("unquote-splicing can only be used inside quasiquote");
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
   * @returns Quoted expression
   */
  private evalQuote(elements: TLispValue[], env: TLispEnvironment): TLispValue {
    if (elements.length !== 2) {
      throw new Error("quote requires exactly 1 argument");
    }
    
    const expr = elements[1];
    if (!expr) {
      throw new Error("quote missing argument");
    }
    
    return expr;
  }

  /**
   * Evaluate if special form
   * @param elements - List elements
   * @param env - Environment
   * @param inTailPosition - Whether this evaluation is in tail position
   * @returns Conditional result
   */
  private evalIf(elements: TLispValue[], env: TLispEnvironment, inTailPosition: boolean = false): EvalResult {
    if (elements.length !== 4) {
      throw new Error("if requires exactly 3 arguments: condition, then-expr, else-expr");
    }
    
    const conditionExpr = elements[1];
    const thenExpr = elements[2];
    const elseExpr = elements[3];
    
    if (!conditionExpr || !thenExpr || !elseExpr) {
      throw new Error("if missing required arguments");
    }
    
    const condition = this.eval(conditionExpr, env);
    
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
   * @returns Let body result
   */
  private evalLet(elements: TLispValue[], env: TLispEnvironment, inTailPosition: boolean = false): EvalResult {
    if (elements.length !== 3) {
      throw new Error("let requires exactly 2 arguments: bindings and body");
    }
    
    const bindings = elements[1];
    const body = elements[2];
    
    if (!bindings || !body) {
      throw new Error("let missing required arguments");
    }
    
    if (bindings.type !== "list") {
      throw new Error("let bindings must be a list");
    }
    
    // Create new environment for let bindings
    const letEnv = new TLispEnvironmentImpl(env);
    
    // Process bindings
    const bindingList = bindings.value as TLispValue[];
    for (const binding of bindingList) {
      if (binding.type !== "list") {
        throw new Error("let binding must be a list");
      }
      
      const bindingElements = binding.value as TLispValue[];
      if (bindingElements.length !== 2) {
        throw new Error("let binding must have exactly 2 elements: name and value");
      }
      
      const name = bindingElements[0];
      const value = bindingElements[1];
      
      if (!name || !value) {
        throw new Error("let binding missing name or value");
      }
      
      if (name.type !== "symbol") {
        throw new Error("let binding name must be a symbol");
      }
      
      const evaluatedValue = this.eval(value, env);
      letEnv.define(name.value as string, evaluatedValue);
    }
    
    // Evaluate body in new environment
    return this.evalInternal(body, letEnv, inTailPosition);
  }

  /**
   * Evaluate lambda special form
   * @param elements - List elements
   * @param env - Environment
   * @returns Lambda function
   */
  private evalLambda(elements: TLispValue[], env: TLispEnvironment): TLispValue {
    if (elements.length !== 3) {
      throw new Error("lambda requires exactly 2 arguments: parameters and body");
    }
    
    const parameters = elements[1];
    const body = elements[2];
    
    if (!parameters || !body) {
      throw new Error("lambda missing required arguments");
    }
    
    if (parameters.type !== "list") {
      throw new Error("lambda parameters must be a list");
    }
    
    const paramList = parameters.value as TLispValue[];
    for (const param of paramList) {
      if (param.type !== "symbol") {
        throw new Error("lambda parameter must be a symbol");
      }
    }
    
    // Create closure with tail-call optimization support
    const lambdaFunction = (args: TLispValue[]): TLispValue => {
      if (args.length !== paramList.length) {
        throw new Error(`lambda expects ${paramList.length} arguments, got ${args.length}`);
      }
      
      // Create new environment for function call
      const callEnv = new TLispEnvironmentImpl(env);
      
      // Bind parameters to arguments
      for (let i = 0; i < paramList.length; i++) {
        const param = paramList[i];
        const arg = args[i];
        if (!param || !arg) {
          throw new Error("lambda parameter or argument missing");
        }
        const paramName = param.value as string;
        callEnv.define(paramName, arg);
      }
      
      // Evaluate body in tail position
      return this.eval(body, callEnv);
    };
    
    return createFunction(lambdaFunction);
  }

  /**
   * Evaluate defun special form
   * @param elements - List elements
   * @param env - Environment
   * @returns Function symbol
   */
  private evalDefun(elements: TLispValue[], env: TLispEnvironment): TLispValue {
    if (elements.length !== 4) {
      throw new Error("defun requires exactly 3 arguments: name, parameters, and body");
    }
    
    const name = elements[1];
    const parameters = elements[2];
    const body = elements[3];
    
    if (!name || !parameters || !body) {
      throw new Error("defun missing required arguments");
    }
    
    if (name.type !== "symbol") {
      throw new Error("defun name must be a symbol");
    }
    
    // Create lambda and bind it to the name
    const lambdaExpr = createList([createSymbol("lambda"), parameters, body]);
    const lambdaFunction = this.eval(lambdaExpr, env);
    
    env.define(name.value as string, lambdaFunction);
    
    return name;
  }

  /**
   * Evaluate quasiquote special form
   * @param elements - List elements
   * @param env - Environment
   * @returns Quasiquoted expression
   */
  private evalQuasiquote(elements: TLispValue[], env: TLispEnvironment): TLispValue {
    if (elements.length !== 2) {
      throw new Error("quasiquote requires exactly 1 argument");
    }
    
    const expr = elements[1];
    if (!expr) {
      throw new Error("quasiquote missing argument");
    }
    
    return this.expandQuasiquote(expr, env, 1);
  }

  /**
   * Expand quasiquote expression
   * @param expr - Expression to expand
   * @param env - Environment
   * @param depth - Nesting depth of quasiquotes
   * @returns Expanded expression
   */
  private expandQuasiquote(expr: TLispValue, env: TLispEnvironment, depth: number = 1): TLispValue {
    if (expr.type !== "list") {
      return expr;
    }
    
    const elements = expr.value as TLispValue[];
    if (elements.length === 0) {
      return createList([]);
    }
    
    const first = elements[0];
    if (!first) {
      return createList([]);
    }
    
    // Handle quasiquote - increase depth
    if (first.type === "symbol" && first.value === "quasiquote") {
      if (elements.length !== 2) {
        throw new Error("quasiquote requires exactly 1 argument");
      }
      const quasiExpr = elements[1];
      if (!quasiExpr) {
        throw new Error("quasiquote missing argument");
      }
      return createList([first, this.expandQuasiquote(quasiExpr, env, depth + 1)]);
    }
    
    // Handle unquote
    if (first.type === "symbol" && first.value === "unquote") {
      if (elements.length !== 2) {
        throw new Error("unquote requires exactly 1 argument");
      }
      const unquoteExpr = elements[1];
      if (!unquoteExpr) {
        throw new Error("unquote missing argument");
      }
      
      if (depth === 1) {
        // We're at the top level - evaluate the expression
        return this.eval(unquoteExpr, env);
      } else {
        // We're nested - decrease depth and continue
        return createList([first, this.expandQuasiquote(unquoteExpr, env, depth - 1)]);
      }
    }
    
    // Handle unquote-splicing
    if (first.type === "symbol" && first.value === "unquote-splicing") {
      if (depth === 1) {
        throw new Error("unquote-splicing can only be used inside a list");
      } else {
        // We're nested - decrease depth and continue
        if (elements.length !== 2) {
          throw new Error("unquote-splicing requires exactly 1 argument");
        }
        const spliceExpr = elements[1];
        if (!spliceExpr) {
          throw new Error("unquote-splicing missing argument");
        }
        return createList([first, this.expandQuasiquote(spliceExpr, env, depth - 1)]);
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
              throw new Error("unquote-splicing missing argument");
            }
            const spliceValue = this.eval(spliceExpr, env);
            if (spliceValue.type === "list") {
              const spliceList = spliceValue.value as TLispValue[];
              result.push(...spliceList);
            } else {
              throw new Error("unquote-splicing requires a list");
            }
          } else {
            // Nested - process recursively
            result.push(this.expandQuasiquote(element, env, depth));
          }
        } else {
          result.push(this.expandQuasiquote(element, env, depth));
        }
      } else {
        result.push(this.expandQuasiquote(element, env, depth));
      }
    }
    
    return createList(result);
  }

  /**
   * Evaluate defmacro special form
   * @param elements - List elements
   * @param env - Environment
   * @returns Macro symbol
   */
  private evalDefmacro(elements: TLispValue[], env: TLispEnvironment): TLispValue {
    if (elements.length !== 4) {
      throw new Error("defmacro requires exactly 3 arguments: name, parameters, and body");
    }
    
    const name = elements[1];
    const parameters = elements[2];
    const body = elements[3];
    
    if (!name || !parameters || !body) {
      throw new Error("defmacro missing required arguments");
    }
    
    if (name.type !== "symbol") {
      throw new Error("defmacro name must be a symbol");
    }
    
    if (parameters.type !== "list") {
      throw new Error("defmacro parameters must be a list");
    }
    
    const paramList = parameters.value as TLispValue[];
    for (const param of paramList) {
      if (param.type !== "symbol") {
        throw new Error("defmacro parameter must be a symbol");
      }
    }
    
    // Create macro function
    const macroFunction = (args: TLispValue[]): TLispValue => {
      if (args.length !== paramList.length) {
        throw new Error(`macro ${name.value} expects ${paramList.length} arguments, got ${args.length}`);
      }
      
      // Create new environment for macro expansion
      const macroEnv = new TLispEnvironmentImpl(env);
      
      // Bind parameters to arguments (unevaluated)
      for (let i = 0; i < paramList.length; i++) {
        const param = paramList[i];
        const arg = args[i];
        if (!param || !arg) {
          throw new Error("macro parameter or argument missing");
        }
        const paramName = param.value as string;
        macroEnv.define(paramName, arg);
      }
      
      // Evaluate body to generate code
      return this.eval(body, macroEnv);
    };
    
    const macro = createMacro(macroFunction, name.value as string);
    env.define(name.value as string, macro);
    
    return name;
  }

  /**
   * Evaluate function call
   * @param elements - List elements
   * @param env - Environment
   * @param inTailPosition - Whether this evaluation is in tail position
   * @returns Function result or tail call
   */
  private evalFunctionCall(elements: TLispValue[], env: TLispEnvironment, inTailPosition: boolean = false): EvalResult {
    const funcExpr = elements[0];
    if (!funcExpr) {
      throw new Error("Function call missing function expression");
    }
    
    const argExprs = elements.slice(1);
    
    // Check if this is a macro call
    if (funcExpr.type === "symbol") {
      const symbolName = funcExpr.value as string;
      const value = env.lookup(symbolName);
      if (value && isMacro(value)) {
        // Macro expansion - pass unevaluated arguments
        const macroImpl = value.value as (args: TLispValue[]) => TLispValue;
        const expanded = macroImpl(argExprs);
        // Evaluate the expanded form
        return this.evalInternal(expanded, env, inTailPosition);
      }
    }
    
    if (inTailPosition) {
      // Return tail call for optimization - defer evaluation
      return createTailCall(funcExpr, argExprs, env);
    } else {
      // Direct function call - evaluate immediately
      const func = this.eval(funcExpr, env);
      const args = argExprs.map(expr => this.eval(expr, env));
      return this.evalFunctionCallInternal(func, args, env);
    }
  }
  
  /**
   * Internal function call evaluation
   * @param func - Function to call
   * @param args - Arguments to pass
   * @param env - Environment
   * @returns Function result or tail call
   */
  private evalFunctionCallInternal(func: TLispValue, args: TLispValue[], env: TLispEnvironment): EvalResult {
    if (!func) {
      throw new Error("Function call missing function");
    }
    
    if (func.type === "function") {
      const functionImpl = func.value as (args: TLispValue[]) => TLispValue;
      return functionImpl(args);
    }
    
    if (func.type === "macro") {
      throw new Error("Macro cannot be called as function - this should be handled in evalFunctionCall");
    }
    
    throw new Error(`Cannot call non-function: ${func.type}`);
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
        throw new Error("+ requires numeric arguments");
      }
      sum += arg.value as number;
    }
    return createNumber(sum);
  }, "+"));
  
  env.define("-", createFunction((args: TLispValue[]) => {
    if (args.length === 0) {
      throw new Error("- requires at least 1 argument");
    }
    const firstArg = args[0];
    if (!firstArg || firstArg.type !== "number") {
      throw new Error("- requires numeric arguments");
    }
    
    let result = firstArg.value as number;
    if (args.length === 1) {
      return createNumber(-result);
    }
    
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (!arg || arg.type !== "number") {
        throw new Error("- requires numeric arguments");
      }
      result -= arg.value as number;
    }
    return createNumber(result);
  }, "-"));
  
  env.define("*", createFunction((args: TLispValue[]) => {
    let product = 1;
    for (const arg of args) {
      if (arg.type !== "number") {
        throw new Error("* requires numeric arguments");
      }
      product *= arg.value as number;
    }
    return createNumber(product);
  }, "*"));
  
  env.define("/", createFunction((args: TLispValue[]) => {
    if (args.length === 0) {
      throw new Error("/ requires at least 1 argument");
    }
    const firstArg = args[0];
    if (!firstArg || firstArg.type !== "number") {
      throw new Error("/ requires numeric arguments");
    }
    
    let result = firstArg.value as number;
    if (args.length === 1) {
      return createNumber(1 / result);
    }
    
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (!arg || arg.type !== "number") {
        throw new Error("/ requires numeric arguments");
      }
      const divisor = arg.value as number;
      if (divisor === 0) {
        throw new Error("Division by zero");
      }
      result /= divisor;
    }
    return createNumber(result);
  }, "/"));
  
  // Comparison functions
  env.define("=", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("= requires exactly 2 arguments");
    }
    
    const a = args[0];
    const b = args[1];
    
    if (!a || !b) {
      throw new Error("= missing arguments");
    }
    
    if (a.type !== b.type) {
      return createBoolean(false);
    }
    
    return createBoolean(a.value === b.value);
  }, "="));
  
  env.define("<", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("< requires exactly 2 arguments");
    }
    
    const a = args[0];
    const b = args[1];
    
    if (!a || !b) {
      throw new Error("< missing arguments");
    }
    
    if (a.type !== "number" || b.type !== "number") {
      throw new Error("< requires numeric arguments");
    }
    
    return createBoolean((a.value as number) < (b.value as number));
  }, "<"));
  
  env.define(">", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("> requires exactly 2 arguments");
    }
    
    const a = args[0];
    const b = args[1];
    
    if (!a || !b) {
      throw new Error("> missing arguments");
    }
    
    if (a.type !== "number" || b.type !== "number") {
      throw new Error("> requires numeric arguments");
    }
    
    return createBoolean((a.value as number) > (b.value as number));
  }, ">"));
  
  // List functions
  env.define("cons", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("cons requires exactly 2 arguments");
    }
    
    const elem = args[0];
    const list = args[1];
    
    if (!elem || !list) {
      throw new Error("cons missing arguments");
    }
    
    if (list.type !== "list") {
      throw new Error("cons requires second argument to be a list");
    }
    
    const listElements = list.value as TLispValue[];
    return createList([elem, ...listElements]);
  }, "cons"));
  
  env.define("car", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("car requires exactly 1 argument");
    }
    
    const list = args[0];
    if (!list) {
      throw new Error("car missing argument");
    }
    
    if (list.type !== "list") {
      throw new Error("car requires a list argument");
    }
    
    const listElements = list.value as TLispValue[];
    if (listElements.length === 0) {
      return createNil();
    }
    
    const first = listElements[0];
    if (!first) {
      return createNil();
    }
    
    return first;
  }, "car"));
  
  env.define("cdr", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("cdr requires exactly 1 argument");
    }
    
    const list = args[0];
    if (!list) {
      throw new Error("cdr missing argument");
    }
    
    if (list.type !== "list") {
      throw new Error("cdr requires a list argument");
    }
    
    const listElements = list.value as TLispValue[];
    if (listElements.length === 0) {
      return createList([]);
    }
    
    return createList(listElements.slice(1));
  }, "cdr"));
  
  // Predicate functions
  env.define("null", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("null requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("null missing argument");
    }
    
    return createBoolean(isNil(arg) || (arg.type === "list" && (arg.value as TLispValue[]).length === 0));
  }, "null"));
  
  env.define("atom", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("atom requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("atom missing argument");
    }
    
    return createBoolean(arg.type !== "list");
  }, "atom"));
  
  env.define("eq", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("eq requires exactly 2 arguments");
    }
    
    const a = args[0];
    const b = args[1];
    
    if (!a || !b) {
      throw new Error("eq missing arguments");
    }
    
    return createBoolean(a === b);
  }, "eq"));
  
  // ============================================================================
  // STANDARD LIBRARY FUNCTIONS
  // ============================================================================
  
  // String functions
  env.define("length", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("length requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("length missing argument");
    }
    
    if (arg.type === "string") {
      return createNumber((arg.value as string).length);
    } else if (arg.type === "list") {
      return createNumber((arg.value as TLispValue[]).length);
    } else {
      throw new Error("length requires string or list argument");
    }
  }, "length"));
  
  env.define("substring", createFunction((args: TLispValue[]) => {
    if (args.length !== 3) {
      throw new Error("substring requires exactly 3 arguments: string, start, end");
    }
    
    const str = args[0];
    const start = args[1];
    const end = args[2];
    
    if (!str || !start || !end) {
      throw new Error("substring missing arguments");
    }
    
    if (str.type !== "string") {
      throw new Error("substring first argument must be a string");
    }
    
    if (start.type !== "number" || end.type !== "number") {
      throw new Error("substring start and end must be numbers");
    }
    
    const s = str.value as string;
    const startIdx = start.value as number;
    const endIdx = end.value as number;
    
    return createString(s.substring(startIdx, endIdx));
  }, "substring"));
  
  env.define("string-append", createFunction((args: TLispValue[]) => {
    let result = "";
    for (const arg of args) {
      if (arg.type !== "string") {
        throw new Error("string-append requires string arguments");
      }
      result += arg.value as string;
    }
    return createString(result);
  }, "string-append"));
  
  env.define("string=", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("string= requires exactly 2 arguments");
    }
    
    const a = args[0];
    const b = args[1];
    
    if (!a || !b) {
      throw new Error("string= missing arguments");
    }
    
    if (a.type !== "string" || b.type !== "string") {
      throw new Error("string= requires string arguments");
    }
    
    return createBoolean(a.value === b.value);
  }, "string="));
  
  env.define("string<", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("string< requires exactly 2 arguments");
    }
    
    const a = args[0];
    const b = args[1];
    
    if (!a || !b) {
      throw new Error("string< missing arguments");
    }
    
    if (a.type !== "string" || b.type !== "string") {
      throw new Error("string< requires string arguments");
    }
    
    return createBoolean((a.value as string) < (b.value as string));
  }, "string<"));
  
  env.define("string>", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("string> requires exactly 2 arguments");
    }
    
    const a = args[0];
    const b = args[1];
    
    if (!a || !b) {
      throw new Error("string> missing arguments");
    }
    
    if (a.type !== "string" || b.type !== "string") {
      throw new Error("string> requires string arguments");
    }
    
    return createBoolean((a.value as string) > (b.value as string));
  }, "string>"));
  
  env.define("string-upcase", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("string-upcase requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("string-upcase missing argument");
    }
    
    if (arg.type !== "string") {
      throw new Error("string-upcase requires string argument");
    }
    
    return createString((arg.value as string).toUpperCase());
  }, "string-upcase"));
  
  env.define("string-downcase", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("string-downcase requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("string-downcase missing argument");
    }
    
    if (arg.type !== "string") {
      throw new Error("string-downcase requires string argument");
    }
    
    return createString((arg.value as string).toLowerCase());
  }, "string-downcase"));
  
  // Advanced list functions
  env.define("append", createFunction((args: TLispValue[]) => {
    const result: TLispValue[] = [];
    for (const arg of args) {
      if (arg.type !== "list") {
        throw new Error("append requires list arguments");
      }
      result.push(...(arg.value as TLispValue[]));
    }
    return createList(result);
  }, "append"));
  
  env.define("reverse", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("reverse requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("reverse missing argument");
    }
    
    if (arg.type !== "list") {
      throw new Error("reverse requires list argument");
    }
    
    const list = arg.value as TLispValue[];
    return createList([...list].reverse());
  }, "reverse"));
  
  env.define("nth", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("nth requires exactly 2 arguments: index, list");
    }
    
    const index = args[0];
    const list = args[1];
    
    if (!index || !list) {
      throw new Error("nth missing arguments");
    }
    
    if (index.type !== "number") {
      throw new Error("nth index must be a number");
    }
    
    if (list.type !== "list") {
      throw new Error("nth second argument must be a list");
    }
    
    const idx = index.value as number;
    const elements = list.value as TLispValue[];
    
    if (idx < 0 || idx >= elements.length) {
      return createNil();
    }
    
    const element = elements[idx];
    return element || createNil();
  }, "nth"));
  
  env.define("last", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("last requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("last missing argument");
    }
    
    if (arg.type !== "list") {
      throw new Error("last requires list argument");
    }
    
    const list = arg.value as TLispValue[];
    if (list.length === 0) {
      return createNil();
    }
    
    const lastElement = list[list.length - 1];
    return lastElement || createNil();
  }, "last"));
  
  env.define("member", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("member requires exactly 2 arguments: item, list");
    }
    
    const item = args[0];
    const list = args[1];
    
    if (!item || !list) {
      throw new Error("member missing arguments");
    }
    
    if (list.type !== "list") {
      throw new Error("member second argument must be a list");
    }
    
    const elements = list.value as TLispValue[];
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      if (element && element.type === item.type && element.value === item.value) {
        return createList(elements.slice(i));
      }
    }
    
    return createNil();
  }, "member"));
  
  // Type predicates
  env.define("numberp", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("numberp requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("numberp missing argument");
    }
    
    return createBoolean(arg.type === "number");
  }, "numberp"));
  
  env.define("stringp", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("stringp requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("stringp missing argument");
    }
    
    return createBoolean(arg.type === "string");
  }, "stringp"));
  
  env.define("symbolp", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("symbolp requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("symbolp missing argument");
    }
    
    return createBoolean(arg.type === "symbol");
  }, "symbolp"));
  
  env.define("listp", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("listp requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("listp missing argument");
    }
    
    return createBoolean(arg.type === "list");
  }, "listp"));
  
  env.define("functionp", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("functionp requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("functionp missing argument");
    }
    
    return createBoolean(arg.type === "function");
  }, "functionp"));
  
  env.define("zerop", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("zerop requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("zerop missing argument");
    }
    
    if (arg.type !== "number") {
      throw new Error("zerop requires number argument");
    }
    
    return createBoolean(arg.value === 0);
  }, "zerop"));
  
  env.define("evenp", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("evenp requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("evenp missing argument");
    }
    
    if (arg.type !== "number") {
      throw new Error("evenp requires number argument");
    }
    
    const num = arg.value as number;
    return createBoolean(Math.floor(num) === num && num % 2 === 0);
  }, "evenp"));
  
  env.define("oddp", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("oddp requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("oddp missing argument");
    }
    
    if (arg.type !== "number") {
      throw new Error("oddp requires number argument");
    }
    
    const num = arg.value as number;
    return createBoolean(Math.floor(num) === num && num % 2 !== 0);
  }, "oddp"));
  
  // Mathematical functions
  env.define("abs", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("abs requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("abs missing argument");
    }
    
    if (arg.type !== "number") {
      throw new Error("abs requires number argument");
    }
    
    return createNumber(Math.abs(arg.value as number));
  }, "abs"));
  
  env.define("min", createFunction((args: TLispValue[]) => {
    if (args.length === 0) {
      throw new Error("min requires at least 1 argument");
    }
    
    let min = Number.POSITIVE_INFINITY;
    for (const arg of args) {
      if (arg.type !== "number") {
        throw new Error("min requires numeric arguments");
      }
      const num = arg.value as number;
      if (num < min) {
        min = num;
      }
    }
    
    return createNumber(min);
  }, "min"));
  
  env.define("max", createFunction((args: TLispValue[]) => {
    if (args.length === 0) {
      throw new Error("max requires at least 1 argument");
    }
    
    let max = Number.NEGATIVE_INFINITY;
    for (const arg of args) {
      if (arg.type !== "number") {
        throw new Error("max requires numeric arguments");
      }
      const num = arg.value as number;
      if (num > max) {
        max = num;
      }
    }
    
    return createNumber(max);
  }, "max"));
  
  env.define("sqrt", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("sqrt requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("sqrt missing argument");
    }
    
    if (arg.type !== "number") {
      throw new Error("sqrt requires number argument");
    }
    
    const num = arg.value as number;
    if (num < 0) {
      throw new Error("sqrt of negative number");
    }
    
    return createNumber(Math.sqrt(num));
  }, "sqrt"));
  
  env.define("expt", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("expt requires exactly 2 arguments: base, exponent");
    }
    
    const base = args[0];
    const exponent = args[1];
    
    if (!base || !exponent) {
      throw new Error("expt missing arguments");
    }
    
    if (base.type !== "number" || exponent.type !== "number") {
      throw new Error("expt requires numeric arguments");
    }
    
    return createNumber(Math.pow(base.value as number, exponent.value as number));
  }, "expt"));
  
  env.define("mod", createFunction((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("mod requires exactly 2 arguments: dividend, divisor");
    }
    
    const dividend = args[0];
    const divisor = args[1];
    
    if (!dividend || !divisor) {
      throw new Error("mod missing arguments");
    }
    
    if (dividend.type !== "number" || divisor.type !== "number") {
      throw new Error("mod requires numeric arguments");
    }
    
    const divisorNum = divisor.value as number;
    if (divisorNum === 0) {
      throw new Error("mod by zero");
    }
    
    return createNumber((dividend.value as number) % divisorNum);
  }, "mod"));
  
  env.define("floor", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("floor requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("floor missing argument");
    }
    
    if (arg.type !== "number") {
      throw new Error("floor requires number argument");
    }
    
    return createNumber(Math.floor(arg.value as number));
  }, "floor"));
  
  env.define("ceiling", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("ceiling requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("ceiling missing argument");
    }
    
    if (arg.type !== "number") {
      throw new Error("ceiling requires number argument");
    }
    
    return createNumber(Math.ceil(arg.value as number));
  }, "ceiling"));
  
  env.define("round", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("round requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("round missing argument");
    }
    
    if (arg.type !== "number") {
      throw new Error("round requires number argument");
    }
    
    return createNumber(Math.round(arg.value as number));
  }, "round"));
  
  // Logical functions
  env.define("not", createFunction((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("not requires exactly 1 argument");
    }
    
    const arg = args[0];
    if (!arg) {
      throw new Error("not missing argument");
    }
    
    return createBoolean(!isTruthy(arg));
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
    return createNil();
  }, "print"));
  
  return { evaluator, env };
};