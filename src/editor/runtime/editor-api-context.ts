/**
 * @file editor-api-context.ts
 * @description CHORE-44 Change 2 — the single typed context supplied to editor
 * API contributions via `createEditorAPI`.
 *
 * This replaces the legacy editor-state bridge and its compatibility
 * projection + underscored runtime escape hatches. Every API primitive
 * reads deterministic state through `access: EditorModelAccess` (the immutable
 * `EditorModel`) and reaches runtime services through these typed members — no
 * `any`, no mutable compat object, no underscored hooks (AC2.1–AC2.3).
 *
 * AC2.6: this interface does NOT duplicate deterministic `EditorModel` fields
 * as mutable bridge properties. State reads go through `access.getModel()` and
 * state writes go through `applyUpdate(msg: Msg)` (simple fields) or the four
 * explicit side-effectful methods whose editor-side bodies do MORE than a
 * single reducer message (tab/window/metadata/cursor-window sync):
 * `setCurrentBuffer`, `setCursorLine`, `setCursorColumn`, `setCurrentFilename`.
 *
 * `spacePressed` is intentionally retained as a runtime-service accessor pair
 * (not a deterministic EditorModel field): it is transient leader-key input
 * state owned by the `Editor` class (`editor.spacePressed`), not document
 * state, and therefore must not appear as a duplicated model bridge field. We
 * expose it via `getSpacePressed`/`setSpacePressed` so the API factory has a
 * typed surface without re-introducing a mutable bridge property.
 */

import type { TextBuffer } from "../../core/contracts/buffer.ts";
import type { TerminalIO } from "../../core/contracts/terminal.ts";
import type { FileSystem } from "../../core/contracts/filesystem.ts";
import type { EvalError } from "../../error/types.ts";
import { Either } from "../../utils/task-either.ts";
import type { TLispValue } from "../../tlisp/types.ts";
import type { ModuleRegistry } from "../../tlisp/module-registry.ts";
import type { EditorModelAccess } from "../api/state-context.ts";
import type { EditorModel } from "../functional/model.ts";
import type { Msg } from "../functional/messages.ts";
import type { EditorSession } from "../functional/domain-state.ts";
import type { EditorRuntimeCaches } from "./caches.ts";
import type { ViewBoundLog, Log } from "../log-store.ts";
import type { EditorOperations } from "../tlisp-api.ts";

/** Editor mode union (mirrors the public EditorState mode). */
export type EditorMode = "normal" | "insert" | "visual" | "command" | "mx" | "replace";

/** Minor-mode registry entry (mode name → opaque mode descriptor). */
export type MinorModeMap = Map<string, unknown>;

/**
 * The typed context handed to `createEditorAPI`. The Editor runtime constructs
 * exactly one; API factories read state via `access` and call runtime services
 * via the named members below.
 *
 * Deterministic state writes pass through `applyUpdate` (simple reducer Msgs)
 * or the four explicit side-effectful methods that preserve editor-specific
 * invariants beyond a single reducer message.
 */
export interface EditorAPIContext {
  /** Deterministic model reads/writes (the immutable EditorModel). */
  access: EditorModelAccess;
  /** Per-editor session state (kill ring, registers, visual, macros, …). */
  session: EditorSession;
  /** Per-editor non-serializable derived caches (AST/parse trees). */
  caches: EditorRuntimeCaches;

  // Runtime services ----------------------------------------------------------
  terminal: TerminalIO;
  filesystem: FileSystem;
  /** Optional file/state operations (used by file-ops). */
  operations?: EditorOperations;

  // ── Deterministic state write surface (AC2.6 / AC2.7) ───────────────────
  /**
   * Commit a reducer {@link Msg}. The Editor runtime routes this through
   * `editor.applyUpdate(msg)` — reducer run, model commit, Cmd enqueue, and a
   * single state-change notification. Use this for every simple-field write
   * (status, mode, commandLine, cursorFocus, viewport, config, searchMatches,
   * foldRanges, mxCommand, lastCommand, lspDiagnostics, …). No primitive may
   * mutate a duplicated bridge property directly.
   */
  applyUpdate: (msg: Msg) => void;

  /**
   * Side-effectful current-buffer switch. The editor-side body preserves
   * tab/window/bufferMetadata/filename invariants beyond what the
   * `SetCurrentBuffer` reducer message alone does — so it cannot be replaced
   * by a bare `applyUpdate({type:"SetCurrentBuffer"})`.
   */
  setCurrentBuffer: (buffer: TextBuffer | null) => void;
  /**
   * Side-effectful cursor-line set. Beyond `SetCursorPosition`, the editor-side
   * body mirrors the line into the current window's `cursorLine` (US-3.2.1).
   */
  setCursorLine: (line: number) => void;
  /**
   * Side-effectful cursor-column set. Beyond `SetCursorPosition`, the
   * editor-side body mirrors the column into the current window's
   * `cursorColumn` (US-3.2.1).
   */
  setCursorColumn: (column: number) => void;
  /**
   * Side-effectful current-filename set. Beyond `SetCurrentFilename`, the
   * editor-side body calls `updateBufferMetadata` to keep the buffer-name →
   * filename map consistent.
   */
  setCurrentFilename: (filename: string | undefined) => void;

  // ── Transient runtime input state (NOT deterministic model state) ───────
  // spacePressed is leader-key (SPC ;) transient input state owned by the
  // Editor class. Exposed as a runtime-service accessor pair so it does NOT
  // appear as a duplicated EditorModel bridge property (AC2.6).
  getSpacePressed: () => boolean;
  setSpacePressed: (pressed: boolean) => void;

  // Typed runtime service callbacks (formerly underscored escape hatches) -----
  /** Evaluate a T-Lisp expression against the editor's interpreter. */
  evalTlisp?: (expr: string) => Either<EvalError, TLispValue>;
  getCurrentMajorMode?: () => string;
  setCurrentMajorMode?: (mode: string) => void;
  getMinorModeRegistry?: () => MinorModeMap;
  getBufferModeStates?: () => Map<string, unknown>;
  getCurrentBufferKey?: () => string;
  getGlobalizedMinorModes?: () => Set<string>;
  getModuleRegistry?: () => ModuleRegistry;
  getLoadPaths?: () => string[];
  getCurrentModuleName?: () => string | undefined;
  getBufferModified?: () => boolean;
  setBufferModified?: (modified: boolean) => void;
  /** Logging surface for the *Messages* buffer (SPEC-055). */
  logMessage?: (msg: string, level?: string, command?: string, frameId?: string) => void;
  setEchoOnly?: (text: string) => void;
  logProgram?: (category: "shell" | "process" | "test" | "autosave", entry: { level: string; text: string; exitCode?: number; durationMs?: number; outputTail?: string; pid?: number; command?: string; frameId?: string }) => void;
  getMessageLog?: () => ViewBoundLog;
  getUnifiedLog?: () => Log;
}

/** Re-export so callers can construct an access handle without a separate import. */
export type { EditorModel, EditorModelAccess, Msg };
