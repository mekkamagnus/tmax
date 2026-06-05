/**
 * @file module-ops.ts
 * @description T-Lisp module introspection builtins
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createBoolean, createList, createString, createNil } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import type { AppError } from "../../error/types.ts";
import type { ModuleRegistry } from "../../tlisp/module-registry.ts";

export function createModuleOps(
  getRegistry: () => ModuleRegistry,
  getCurrentModuleName: () => string | undefined,
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  // (module-loaded? "editor/motions")
  api.set("module-loaded?", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      return Either.left({ type: 'EvalError', variant: 'RuntimeError', message: "module-loaded? requires a string module name", details: {} });
    }
    const name = args[0].value as string;
    return Either.right(createBoolean(getRegistry().isLoaded(name)));
  });

  // (module-exports "editor/motions")
  api.set("module-exports", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      return Either.left({ type: 'EvalError', variant: 'RuntimeError', message: "module-exports requires a string module name", details: {} });
    }
    const name = args[0].value as string;
    const record = getRegistry().resolve(name);
    if (!record) return Either.right(createList([]));
    return Either.right(createList(Array.from(record.exports).map(s => createString(s))));
  });

  // (module-list)
  api.set("module-list", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left({ type: 'EvalError', variant: 'RuntimeError', message: "module-list takes no arguments", details: {} });
    }
    const modules = getRegistry().listModules();
    return Either.right(createList(modules.map(m => createString(m.name))));
  });

  // (module-lookup "editor/motions" "paragraph-next")
  api.set("module-lookup", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      return Either.left({ type: 'EvalError', variant: 'RuntimeError', message: "module-lookup requires module name and symbol name strings", details: {} });
    }
    const moduleName = args[0].value as string;
    const symName = args[1].value as string;
    const record = getRegistry().resolve(moduleName);
    if (!record || record.state !== "loaded") {
      return Either.left({ type: 'EvalError', variant: 'RuntimeError', message: `Module '${moduleName}' not loaded`, details: {} });
    }
    const value = record.env.lookup(symName);
    if (value === undefined) {
      return Either.left({ type: 'EvalError', variant: 'RuntimeError', message: `Symbol '${symName}' not found in module '${moduleName}'`, details: {} });
    }
    return Either.right(value);
  });

  // (describe-module "editor/motions")
  api.set("describe-module", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      return Either.left({ type: 'EvalError', variant: 'RuntimeError', message: "describe-module requires a string module name", details: {} });
    }
    const name = args[0].value as string;
    const record = getRegistry().resolve(name);
    if (!record) {
      return Either.right(createNil());
    }
    return Either.right(createList([
      createString(record.name),
      createString(record.state),
      createString(record.sourcePath || "unknown"),
      createList(Array.from(record.exports).map(s => createString(s))),
    ]));
  });

  // (current-module)
  api.set("current-module", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left({ type: 'EvalError', variant: 'RuntimeError', message: "current-module takes no arguments", details: {} });
    }
    const name = getCurrentModuleName();
    return Either.right(name ? createString(name) : createNil());
  });

  return api;
}
