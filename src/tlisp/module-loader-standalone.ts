/**
 * @file module-loader-standalone.ts
 * @description Standalone module resolution for T-Lisp.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, resolve } from "node:path";
import type { EvalError } from "../error/types.ts";
import { Either } from "../utils/task-either.ts";
import type { TLispValue } from "./types.ts";
import { STANDALONE_STDLIB_MODULES } from "./stdlib-assets.ts";
import type { TLispInterpreterImpl } from "./interpreter.ts";

export interface StandaloneModuleLoaderOptions {
  cwd?: string;
  tlispPath?: string;
  embeddedModules?: Record<string, string>;
}

const runtimeError = (message: string, details?: Record<string, unknown>): EvalError => ({
  type: "EvalError",
  variant: "RuntimeError",
  message,
  details,
});

const isSafeModuleName = (moduleName: string): boolean => {
  if (moduleName.trim() === "") return false;
  if (moduleName.includes("\0")) return false;
  if (moduleName.startsWith("/") || /^[A-Za-z]:[\\/]/.test(moduleName)) return false;
  return moduleName.split(/[\\/]/).every((part) => part !== "" && part !== "." && part !== "..");
};

const moduleFileName = (moduleName: string): string =>
  moduleName.endsWith(".tlisp") ? moduleName : `${moduleName}.tlisp`;

const safeResolve = (base: string, moduleName: string): string | null => {
  const normalizedBase = resolve(base);
  const candidate = resolve(normalizedBase, moduleFileName(moduleName));
  if (!candidate.startsWith(`${normalizedBase}/`) && candidate !== normalizedBase) {
    return null;
  }
  return normalize(candidate);
};

export function createStandaloneModuleLoader(
  interpreter: TLispInterpreterImpl,
  options: StandaloneModuleLoaderOptions = {},
): (name: string) => Either<EvalError, TLispValue> | null {
  const cwd = options.cwd ?? process.cwd();
  const embeddedModules = options.embeddedModules ?? STANDALONE_STDLIB_MODULES;
  const pathEntries = (options.tlispPath ?? process.env.TLISP_PATH ?? "")
    .split(":")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const loadSource = (moduleName: string, source: string): Either<EvalError, TLispValue> =>
    interpreter.execute(source);

  return (moduleName: string): Either<EvalError, TLispValue> | null => {
    if (!isSafeModuleName(moduleName)) {
      return Either.left(runtimeError(`Invalid module name '${moduleName}'`, { moduleName }));
    }

    const embedded = embeddedModules[moduleName];
    if (embedded !== undefined) {
      return loadSource(moduleName, embedded);
    }

    const searchRoots = [cwd, ...pathEntries];
    const searched: string[] = [];

    for (const root of searchRoots) {
      if (!isAbsolute(root) && root.includes("..")) continue;
      const candidate = safeResolve(root, moduleName);
      if (!candidate) continue;
      searched.push(candidate);
      if (existsSync(candidate)) {
        try {
          return loadSource(moduleName, readFileSync(candidate, "utf8"));
        } catch (error) {
          return Either.left(runtimeError(`Failed to load module '${moduleName}'`, {
            moduleName,
            path: candidate,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }

      const pluginCandidate = safeResolve(root, join(moduleName, "plugin"));
      if (pluginCandidate) {
        searched.push(pluginCandidate);
        if (existsSync(pluginCandidate)) {
          try {
            return loadSource(moduleName, readFileSync(pluginCandidate, "utf8"));
          } catch (error) {
            return Either.left(runtimeError(`Failed to load module '${moduleName}'`, {
              moduleName,
              path: pluginCandidate,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        }
      }
    }

    return Either.left(runtimeError(`Module '${moduleName}' not found`, { moduleName, searched }));
  };
}
