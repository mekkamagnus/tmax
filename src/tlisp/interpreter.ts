/**
 * @file interpreter.ts
 * @description T-Lisp interpreter implementation
 */

import type { TLispInterpreter, TLispEnvironment, TLispValue, TLispFunctionImpl, TLispFunctionImplAsync, EvalError } from "./types.ts";
import { createEvalContext } from "./async.ts";
import type { EvalError as EvalErrorType } from "../error/types.ts";
import { TLispParser } from "./parser.ts";
import { TLispEvaluator, createEvaluatorWithBuiltins } from "./evaluator.ts";
import { createFunction, createNil } from "./values.ts";
import { Either } from "../utils/task-either.ts";
import { isCoverageEnabled, registerFunction } from "./test-coverage.ts";
import { ModuleRegistry } from "./module-registry.ts";
import { diagnosticToJSON } from "./diagnostics.ts";
import { renderDiagnostic } from "./diagnostic-renderer.ts";

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
    this.moduleRegistry = new ModuleRegistry();
    const { evaluator, builtinsEnv, env } = createEvaluatorWithBuiltins(this.moduleRegistry);
    this.evaluator = evaluator;
    this.builtinsEnv = builtinsEnv;
    this.globalEnv = env;
    evaluator.setModuleRegistry(this.moduleRegistry);
    evaluator.setBuiltinsEnv(builtinsEnv);
    this.registerDebugBuiltins();
  }

  /**
   * Get the evaluator's debug state
   */
  getDebugState() {
    return this.evaluator.getDebugState();
  }

  private registerDebugBuiltins(): void {
    const debugState = this.evaluator.getDebugState();

    this.defineBuiltin("trace", (args) => {
      if (args.length !== 1 || (args[0]?.type !== "symbol" && args[0]?.type !== "string")) {
        return Either.left({ type: 'EvalError', variant: 'TypeError', message: "trace requires a symbol or string name" });
      }
      const name = args[0].value as string;
      debugState.traceFunction(name);
      return Either.right({ type: 'string', value: `trace enabled: ${name}` });
    });

    this.defineBuiltin("untrace", (args) => {
      if (args.length !== 1 || (args[0]?.type !== "symbol" && args[0]?.type !== "string")) {
        return Either.left({ type: 'EvalError', variant: 'TypeError', message: "untrace requires a symbol or string name" });
      }
      const name = args[0].value as string;
      debugState.untraceFunction(name);
      return Either.right({ type: 'string', value: `trace disabled: ${name}` });
    });

    this.defineBuiltin("trace-list", (args) => {
      const names = debugState.getTracedFunctions();
      return Either.right({
        type: 'list',
        value: names.map(n => ({ type: 'string', value: n })),
      });
    });

    this.defineBuiltin("tlisp-last-error", (args) => {
      const d = debugState.getLastDiagnostic();
      if (!d) return Either.right(createNil());
      return Either.right({ type: 'string', value: renderDiagnostic(d) });
    });

    this.defineBuiltin("tlisp-last-error-json", (args) => {
      const d = debugState.getLastDiagnostic();
      if (!d) return Either.right(createNil());
      const json = diagnosticToJSON(d);
      const entries = Object.entries(json).map(([k, v]) => ({
        type: 'list' as const,
        value: [
          { type: 'string' as const, value: k },
          typeof v === 'string' ? { type: 'string' as const, value: v } : { type: 'string' as const, value: JSON.stringify(v) },
        ],
      }));
      return Either.right({ type: 'list', value: entries });
    });

    this.defineBuiltin("tlisp-backtrace", (args) => {
      const stack = debugState.getStack();
      if (stack.length === 0) return Either.right(createNil());
      const frames = stack.map((frame, i) => {
        const loc = frame.callSpan
          ? `:${frame.callSpan.start.line + 1}:${frame.callSpan.start.column + 1}`
          : "";
        const mod = frame.module ? ` at ${frame.module}` : "";
        return { type: 'string', value: `${i}: ${frame.function}${mod}${loc}` };
      });
      return Either.right({ type: 'list', value: frames });
    });
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

  async evalAsync(expr: TLispValue, env?: TLispEnvironment): Promise<Either<EvalError, TLispValue>> {
    const evalEnv = env || this.globalEnv;
    return this.evaluator.evalAsync(expr, evalEnv, createEvalContext());
  }

  /**
   * Execute T-Lisp source code (single expression or multiple expressions)
   * @param source - Source code to execute
   * @param env - Environment for execution
   * @returns Either with error or execution result (result of last expression for multiple expressions)
   */
  execute(source: string, env?: TLispEnvironment, sourceName?: string): Either<EvalError, TLispValue> {
    const evalEnv = env || this.globalEnv;
    const programResult = this.parser.parseProgram(source, sourceName);
    if (Either.isLeft(programResult)) {
      return Either.left({ type: 'EvalError', variant: 'SyntaxError', message: programResult.left.message });
    }

    const forms = programResult.right;
    if (forms.length === 0) {
      return Either.right(createNil());
    }

    let lastResult: Either<EvalError, TLispValue> | null = null;

    for (const form of forms) {
      const evalResult = this.evaluator.eval(form.value, evalEnv);
      if (Either.isLeft(evalResult)) {
        return evalResult;
      }
      lastResult = evalResult;
    }

    return lastResult || Either.right(createNil());
  }

  async executeAsync(source: string, env?: TLispEnvironment, sourceName?: string): Promise<Either<EvalError, TLispValue>> {
    const evalEnv = env || this.globalEnv;
    const programResult = this.parser.parseProgram(source, sourceName);
    if (Either.isLeft(programResult)) {
      return Either.left({ type: 'EvalError', variant: 'SyntaxError', message: programResult.left.message });
    }

    const forms = programResult.right;
    if (forms.length === 0) {
      return Either.right(createNil());
    }

    const context = createEvalContext({ sourceName });
    let lastResult: Either<EvalError, TLispValue> | null = null;

    for (const form of forms) {
      const evalResult = await this.evaluator.evalAsync(form.value, evalEnv, context);
      if (Either.isLeft(evalResult)) {
        return evalResult;
      }
      lastResult = evalResult;
    }

    return lastResult || Either.right(createNil());
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

    // Register builtin function for coverage tracking (US-0.6.6)
    if (isCoverageEnabled()) {
      registerFunction(name, undefined, undefined, true); // Mark as builtin
    }
  }

  defineAsyncBuiltin(name: string, fn: TLispFunctionImpl, asyncFn: TLispFunctionImplAsync): void {
    const func = createFunction(fn, name, asyncFn);
    this.builtinsEnv.define(name, func);

    if (isCoverageEnabled()) {
      registerFunction(name, undefined, undefined, true);
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
