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

/**
 * Plugin submission for review
 */
export interface PluginSubmission {
  /** Unique plugin identifier */
  name: string;
  /** Human-readable description */
  description: string;
  /** Plugin author */
  author: string;
  /** Submission timestamp */
  submittedAt: Date;
  /** Submission status */
  status: 'pending' | 'approved' | 'rejected';
  /** Rejection reason (if rejected) */
  rejectionReason?: string;
}

/**
 * In-memory store for plugin submissions
 * In production, this would be persisted to a database or file
 */
const PLUGIN_SUBMISSIONS: Map<string, PluginSubmission> = new Map();

/**
 * Validate plugin name format
 * Must be lowercase, alphanumeric, hyphens only
 */
export function validatePluginName(name: string): boolean {
  return /^[a-z0-9-]+$/.test(name) && name.length > 0 && name.length <= 50;
}

/**
 * Submit a plugin for review
 */
export function submitPlugin(
  name: string,
  description: string,
  author: string
): { success: boolean; message: string; submission?: PluginSubmission } {
  // Validate inputs
  if (!name || !description || !author) {
    return {
      success: false,
      message: 'Error: plugin-submit requires name, description, and author'
    };
  }

  // Validate plugin name format
  if (!validatePluginName(name)) {
    return {
      success: false,
      message: 'Error: Plugin name must be lowercase letters, numbers, and hyphens only (e.g., "my-plugin")'
    };
  }

  // Check for duplicate in repository
  if (getPlugin(name)) {
    return {
      success: false,
      message: `Error: Plugin "${name}" already exists in repository`
    };
  }

  // Check for duplicate submission
  if (PLUGIN_SUBMISSIONS.has(name)) {
    const existing = PLUGIN_SUBMISSIONS.get(name)!;
    if (existing.status === 'pending') {
      return {
        success: false,
        message: `Error: Plugin "${name}" is already pending review`
      };
    }
  }

  // Create submission
  const submission: PluginSubmission = {
    name,
    description,
    author,
    submittedAt: new Date(),
    status: 'pending'
  };

  PLUGIN_SUBMISSIONS.set(name, submission);

  return {
    success: true,
    message: `Plugin "${name}" submitted for review`,
    submission
  };
}

/**
 * Get all pending submissions
 */
export function getPendingSubmissions(): PluginSubmission[] {
  return Array.from(PLUGIN_SUBMISSIONS.values())
    .filter(s => s.status === 'pending')
    .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
}

/**
 * Approve a plugin submission
 * Adds it to the repository and removes from pending
 */
export function approvePlugin(name: string): { success: boolean; message: string } {
  const submission = PLUGIN_SUBMISSIONS.get(name);

  if (!submission) {
    return {
      success: false,
      message: `Error: Plugin "${name}" not found in submissions`
    };
  }

  if (submission.status !== 'pending') {
    return {
      success: false,
      message: `Error: Plugin "${name}" is not pending review`
    };
  }

  // Create plugin metadata
  const plugin: PluginMetadata = {
    name: submission.name,
    description: submission.description,
    author: submission.author,
    version: '1.0.0',
    installCommand: `plugin-install ${submission.name}`,
    license: 'MIT'
  };

  // Add to repository
  PLUGIN_REPOSITORY.push(plugin);

  // Update submission status
  submission.status = 'approved';

  return {
    success: true,
    message: `Plugin "${name}" approved and added to repository`
  };
}

/**
 * Reject a plugin submission
 * Does not add to repository
 */
export function rejectPlugin(name: string, reason: string): { success: boolean; message: string } {
  const submission = PLUGIN_SUBMISSIONS.get(name);

  if (!submission) {
    return {
      success: false,
      message: `Error: Plugin "${name}" not found in submissions`
    };
  }

  if (!reason || reason.trim().length === 0) {
    return {
      success: false,
      message: 'Error: plugin-reject requires a rejection reason'
    };
  }

  if (submission.status !== 'pending') {
    return {
      success: false,
      message: `Error: Plugin "${name}" is not pending review`
    };
  }

  // Update submission status
  submission.status = 'rejected';
  submission.rejectionReason = reason;

  return {
    success: true,
    message: `Plugin "${name}" rejected: ${reason}`
  };
}

/**
 * Clear all submissions (for testing)
 */
export function clearSubmissions(): void {
  PLUGIN_SUBMISSIONS.clear();
}
