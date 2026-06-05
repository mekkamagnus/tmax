/**
 * @file module-loader.ts
 * @description Shared module resolution and loading for T-Lisp profiles.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, resolve } from "node:path";
import type { EvalError } from "../error/types.ts";
import { Either } from "../utils/task-either.ts";
import type { TLispValue } from "./types.ts";
import { STANDALONE_STDLIB_MODULES } from "./stdlib-assets.ts";
import type { TLispInterpreterImpl } from "./interpreter.ts";

export interface ModuleLoaderOptions {
  cwd?: string;
  tlispPath?: string;
  embeddedModules?: Record<string, string>;
  coreRoot?: string;
  packageRoots?: string[];
  userRoots?: string[];
}

export type ModuleLoader = (name: string) => Either<EvalError, TLispValue> | null;

const runtimeError = (message: string, details?: Record<string, unknown>): EvalError => ({
  type: "EvalError",
  variant: "RuntimeError",
  message,
  details,
});

export const isSafeModuleName = (moduleName: string): boolean => {
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

const coreModulePaths = (coreRoot: string, moduleName: string): string[] => {
  if (!moduleName.startsWith("editor/")) return [];
  const relativeName = moduleName.slice("editor/".length);
  const candidates = [relativeName];
  if (!relativeName.includes("/")) {
    candidates.push(`${relativeName}/${relativeName}`);
  }
  if (relativeName.startsWith("modes/") && !relativeName.endsWith("-mode")) {
    candidates.push(`${relativeName}-mode`);
  }
  return candidates
    .map((candidate) => safeResolve(coreRoot, candidate))
    .filter((candidate): candidate is string => candidate !== null);
};

const findDeclaredModuleName = (source: string): string | undefined => {
  const match = source.match(/\(\s*defmodule\s+([^\s()]+)/);
  return match?.[1];
};

export function createModuleLoader(
  interpreter: TLispInterpreterImpl,
  options: ModuleLoaderOptions = {},
): ModuleLoader {
  const cwd = options.cwd ?? process.cwd();
  const coreRoot = options.coreRoot ?? "src/tlisp/core";
  const embeddedModules = options.embeddedModules ?? STANDALONE_STDLIB_MODULES;
  const pathEntries = (options.tlispPath ?? process.env.TLISP_PATH ?? "")
    .split(":")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const searchRoots = [
    cwd,
    ...pathEntries,
    ...(options.packageRoots ?? []),
    ...(options.userRoots ?? []),
  ];

  const loadSource = (moduleName: string, source: string, sourcePath: string): Either<EvalError, TLispValue> => {
    const result = interpreter.execute(source);
    if (Either.isLeft(result)) return result;

    interpreter.moduleRegistry.setSourcePath(moduleName, sourcePath);
    const declaredName = findDeclaredModuleName(source);
    if (declaredName && declaredName !== moduleName) {
      interpreter.moduleRegistry.setSourcePath(declaredName, sourcePath);
    }

    return result;
  };

  return (moduleName: string): Either<EvalError, TLispValue> | null => {
    if (!isSafeModuleName(moduleName)) {
      return Either.left(runtimeError(`Invalid module name '${moduleName}'`, { moduleName }));
    }

    const embedded = embeddedModules[moduleName];
    if (embedded !== undefined) {
      return loadSource(moduleName, embedded, `<embedded:${moduleName}>`);
    }

    const searched: string[] = [];
    for (const coreCandidate of coreModulePaths(coreRoot, moduleName)) {
      searched.push(coreCandidate);
      if (existsSync(coreCandidate)) {
        try {
          return loadSource(moduleName, readFileSync(coreCandidate, "utf8"), coreCandidate);
        } catch (error) {
          return Either.left(runtimeError(`Failed to load module '${moduleName}'`, {
            moduleName,
            path: coreCandidate,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    }

    for (const root of searchRoots) {
      if (!isAbsolute(root) && root.includes("..")) continue;
      const candidate = safeResolve(root, moduleName);
      if (!candidate) continue;
      searched.push(candidate);
      if (existsSync(candidate)) {
        try {
          return loadSource(moduleName, readFileSync(candidate, "utf8"), candidate);
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
            return loadSource(moduleName, readFileSync(pluginCandidate, "utf8"), pluginCandidate);
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
