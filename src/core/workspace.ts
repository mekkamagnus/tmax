/**
 * @file workspace.ts
 * @description Workspace persistence and management for tmax editor
 *
 * Manages workspace CRUD operations, serialization, atomic writes with backup,
 * format versioning, and name validation per RFC-014.
 *
 * Uses only fs, path, and crypto built-ins (no external dependencies).
 */

import type {
  BufferMetadata,
  BufferModeState,
  TextBuffer,
  Window,
  WorkspaceData,
  WorkspaceMetadata,
  WorkspaceState,
} from './types.ts';
import { Either, TaskEither } from '../utils/task-either.ts';
import path from 'path';
import { createHash } from 'crypto';

// N9: single source of truth for format version (defined in types.ts)
import { CURRENT_WORKSPACE_FORMAT_VERSION } from './types.ts';
export { CURRENT_WORKSPACE_FORMAT_VERSION };
const CURRENT_FORMAT_VERSION = CURRENT_WORKSPACE_FORMAT_VERSION;

/**
 * Workspace name validation regex per RFC-014
 * - 1-64 characters
 * - Alphanumeric, underscore, hyphen only
 * - No spaces, no path separators
 */
const WORKSPACE_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Default workspace directory
 * Default workspace directory
 */
function defaultWorkspaceDir(): string {
  return process.env.TMAX_WORKSPACE_DIR ?? `${process.env.HOME ?? '.'}/.config/tmax/workspaces`;
}

/**
 * Maximum workspace file size (10MB) to prevent corruption from malformed files
 */
const MAX_WORKSPACE_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Workspace creation options
 */
export interface WorkspaceCreateOptions {
  projectRoot?: string;
  initialContent?: Map<string, string>;  // Buffer name → content
}

/**
 * Workspace manager error type
 */
export type WorkspaceError = string;

export interface WorkspaceSaveResult {
  contentHash: string;
  saved: boolean;
}

/**
 * Workspace manager class
 *
 * Manages workspace persistence with:
 * - CRUD operations (create, list, load, save, delete, rename)
 * - Atomic write with one-generation backup
 * - Format version checking
 * - Name validation
 * - Default workspace creation
 */
export class WorkspaceManager {
  private workspaceDir: string;
  private loadedWorkspaces: Map<string, WorkspaceState>;
  private saveQueues: Map<string, Promise<void>>;

  constructor(workspaceDir?: string) {
    this.workspaceDir = workspaceDir ?? defaultWorkspaceDir();
    this.loadedWorkspaces = new Map();
    this.saveQueues = new Map();
  }

  /**
   * Initialize the workspace directory
   */
  init(): TaskEither<WorkspaceError, void> {
    return TaskEither.tryCatch(
      async () => {
        const fs = await import('fs/promises');
        await fs.mkdir(this.workspaceDir, { recursive: true });
      },
      (error) => `Failed to initialize workspace directory: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Validate workspace name against RFC-014 rules
   */
  validateName(name: string): Either<WorkspaceError, string> {
    if (!name || name.trim() === '') {
      return Either.left('Workspace name cannot be empty');
    }

    if (name.length > 64) {
      return Either.left('Workspace name must be 64 characters or less');
    }

    if (!WORKSPACE_NAME_REGEX.test(name)) {
      return Either.left(
        'Workspace name must contain only alphanumeric characters, underscores, and hyphens (no spaces, no path separators)'
      );
    }

    // Check for path separator attempts
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      return Either.left('Workspace name cannot contain path separators or ".."');
    }

    return Either.right(name);
  }

  /**
   * Check if a workspace exists on disk
   */
  exists(name: string): TaskEither<WorkspaceError, boolean> {
    const nameValid = this.validateName(name);
    if (Either.isLeft(nameValid)) {
      return TaskEither.left(nameValid.left);
    }

    return TaskEither.tryCatch(
      async () => {
        const fs = await import('fs/promises');
        try {
          await fs.access(this.getWorkspacePath(name));
          return true;
        } catch {
          return false;
        }
      },
      (error) => `Failed to check workspace existence: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Generate a unique UUID for workspace ID
   */
  private generateUUID(): string {
    return globalThis.crypto.randomUUID();
  }

  /**
   * Create a new workspace
   *
   * - Validates name
   * - Checks for duplicates (both in memory and on disk)
   * - Creates workspace with *scratch* buffer
   * - Saves to disk
   * - Optionally associates project root
   */
  create(name: string, options?: WorkspaceCreateOptions): TaskEither<WorkspaceError, WorkspaceState> {
    const nameValid = this.validateName(name);
    if (Either.isLeft(nameValid)) {
      return TaskEither.left(nameValid.left);
    }

    // Check memory first, then disk
    if (this.loadedWorkspaces.has(name)) {
      return TaskEither.left(`Workspace "${name}" already exists`);
    }

    return this.exists(name).flatMap((exists) => {
      if (exists) {
        return TaskEither.left(`Workspace "${name}" already exists`);
      }

      return TaskEither.tryCatch(
        async () => {
          // Create workspace metadata
          const now = new Date().toISOString();
          const metadata: WorkspaceMetadata = {
            id: this.generateUUID(),
            name,
            projectRoot: options?.projectRoot,
            createdAt: now,
            lastAccessed: now,
            formatVersion: CURRENT_FORMAT_VERSION
          };

          // Import here to avoid top-level import issues
          const { TextBufferImpl } = await import('../core/buffer.ts');

          // Create initial buffers with *scratch*
          const buffers = new Map<string, TextBuffer>();
          const bufferMetadata = new Map<string, BufferMetadata>();
          const bufferModeStates = new Map<string, BufferModeState>();

          // Always create *scratch* buffer
          const scratchBuffer = TextBufferImpl.create('');
          buffers.set('*scratch*', scratchBuffer);
          bufferMetadata.set('*scratch*', {
            name: '*scratch*',
            modified: false,
            cursorLine: 0,
            cursorColumn: 0
          });
          bufferModeStates.set('*scratch*', {});

          // Add any initial content buffers
          if (options?.initialContent) {
            for (const [bufferName, content] of options.initialContent.entries()) {
              if (bufferName === '*scratch*') continue; // Already created

              const buffer = TextBufferImpl.create(content);
              buffers.set(bufferName, buffer);
              bufferMetadata.set(bufferName, {
                name: bufferName,
                modified: false,
                cursorLine: 0,
                cursorColumn: 0
              });
              bufferModeStates.set(bufferName, {});
            }
          }

          const workspace: WorkspaceState = {
            metadata,
            buffers,
            bufferMetadata,
            bufferModeStates,
            windows: [],
            tabs: [],
            cursorState: { line: 0, column: 0 },
            viewportState: { top: 0 },
            currentBufferName: '*scratch*'
          };

          // Save to disk before adding to cache
          const saveResult = await this.saveInternal(workspace).run();
          if (Either.isLeft(saveResult)) {
            throw new Error(saveResult.left);
          }

          // Add to cache after successful save
          this.loadedWorkspaces.set(name, workspace);

          return workspace;
        },
        (error) => `Failed to create workspace: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }

  /**
   * Internal save method that doesn't update lastAccessed
   */
  private saveInternal(workspace: WorkspaceState): TaskEither<WorkspaceError, void> {
    return this.workspaceToData(workspace).flatMap((data) =>
      this.writeWorkspaceData(workspace.metadata.name, data)
    );
  }

  private writeWorkspaceData(workspaceName: string, data: WorkspaceData): TaskEither<WorkspaceError, void> {
    return TaskEither.tryCatch(
      async () => {
        const previousSave = this.saveQueues.get(workspaceName) ?? Promise.resolve();
        const operation = previousSave.catch(() => undefined).then(async () => {
          const fs = await import('fs/promises');

          const workspacePath = this.getWorkspacePath(workspaceName);
          const tmpPath = `${workspacePath}.tmp`;
          const backupPath = this.getBackupPath(workspaceName);

          // Serialize to JSON
          const jsonContent = JSON.stringify(data, null, 2);

          await fs.mkdir(this.workspaceDir, { recursive: true });

          // Write to temporary file
          await fs.writeFile(tmpPath, jsonContent, 'utf-8');

          // If main file exists, rename it to backup
          try {
            await fs.stat(workspacePath);
            await fs.rename(workspacePath, backupPath);
          } catch {
            // Main file doesn't exist, that's fine
          }

          // Rename temp file to main file
          await fs.rename(tmpPath, workspacePath);
        });
        const release = operation.then(() => undefined, () => undefined);
        this.saveQueues.set(workspaceName, release);
        try {
          await operation;
        } finally {
          if (this.saveQueues.get(workspaceName) === release) {
            this.saveQueues.delete(workspaceName);
          }
        }
      },
      (error) => `Failed to save workspace "${workspaceName}": ${error instanceof Error ? error.message : String(error)}`
    );
  }

  private workspaceDataContentHash(data: WorkspaceData): string {
    const hash = createHash('sha256');
    const buffers = [...data.buffers].sort((a, b) => a.name.localeCompare(b.name));
    for (const buffer of buffers) {
      hash.update(JSON.stringify({
        name: buffer.name,
        filename: buffer.filename,
        content: buffer.content,
        modified: buffer.modified,
        majorMode: buffer.majorMode,
        cursorLine: buffer.cursorLine,
        cursorColumn: buffer.cursorColumn,
        minorModes: buffer.minorModes ?? [],
        lighters: buffer.lighters ?? [],
      }));
      hash.update('\n');
    }
    hash.update(JSON.stringify({
      windows: data.windows.map(window => ({
        id: window.id,
        bufferName: window.bufferName,
        cursorLine: window.cursorLine,
        cursorColumn: window.cursorColumn,
        viewportTop: window.viewportTop,
        viewportLeft: window.viewportLeft,
        splitType: window.splitType,
        height: window.height,
        width: window.width,
        row: window.row,
        col: window.col,
        scrollback: window.scrollback,
      })),
      tabs: data.tabs.map(tab => ({
        id: tab.id,
        label: tab.label,
        bufferName: tab.bufferName,
      })),
      cursorState: data.cursorState,
      viewportState: data.viewportState,
      currentBufferName: data.currentBufferName,
      currentFilename: data.currentFilename,
      currentMajorMode: data.currentMajorMode,
      activeMinorModes: data.activeMinorModes ?? [],
      activeMinorModeLighters: data.activeMinorModeLighters ?? [],
    }));
    return hash.digest('hex');
  }

  /**
   * Get file path for a workspace
   */
  private getWorkspacePath(name: string): string {
    return path.join(this.workspaceDir, `${name}.json`);
  }

  /**
   * Get backup file path for a workspace
   */
  private getBackupPath(name: string): string {
    return path.join(this.workspaceDir, `${name}.json~`);
  }

  /**
   * List all workspaces from disk
   */
  list(): TaskEither<WorkspaceError, WorkspaceMetadata[]> {
    return TaskEither.tryCatch(
      async () => {
        const fs = await import('fs/promises');

        const entries = await fs.readdir(this.workspaceDir);
        const workspaces: WorkspaceMetadata[] = [];

        for (const entry of entries) {
          // Only process .json files (not backups)
          if (!entry.endsWith('.json') || entry.endsWith('~')) {
            continue;
          }

          const filePath = path.join(this.workspaceDir, entry);
          const stat = await fs.stat(filePath);

          // Skip if too large
          if (stat.size > MAX_WORKSPACE_FILE_SIZE) {
            console.error(`Workspace file ${entry} exceeds maximum size, skipping`);
            continue;
          }

          try {
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content) as WorkspaceData;

            if (data.metadata && typeof data.metadata === 'object') {
              workspaces.push(data.metadata);
            }
          } catch (error) {
            console.error(`Failed to read workspace ${entry}:`, error);
          }
        }

        // Sort by last accessed descending
        workspaces.sort((a, b) =>
          new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime()
        );

        return workspaces;
      },
      (error) => `Failed to list workspaces: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Load a workspace from disk
   *
   * - Reads workspace file
   * - Attempts backup recovery on parse failure
   * - Fills defaults for missing fields (additive schema)
   * - Refuses newer format versions
   */
  load(name: string): TaskEither<WorkspaceError, WorkspaceState> {
    const nameValid = this.validateName(name);
    if (Either.isLeft(nameValid)) {
      return TaskEither.left(nameValid.left);
    }

    const workspacePath = this.getWorkspacePath(name);
    const backupPath = this.getBackupPath(name);

    return this.loadFromFile(workspacePath, backupPath, name).tap((workspace) => {
      this.loadedWorkspaces.set(name, workspace);
    });
  }

  /**
   * Load workspace from a specific file, with backup fallback
   */
  private loadFromFile(
    filePath: string,
    backupPath: string,
    workspaceName: string
  ): TaskEither<WorkspaceError, WorkspaceState> {
    const fsPromise = import('fs/promises');

    return TaskEither.tryCatch(
      async () => {
        const fs = await fsPromise;

        // Try primary file first
        let content: string;
        let usingBackup = false;

        try {
          content = await fs.readFile(filePath, 'utf-8');
        } catch (error) {
          // Primary file doesn't exist or is unreadable, try backup
          try {
            content = await fs.readFile(backupPath, 'utf-8');
            usingBackup = true;
          } catch {
            throw new Error(`Workspace "${workspaceName}" not found and no backup available`);
          }
        }

        // Check file size
        if (content.length > MAX_WORKSPACE_FILE_SIZE) {
          throw new Error(`Workspace file exceeds maximum size of ${MAX_WORKSPACE_FILE_SIZE} bytes`);
        }

        // Parse JSON
        let data: WorkspaceData;
        try {
          data = JSON.parse(content) as WorkspaceData;
        } catch (parseError) {
          // If we weren't already using backup, try it now
          if (!usingBackup) {
            try {
              content = await fs.readFile(backupPath, 'utf-8');
              data = JSON.parse(content) as WorkspaceData;
              usingBackup = true;
            } catch {
              throw new Error(`Failed to parse workspace file and backup recovery failed`);
            }
          } else {
            throw new Error(`Failed to parse workspace file`);
          }
        }

        // Check format version
        if (data.metadata?.formatVersion === undefined || data.metadata?.formatVersion === null) {
          throw new Error('Workspace file missing format version');
        }

        if (data.metadata.formatVersion > CURRENT_FORMAT_VERSION) {
          throw new Error(
            `Workspace format version ${data.metadata.formatVersion} is newer than current version ${CURRENT_FORMAT_VERSION}. Please upgrade tmax.`
          );
        }

        // Warn if using backup
        if (usingBackup) {
          console.warn(`Loaded workspace "${workspaceName}" from backup file due to corrupted primary`);
        }

        return data;
      },
      (error) => `Failed to load workspace: ${error instanceof Error ? error.message : String(error)}`
    ).flatMap(this.dataToWorkspace.bind(this));
  }

  /**
   * Convert WorkspaceData to WorkspaceState
   *
   * Reconstructs TextBuffer instances from serialized content
   */
  private dataToWorkspace(data: WorkspaceData): TaskEither<WorkspaceError, WorkspaceState> {
    return TaskEither.tryCatch(
      async () => {
        const { TextBufferImpl } = await import('../core/buffer.ts');

        const fs = await import('fs/promises');
        const restoreWarnings: string[] = [];
        const restoreConflicts: string[] = [];

        if (data.metadata.projectRoot) {
          try {
            const stat = await fs.stat(data.metadata.projectRoot);
            if (!stat.isDirectory()) {
              restoreWarnings.push(`Workspace project root is not a directory: ${data.metadata.projectRoot}`);
              data.metadata = { ...data.metadata, projectRoot: undefined };
            }
          } catch {
            restoreWarnings.push(`Workspace project root missing: ${data.metadata.projectRoot}`);
            data.metadata = { ...data.metadata, projectRoot: undefined };
          }
        }

        // Reconstruct buffers
        const buffers = new Map<string, TextBuffer>();
        const bufferMetadata = new Map<string, BufferMetadata>();
        const bufferModeStates = new Map<string, BufferModeState>();

        // Handle undefined or empty buffers array
        const buffersList = data.buffers ?? [];

        for (const bufferData of buffersList) {
          let content = bufferData.content;
          if (bufferData.filename) {
            try {
              const diskContent = await fs.readFile(bufferData.filename, 'utf-8');
              if (bufferData.modified) {
                if (diskContent !== bufferData.content) {
                  restoreConflicts.push(bufferData.name);
                }
              } else {
                content = diskContent;
              }
            } catch {
              // Missing/unreadable files fall back to serialized content.
            }
          }

          const buffer = TextBufferImpl.create(content);
          buffers.set(bufferData.name, buffer);
          bufferMetadata.set(bufferData.name, {
            name: bufferData.name,
            filename: bufferData.filename,
            modified: bufferData.modified,
            majorMode: bufferData.majorMode,
            cursorLine: bufferData.cursorLine,
            cursorColumn: bufferData.cursorColumn
          });
          bufferModeStates.set(bufferData.name, {
            majorMode: bufferData.majorMode,
            minorModes: bufferData.minorModes,
            lighters: bufferData.lighters
          });
        }

        // Ensure *scratch* exists (for old workspaces)
        if (!buffers.has('*scratch*')) {
          const scratchBuffer = TextBufferImpl.create('');
          buffers.set('*scratch*', scratchBuffer);
          bufferMetadata.set('*scratch*', {
            name: '*scratch*',
            modified: false,
            cursorLine: 0,
            cursorColumn: 0
          });
          bufferModeStates.set('*scratch*', {});
        }

        // C4: reconstruct windows with buffer references
        const windows: Window[] = [];
        for (const winData of data.windows ?? []) {
          const resolvedName = buffers.has(winData.bufferName) ? winData.bufferName : '*scratch*';
          if (winData.bufferName && !buffers.has(winData.bufferName)) {
            console.warn(`dataToWorkspace: window "${winData.id}" references unknown buffer "${winData.bufferName}", falling back to *scratch*`);
          }
          const buffer = buffers.get(resolvedName)!;
          const window: Window = {
            id: winData.id,
            buffer,
            bufferName: resolvedName,
            cursorLine: winData.cursorLine,
            cursorColumn: winData.cursorColumn,
            viewportTop: winData.viewportTop,
            viewportLeft: winData.viewportLeft ?? 0,
            ...(winData.splitType ? { splitType: winData.splitType } : {}),
            ...(winData.height !== undefined ? { height: winData.height } : {}),
            ...(winData.width !== undefined ? { width: winData.width } : {}),
            ...(winData.row !== undefined ? { row: winData.row } : {}),
            ...(winData.col !== undefined ? { col: winData.col } : {}),
            ...(winData.scrollback ? { scrollback: winData.scrollback } : {}),
          };
          windows.push(window);
        }

        // Reconstruct tabs
        const tabs: import('./types.ts').Tab[] = [];
        for (const tabData of data.tabs ?? []) {
          const resolvedName = buffers.has(tabData.bufferName) ? tabData.bufferName : '*scratch*';
          if (tabData.bufferName && !buffers.has(tabData.bufferName)) {
            console.warn(`dataToWorkspace: tab "${tabData.id}" references unknown buffer "${tabData.bufferName}", falling back to *scratch*`);
          }
          const buffer = buffers.get(resolvedName)!;
          tabs.push({
            id: tabData.id,
            label: tabData.label,
            buffer,
            bufferName: resolvedName,
          });
        }

        // Reconstruct workspace state
        const workspace: WorkspaceState = {
          metadata: data.metadata,
          buffers,
          bufferMetadata,
          bufferModeStates,
          windows,
          tabs,
          cursorState: data.cursorState || { line: 0, column: 0 },
          viewportState: data.viewportState || { top: 0 },
          currentBufferName: data.currentBufferName || '*scratch*',
          currentFilename: data.currentFilename,
          currentMajorMode: data.currentMajorMode,
          activeMinorModes: data.activeMinorModes,
          activeMinorModeLighters: data.activeMinorModeLighters,
          restoreWarnings,
          restoreConflicts,
        };

        if (restoreConflicts.length > 0) {
          restoreWarnings.push(
            `Workspace restore conflict prompt: files changed on disk for ${restoreConflicts.join(', ')}. Choices: keep disk version, restore workspace version, diff view.`
          );
        }

        return workspace;
      },
      (error) => `Failed to reconstruct workspace: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Save a workspace to disk with atomic write
   *
   * Process per RFC-014:
   * 1. Serialize to JSON
   * 2. Write to .json.tmp
   * 3. Rename existing .json to .json~
   * 4. Rename .tmp to .json
   */
  save(workspace: WorkspaceState): TaskEither<WorkspaceError, void> {
    // C5: update lastAccessed before serialization
    workspace.metadata.lastAccessed = new Date().toISOString();
    return this.saveInternal(workspace);
  }

  saveWithContentHash(
    workspace: WorkspaceState,
    options: { lastHash?: string; force?: boolean } = {}
  ): TaskEither<WorkspaceError, WorkspaceSaveResult> {
    workspace.metadata.lastAccessed = new Date().toISOString();
    return this.workspaceToData(workspace).flatMap((data) => {
      const contentHash = this.workspaceDataContentHash(data);
      if (!options.force && options.lastHash === contentHash) {
        return TaskEither.right<WorkspaceSaveResult, WorkspaceError>({ contentHash, saved: false });
      }
      return this.writeWorkspaceData(workspace.metadata.name, data)
        .map((): WorkspaceSaveResult => ({ contentHash, saved: true }));
    });
  }

  /**
   * Convert WorkspaceState to WorkspaceData for serialization
   */
  private workspaceToData(workspace: WorkspaceState): TaskEither<WorkspaceError, WorkspaceData> {
    return TaskEither.tryCatch(
      async () => {
        const buffers: WorkspaceData['buffers'] = [];

        for (const [name, buffer] of workspace.buffers.entries()) {
          const meta = workspace.bufferMetadata.get(name);
          const modeState = workspace.bufferModeStates.get(name);

          const contentResult = buffer.getContent();
          if (Either.isLeft(contentResult)) {
            throw new Error(`Failed to get buffer content for ${name}: ${contentResult.left}`);
          }

          buffers.push({
            name,
            filename: meta?.filename,
            content: contentResult.right,
            modified: meta?.modified ?? false,
            majorMode: meta?.majorMode,
            cursorLine: meta?.cursorLine ?? 0,
            cursorColumn: meta?.cursorColumn ?? 0,
            minorModes: modeState?.minorModes,
            lighters: modeState?.lighters
          });
        }

        // C4: serialize windows with proper buffer name resolution
        const windows: WorkspaceData['windows'] = workspace.windows.map(win => {
          // R3-2: use cached bufferName when available (identity check fails after mutations)
          let winBufferName = win.bufferName ?? "";
          if (!winBufferName && win.buffer) {
            for (const [name, buf] of workspace.buffers.entries()) {
              if (buf === win.buffer) { winBufferName = name; break; }
            }
          }
          return {
            id: win.id,
            bufferName: winBufferName,
            cursorLine: win.cursorLine,
            cursorColumn: win.cursorColumn,
            viewportTop: win.viewportTop,
            viewportLeft: win.viewportLeft,
            splitType: win.splitType,
            height: win.height,
            width: win.width,
            row: win.row,
            col: win.col,
            scrollback: win.scrollback ? {
              capacity: win.scrollback.capacity,
              lines: win.scrollback.lines,
              size: win.scrollback.size,
              head: win.scrollback.head,
              tail: win.scrollback.tail,
              viewportOffset: win.scrollback.viewportOffset
            } : undefined
          };
        });

        const tabs: WorkspaceData['tabs'] = workspace.tabs.map(tab => {
          let tabBufferName = tab.bufferName ?? "";
          if (!tabBufferName && tab.buffer) {
            for (const [name, buf] of workspace.buffers.entries()) {
              if (buf === tab.buffer) { tabBufferName = name; break; }
            }
          }
          return { id: tab.id, label: tab.label, bufferName: tabBufferName };
        });

        const data: WorkspaceData = {
          metadata: workspace.metadata,
          buffers,
          windows,
          tabs,
          cursorState: workspace.cursorState,
          viewportState: workspace.viewportState,
          currentBufferName: workspace.currentBufferName,
          currentFilename: workspace.currentFilename,
          currentMajorMode: workspace.currentMajorMode,
          activeMinorModes: workspace.activeMinorModes,
          activeMinorModeLighters: workspace.activeMinorModeLighters
        };

        return data;
      },
      (error) => `Failed to serialize workspace: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Delete a workspace from disk
   *
   * Removes both .json and .json~ files
   */
  delete(name: string): TaskEither<WorkspaceError, void> {
    const nameValid = this.validateName(name);
    if (Either.isLeft(nameValid)) {
      return TaskEither.left(nameValid.left);
    }

    return TaskEither.tryCatch(
      async () => {
        const fs = await import('fs/promises');

        const workspacePath = this.getWorkspacePath(name);
        const backupPath = this.getBackupPath(name);

        // Remove main file if it exists
        try {
          await fs.unlink(workspacePath);
        } catch {
          // File doesn't exist, that's fine
        }

        // Remove backup if it exists
        try {
          await fs.unlink(backupPath);
        } catch {
          // Backup doesn't exist, that's fine
        }

        // Remove from loaded cache
        this.loadedWorkspaces.delete(name);
      },
      (error) => `Failed to delete workspace "${name}": ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Rename a workspace
   *
   * Validates new name and renames both .json and .json~ files
   */
  rename(oldName: string, newName: string): TaskEither<WorkspaceError, void> {
    const oldValid = this.validateName(oldName);
    if (Either.isLeft(oldValid)) {
      return TaskEither.left(oldValid.left);
    }

    const newValid = this.validateName(newName);
    if (Either.isLeft(newValid)) {
      return TaskEither.left(newValid.left);
    }

    if (oldName === newName) {
      return TaskEither.right(undefined);
    }

    return this.exists(newName).flatMap((newExists) => {
      if (newExists) {
        return TaskEither.left(`Workspace "${newName}" already exists`);
      }

      return this.exists(oldName).flatMap((oldExists) => {
        if (!oldExists && !this.loadedWorkspaces.has(oldName)) {
          return TaskEither.left(`Workspace "${oldName}" does not exist`);
        }

      return TaskEither.tryCatch(
        async () => {
          const fs = await import('fs/promises');

          const oldPath = this.getWorkspacePath(oldName);
          const newPath = this.getWorkspacePath(newName);
          const oldBackup = this.getBackupPath(oldName);
          const newBackup = this.getBackupPath(newName);

          // Rename main file (tolerate missing file for in-memory-only workspaces)
          try {
            await fs.rename(oldPath, newPath);
          } catch {
            // File doesn't exist on disk (in-memory-only workspace), that's fine
          }

          // Rename backup if it exists
          try {
            await fs.rename(oldBackup, newBackup);
          } catch {
            // Backup doesn't exist, that's fine
          }

          // Update loaded workspace metadata if cached
          const loaded = this.loadedWorkspaces.get(oldName);
          if (loaded) {
            loaded.metadata.name = newName;
            this.loadedWorkspaces.delete(oldName);
            this.loadedWorkspaces.set(newName, loaded);
          }
        },
        (error) => `Failed to rename workspace from "${oldName}" to "${newName}": ${error instanceof Error ? error.message : String(error)}`
      );
      }); // close exists(oldName).flatMap
    });
  }

  /**
   * Get a workspace from cache if loaded
   */
  getLoaded(name: string): Either<WorkspaceError, WorkspaceState> {
    const nameValid = this.validateName(name);
    if (Either.isLeft(nameValid)) {
      return nameValid;
    }

    const workspace = this.loadedWorkspaces.get(name);
    if (!workspace) {
      return Either.left(`Workspace "${name}" is not loaded`);
    }

    return Either.right(workspace);
  }

  /**
   * Check if a workspace is currently loaded in memory
   */
  isLoaded(name: string): boolean {
    return this.loadedWorkspaces.has(name);
  }

  /**
   * Unload a workspace from memory (does not delete from disk)
   */
  unload(name: string): Either<WorkspaceError, void> {
    const nameValid = this.validateName(name);
    if (Either.isLeft(nameValid)) {
      return nameValid;
    }

    if (!this.loadedWorkspaces.delete(name)) {
      return Either.left(`Workspace "${name}" is not loaded`);
    }

    return Either.right(undefined);
  }

  /**
   * Get all currently loaded workspace names
   */
  getLoadedNames(): string[] {
    return Array.from(this.loadedWorkspaces.keys());
  }
}
