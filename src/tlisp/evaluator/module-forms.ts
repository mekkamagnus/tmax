/**
 * @file module-forms.ts
 * @description CHORE-44 Change 4 AC4.7 — module/provide/require/defmodule/
 * require-module handler logic extracted from the ~5,000-line `evaluator.ts`
 * facade.
 *
 * Each handler is a free function taking a narrow {@link ModuleFormsContext}
 * (the surface area of `TLispEvaluator` these handlers actually need). The
 * evaluator's dispatch switch becomes a one-line delegation:
 *
 *   case "provide": return evalProvideForm(this, elements);
 *
 * `TLispEvaluator` remains the public facade + trampoline owner; this module
 * owns the IMPLEMENTATION bodies for module-related forms only. Behavior is
 * byte-for-byte preserved (the bodies are MOVED, not rewritten).
 */

import type { TLispValue, TLispEnvironment } from "../types.ts";
import type { ModuleRegistry } from "../module-registry.ts";
import type { EvalError } from "../../error/types.ts";
import { Either } from "../../utils/task-either.ts";
import { TLispEnvironmentImpl } from "../environment.ts";
import { createNil, createBoolean, createString, createSymbol } from "../values.ts";
import { validateProvide, validateFeaturep, validateRequire } from "./form-shapes.ts";

/**
 * Narrow evaluator surface required by module-form handlers. `TLispEvaluator`
 * implements this interface; tests may supply a fake. Keeping the surface
 * minimal prevents module-form logic from reaching into unrelated evaluator
 * internals and avoids a circular concrete import.
 */
export interface ModuleFormsContext {
  readonly moduleRegistry: ModuleRegistry | null;
  readonly builtinsEnv: TLispEnvironment | null;
  /** External module loader hook (set by the editor to resolve file paths). */
  readonly moduleLoader: ((name: string) => Either<EvalError, TLispValue> | null) | null;

  /**
   * Evaluate a single T-Lisp form in the given environment (sync). Used by
   * `defmodule` to evaluate body forms in the isolated module env.
   */
  evalForm(expr: TLispValue, env: TLispEnvironment): Either<EvalError, TLispValue>;

  /** Construct a diagnostic-backed EvalError (mirrors `TLispEvaluator.makeError`). */
  makeError(
    variant: EvalError['variant'],
    code: string,
    message: string,
    options?: {
      details?: Record<string, unknown>;
      expected?: string;
      actual?: string;
      help?: string;
    },
  ): EvalError;
}

/**
 * Evaluate `(provide "feature-name")`. Registers the feature so
 * `(featurep ...)` returns true; returns the feature name string.
 * (SPEC-003/007). Body MOVED from `TLispEvaluator.evalProvide`.
 */
export function evalProvideForm(
  _ctx: ModuleFormsContext,
  elements: TLispValue[],
): Either<EvalError, TLispValue> {
  const shape = validateProvide(elements);
  if (Either.isLeft(shape)) return Either.left(shape.left);
  const { feature } = shape.right;
  if (_ctx.moduleRegistry) {
    _ctx.moduleRegistry.provideFeature(feature);
  }
  return Either.right(createString(feature));
}

/**
 * Evaluate `(featurep "feature-name")`. Returns `t` if the feature has been
 * provided, nil otherwise. (SPEC-003/007). Body MOVED from
 * `TLispEvaluator.evalFeaturep`.
 */
export function evalFeaturepForm(
  _ctx: ModuleFormsContext,
  elements: TLispValue[],
): Either<EvalError, TLispValue> {
  const shape = validateFeaturep(elements);
  if (Either.isLeft(shape)) return Either.left(shape.left);
  const { feature } = shape.right;
  const provided = _ctx.moduleRegistry?.hasFeature(feature) ?? false;
  return Either.right(provided ? createBoolean(true) : createNil());
}

/**
 * Evaluate `(require "feature-name")`. Returns nil if the feature is already
 * provided, errors otherwise. (SPEC-003/007). Body MOVED from
 * `TLispEvaluator.evalRequire`.
 */
export function evalRequireForm(
  _ctx: ModuleFormsContext,
  elements: TLispValue[],
): Either<EvalError, TLispValue> {
  const shape = validateRequire(elements);
  if (Either.isLeft(shape)) return Either.left(shape.left);
  const { feature } = shape.right;
  const provided = _ctx.moduleRegistry?.hasFeature(feature) ?? false;
  if (!provided) {
    return Either.left({
      type: 'EvalError',
      variant: 'UndefinedSymbol',
      message: `Required feature not available: ${feature}`,
      details: { feature },
    });
  }
  return Either.right(createNil());
}

/**
 * Evaluate `(current-module)`. Returns the current module name as a string,
 * or nil if not inside a module. Body MOVED from
 * `TLispEvaluator.evalCurrentModule`.
 */
export function evalCurrentModuleForm(
  ctx: ModuleFormsContext,
  elements: TLispValue[],
  env: TLispEnvironment,
): Either<EvalError, TLispValue> {
  if (elements.length !== 1) {
    return Either.left({
      type: 'EvalError',
      variant: 'RuntimeError',
      message: "current-module takes no arguments",
      details: { actual: elements.length - 1 },
    });
  }
  const moduleName = currentModuleNameForEnv(ctx, env);
  return Either.right(moduleName ? createString(moduleName) : createNil());
}

/** Walk the env chain to find the module name owning the env (if any). */
function currentModuleNameForEnv(ctx: ModuleFormsContext, env: TLispEnvironment): string | undefined {
  if (!ctx.moduleRegistry) return undefined;
  let current: TLispEnvironment | undefined = env;
  while (current) {
    for (const record of ctx.moduleRegistry.listModules()) {
      if (record.env === current) return record.name;
    }
    current = current.parent;
  }
  return undefined;
}

/**
 * Evaluate `(defmodule name (export ...) (require-module ...) ...body)`.
 * Creates an isolated module environment, evaluates body, registers exports.
 * Body MOVED from `TLispEvaluator.evalDefmodule`.
 */
export function evalDefmoduleForm(
  ctx: ModuleFormsContext,
  elements: TLispValue[],
  env: TLispEnvironment,
): Either<EvalError, TLispValue> {
  if (elements.length < 3) {
    return Either.left({
      type: 'EvalError',
      variant: 'SyntaxError',
      message: "defmodule requires at least a name and body",
      details: { expected: "3+", actual: elements.length },
    });
  }

  const nameExpr = elements[1];
  if (!nameExpr || nameExpr.type !== "symbol") {
    return Either.left({
      type: 'EvalError',
      variant: 'SyntaxError',
      message: "defmodule name must be a symbol",
      details: { nameExpr },
    });
  }

  const moduleName = nameExpr.value as string;

  if (!ctx.moduleRegistry || !ctx.builtinsEnv) {
    return Either.left(ctx.makeError('RuntimeError', 'TL2001', "Module system not initialized", {
      details: { moduleName },
    }));
  }

  // Check for nested defmodule
  let currentEnv: TLispEnvironment | undefined = env;
  while (currentEnv) {
    if (currentEnv.moduleImports && currentEnv !== ctx.builtinsEnv) {
      for (const record of ctx.moduleRegistry.listModules()) {
        if (record.env === currentEnv) {
          return Either.left({
            type: 'EvalError',
            variant: 'SyntaxError',
            message: `Nested defmodule not allowed (already inside module '${record.name}')`,
            details: { moduleName, parentModule: record.name },
          });
        }
      }
    }
    currentEnv = currentEnv.parent;
  }

  // Check if already registered
  if (ctx.moduleRegistry.resolve(moduleName)) {
    return Either.right(createSymbol(moduleName));
  }

  // Create module environment as child of builtinsEnv (not globalEnv)
  const moduleEnv = new TLispEnvironmentImpl(ctx.builtinsEnv);
  moduleEnv.moduleImports = new Map();

  // Mark as loading for cycle detection
  ctx.moduleRegistry.setLoading(moduleName, moduleEnv, "");

  // Parse body elements: collect exports and evaluate the rest
  const exports = new Set<string>();
  const bodyForms: TLispValue[] = [];

  for (let i = 2; i < elements.length; i++) {
    const elem = elements[i];
    if (!elem || elem.type !== "list") {
      bodyForms.push(elem!);
      continue;
    }

    const listItems = elem.value as TLispValue[];
    if (listItems.length === 0) {
      bodyForms.push(elem);
      continue;
    }

    const first = listItems[0];
    if (first && first.type === "symbol") {
      const sym = first.value as string;

      if (sym === "export") {
        for (let j = 1; j < listItems.length; j++) {
          const exportSym = listItems[j];
          if (exportSym && exportSym.type === "symbol") {
            exports.add(exportSym.value as string);
          }
        }
        continue;
      }

      if (sym === "require-module") {
        // Evaluate require-module in the module env
        const reqResult = evalRequireModuleForm(ctx, listItems, moduleEnv);
        if (Either.isLeft(reqResult)) return reqResult;
        continue;
      }
    }

    bodyForms.push(elem);
  }

  // Evaluate body forms in module environment
  let lastResult: TLispValue = createNil();
  for (const form of bodyForms) {
    const result = ctx.evalForm(form, moduleEnv);
    if (Either.isLeft(result)) {
      ctx.moduleRegistry.setFailed(moduleName);
      return result;
    }
    lastResult = result.right;
  }

  // Register module with exports
  ctx.moduleRegistry.register(moduleName, moduleEnv, exports, "");

  return Either.right(createSymbol(moduleName));
}

/**
 * Evaluate `(require-module module-name [:as alias | :import [sym1 sym2 ...]])`.
 * Loads a module and registers the import in the current scope. Body MOVED
 * from `TLispEvaluator.evalRequireModule`.
 */
export function evalRequireModuleForm(
  ctx: ModuleFormsContext,
  elements: TLispValue[],
  env: TLispEnvironment,
): Either<EvalError, TLispValue> {
  if (elements.length < 2) {
    return Either.left({
      type: 'EvalError',
      variant: 'SyntaxError',
      message: "require-module requires at least a module name",
      details: { expected: "2+", actual: elements.length },
    });
  }

  const nameExpr = elements[1];
  if (!nameExpr || (nameExpr.type !== "symbol" && nameExpr.type !== "string")) {
    return Either.left({
      type: 'EvalError',
      variant: 'SyntaxError',
      message: "require-module name must be a symbol or string",
      details: { nameExpr },
    });
  }

  const moduleName = nameExpr.value as string;

  if (!ctx.moduleRegistry) {
    return Either.left(ctx.makeError('RuntimeError', 'TL2001', "Module system not initialized", {
      details: { moduleName },
    }));
  }

  // Check for circular dependency
  const existing = ctx.moduleRegistry.resolve(moduleName);
  if (existing && existing.state === "loading") {
    return Either.left(ctx.makeError('RuntimeError', 'TL2003', `Circular module dependency detected: '${moduleName}' is currently being loaded`, {
      details: { moduleName },
    }));
  }

  // Already loaded — just register the import
  if (!existing || existing.state !== "loaded") {
    // Module not yet loaded — attempt file resolution
    const loadResult = loadModuleFromDisk(ctx, moduleName);
    if (Either.isLeft(loadResult)) return loadResult;
  }

  const record = ctx.moduleRegistry.resolve(moduleName);
  if (!record || record.state !== "loaded") {
    return Either.left(ctx.makeError('RuntimeError', 'TL2001', `Module '${moduleName}' did not finish loading`, {
      details: { moduleName },
    }));
  }

  // Parse import style
  let alias: string;
  let importedSymbols: Set<string> | undefined;

  // Default alias: last segment of module name
  const lastSlash = moduleName.lastIndexOf("/");
  alias = lastSlash >= 0 ? moduleName.substring(lastSlash + 1) : moduleName;

  if (elements.length >= 3) {
    const flag = elements[2];
    if (flag && flag.type === "symbol") {
      const flagStr = flag.value as string;

      if (flagStr === ":as" || flagStr === "as") {
        // (require-module name :as alias)
        if (elements.length < 4 || !elements[3] || elements[3].type !== "symbol") {
          return Either.left({
            type: 'EvalError',
            variant: 'SyntaxError',
            message: "require-module :as requires a symbol alias",
            details: { elements },
          });
        }
        alias = elements[3].value as string;
      } else if (flagStr === ":import" || flagStr === "import") {
        // (require-module name :import [sym1 sym2 ...])
        if (elements.length < 4 || !elements[3] || elements[3].type !== "list") {
          return Either.left({
            type: 'EvalError',
            variant: 'SyntaxError',
            message: "require-module :import requires a list of symbols",
            details: { elements },
          });
        }
        importedSymbols = new Set<string>();
        const syms = (elements[3].value as TLispValue[]);
        for (const s of syms) {
          if (s.type === "symbol") {
            const importedName = s.value as string;
            if (!record.exports.has(importedName)) {
              return Either.left(ctx.makeError('UndefinedSymbol', 'TL2002', `Symbol '${importedName}' not exported from module '${moduleName}'`, {
                details: { moduleName, symbol: importedName, exports: [...record.exports] },
              }));
            }
            importedSymbols.add(importedName);
          }
        }
      }
    }
  }

  // Ensure env has import table
  if (!env.moduleImports) {
    env.moduleImports = new Map();
  }
  env.moduleImports.set(alias, { moduleName, alias, importedSymbols });

  return Either.right(createNil());
}

/**
 * Attempt to load a module from disk by resolving its name to a file path.
 * MOVED from `TLispEvaluator.loadModuleFromDisk`.
 */
function loadModuleFromDisk(ctx: ModuleFormsContext, moduleName: string): Either<EvalError, TLispValue> {
  // Resolution order: check module loader if registered
  if (ctx.moduleLoader) {
    const result = ctx.moduleLoader(moduleName);
    if (result) return result;
  }

  return Either.left(ctx.makeError('RuntimeError', 'TL2001', `Module '${moduleName}' not found`, {
    details: { moduleName },
  }));
}
