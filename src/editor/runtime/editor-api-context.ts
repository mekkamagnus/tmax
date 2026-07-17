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
 */

import type { FunctionalTextBuffer, TerminalIO, FileSystem, EditorConfig, LSPDiagnostic, Range } from "../../core/types.ts";
import type { EvalError } from "../../error/types.ts";
import { Either } from "../../utils/task-either.ts";
import type { TLispValue } from "../../tlisp/types.ts";
import type { ModuleRegistry } from "../../tlisp/module-registry.ts";
import type { EditorModelAccess } from "../api/state-context.ts";
import type { EditorModel } from "../functional/model.ts";
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

  // Bridge fields (Editor-side getters/setters consumed by API factories) -----
  currentBuffer: FunctionalTextBuffer | null;
  buffers: Map<string, FunctionalTextBuffer>;
  cursorLine: number;
  cursorColumn: number;
  mode: EditorMode;
  lastCommand: string;
  statusMessage: string;
  viewportTop: number;
  viewportLeft: number;
  commandLine: string;
  mxCommand: string;
  spacePressed: boolean;
  cursorFocus: "buffer" | "command";
  currentFilename?: string;
  config?: EditorConfig;
  lspDiagnostics?: readonly LSPDiagnostic[];
  foldRanges?: Map<number, number>;
  searchMatches?: Range[];

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
export type { EditorModel, EditorModelAccess };
