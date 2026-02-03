/**
 * @file plugin-repository.ts
 * @description Plugin repository system for tmax editor
 *
 * Provides plugin discovery, search, and installation functionality.
 * Plugins are stored in a central repository and can be installed to ~/.config/tmax/tlpa/
 */

/**
 * Plugin metadata from repository
 */
export interface PluginMetadata {
  /** Unique plugin identifier */
  name: string;
  /** Human-readable description */
  description: string;
  /** Plugin author */
  author: string;
  /** Semantic version */
  version: string;
  /** Installation command */
  installCommand: string;
  /** Plugin homepage URL */
  homepage?: string;
  /** Plugin license */
  license?: string;
  /** Required tmax version */
  tmaxVersion?: string;
  /** Plugin dependencies */
  dependencies?: Record<string, string>;
}

/**
 * Plugin repository
 * In production, this would be fetched from a remote URL
 */
const PLUGIN_REPOSITORY: PluginMetadata[] = [
  {
    name: 'theme-solarized',
    description: 'Solarized dark color theme for tmax',
    author: 'Tmax Community',
    version: '1.0.0',
    installCommand: 'plugin-install theme-solarized',
    homepage: 'https://github.com/tmax-editor/theme-solarized',
    license: 'MIT',
    tmaxVersion: '>=0.1.0'
  },
  {
    name: 'theme-monokai',
    description: 'Monokai color scheme for tmax',
    author: 'Tmax Community',
    version: '1.2.0',
    installCommand: 'plugin-install theme-monokai',
    homepage: 'https://github.com/tmax-editor/theme-monokai',
    license: 'MIT'
  },
  {
    name: 'lsp-typescript',
    description: 'TypeScript language server integration',
    author: 'Tmax Contributors',
    version: '2.0.1',
    installCommand: 'plugin-install lsp-typescript',
    homepage: 'https://github.com/tmax-editor/lsp-typescript',
    license: 'MIT',
    dependencies: {
      'tmax': '>=0.8.0'
    }
  },
  {
    name: 'git-integration',
    description: 'Git commands and status integration',
    author: 'Tmax Community',
    version: '1.5.0',
    installCommand: 'plugin-install git-integration',
    license: 'MIT'
  },
  {
    name: 'file-tree',
    description: 'File tree sidebar for navigation',
    author: 'Tmax Contributors',
    version: '0.9.0',
    installCommand: 'plugin-install file-tree',
    homepage: 'https://github.com/tmax-editor/file-tree',
    license: 'Apache-2.0'
  },
  {
    name: 'example-plugin',
    description: 'Example plugin demonstrating tmax plugin API',
    author: 'Tmax Community',
    version: '1.0.0',
    installCommand: 'plugin-install example-plugin',
    license: 'MIT'
  }
];

/**
 * Get all plugins from repository
 */
export function listPlugins(): PluginMetadata[] {
  return [...PLUGIN_REPOSITORY];
}

/**
 * Get plugin by name
 */
export function getPlugin(name: string): PluginMetadata | null {
  return PLUGIN_REPOSITORY.find(p => p.name === name) || null;
}

/**
 * Search plugins by pattern (case-insensitive)
 * Searches in both name and description
 */
export function searchPlugins(pattern: string): PluginMetadata[] {
  const lowerPattern = pattern.toLowerCase();
  return PLUGIN_REPOSITORY.filter(p =>
    p.name.toLowerCase().includes(lowerPattern) ||
    p.description.toLowerCase().includes(lowerPattern)
  );
}

/**
 * Generate plugin.tlisp content for a plugin
 */
export function generatePluginTlisp(plugin: PluginMetadata): string {
  const hasFunction = plugin.name === 'example-plugin';

  if (hasFunction) {
    return `;; ${plugin.name} - ${plugin.description}
;; Author: ${plugin.author}
;; Version: ${plugin.version}

;; Example plugin function
(defun example-function ()
  "An example function from ${plugin.name}"
  t)

;; Define plugin lifecycle functions
(defun plugin-init ()
  "Initialize ${plugin.name}"
  (status-message "${plugin.name} loaded"))

(defun plugin-enable ()
  "Enable ${plugin.name}"
  (status-message "${plugin.name} enabled"))

(defun plugin-disable ()
  "Disable ${plugin.name}"
  (status-message "${plugin.name} disabled"))

(plugin-init)
`;
  }

  return `;; ${plugin.name} - ${plugin.description}
;; Author: ${plugin.author}
;; Version: ${plugin.version}

;; Define plugin lifecycle functions
(defun plugin-init ()
  "Initialize ${plugin.name}"
  (status-message "${plugin.name} loaded"))

(defun plugin-enable ()
  "Enable ${plugin.name}"
  (status-message "${plugin.name} enabled"))

(defun plugin-disable ()
  "Disable ${plugin.name}"
  (status-message "${plugin.name} disabled"))

(plugin-init)
`;
}

/**
 * Generate plugin.toml content for a plugin
 */
export function generatePluginToml(plugin: PluginMetadata): string {
  let toml = `[plugin]
name = "${plugin.name}"
version = "${plugin.version}"
description = "${plugin.description}"
author = "${plugin.author}"
`;

  if (plugin.homepage) {
    toml += `homepage = "${plugin.homepage}"\n`;
  }

  if (plugin.license) {
    toml += `license = "${plugin.license}"\n`;
  }

  if (plugin.tmaxVersion) {
    toml += `\n[requirements]\ntmax-version = "${plugin.tmaxVersion}"\n`;
  }

  if (plugin.dependencies && Object.keys(plugin.dependencies).length > 0) {
    toml += `\n[dependencies]\n`;
    for (const [dep, version] of Object.entries(plugin.dependencies)) {
      toml += `${dep} = "${version}"\n`;
    }
  }

  return toml;
}
