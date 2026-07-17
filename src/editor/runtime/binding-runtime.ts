/**
 * @file binding-runtime.ts
 * @description CHORE-44 Change 3 — key-binding loading + policy collaborator
 * delegated by `Editor`.
 *
 * Owns ALL binding-file policy: low-level file loading + the
 * `editor-set-mode` quoting sanitizer, the core-bindings load order
 * (keymaps.tlisp then normal/insert/visual/command), the minimal fallback
 * keymap string, the init-file (`~/.config/tmax/init.tlisp`) discovery
 * algorithm, and the lazy core-bindings wrapper. `Editor` constructs one
 * `BindingRuntime` and delegates `loadBindingsFromFile` / `loadCoreBindings` /
 * `loadFallbackBindings` / `loadInitFile` / `ensureCoreBindingsLoaded` here
 * (AC3.4 / AC3.7: no core/fallback/init-file parsing/loading algorithms in
 * `Editor`). `Editor` supplies callbacks for evaluation, the post-load
 * global-line-numbers-mode toggle, the `coreBindingsLoaded` flag, and
 * status-message commit on critical failure; the collaborator never imports
 * the concrete `Editor` class (AC3.3).
 */

import type { FileSystem } from "../../core/types.ts";
import { Either } from "../../utils/task-either.ts";
import type { EvalError } from "../../error/types.ts";
import type { TLispValue } from "../../tlisp/types.ts";
import { log } from "../../utils/logger.ts";

export type BindingEvaluator = (code: string) => Either<EvalError, TLispValue>;

/** Callbacks supplied by `Editor` (the composition root). */
export interface BindingRuntimeDeps {
  /** Filesystem used to discover/read binding + init files. */
  filesystem: FileSystem;
  /** Synchronous T-Lisp evaluator (interpreter.execute). */
  evalCode: BindingEvaluator;
  /** Set/get the "core bindings loaded" flag (Editor owns the boolean). */
  setCoreBindingsLoaded: (v: boolean) => void;
  getCoreBindingsLoaded: () => boolean;
  /** Post-core-load hook: enable global line-numbers minor mode. */
  onCoreBindingsLoaded: () => void;
  /** Commit a status message (used only on critical fallback failure). */
  setStatusMessage: (message: string) => void;
}

/** Required core binding files, loaded in this order after keymaps.tlisp. */
const REQUIRED_BINDING_FILES = [
  "normal.tlisp",
  "insert.tlisp",
  "visual.tlisp",
  "command.tlisp",
] as const;

/**
 * Minimal fallback key bindings used when one or more required core binding
 * files fail to load. Kept here (AC3.7: the fallback keymap string literal
 * lives in binding-runtime, not Editor).
 */
const FALLBACK_BINDINGS = `
        ;; Minimal fallback bindings
        (key-bind "q" "(editor-quit)" "normal")
        (key-bind "i" "(editor-set-mode \\"insert\\")" "normal")
        (key-bind "Escape" "(editor-set-mode \\"normal\\")" "insert")
        (key-bind "h" "(cursor-move (cursor-line) (- (cursor-column) 1))" "normal")
        (key-bind "j" "(cursor-move (+ (cursor-line) 1) (cursor-column))" "normal")
        (key-bind "k" "(cursor-move (- (cursor-line) 1) (cursor-column))" "normal")
        (key-bind "l" "(cursor-move (cursor-line) (+ (cursor-column) 1))" "normal")
        (key-bind ":" "(editor-enter-command-mode)" "normal")
        (key-bind "Escape" "(editor-exit-command-mode)" "command")
        (key-bind "Enter" "(editor-execute-command-line)" "command")

        ;; M-x mode bindings (US-1.10.1)
        (key-bind " " "(editor-handle-space)" "normal")
        (key-bind ";" "(execute-extended-command-maybe)" "normal")
        (key-bind "C-x b" "(switch-buffer)" "normal")
        (key-bind "Escape" "(minibuffer-dispatch-key \\"Escape\\")" "mx")
        (key-bind "C-g" "(minibuffer-dispatch-key \\"C-g\\")" "mx")
        (key-bind "Enter" "(minibuffer-dispatch-key \\"Enter\\")" "mx")

        ;; Window management bindings (SPEC-004)
        (key-bind "C-w" "(editor-window-prefix)" "normal")
      `;

export class BindingRuntime {
  constructor(private readonly deps: BindingRuntimeDeps) {}

  /**
   * Load + evaluate a T-Lisp binding file. Returns true on success, false on
   * failure (logged unless `silent`). Falls back to the real filesystem if the
   * injected `FileSystem` cannot read the path.
   */
  async loadBindingsFromFile(path: string, silent = false): Promise<boolean> {
    const executeContent = (content: string): boolean => {
      const result = this.deps.evalCode(content);
      if (Either.isLeft(result)) {
        const sanitizedContent = content.replace(
          /"\((editor-set-mode) "([^"]+)"\)"/g,
          '"($1 \\"$2\\")"'
        );
        if (sanitizedContent !== content) {
          const sanitizedResult = this.deps.evalCode(sanitizedContent);
          if (Either.isRight(sanitizedResult)) {
            return true;
          }
        }
        throw new Error(result.left.message);
      }
      return true;
    };

    try {
      const content = await this.deps.filesystem.readFile(path);
      return executeContent(content);
    } catch (error) {
      try {
        const realFile = Bun.file(path);
        if (await realFile.exists()) {
          return executeContent(await realFile.text());
        }
      } catch (realError) {
        const realMessage = realError instanceof Error ? realError.message : String(realError);
        if (!silent) {
          console.warn(`Failed to load bindings from ${path}: ${realMessage}`);
        }
        return false;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!silent) {
        console.warn(`Failed to load bindings from ${path}: ${errorMessage}`);
      }
      return false;
    }
  }

  /**
   * Load core key bindings: keymaps.tlisp first (SPEC-038), then the four
   * required mode files. On any failure, log + load the minimal fallback
   * keymap. After success, flip the core-bindings-loaded flag and enable the
   * global line-numbers minor mode.
   */
  async loadCoreBindings(coreBindingsDir: string, keymapsPath: string): Promise<void> {
    // Load unified keymap module before bindings (SPEC-038)
    try {
      await this.loadBindingsFromFile(keymapsPath);
    } catch {}

    let allLoaded = true;
    let lastError = "";

    for (const file of REQUIRED_BINDING_FILES) {
      const path = `${coreBindingsDir}/${file}`;
      const loaded = await this.loadBindingsFromFile(path);
      if (!loaded) {
        allLoaded = false;
        lastError = `Failed to load from ${path}`;
      }
    }

    if (!allLoaded) {
      console.warn(`Failed to load some core bindings. Last error: ${lastError}`);
      console.warn("Loading minimal fallback key bindings...");
      this.loadFallbackBindings();
    }

    this.deps.setCoreBindingsLoaded(true);
    this.deps.onCoreBindingsLoaded();
  }

  /** Ensure core bindings are loaded (lazy loading on first key press). */
  async ensureCoreBindingsLoaded(coreBindingsDir: string, keymapsPath: string): Promise<void> {
    if (!this.deps.getCoreBindingsLoaded()) {
      await this.loadCoreBindings(coreBindingsDir, keymapsPath);
    }
  }

  /**
   * Load minimal fallback key bindings when a required core binding file
   * fails to load. The fallback keymap string lives here (AC3.7). A critical
   * failure (even the fallback won't parse) commits a status message via the
   * injected callback.
   */
  loadFallbackBindings(): void {
    try {
      this.deps.evalCode(FALLBACK_BINDINGS);

      // Enable line-numbers mode by default
      try { this.deps.evalCode('(global-line-numbers-mode t)'); } catch { /* ok */ }
    } catch (error) {
      console.error("Critical: Failed to load even fallback bindings:", error);
      this.deps.setStatusMessage("Critical: No key bindings available");
    }
  }

  /**
   * Load initialization file (SPEC-025). The file is loaded from
   * `~/.config/tmax/init.tlisp` (XDG config directory) unless an explicit path
   * is supplied. The discovery algorithm — config-dir creation, default-path
   * fallback to the literal `~/.config/tmax/init.tlisp` on read failure, and
   * silent "use defaults" on missing file — lives here (AC3.7).
   *
   * Returns the resolved init file path (for `Editor.currentInitFile`).
   */
  async loadInitFile(initFilePath?: string, registeredKeymaps?: string[]): Promise<string> {
    const initLog = log.module('editor').fn('loadInitFile');

    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const configDir = `${homeDir}/.config/tmax`;
    const defaultInitFile = `${configDir}/init.tlisp`;

    const initFile = initFilePath || defaultInitFile;

    try {
      // Create config directory if it doesn't exist (only for default path)
      if (!initFilePath) {
        try {
          await this.deps.filesystem.createDir(configDir);
          initLog.debug('Created config directory', { data: { path: configDir } });
        } catch (dirError) {
          initLog.debug('Config directory creation failed or already exists', {
            data: {
              path: configDir,
              error: dirError instanceof Error ? dirError.message : String(dirError)
            }
          });
        }
      }

      initLog.debug(`Loading init file: ${initFile}`);

      let initContent: string;
      try {
        initContent = await this.deps.filesystem.readFile(initFile);
      } catch (readError) {
        if (initFilePath) {
          throw readError;
        }
        initContent = await this.deps.filesystem.readFile("~/.config/tmax/init.tlisp");
        // Returning the literal fallback path mirrors the prior Editor behavior.
        return "~/.config/tmax/init.tlisp";
      }
      this.deps.evalCode(initContent);

      initLog.info('Loaded init file', {
        data: { path: initFile }
      });

      // Log any keymaps that were registered (caller supplies the mode list).
      if (registeredKeymaps && registeredKeymaps.length > 0) {
        initLog.info('Registered T-Lisp keymaps from init file', {
          data: { modes: registeredKeymaps }
        });
      }

      return initFile;
    } catch (error) {
      // Init file not found or error - use defaults (silent)
      initLog.debug('No init file found or error loading it', {
        data: {
          path: initFile,
          error: error instanceof Error ? error.message : String(error)
        }
      });
      return initFile;
    }
  }
}
