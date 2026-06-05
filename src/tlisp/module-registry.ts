/**
 * @file module-registry.ts
 * @description T-Lisp module registry for Guile/Racket-style module system
 */

import type { TLispEnvironment } from "./types.ts";

/**
 * Metadata for a single module import within a scope
 */
export interface ModuleImport {
  moduleName: string;
  alias: string;
  importedSymbols?: Set<string>;
}

/**
 * Record for a registered module
 */
export interface ModuleRecord {
  name: string;
  env: TLispEnvironment;
  exports: Set<string>;
  sourcePath: string;
  state: "loading" | "loaded" | "failed";
}

/**
 * Module registry — maps module names to environments, export sets, and loading state.
 */
export class ModuleRegistry {
  private modules: Map<string, ModuleRecord> = new Map();

  register(name: string, env: TLispEnvironment, exports: Set<string>, sourcePath: string): void {
    this.modules.set(name, {
      name,
      env,
      exports,
      sourcePath,
      state: "loaded",
    });
  }

  resolve(name: string): ModuleRecord | undefined {
    return this.modules.get(name);
  }

  isLoaded(name: string): boolean {
    const record = this.modules.get(name);
    return record !== undefined && record.state === "loaded";
  }

  setLoading(name: string, env: TLispEnvironment, sourcePath: string): void {
    this.modules.set(name, {
      name,
      env,
      exports: new Set(),
      sourcePath,
      state: "loading",
    });
  }

  setLoaded(name: string, exports: Set<string>): void {
    const record = this.modules.get(name);
    if (record) {
      record.exports = exports;
      record.state = "loaded";
    }
  }

  setFailed(name: string): void {
    const record = this.modules.get(name);
    if (record) {
      record.state = "failed";
    }
  }

  listModules(): ModuleRecord[] {
    return Array.from(this.modules.values());
  }

  allExports(): Map<string, { value: any; moduleName: string }> {
    const result = new Map<string, { value: any; moduleName: string }>();
    for (const record of this.modules.values()) {
      if (record.state !== "loaded") continue;
      for (const exportName of record.exports) {
        const value = record.env.lookup(exportName);
        if (value !== undefined) {
          result.set(exportName, { value, moduleName: record.name });
        }
      }
    }
    return result;
  }
}
