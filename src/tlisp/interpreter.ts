/**
 * @file interpreter.ts
 * @description T-Lisp interpreter implementation
 */

import type { TLispInterpreter, TLispEnvironment, TLispValue, TLispFunctionImpl, EvalError } from "./types.ts";
import type { EvalError as EvalErrorType } from "../error/types.ts";
import { TLispParser } from "./parser.ts";
import { TLispEvaluator, createEvaluatorWithBuiltins } from "./evaluator.ts";
import { createFunction } from "./values.ts";
import { Either } from "../utils/task-either.ts";
import { isCoverageEnabled, registerFunction } from "./test-coverage.ts";
import { ModuleRegistry } from "./module-registry.ts";

/**
 * T-Lisp interpreter implementation
 * Complete implementation with parser, evaluator, and standard library
 */
export class TLispInterpreterImpl implements TLispInterpreter {
  public globalEnv: TLispEnvironment;
  public builtinsEnv: TLispEnvironment;
  public moduleRegistry: ModuleRegistry;
  private parser: TLispParser;
  private evaluator: TLispEvaluator;

  /**
   * Create a new T-Lisp interpreter
   */
  constructor() {
    this.parser = new TLispParser();
    const { evaluator, builtinsEnv, env } = createEvaluatorWithBuiltins();
    this.evaluator = evaluator;
    this.builtinsEnv = builtinsEnv;
    this.globalEnv = env;
    this.moduleRegistry = new ModuleRegistry();
    evaluator.setModuleRegistry(this.moduleRegistry);
    evaluator.setBuiltinsEnv(builtinsEnv);
  }

  /**
   * Parse T-Lisp source code
   * @param source - Source code to parse
   * @returns Parsed T-Lisp value
   */
  parse(source: string): TLispValue {
    const result = this.parser.parse(source);
    if ('left' in result) {
      throw new Error(`Parse error: ${result.left.message}`);
    }
    return result.right;
  }

  /**
   * Evaluate T-Lisp expression
   * @param expr - Expression to evaluate
   * @param env - Environment for evaluation
   * @returns Evaluated result
   */
  eval(expr: TLispValue, env?: TLispEnvironment): Either<EvalError, TLispValue> {
    const evalEnv = env || this.globalEnv;
    return this.evaluator.eval(expr, evalEnv);
  }

  /**
   * Execute T-Lisp source code (single expression or multiple expressions)
   * @param source - Source code to execute
   * @param env - Environment for execution
   * @returns Either with error or execution result (result of last expression for multiple expressions)
   */
  execute(source: string, env?: TLispEnvironment): Either<EvalError, TLispValue> {
    const forms = this.splitTopLevelForms(source);
    const evalEnv = env || this.globalEnv;
    let lastResult: Either<EvalError, TLispValue> | null = null;

    for (const form of forms) {
      const trimmedForm = form.trim();
      if (trimmedForm === "") {
        continue;
      }

      const exprResult = this.parser.parse(trimmedForm);
      if (Either.isLeft(exprResult)) {
        return Either.left({ type: 'EvalError', variant: 'SyntaxError', message: exprResult.left.message });
      }

      const expr = exprResult.right;
      const evalResult = this.evaluator.eval(expr, evalEnv);
      if (Either.isLeft(evalResult)) {
        return evalResult; // Return evaluation error
      }

      lastResult = evalResult;
    }

    // Return the last result, or nil if no expressions were executed
    if (lastResult) {
      return lastResult;
    }

    const nilResult = this.parser.parse("nil");
    if (Either.isLeft(nilResult)) {
      return Either.left({ type: 'EvalError', variant: 'SyntaxError', message: nilResult.left.message });
    }

    return Either.right(nilResult.right);
  }

  /**
   * Split source into top-level forms while preserving multi-line forms.
   */
  private splitTopLevelForms(source: string): string[] {
    const forms: string[] = [];
    let current = "";
    let depth = 0;
    let inString = false;
    let escaped = false;
    let inComment = false;

    const pushCurrent = () => {
      const trimmed = current.trim();
      if (trimmed) forms.push(trimmed);
      current = "";
    };

    for (let i = 0; i < source.length; i++) {
      const ch = source[i]!;

      if (inComment) {
        if (ch === "\n") {
          inComment = false;
          if (depth === 0) pushCurrent();
        }
        continue;
      }

      if (inString) {
        current += ch;
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === ";") {
        inComment = true;
        continue;
      }

      if (ch === '"') {
        inString = true;
        current += ch;
        continue;
      }

      if (ch === "(") {
        depth++;
        current += ch;
        continue;
      }

      if (ch === ")") {
        depth--;
        current += ch;
        if (depth === 0) pushCurrent();
        continue;
      }

      if (depth === 0 && /\s/.test(ch)) {
        pushCurrent();
        continue;
      }

      current += ch;
    }

    pushCurrent();
    return forms;
  }

  /**
   * Define a built-in function
   * @param name - Function name
   * @param fn - Function implementation that returns Either
   */
  defineBuiltin(name: string, fn: TLispFunctionImpl): void {
    const func = createFunction(fn, name);
    // Register into builtinsEnv so modules can see editor primitives
    this.builtinsEnv.define(name, func);
    // Also register into globalEnv for backward compat with code that iterates globalEnv.bindings
    this.globalEnv.define(name, func);

    // Register builtin function for coverage tracking (US-0.6.6)
    if (isCoverageEnabled()) {
      registerFunction(name, undefined, undefined, true); // Mark as builtin
    }
  }

  /**
   * Set the module loader hook for resolving module names to file paths
   */
  setModuleLoader(loader: (name: string) => Either<EvalErrorType, TLispValue> | null): void {
    (this.evaluator as any).setModuleLoader(loader);
  }

  /**
   * Get test definition by name
   * @param name - Name of the test
   * @returns Test definition or undefined if not found
   */
  getTestDefinition(name: string): { body: TLispValue[], name: string, params: TLispValue, isAsync?: boolean } | undefined {
    // Access the evaluator's test registry
    // Since the evaluator is private, we need to add a method to access the registry
    // This is a workaround - ideally we'd have a cleaner interface
    return (this.evaluator as any).getTestDefinition?.(name);
  }

  /**
   * Get all test names
   * @returns Array of test names
   */
  getAllTestNames(): string[] {
    // Access the evaluator's test registry
    return (this.evaluator as any).getAllTestNames?.() || [];
  }

  /**
   * Get suite definition by name.
   * @param name - Name of the suite
   * @returns Suite definition or undefined if not found
   */
  getSuiteDefinition(name: string): { body: TLispValue[], name: string, params: TLispValue, setup?: TLispValue[], teardown?: TLispValue[], tests: string[] } | undefined {
    return (this.evaluator as any).getSuiteDefinition?.(name);
  }

  /**
   * Get all suite names.
   * @returns Array of suite names
   */
  getAllSuiteNames(): string[] {
    return (this.evaluator as any).getAllSuiteNames?.() || [];
  }
}
