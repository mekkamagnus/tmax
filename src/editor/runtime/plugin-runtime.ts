/**
 * @file plugin-runtime.ts
 * @description CHORE-44 Change 3 — plugin discovery/wrapping/loading + macro
 * persistence, delegated by `Editor`.
 *
 * Plugin file parsing (module-name munging, defmodule detection, export
 * collection, module wrapping) is pure and lives here, not in `Editor`
 * (AC3.4: no plugin file parsing in `Editor`). Directory discovery + module
 * evaluation are driven through injected `FileSystem` / eval callbacks so the
 * collaborator never imports the concrete `Editor` class (AC3.3).
 */

import type { FileSystem } from "../../core/contracts/filesystem.ts";
import { Either } from "../../utils/task-either.ts";
import type { EvalError } from "../../error/types.ts";
import type { TLispValue } from "../../tlisp/types.ts";
import type { MacroOps } from "../api/macro-recording.ts";
import { loadMacrosFromFile, saveMacrosToFile } from "../api/macro-persistence.ts";

export interface PluginLoadResult {
  loaded: string[];
  skipped: string[];
  total: number;
  errors: Array<{ plugin: string; error: string }>;
}

export type PluginEvaluator = (code: string) => Either<EvalError, TLispValue>;

export class PluginRuntime {
  /** Build a safe module name for a plugin (`user/plugin/<safe>`). */
  pluginModuleName(pluginName: string): string {
    const safeName = pluginName
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `user/plugin/${safeName || "plugin"}`;
  }

  /** True if the plugin source already declares its own module. */
  pluginHasDefmodule(content: string): boolean {
    return /^\s*\(\s*defmodule\b/m.test(content);
  }

  /** Collect top-level defun/defvar/defmacro names as module exports. */
  collectPluginExports(content: string): string[] {
    const exports = new Set<string>();
    const pattern = /^\s*\(\s*def(?:un|var|macro)\s+([^\s()]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      if (name) exports.add(name);
    }
    return Array.from(exports);
  }

  /** Wrap a plugin's source in an isolated `defmodule` unless it already has one. */
  wrapPluginModule(pluginName: string, content: string): string {
    if (this.pluginHasDefmodule(content)) {
      return content;
    }
    const moduleName = this.pluginModuleName(pluginName);
    const exports = this.collectPluginExports(content);
    const exportForm = exports.length > 0 ? `(export ${exports.join(" ")})` : "(export)";
    return `(defmodule ${moduleName}\n  ${exportForm}\n\n${content}\n)\n`;
  }

  /** Discover and load plugins from a directory (US-2.1.1). */
  async loadPluginsFromDirectory(pluginDir: string, fs: FileSystem, evalCode: PluginEvaluator): Promise<PluginLoadResult> {
    const result: PluginLoadResult = { loaded: [], skipped: [], total: 0, errors: [] };

    try {
      const dirExists = await fs.exists(pluginDir);
      if (!dirExists) {
        result.errors.push({ plugin: "directory", error: `Plugin directory does not exist: ${pluginDir}` });
        return result;
      }

      let entryNames: string[];
      if (fs.readdir) {
        const allEntries = await fs.readdir(pluginDir);
        const dirEntries: string[] = [];
        for (const entry of allEntries) {
          const entryPath = `${pluginDir}/${entry}`;
          try {
            const stat = await fs.stat(entryPath);
            if (stat.isDirectory) {
              dirEntries.push(entry);
            }
          } catch { /* stat failed, assume not a directory */ }
        }
        entryNames = dirEntries;
      } else {
        const entriesWithTypes = await (await import("fs/promises")).readdir(pluginDir, { withFileTypes: true });
        entryNames = entriesWithTypes
          .filter((entry: { isDirectory: () => boolean }) => entry.isDirectory())
          .map((entry: { name: string }) => entry.name);
      }

      result.total = entryNames.length;

      for (const pluginName of entryNames) {
        const pluginPath = `${pluginDir}/${pluginName}`;
        try {
          const pluginFilePath = `${pluginPath}/plugin.tlisp`;
          const pluginFileExists = await fs.exists(pluginFilePath);
          if (!pluginFileExists) {
            result.skipped.push(pluginName);
            continue;
          }

          const tomlPath = `${pluginPath}/plugin.toml`;
          const tomlExists = await fs.exists(tomlPath);
          if (tomlExists) {
            try {
              await fs.readFile(tomlPath);
              console.log(`Loading plugin metadata from: ${tomlPath}`);
            } catch (error) {
              console.warn(`Warning: Failed to load plugin.toml for ${pluginName}: ${error}`);
            }
          }

          try {
            const pluginContent = await fs.readFile(pluginFilePath);
            const execResult = evalCode(this.wrapPluginModule(pluginName, pluginContent));
            if (Either.isLeft(execResult)) {
              result.errors.push({ plugin: pluginName, error: execResult.left.message });
              console.error(`Failed to load plugin ${pluginName}: ${execResult.left.message}`);
            } else {
              result.loaded.push(pluginName);
              console.log(`Loaded plugin: ${pluginName}`);
            }
          } catch (error) {
            result.errors.push({ plugin: pluginName, error: error instanceof Error ? error.message : String(error) });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.errors.push({ plugin: pluginName, error: errorMessage });
          console.error(`Failed to load plugin ${pluginName}: ${errorMessage}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push({ plugin: "directory", error: `Failed to read plugin directory: ${errorMessage}` });
    }

    return result;
  }

  /** Persist recorded macros to the macros file (US-2.4.2). */
  async saveMacros(fs: FileSystem, macros: MacroOps): Promise<boolean> {
    return saveMacrosToFile(fs, macros);
  }

  /** Load macros from the macros file into the per-editor macro state. */
  async loadMacros(fs: FileSystem, macros: MacroOps): Promise<boolean> {
    return loadMacrosFromFile(fs, macros);
  }
}
