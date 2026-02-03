/**
 * @file plugin-ops.ts
 * @description T-Lisp API functions for plugin repository operations
 *
 * Provides plugin-list, plugin-show, plugin-install, plugin-search, and plugin-info functions
 */

import { TLispValue, createString, createList, createNil } from '../../tlisp/values';
import { TLispInterpreter } from '../../tlisp/types';
import { Either } from '../../utils/task-either';
import {
  listPlugins,
  getPlugin,
  searchPlugins,
  generatePluginTlisp,
  generatePluginToml,
  PluginMetadata
} from './plugin-repository';

/**
 * Create plugin repository operations
 */
export function createPluginOps(
  filesystem: any,
  getTlpaDir: () => string
): Map<string, (args: TLispValue[], interpreter: TLispInterpreter) => Either<Error, TLispValue>> {
  const ops = {
    /**
     * (plugin-list) -> List all available plugins
     */
    'plugin-list': (_args: TLispValue[], _interpreter: TLispInterpreter): Either<Error, TLispValue> => {
      const plugins = listPlugins();

      const pluginLists = plugins.map(plugin => createList([
        createString(plugin.name),
        createString(plugin.description),
        createString(plugin.author),
        createString(plugin.version),
        createString(plugin.installCommand)
      ]));

      return Either.right(createList(pluginLists));
    },

    /**
     * (plugin-show "plugin-name") -> Show detailed plugin information
     */
    'plugin-show': (args: TLispValue[]): Either<Error, TLispValue> => {
      if (args.length !== 1) {
        return Either.right(createString('Error: plugin-show requires exactly one argument (plugin-name)'));
      }

      const pluginName = args[0];
      if (pluginName.type !== 'string') {
        return Either.right(createString('Error: plugin-show argument must be a string'));
      }

      const plugin = getPlugin(pluginName.value);
      if (!plugin) {
        return Either.right(createString(`Error: Plugin not found: ${pluginName.value}`));
      }

      // Format as human-readable string
      const info = [
        `Name: ${plugin.name}`,
        `Description: ${plugin.description}`,
        `Author: ${plugin.author}`,
        `Version: ${plugin.version}`,
        `Install: ${plugin.installCommand}`
      ];

      if (plugin.homepage) {
        info.push(`Homepage: ${plugin.homepage}`);
      }

      if (plugin.license) {
        info.push(`License: ${plugin.license}`);
      }

      return Either.right(createString(info.join('\n')));
    },

    /**
     * (plugin-install "plugin-name") -> Install plugin to tlpa directory
     */
    'plugin-install': (args: TLispValue[]): Either<Error, TLispValue> => {
      if (args.length !== 1) {
        return Either.right(createString('Error: plugin-install requires exactly one argument (plugin-name)'));
      }

      const pluginName = args[0];
      if (pluginName.type !== 'string') {
        return Either.right(createString('Error: plugin-install argument must be a string'));
      }

      // Get plugin metadata
      const plugin = getPlugin(pluginName.value);
      if (!plugin) {
        return Either.right(createString(`Error: Plugin not found in repository: ${pluginName.value}`));
      }

      const tlpaDir = getTlpaDir();
      const pluginPath = `${tlpaDir}/${plugin.name}`;

      // For now, just return success message
      // In production, this would need to be async and handle the filesystem operations
      return Either.right(createString(`Plugin ${plugin.name} installation would create files at ${pluginPath}`));
    },

    /**
     * (plugin-search "pattern") -> Search plugins by pattern
     */
    'plugin-search': (args: TLispValue[]): Either<Error, TLispValue> => {
      if (args.length !== 1) {
        return Either.right(createString('Error: plugin-search requires exactly one argument (pattern)'));
      }

      const pattern = args[0];
      if (pattern.type !== 'string') {
        return Either.right(createString('Error: plugin-search argument must be a string'));
      }

      const plugins = searchPlugins(pattern.value);

      const pluginLists = plugins.map(plugin => createList([
        createString(plugin.name),
        createString(plugin.description),
        createString(plugin.author),
        createString(plugin.version),
        createString(plugin.installCommand)
      ]));

      return Either.right(createList(pluginLists));
    },

    /**
     * (plugin-info "plugin-name") -> Get structured plugin information
     */
    'plugin-info': (args: TLispValue[]): Either<Error, TLispValue> => {
      if (args.length !== 1) {
        return Either.right(createString('Error: plugin-info requires exactly one argument (plugin-name)'));
      }

      const pluginName = args[0];
      if (pluginName.type !== 'string') {
        return Either.right(createString('Error: plugin-info argument must be a string'));
      }

      const plugin = getPlugin(pluginName.value);
      if (!plugin) {
        return Either.right(createNil());
      }

      // Return structured information as a list
      return Either.right(createList([
        createString(plugin.name),
        createString(plugin.description),
        createString(plugin.author),
        createString(plugin.version),
        createString(plugin.installCommand),
        plugin.homepage ? createString(plugin.homepage) : createNil(),
        plugin.license ? createString(plugin.license) : createNil()
      ]));
    }
  };

  // Convert to Map
  return new Map(Object.entries(ops));
}
