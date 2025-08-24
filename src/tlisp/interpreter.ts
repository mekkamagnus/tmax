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
   * Execute T-Lisp source code (single expression or multiple expressions)
   * @param source - Source code to execute
   * @param env - Environment for execution
   * @returns Execution result (result of last expression for multiple expressions)
   */
  execute(source: string, env?: TLispEnvironment): TLispValue {
    // Handle multi-expression sources by splitting on lines and executing each
    const lines = source.split('\n');
    const evalEnv = env || this.globalEnv;
    let lastResult: TLispValue | null = null;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines and comments
      if (trimmedLine === '' || trimmedLine.startsWith(';')) {
        continue;
      }

      try {
        const expr = this.parse(trimmedLine);
        lastResult = this.eval(expr, evalEnv);
      } catch (error) {
        // Enhance error message with line context
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Error in line "${trimmedLine}": ${errorMessage}`);
      }
    }

    // Return the last result, or nil if no expressions were executed
    return lastResult || this.parse("nil");
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