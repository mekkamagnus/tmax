/**
 * @file standalone.ts
 * @description Standalone T-Lisp runtime profile.
 */

import type { AppError } from "../../error/types.ts";
import { Either } from "../../utils/task-either.ts";
import { registerIOPrimitives, type StandaloneIOOptions } from "../io-ops.ts";
import { TLispInterpreterImpl } from "../interpreter.ts";
import { createModuleLoader, type ModuleLoaderOptions } from "../module-loader.ts";
import { registerSysPrimitives, type StandaloneSysOptions } from "../sys-ops.ts";
import type { TLispEnvironment, TLispFunction, TLispInterpreter, TLispValue } from "../types.ts";
import { createBoolean, createList, createNil, createString, createSymbol, valueToString } from "../values.ts";

export interface StandaloneProfileOptions extends StandaloneIOOptions, StandaloneSysOptions, ModuleLoaderOptions {
  registerModuleLoader?: boolean;
}

const evalError = (message: string, details?: Record<string, unknown>): AppError => ({
  type: "EvalError",
  variant: "RuntimeError",
  message,
  details,
});

function collectBindings(env: TLispEnvironment): Map<string, TLispValue> {
  const result = new Map<string, TLispValue>();
  let current: TLispEnvironment | undefined = env;
  while (current) {
    for (const [name, value] of current.bindings) {
      if (!result.has(name)) result.set(name, value);
    }
    current = current.parent;
  }
  return result;
}

function symbolName(value: TLispValue | undefined, builtinName: string): Either<AppError, string> {
  if (!value) return Either.left(evalError(`${builtinName} missing argument`));
  if (value.type === "symbol" || value.type === "string") return Either.right(value.value as string);
  if (value.type === "function" && "name" in value && typeof value.name === "string") return Either.right(value.name);
  return Either.left(evalError(`${builtinName} requires a symbol or string`, { actual: value.type }));
}

function registerStandaloneHelpers(interpreter: TLispInterpreter): void {
  interpreter.defineBuiltin("doc", (args: TLispValue[]) => {
    if (args.length !== 1) return Either.left(evalError("doc requires exactly 1 argument", { actual: args.length }));
    const nameResult = symbolName(args[0], "doc");
    if (Either.isLeft(nameResult)) return nameResult;
    const value = interpreter.globalEnv.lookup(nameResult.right);
    if (!value) return Either.right(createString(`No documentation for ${nameResult.right}`));
    if (value.type === "function") {
      const fn = value as TLispFunction;
      const docstring = fn.docstring ?? "(no docstring)";
      const params = fn.parameters?.length ? ` (${fn.parameters.join(" ")})` : "";
      return Either.right(createString(`${nameResult.right}${params}\n${docstring}`));
    }
    return Either.right(createString(`${nameResult.right}: ${valueToString(value)}`));
  });

  interpreter.defineBuiltin("apropos", (args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      return Either.left(evalError("apropos requires exactly 1 string argument", { actual: args.length }));
    }
    const pattern = args[0].value as string;
    const matches = Array.from(collectBindings(interpreter.globalEnv).keys())
      .filter((name) => name.includes(pattern))
      .sort()
      .map(createString);
    return Either.right(createList(matches));
  });

  interpreter.defineBuiltin("nilp", (args: TLispValue[]) => {
    if (args.length !== 1) return Either.left(evalError("nilp requires exactly 1 argument", { actual: args.length }));
    return Either.right(createBoolean(args[0]?.type === "nil"));
  });

  interpreter.defineBuiltin("ceil", (args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "number") {
      return Either.left(evalError("ceil requires exactly 1 number argument", { actual: args.length }));
    }
    const result = interpreter.execute(`(ceiling ${args[0].value as number})`);
    return Either.isLeft(result) ? result : Either.right(result.right);
  });

  interpreter.defineBuiltin("pow", (args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "number" || args[1]?.type !== "number") {
      return Either.left(evalError("pow requires exactly 2 number arguments", { actual: args.length }));
    }
    const result = interpreter.execute(`(expt ${args[0].value as number} ${args[1].value as number})`);
    return Either.isLeft(result) ? result : Either.right(result.right);
  });

  interpreter.defineBuiltin("loaded-modules", () => {
    const registry = (interpreter as TLispInterpreterImpl).moduleRegistry;
    return Either.right(createList(registry.listModules().map((record) => createSymbol(record.name))));
  });
}

export function registerStandaloneProfile(
  interpreter: TLispInterpreterImpl,
  options: StandaloneProfileOptions = {},
): TLispInterpreterImpl {
  registerIOPrimitives(interpreter, options);
  registerSysPrimitives(interpreter, options);
  registerStandaloneHelpers(interpreter);

  if (options.registerModuleLoader ?? true) {
    interpreter.setModuleLoader(createModuleLoader(interpreter, options));
  }

  return interpreter;
}

export function createStandaloneInterpreter(options: StandaloneProfileOptions = {}): TLispInterpreterImpl {
  return registerStandaloneProfile(new TLispInterpreterImpl(), options);
}
