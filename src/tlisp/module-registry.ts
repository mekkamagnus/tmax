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

export interface ModuleExportRecord {
  publicName: string;
  exportName: string;
  moduleName: string;
  value: any;
  env: TLispEnvironment;
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

  setSourcePath(name: string, sourcePath: string): void {
    const record = this.modules.get(name);
    if (record) {
      record.sourcePath = sourcePath;
    }
  }

  listModules(): ModuleRecord[] {
    return Array.from(this.modules.values());
  }

  listExports(): ModuleExportRecord[] {
    const loadedRecords = Array.from(this.modules.values()).filter((record) => record.state === "loaded");
    const exportCounts = new Map<string, number>();

    for (const record of loadedRecords) {
      for (const exportName of record.exports) {
        exportCounts.set(exportName, (exportCounts.get(exportName) ?? 0) + 1);
      }
    }

    const result: ModuleExportRecord[] = [];
    for (const record of loadedRecords) {
      if (record.state !== "loaded") continue;
      for (const exportName of record.exports) {
        const value = record.env.lookup(exportName);
        if (value !== undefined) {
          const duplicated = (exportCounts.get(exportName) ?? 0) > 1;
          result.push({
            publicName: duplicated ? `${record.name}/${exportName}` : exportName,
            exportName,
            moduleName: record.name,
            value,
            env: record.env,
          });
        }
      }
    }
    return result;
  }

  allExports(): Map<string, { value: any; moduleName: string; exportName: string; env: TLispEnvironment }> {
    const result = new Map<string, { value: any; moduleName: string; exportName: string; env: TLispEnvironment }>();
    for (const entry of this.listExports()) {
      result.set(entry.publicName, {
        value: entry.value,
        moduleName: entry.moduleName,
        exportName: entry.exportName,
        env: entry.env,
      });
    }
    return result;
  }

  resolveUniqueExport(exportName: string): ModuleExportRecord | "ambiguous" | undefined {
    const matches = this.listExports().filter((entry) => entry.exportName === exportName);
    if (matches.length === 0) return undefined;
    if (matches.length > 1) return "ambiguous";
    return matches[0];
  }

  resolvePublicName(publicName: string): ModuleExportRecord | undefined {
    const direct = this.listExports().find((entry) => entry.publicName === publicName);
    if (direct) return direct;

    const loadedRecords = Array.from(this.modules.values())
      .filter((record) => record.state === "loaded")
      .sort((left, right) => right.name.length - left.name.length);

    for (const record of loadedRecords) {
      const prefix = `${record.name}/`;
      if (!publicName.startsWith(prefix)) continue;
      const exportName = publicName.slice(prefix.length);
      if (!record.exports.has(exportName)) return undefined;
      const value = record.env.lookup(exportName);
      if (value === undefined) return undefined;
      return {
        publicName,
        exportName,
        moduleName: record.name,
        value,
        env: record.env,
      };
    }

    return undefined;
  }
}
