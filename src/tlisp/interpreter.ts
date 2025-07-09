/**
 * @file interpreter.ts
 * @description T-Lisp interpreter implementation
 */

import type { TLispInterpreter, TLispEnvironment, TLispValue, TLispFunctionImpl } from "./types.ts";
import { TLispParser } from "./parser.ts";
import { TLispEvaluator, createEvaluatorWithBuiltins } from "./evaluator.ts";
import { createFunction } from "./values.ts";

/**
 * T-Lisp interpreter implementation
 * Complete implementation with parser, evaluator, and standard library
 */
export class TLispInterpreterImpl implements TLispInterpreter {
  public globalEnv: TLispEnvironment;
  private parser: TLispParser;
  private evaluator: TLispEvaluator;

  /**
   * Create a new T-Lisp interpreter
   */
  constructor() {
    this.parser = new TLispParser();
    const { evaluator, env } = createEvaluatorWithBuiltins();
    this.evaluator = evaluator;
    this.globalEnv = env;
  }

  /**
   * Parse T-Lisp source code
   * @param source - Source code to parse
   * @returns Parsed T-Lisp value
   */
  parse(source: string): TLispValue {
    return this.parser.parse(source);
  }

  /**
   * Evaluate T-Lisp expression
   * @param expr - Expression to evaluate
   * @param env - Environment for evaluation
   * @returns Evaluated result
   */
  eval(expr: TLispValue, env?: TLispEnvironment): TLispValue {
    const evalEnv = env || this.globalEnv;
    return this.evaluator.eval(expr, evalEnv);
  }

  /**
   * Execute T-Lisp source code
   * @param source - Source code to execute
   * @param env - Environment for execution
   * @returns Execution result
   */
  execute(source: string, env?: TLispEnvironment): TLispValue {
    const expr = this.parse(source);
    return this.eval(expr, env);
  }

  /**
   * Define a built-in function
   * @param name - Function name
   * @param fn - Function implementation
   */
  defineBuiltin(name: string, fn: TLispFunctionImpl): void {
    const func = createFunction(fn, name);
    this.globalEnv.define(name, func);
  }
}