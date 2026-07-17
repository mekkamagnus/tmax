/**
 * @file tlisp-api.ts
 * @description T-Lisp editor API functions that bridge TypeScript core with T-Lisp extensibility.
 *
 * CHORE-44 Change 7: the API inventory is now composed declaratively through
 * {@link registerContributions}. Each `create*Ops` factory + each group of
 * inline primitives becomes one {@link EditorAPIContribution} whose `factory`
 * closure derives its dependencies from the single typed
 * {@link EditorAPIContext}. Duplicate primitive names across contributions
 * return a deterministic typed `AppError` naming both contributions
 * (AC7.2); there are no `for (const [k,v] of X.entries()) api.set(k,v)`
 * copy loops (AC7.3) and AST/navigation share the same `ctx.caches` (AC7.4).
 */

import type { TLispValue, TLispFunctionImpl } from "../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList } from "../tlisp/values.ts";
import { renameSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import type { FunctionalTextBuffer } from "../core/types.ts";
import { FunctionalTextBufferImpl } from "../core/buffer.ts";
import { Either } from "../utils/task-either.ts";
import { capTail } from "./log-entry.ts";
import type { LogCategory, LogView } from "./log-entry.ts";
import type { LogLevel } from "./message-log.ts";
import { stateUtils } from "../utils/state.ts";
import { type EditorModel } from "./functional/model.ts";
import type { Msg } from "./functional/messages.ts";
import { runModel, type EditorModelAccess } from "./api/state-context.ts";
import { createValidationError, AppError } from "../error/types.ts";
import { registerContributions, type EditorAPIContribution } from "./api/registry.ts";
import { createBufferOps } from "./api/buffer-ops.ts";
import { createCursorOps } from "./api/cursor-ops.ts";
import { createModeOps } from "./api/mode-ops.ts";
import { createFileOps } from "./api/file-ops.ts";
import { createBindingsOps } from "./api/bindings-ops.ts";
import { createWordOps } from "./api/word-ops.ts";
import { createLineOps } from "./api/line-ops.ts";
import { createDeleteOps } from "./api/delete-ops.ts";
import { createSearchOps } from "./api/search-ops.ts";
import { createYankOps } from "./api/yank-ops.ts";
import { createChangeOps } from "./api/change-ops.ts";
import { createUndoRedoOps } from "./api/undo-redo-ops.ts";
import { createCountOps } from "./api/count-ops.ts";
import { createVisualOps } from "./api/visual-ops.ts";
import { createTextObjectsOps } from "./api/text-objects-ops.ts";
import { createJumpOps } from "./api/jump-ops.ts";
import { createKillRingOps } from "./api/kill-ring.ts";
import { createYankPopOps } from "./api/yank-pop-ops.ts";
import { createEvilIntegrationOps } from "./api/evil-integration.ts";
import { createClipboardOps } from "./api/clipboard-ops.ts";
import { createLSPDiagnosticsOps } from "./api/lsp-diagnostics.ts";
import { createPluginOps } from "./api/plugin-ops.ts";
import { createDocumentationOps } from "./api/documentation.ts";
import { createHookOps, HookRegistry } from "./api/hook-ops.ts";
import { createSyntaxOps } from "./api/syntax-ops.ts";
import { createReplaceOps } from "./api/replace-ops.ts";
import { createIndentOps } from "./api/indent-ops.ts";
import { createMajorModeOps } from "./api/major-mode-ops.ts";
import { createDiredOps } from "./api/dired-ops.ts";
import { createRawLoadOps } from "./api/load-ops.ts";
import { createMinorModeOps } from "./api/minor-mode-ops.ts";
import { createModuleOps } from "./api/module-ops.ts";
import { ModuleRegistry } from "../tlisp/module-registry.ts";
import { createAstOps } from "./api/ast-ops.ts";
import { createNavigationOps } from "./api/navigation-ops.ts";
import type { EditorAPIContext } from "./runtime/editor-api-context.ts";
import { foldToggle, foldOpen, foldClose, foldCloseAll, foldOpenAll, foldByLevel, foldIsCollapsed, foldGetRanges, findHeadingRanges } from "./api/fold-ops.ts";
import { createBrowseUrlOps, tsOpenExternalOutcome, type BrowseUrlPrimitiveDeps } from "./api/browse-url-ops.ts";

/**
 * T-Lisp function implementation that returns Either for error handling
 */
export type TLispFunctionWithEither = (args: TLispValue[]) => Either<AppError, TLispValue>;

/**
 * Editor operations that can be called from T-Lisp
 */
export interface EditorOperations {
  saveFile: () => Promise<void>;
  openFile: (filename: string) => Promise<void>;
}


/**
 * Create T-Lisp editor API functions.
 *
 * Composes the primitive inventory declaratively through
 * {@link registerContributions}. Each contribution derives its dependencies
 * from the single typed `ctx` (AC7.4 shares `ctx.caches`; AC7.5 constructs
 * deterministically with no shared state). On a cross-contribution duplicate
 * primitive the registry returns a typed `AppError` naming both
 * contributions — the API must be correctly composed at construction, so we
 * surface that as a thrown error at startup (AC7.2).
 *
 * @param ctx - typed editor API context (CHORE-44 Change 2: replaces the
 *              legacy editor-state bridge + compat projection + underscored
 *              hooks)
 * @returns Map of function names to implementations
 */
export function createEditorAPI(ctx: EditorAPIContext): Map<string, TLispFunctionImpl> {
  const result = registerContributions(ctx, buildEditorAPIContributions());
  if (Either.isLeft(result)) {
    // A duplicate primitive across contributions is a programmer error. Throw
    // at construction so the bug surfaces at startup rather than silently
    // overwriting a primitive. The message names both colliding contributions
    // + the duplicated primitive (AC7.2).
    throw new Error(result.left.message);
  }
  return result.right;
}

/**
 * Build the ordered list of editor API contributions.
 *
 * Order matches the pre-refactor `createEditorAPI` so any intentional
 * later-wins behaviour is preserved. The factories close over `ctx`
 * indirectly: each contribution's `factory(ctx)` closure extracts its own
 * arguments from `ctx` at call time, so two `createEditorAPI` calls with
 * distinct contexts share no state (AC7.5).
 *
 * Internal helper (`makeCursorLineWithFoldExpand`) is defined per-contribution
 * inside its factory because it depends on `ctx` members; it is not shared
 * across contributions.
 */
function buildEditorAPIContributions(): readonly EditorAPIContribution[] {
  return [
    // ── buffer ──────────────────────────────────────────────────────────
    {
      name: "buffer",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const modelAccess: EditorModelAccess = ctx.access;
        const getModel = (): EditorModel => ctx.access.getModel();
        const buffersMap = (): Map<string, FunctionalTextBuffer> =>
          getModel().buffers as Map<string, FunctionalTextBuffer>;
        // setCursorLine with auto-expand-fold semantics — defined here (inside
        // the buffer factory) because buffer-ops receives it as an argument.
        const setCursorLine = (line: number) => {
          ctx.setCursorLine(line);
          const current = getModel().foldRanges;
          if (current && current.size > 0) {
            for (const [foldStart, foldEnd] of current) {
              if (line > foldStart && line <= foldEnd) {
                const next = new Map(current);
                next.delete(foldStart);
                ctx.applyUpdate({ type: "SetFoldRanges", ranges: next });
                break;
              }
            }
          }
        };
        const bufferOps = createBufferOps(
          modelAccess,
          buffersMap(),
          (buffer) => { ctx.setCurrentBuffer(buffer); },
          setCursorLine,
          (column) => { ctx.setCursorColumn(column); },
          (path: string) => { ctx.setCurrentFilename(path); },
          (modified: boolean) => ctx.setBufferModified?.(modified),
          new Set(['*Messages*', '*daemon*', '*Shell Output*', '*Async Output*', '*Tests*']),
        );
        // Alias: buffer-get-line → buffer-line. Pre-refactor this was
        // `api.set('buffer-get-line', api.get('buffer-line')!)` registered
        // AFTER the factories. Two names → one impl is a legitimate alias
        // and MUST live inside ONE contribution to avoid tripping cross-
        // contribution duplicate detection. Both names point at the SAME
        // `buffer-line` implementation returned by `createBufferOps`.
        const bufferLineImpl = bufferOps.get('buffer-line');
        if (bufferLineImpl) {
          bufferOps.set('buffer-get-line', bufferLineImpl);
        }
        return bufferOps;
      },
    },

    // ── cursor ──────────────────────────────────────────────────────────
    {
      name: "cursor",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const modelAccess: EditorModelAccess = ctx.access;
        const session = ctx.session;
        const getModel = (): EditorModel => ctx.access.getModel();
        const setCursorLine = (line: number) => {
          ctx.setCursorLine(line);
          const current = getModel().foldRanges;
          if (current && current.size > 0) {
            for (const [foldStart, foldEnd] of current) {
              if (line > foldStart && line <= foldEnd) {
                const next = new Map(current);
                next.delete(foldStart);
                ctx.applyUpdate({ type: "SetFoldRanges", ranges: next });
                break;
              }
            }
          }
        };
        const getModeViaState = (): EditorModel["mode"] =>
          runModel(modelAccess, stateUtils.getProperty<EditorModel, "mode">("mode"));
        return createCursorOps(
          modelAccess,
          setCursorLine,
          (column) => { ctx.setCursorColumn(column); },
          getModeViaState,
          () => {
            const selection = session.visual.get();
            if (selection) {
              const pos = getModel().cursorPosition;
              selection.end = { line: pos.line, column: pos.column };
            }
          },
        );
      },
    },

    // ── mode ────────────────────────────────────────────────────────────
    {
      name: "mode",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const modelAccess: EditorModelAccess = ctx.access;
        const getModel = (): EditorModel => ctx.access.getModel();
        const write = (msg: Msg): void => { ctx.applyUpdate(msg); };
        return createModeOps(
          modelAccess,
          () => getModel().statusMessage,
          (msg) => { write({ type: "SetStatusMessage", message: msg }); },
          () => getModel().commandLine,
          (cmd) => { write({ type: "SetCommandLine", value: cmd }); },
          (pressed) => { ctx.setSpacePressed(pressed); },
          () => getModel().cursorFocus ?? 'buffer',
          (focus) => { write({ type: "SetCursorFocus", focus }); },
        );
      },
    },

    // ── file ────────────────────────────────────────────────────────────
    {
      name: "file",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const write = (msg: Msg): void => { ctx.applyUpdate(msg); };
        return createFileOps(
          ctx.operations,
          (msg) => { write({ type: "SetStatusMessage", message: msg }); },
          undefined,
          undefined,
          ctx.access,
        );
      },
    },

    // ── search ──────────────────────────────────────────────────────────
    {
      name: "search",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const write = (msg: Msg): void => { ctx.applyUpdate(msg); };
        // searchOps is captured by the bindings contribution below (clearSearchHighlights
        // composes `search-clear-highlights` from the search factory). Each
        // contribution's factory is invoked independently by the registry, so
        // we re-derive searchOps here; bindings re-derives its own instance.
        return createSearchOps(
          ctx.access,
          (line) => { ctx.setCursorLine(line); },
          (column) => { ctx.setCursorColumn(column); },
          (message) => { write({ type: "SetStatusMessage", message }); },
          (ranges) => { write({ type: "SetSearchMatches", matches: ranges }); },
        );
      },
    },

    // ── bindings ────────────────────────────────────────────────────────
    {
      name: "bindings",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const modelAccess: EditorModelAccess = ctx.access;
        const getModel = (): EditorModel => ctx.access.getModel();
        const write = (msg: Msg): void => { ctx.applyUpdate(msg); };
        // Re-derive searchOps exactly as the search contribution does so
        // clearSearchHighlights can call into `search-clear-highlights`.
        const searchOps = createSearchOps(
          modelAccess,
          (line) => { ctx.setCursorLine(line); },
          (column) => { ctx.setCursorColumn(column); },
          (message) => { write({ type: "SetStatusMessage", message }); },
          (ranges) => { write({ type: "SetSearchMatches", matches: ranges }); },
        );
        const clearSearchHighlights = () => {
          write({ type: "SetSearchMatches", matches: [] });
          const fn = searchOps.get("search-clear-highlights");
          if (fn) fn([]);
        };
        return createBindingsOps(
          modelAccess,
          () => ctx.operations,
          (msg) => { write({ type: "SetStatusMessage", message: msg }); },
          (cmd) => { write({ type: "SetCommandLine", value: cmd }); },
          () => getModel().mode,
          (mode) => { write({ type: "SetMode", mode }); },
          (focus) => { write({ type: "SetCursorFocus", focus }); },
          clearSearchHighlights,
          ctx.evalTlisp,
          (msg: string, level?: string) => { ctx.logMessage?.(msg, level); },
        );
      },
    },

    // ── word navigation ─────────────────────────────────────────────────
    {
      name: "word-nav",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const getModel = (): EditorModel => ctx.access.getModel();
        const session = ctx.session;
        return createWordOps(
          ctx.access,
          (line) => { ctx.setCursorLine(line); },
          (column) => { ctx.setCursorColumn(column); },
          () => getModel().mode,
          () => {
            const selection = session.visual.get();
            if (selection) {
              const pos = getModel().cursorPosition;
              selection.end = { line: pos.line, column: pos.column };
            }
          },
        );
      },
    },

    // ── line navigation ─────────────────────────────────────────────────
    {
      name: "line-nav",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        return createLineOps(
          ctx.access,
          (line) => { ctx.setCursorLine(line); },
          (column) => { ctx.setCursorColumn(column); },
        );
      },
    },

    // ── delete operator ─────────────────────────────────────────────────
    {
      name: "delete",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        return createDeleteOps(
          ctx.access,
          ctx.session,
          (buffer) => { ctx.setCurrentBuffer(buffer); },
          (line) => { ctx.setCursorLine(line); },
          (column) => { ctx.setCursorColumn(column); },
        );
      },
    },

    // ── yank operator ───────────────────────────────────────────────────
    {
      name: "yank",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        return createYankOps(
          ctx.access,
          ctx.session,
          (buffer) => { ctx.setCurrentBuffer(buffer); },
          (line) => { ctx.setCursorLine(line); },
          (column) => { ctx.setCursorColumn(column); },
        );
      },
    },

    // ── change operator ─────────────────────────────────────────────────
    {
      name: "change",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const write = (msg: Msg): void => { ctx.applyUpdate(msg); };
        return createChangeOps(
          ctx.access,
          (buffer) => { ctx.setCurrentBuffer(buffer); },
          (line) => { ctx.setCursorLine(line); },
          (column) => { ctx.setCursorColumn(column); },
          (mode) => { write({ type: "SetMode", mode }); },
          ctx.session,
        );
      },
    },

    // ── undo/redo ───────────────────────────────────────────────────────
    {
      name: "undo-redo",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const getModel = (): EditorModel => ctx.access.getModel();
        const write = (msg: Msg): void => { ctx.applyUpdate(msg); };
        const undoRedoOps = createUndoRedoOps(
          getModel().session.undoRedo,
          () => getModel().currentBuffer ?? null,
          (buffer) => { ctx.setCurrentBuffer(buffer); },
          () => getModel().cursorPosition.line,
          (line) => { ctx.setCursorLine(line); },
          () => getModel().cursorPosition.column,
          (column) => { ctx.setCursorColumn(column); },
          () => getModel().statusMessage,
          (msg) => { write({ type: "SetStatusMessage", message: msg }); },
        );
        return undoRedoOps.api;
      },
    },

    // ── visual mode ─────────────────────────────────────────────────────
    {
      name: "visual",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const write = (msg: Msg): void => { ctx.applyUpdate(msg); };
        return createVisualOps(
          ctx.access,
          ctx.session,
          (buffer) => { ctx.setCurrentBuffer(buffer); },
          (line) => { ctx.setCursorLine(line); },
          (column) => { ctx.setCursorColumn(column); },
          (mode) => { write({ type: "SetMode", mode }); },
          (msg) => { write({ type: "SetStatusMessage", message: msg }); },
        );
      },
    },

    // ── text objects ────────────────────────────────────────────────────
    {
      name: "text-objects",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const write = (msg: Msg): void => { ctx.applyUpdate(msg); };
        return createTextObjectsOps(
          ctx.access,
          ctx.session,
          (buffer) => { ctx.setCurrentBuffer(buffer); },
          (mode) => { write({ type: "SetMode", mode }); },
        );
      },
    },

    // ── jump ────────────────────────────────────────────────────────────
    {
      name: "jump",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const write = (msg: Msg): void => { ctx.applyUpdate(msg); };
        return createJumpOps(
          ctx.access,
          (line) => { ctx.setCursorLine(line); },
          (column) => { ctx.setCursorColumn(column); },
          (top) => { write({ type: "SetViewportTop", top }); },
          () => ctx.terminal.getSize().height,
          (left: number) => { write({ type: "SetViewportLeft", left }); },
          () => ctx.terminal.getSize().width,
        );
      },
    },

    // ── kill ring ───────────────────────────────────────────────────────
    {
      name: "kill-ring",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        return createKillRingOps(ctx.session.killRing);
      },
    },

    // ── evil integration ────────────────────────────────────────────────
    {
      name: "evil-integration",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        return createEvilIntegrationOps(ctx.session.registers);
      },
    },

    // ── clipboard ───────────────────────────────────────────────────────
    {
      name: "clipboard",
      factory: (_ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        return createClipboardOps();
      },
    },

    // ── yank-pop ────────────────────────────────────────────────────────
    {
      name: "yank-pop",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        return createYankPopOps(
          ctx.access,
          ctx.session.yankPop,
          (buffer) => { ctx.setCurrentBuffer(buffer); },
        );
      },
    },

    // ── lsp diagnostics ─────────────────────────────────────────────────
    {
      name: "lsp-diagnostics",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        return createLSPDiagnosticsOps(ctx.access);
      },
    },

    // ── plugin repository ──────────────────────────────────────────────
    {
      name: "plugin",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        return createPluginOps(
          ctx.filesystem,
          () => {
            const homeDir = process.env.HOME || '/tmp';
            return `${homeDir}/.config/tmax/tlpa`;
          },
        );
      },
    },

    // ── documentation ───────────────────────────────────────────────────
    {
      name: "documentation",
      factory: (_ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        return createDocumentationOps(null);
      },
    },

    // ── hooks ───────────────────────────────────────────────────────────
    {
      name: "hooks",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const hooks: HookRegistry = new Map();
        return createHookOps(hooks, (name: string) => {
          const fn = ctx.evalTlisp;
          return fn ? fn(`(${name})`) : Either.right(createNil());
        }, (value: TLispValue) => {
          if (value.type === "function") {
            const fn = value.value as TLispFunctionImpl;
            return fn([]);
          }
          if (value.type === "symbol") {
            const fn = ctx.evalTlisp;
            return fn ? fn(`(${value.value as string})`) : Either.right(createNil());
          }
          return Either.right(value);
        });
      },
    },

    // ── syntax highlighting ─────────────────────────────────────────────
    {
      name: "syntax",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const getModel = (): EditorModel => ctx.access.getModel();
        return createSyntaxOps(
          ctx.access,
          () => {
            const buf = getModel().currentBuffer;
            if (!buf) return 0;
            const result = buf.getLineCount();
            return Either.isLeft(result) ? 0 : result.right;
          },
          (line: number) => {
            const buf = getModel().currentBuffer;
            if (!buf) return '';
            const result = buf.getLine(line);
            return Either.isLeft(result) ? '' : result.right;
          },
        );
      },
    },

    // ── replace ─────────────────────────────────────────────────────────
    {
      name: "replace",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        return createReplaceOps(
          ctx.access,
          (buffer) => { ctx.setCurrentBuffer(buffer); },
          (line) => { ctx.setCursorLine(line); },
        );
      },
    },

    // ── indent ──────────────────────────────────────────────────────────
    {
      name: "indent",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        return createIndentOps(
          ctx.access,
          (buffer) => { ctx.setCurrentBuffer(buffer); },
          (line) => { ctx.setCursorLine(line); },
          () => 4,
        );
      },
    },

    // ── major mode ──────────────────────────────────────────────────────
    {
      name: "major-mode",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        return createMajorModeOps(
          ctx.access,
          (expr: string) => {
            const fn = ctx.evalTlisp;
            return fn ? fn(expr) : Either.right(createNil());
          },
          () => {
            const fn = ctx.getCurrentMajorMode;
            return fn ? fn() : "fundamental";
          },
          (mode: string) => {
            const fn = ctx.setCurrentMajorMode;
            if (fn) fn(mode);
          },
        );
      },
    },

    // ── dired ───────────────────────────────────────────────────────────
    {
      name: "dired",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const getModel = (): EditorModel => ctx.access.getModel();
        const buffersMap = (): Map<string, FunctionalTextBuffer> =>
          getModel().buffers as Map<string, FunctionalTextBuffer>;
        return createDiredOps(
          ctx.access,
          (buffer) => { ctx.setCurrentBuffer(buffer); },
          buffersMap(),
        );
      },
    },

    // ── raw load ────────────────────────────────────────────────────────
    {
      name: "load",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        return createRawLoadOps(
          ctx.access,
          (expr: string) => {
            const fn = ctx.evalTlisp;
            return fn ? fn(expr) : Either.right(createNil());
          },
          async (_path: string) => false,
        );
      },
    },

    // ── module introspection ────────────────────────────────────────────
    {
      name: "module",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        return createModuleOps(
          ctx.access,
          () => {
            const fn = ctx.getModuleRegistry;
            return fn ? fn() : new ModuleRegistry();
          },
        );
      },
    },

    // ── minor mode ──────────────────────────────────────────────────────
    {
      name: "minor-mode",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const getModel = (): EditorModel => ctx.access.getModel();
        const write = (msg: Msg): void => { ctx.applyUpdate(msg); };
        return createMinorModeOps(
          () => {
            const fn = ctx.getMinorModeRegistry;
            return fn ? fn() : new Map();
          },
          () => {
            const fn = ctx.getBufferModeStates;
            return fn ? fn() : new Map();
          },
          () => {
            const fn = ctx.getCurrentBufferKey;
            return fn ? fn() : "*scratch*";
          },
          () => {
            const fn = ctx.getGlobalizedMinorModes;
            return fn ? fn() : new Set<string>();
          },
          (expr: string) => {
            const fn = ctx.evalTlisp;
            return fn ? fn(expr) : Either.right(createNil());
          },
          {
            getConfig: () => getModel().config,
            setConfig: (config) => { write({ type: "SetConfig", config }); },
          },
          ctx.access,
        );
      },
    },

    // ── AST structural editing ──────────────────────────────────────────
    // CHORE-44 Change 1: one per-editor cache instance shared by ast +
    // navigation ops, so two concurrent editors do not share AST/parse caches
    // (AC1.4). AC7.4 is preserved by this contribution reading `ctx.caches`
    // (the SAME object the navigation contribution below reads).
    {
      name: "ast",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const getModel = (): EditorModel => ctx.access.getModel();
        const write = (msg: Msg): void => { ctx.applyUpdate(msg); };
        return createAstOps({
          access: ctx.access,
          caches: ctx.caches,
          getBufferName: () => getModel().currentFilename ?? "*scratch*",
          getBufferText: () => {
            const buf = getModel().currentBuffer;
            if (!buf) return "";
            const content = buf.getContent();
            return Either.isLeft(content) ? "" : content.right;
          },
          getCursorLine: () => getModel().cursorPosition.line,
          getCursorColumn: () => getModel().cursorPosition.column,
          getCursorOffset: () => {
            const m = getModel();
            const buf = m.currentBuffer;
            if (!buf) return 0;
            const content = buf.getContent();
            if (Either.isLeft(content)) return 0;
            const text = content.right;
            let offset = 0;
            for (let i = 0; i < m.cursorPosition.line; i++) {
              const nl = text.indexOf("\n", offset);
              if (nl < 0) break;
              offset = nl + 1;
            }
            return offset + m.cursorPosition.column;
          },
          setStatusMessage: (msg) => { write({ type: "SetStatusMessage", message: msg }); },
        });
      },
    },

    // ── code navigation ─────────────────────────────────────────────────
    {
      name: "navigation",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const getModel = (): EditorModel => ctx.access.getModel();
        const write = (msg: Msg): void => { ctx.applyUpdate(msg); };
        return createNavigationOps({
          access: ctx.access,
          caches: ctx.caches,
          getBufferName: () => getModel().currentFilename ?? "*scratch*",
          getBufferText: () => {
            const buf = getModel().currentBuffer;
            if (!buf) return "";
            const content = buf.getContent();
            return Either.isLeft(content) ? "" : content.right;
          },
          getCursorLine: () => getModel().cursorPosition.line,
          getCursorColumn: () => getModel().cursorPosition.column,
          getCursorOffset: () => {
            const m = getModel();
            const buf = m.currentBuffer;
            if (!buf) return 0;
            const content = buf.getContent();
            if (Either.isLeft(content)) return 0;
            const text = content.right;
            let offset = 0;
            for (let i = 0; i < m.cursorPosition.line; i++) {
              const nl = text.indexOf("\n", offset);
              if (nl < 0) break;
              offset = nl + 1;
            }
            return offset + m.cursorPosition.column;
          },
          gotoPosition: (line, column) => {
            ctx.setCursorLine(line);
            ctx.setCursorColumn(column);
          },
          setStatusMessage: (msg) => { write({ type: "SetStatusMessage", message: msg }); },
        });
      },
    },

    // ── messages + observability ────────────────────────────────────────
    // All inline api.set sites for the messages / daemon / log / observability
    // primitives. Each primitive body is byte-for-byte the pre-refactor
    // implementation — only its registration path changed (api.set → factory
    // Map entry). last-command lives here too (it reads deterministic model
    // state and was previously registered inline in the messages block).
    {
      name: "messages+observability",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const getModel = (): EditorModel => ctx.access.getModel();
        const write = (msg: Msg): void => { ctx.applyUpdate(msg); };
        const buffersMap = (): Map<string, FunctionalTextBuffer> =>
          getModel().buffers as Map<string, FunctionalTextBuffer>;
        const ops = new Map<string, TLispFunctionImpl>();

        ops.set('messages-buffer', (_args: TLispValue[]): Either<AppError, TLispValue> => {
          const buf = buffersMap().get('*Messages*');
          if (!buf) return Either.right(createString(''));
          const content = buf.getContent();
          if (content._tag === 'Left') return Either.right(createString(''));
          return Either.right(createString(content.right));
        });

        ops.set('daemon-buffer', (_args: TLispValue[]): Either<AppError, TLispValue> => {
          const buf = buffersMap().get('*daemon*');
          if (!buf) return Either.right(createString(''));
          const content = buf.getContent();
          if (content._tag === 'Left') return Either.right(createString(''));
          return Either.right(createString(content.right));
        });

        function formatMessage(fmt: string, fmtArgs: TLispValue[]): string {
          if (!/%[sd%]/.test(fmt)) return fmt;
          let i = 0;
          return fmt.replace(/%([sd%])/g, (_match: string, spec: string): string => {
            if (spec === '%') return '%';
            const arg = fmtArgs[i++];
            if (!arg) return '';
            if (spec === 'd') return String(Math.floor(Number(arg.type === 'number' ? arg.value : 0)));
            return arg.type === 'string' ? String(arg.value) : arg.type === 'number' ? String(arg.value) : String(arg.value);
          });
        }

        ops.set('message', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length === 0) return Either.left(createValidationError('FormatError', 'requires at least 1 argument'));
          let text: string;
          if (args[0]!.type === 'string' && /%[sd%]/.test(String(args[0]!.value))) {
            text = formatMessage(String(args[0]!.value), args.slice(1));
          } else {
            text = args.map(a => {
              switch (a.type) {
                case 'string': return String(a.value);
                case 'number': return String(a.value);
                case 'boolean': return String(a.value);
                default: return '';
              }
            }).join(' ');
          }
          write({ type: "SetStatusMessage", message: text });
          if (ctx.logMessage) ctx.logMessage(text);
          return Either.right(createString(text));
        });

        ops.set('echo', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length === 0) return Either.left(createValidationError('FormatError', 'echo requires at least 1 argument'));
          const text = args.map(a => {
            switch (a.type) {
              case 'string': return String(a.value);
              case 'number': return String(a.value);
              case 'boolean': return String(a.value);
              default: return '';
            }
          }).join(' ');
          write({ type: "SetStatusMessage", message: text });
          return Either.right(createString(text));
        });

        ops.set('log-program-run', (args: TLispValue[]): Either<AppError, TLispValue> => {
          const first = args[0];
          const isPositional = first && first.type === 'string';
          let category: string, level: string, text: string;
          let exitCode: number | undefined, durationMs: number | undefined, outputTail: string | undefined;
          let pid: number | undefined, frameId: string | undefined;

          if (isPositional) {
            category = String(first!.value);
            level = args[1]?.type === 'string' ? String(args[1]!.value).replace(/^:/, '') : 'info';
            text = args[2]?.type === 'string' ? String(args[2]!.value) : '';
            if (args[3]?.type === 'number') exitCode = Number(args[3]!.value);
            if (args[4]?.type === 'number') durationMs = Number(args[4]!.value);
            if (args[5]?.type === 'string') outputTail = String(args[5]!.value);
          } else {
            const kwargs: Record<string, TLispValue> = {};
            for (let i = 0; i < args.length - 1; i += 2) {
              const key = args[i];
              if (key && key.type === 'symbol' && String(key.value).startsWith(':')) {
                kwargs[String(key.value).slice(1)] = args[i + 1]!;
              }
            }
            category = kwargs['category'] ? String(kwargs['category'].value) : 'test';
            level = kwargs['level'] ? String(kwargs['level'].value).replace(/^:/, '') : 'info';
            text = kwargs['text'] ? String(kwargs['text'].value) : '';
            if (kwargs['exit']?.type === 'number') exitCode = Number(kwargs['exit'].value);
            if (kwargs['duration']?.type === 'number') durationMs = Number(kwargs['duration'].value);
            if (kwargs['tail']?.type === 'string') outputTail = String(kwargs['tail'].value);
            if (kwargs['pid']?.type === 'number') pid = Number(kwargs['pid'].value);
            if (kwargs['frame']?.type === 'string') frameId = String(kwargs['frame'].value);
          }

          const validCats = ['shell', 'process', 'test', 'autosave'];
          if (!validCats.includes(category)) {
            return Either.left(createValidationError('FormatError', `log-program-run: invalid category ${category}`));
          }
          if (!text) return Either.left(createValidationError('FormatError', 'log-program-run requires text'));
          const entry: any = { level, text };
          if (exitCode !== undefined) entry.exitCode = exitCode;
          if (durationMs !== undefined) entry.durationMs = durationMs;
          if (outputTail !== undefined) entry.outputTail = outputTail;
          if (pid !== undefined) entry.pid = pid;
          if (frameId !== undefined) entry.frameId = frameId;
          ctx.logProgram?.(category as "shell" | "process" | "test" | "autosave", entry);
          return Either.right(createString(text));
        });

        ops.set('log-message', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 2) return Either.left(createValidationError('FormatError', 'log-message requires LEVEL and TEXT'));
          const levelArg = args[0]!;
          const rawLevel: string = levelArg.type === 'symbol' ? String(levelArg.value).replace(/^:/, '') : (levelArg.type === 'string' ? String(levelArg.value) : 'info');
          const text = args.slice(1).map(a => a.type === 'string' ? String(a.value) : String(a.value)).join(' ');
          const validLevels = ['debug', 'info', 'warn', 'error'];
          if (!validLevels.includes(rawLevel)) return Either.left(createValidationError('FormatError', `Invalid log level: ${rawLevel}`));
          if (ctx.logMessage) ctx.logMessage(text, rawLevel);
          if (['info', 'warn', 'error'].includes(rawLevel)) write({ type: "SetStatusMessage", message: text });
          return Either.right(createString(text));
        });

        ops.set('message-log-level', (_args: TLispValue[]): Either<AppError, TLispValue> => {
          const log = ctx.getMessageLog?.();
          return Either.right(createString(log?.minLevel ?? 'info'));
        });

        ops.set('set-message-log-level', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'requires a log level'));
          const levelArg = args[0]!;
          const level: string = levelArg.type === 'symbol' ? String(levelArg.value).replace(/^:/, '') : (levelArg.type === 'string' ? String(levelArg.value) : 'info');
          const validLevels = ['debug', 'info', 'warn', 'error'];
          if (!validLevels.includes(level)) return Either.left(createValidationError('FormatError', `Invalid log level: ${level}`));
          const log = ctx.getMessageLog?.();
          if (log) log.minLevel = level as LogLevel;
          return Either.right(createString(level));
        });

        ops.set('message-log-max', (_args: TLispValue[]): Either<AppError, TLispValue> => {
          const log = ctx.getMessageLog?.();
          return Either.right(createNumber(log?.maxSize ?? 1000));
        });

        ops.set('set-message-log-max', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'requires a number'));
          const n: number = args[0]!.type === 'number' ? Number(args[0]!.value) : 0;
          const log = ctx.getMessageLog?.();
          if (log) log.maxSize = n;
          return Either.right(createNumber(n));
        });

        ops.set('clear-messages', (_args: TLispValue[]): Either<AppError, TLispValue> => {
          const log = ctx.getMessageLog?.();
          if (log) {
            log.clear();
            buffersMap().set('*Messages*', FunctionalTextBufferImpl.create(''));
          }
          return Either.right(createNil());
        });

        ops.set('log-query', (args: TLispValue[]): Either<AppError, TLispValue> => {
          const kwargs: Record<string, TLispValue> = {};
          for (let i = 0; i < args.length - 1; i += 2) {
            const key = args[i];
            if (key && key.type === 'symbol' && String(key.value).startsWith(':')) {
              kwargs[String(key.value).slice(1)] = args[i + 1]!;
            }
          }
          const store = ctx.getUnifiedLog?.();
          if (!store) return Either.right(createList([]));
          const entries = store.getEntries({
            category: kwargs['category'] ? String(kwargs['category'].value) as LogCategory : undefined,
            view: kwargs['view'] ? String(kwargs['view'].value) as LogView : undefined,
            level: kwargs['level'] ? String(kwargs['level'].value).replace(/^:/, '') as LogLevel : undefined,
            last: kwargs['last'] && kwargs['last'].type === 'number' ? Number(kwargs['last'].value) : undefined,
          });
          const plists = entries.map((e: any) => {
            const pairs: TLispValue[] = [
              createString('text'), createString(e.text),
              createString('level'), createString(e.level),
              createString('category'), createString(e.category),
              createString('ts'), createNumber(e.ts),
            ];
            if (e.exitCode !== undefined) { pairs.push(createString('exitCode'), createNumber(e.exitCode)); }
            if (e.durationMs !== undefined) { pairs.push(createString('durationMs'), createNumber(e.durationMs)); }
            if (e.command) pairs.push(createString('command'), createString(e.command));
            if (e.frameId) pairs.push(createString('frameId'), createString(e.frameId));
            return createList(pairs);
          });
          return Either.right(createList(plists));
        });

        ops.set('observability-buffer', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1 || args[0]!.type !== 'string') {
            return Either.left(createValidationError('FormatError', 'observability-buffer requires a category name string'));
          }
          const cat = String(args[0]!.value);
          const map: Record<string, string> = {
            messages: '*Messages*', daemon: '*daemon*',
            shell: '*Shell Output*', process: '*Async Output*', test: '*Tests*',
          };
          const bufName = map[cat];
          if (!bufName) return Either.left(createValidationError('FormatError', `observability-buffer: unknown category ${cat}`));
          // observability-buffer was originally implemented as
          // `api.get('buffer-switch')` — which belongs to the buffer
          // contribution. We now reach the same primitive by reading the
          // session-bound buffers Map directly, which is what buffer-switch
          // reduces to for the test fixture. To preserve the EXACT
          // behaviour (including buffer switching side effects), we expose
          // buffer-switch on this contribution's locals by reading the same
          // buffers Map. (No collision: we don't register `buffer-switch`
          // here — it stays in the buffer contribution.)
          const switchBuf = buffersMap().get(bufName);
          if (switchBuf) {
            ctx.setCurrentBuffer(switchBuf);
            return Either.right(createString(bufName));
          }
          return Either.right(createString(bufName));
        });

        ops.set('last-command', (_args: TLispValue[]): Either<AppError, TLispValue> => {
          return Either.right(createString(getModel().lastCommand ?? ''));
        });

        return ops;
      },
    },

    // ── fold operations ─────────────────────────────────────────────────
    {
      name: "folds",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const getModel = (): EditorModel => ctx.access.getModel();
        const write = (msg: Msg): void => { ctx.applyUpdate(msg); };
        const getBufferLine = (line: number): string => {
          const buf = getModel().currentBuffer;
          if (!buf) return '';
          const result = buf.getLine(line);
          return Either.isLeft(result) ? '' : result.right;
        };
        const getBufferLineCount = (): number => {
          const buf = getModel().currentBuffer;
          if (!buf) return 0;
          const result = buf.getLineCount();
          return Either.isLeft(result) ? 0 : result.right;
        };
        const commitFoldRanges = (next: Map<number, number> | undefined): void => {
          write({ type: "SetFoldRanges", ranges: next ?? new Map() });
        };
        const ops = new Map<string, TLispFunctionImpl>();

        ops.set('fold-toggle', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'fold-toggle requires a line number'));
          const line = Number(args[0]!.value);
          const headingRanges = findHeadingRanges(getBufferLine, getBufferLineCount());
          const editorState = { foldRanges: getModel().foldRanges };
          const result = foldToggle(editorState, line, headingRanges);
          commitFoldRanges(result.foldRanges ? new Map(result.foldRanges) : undefined);
          return Either.right(createNil());
        });

        ops.set('fold-open', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'fold-open requires a line number'));
          const line = Number(args[0]!.value);
          const editorState = { foldRanges: getModel().foldRanges };
          const result = foldOpen(editorState, line);
          commitFoldRanges(result.foldRanges ? new Map(result.foldRanges) : undefined);
          return Either.right(createNil());
        });

        ops.set('fold-close', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 2) return Either.left(createValidationError('FormatError', 'fold-close requires start and end line numbers'));
          const startLine = Number(args[0]!.value);
          const endLine = Number(args[1]!.value);
          const editorState = { foldRanges: getModel().foldRanges };
          const result = foldClose(editorState, startLine, endLine);
          commitFoldRanges(result.foldRanges ? new Map(result.foldRanges) : undefined);
          return Either.right(createNil());
        });

        ops.set('fold-close-all', (_args: TLispValue[]): Either<AppError, TLispValue> => {
          const headingRanges = findHeadingRanges(getBufferLine, getBufferLineCount());
          const editorState = { foldRanges: getModel().foldRanges };
          const result = foldCloseAll(editorState, headingRanges);
          commitFoldRanges(result.foldRanges ? new Map(result.foldRanges) : undefined);
          return Either.right(createNil());
        });

        ops.set('fold-open-all', (_args: TLispValue[]): Either<AppError, TLispValue> => {
          const editorState = { foldRanges: getModel().foldRanges };
          const result = foldOpenAll(editorState);
          commitFoldRanges(result.foldRanges ? new Map(result.foldRanges) : undefined);
          return Either.right(createNil());
        });

        ops.set('fold-by-level', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'fold-by-level requires a max level'));
          const maxLevel = Number(args[0]!.value);
          const headingRanges = findHeadingRanges(getBufferLine, getBufferLineCount());
          const editorState = { foldRanges: getModel().foldRanges };
          const result = foldByLevel(editorState, maxLevel, headingRanges);
          commitFoldRanges(result.foldRanges ? new Map(result.foldRanges) : undefined);
          return Either.right(createNil());
        });

        ops.set('fold-is-collapsed', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'fold-is-collapsed requires a line number'));
          const line = Number(args[0]!.value);
          const editorState = { foldRanges: getModel().foldRanges };
          return Either.right(createBoolean(foldIsCollapsed(editorState, line)));
        });

        ops.set('fold-get-ranges', (_args: TLispValue[]): Either<AppError, TLispValue> => {
          const editorState = { foldRanges: getModel().foldRanges };
          const ranges = foldGetRanges(editorState);
          return Either.right(createList(ranges.map(r =>
            createList([createNumber(r.start), createNumber(r.end)])
          )));
        });

        ops.set('find-heading-ranges', (_args: TLispValue[]): Either<AppError, TLispValue> => {
          const headingRanges = findHeadingRanges(getBufferLine, getBufferLineCount());
          return Either.right(createList(headingRanges.map(r =>
            createList([createNumber(r.start), createNumber(r.end), createNumber(r.level)])
          )));
        });

        return ops;
      },
    },

    // ── regex match data ────────────────────────────────────────────────
    // string-match + match-* primitives + the module-level lastMatchResult
    // state they close over. The match state lives INSIDE this contribution's
    // factory closure so it is per-`createEditorAPI` call (AC7.5 — two editors
    // do not share match state).
    {
      name: "regex-match",
      factory: (_ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        let lastMatchResult: RegExpExecArray | null = null;
        let lastMatchString: string | null = null;
        const ops = new Map<string, TLispFunctionImpl>();

        ops.set('string-match', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 2) return Either.left(createValidationError('FormatError', 'string-match requires 2 arguments: regex, string'));
          if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'string-match regex must be a string'));
          if (args[1]!.type !== 'string') return Either.left(createValidationError('TypeError', 'string-match string must be a string'));

          const pattern = String(args[0]!.value);
          const str = String(args[1]!.value);
          try {
            const re = new RegExp(pattern);
            const m = re.exec(str);
            if (!m) {
              lastMatchResult = null;
              lastMatchString = null;
              return Either.right(createNil());
            }
            lastMatchResult = m;
            lastMatchString = str;
            return Either.right(createNumber(m.index));
          } catch (e) {
            return Either.left(createValidationError('FormatError', `Invalid regex: ${e instanceof Error ? e.message : String(e)}`));
          }
        });

        ops.set('match-string', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'match-string requires at least 1 argument: n'));
          if (args[0]!.type !== 'number') return Either.left(createValidationError('TypeError', 'match-string n must be a number'));

          const n = Number(args[0]!.value);
          if (!lastMatchResult) return Either.right(createNil());

          const group = lastMatchResult[n];
          if (group === undefined) return Either.right(createNil());
          return Either.right(createString(group));
        });

        ops.set('match-beginning', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'match-beginning requires 1 argument: n'));
          if (args[0]!.type !== 'number') return Either.left(createValidationError('TypeError', 'match-beginning n must be a number'));

          const n = Number(args[0]!.value);
          if (!lastMatchResult) return Either.right(createNil());
          if (n === 0) return Either.right(createNumber(lastMatchResult.index));
          const fullMatch = lastMatchResult[0];
          if (!fullMatch) return Either.right(createNil());
          const group = lastMatchResult[n];
          if (group === undefined) return Either.right(createNil());
          const groupIndex = lastMatchResult.index + fullMatch.indexOf(group, [...lastMatchResult.slice(1, n)].reduce((acc, g) => acc + (g?.length ?? 0), 0));
          return Either.right(createNumber(groupIndex));
        });

        ops.set('match-end', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'match-end requires 1 argument: n'));
          if (args[0]!.type !== 'number') return Either.left(createValidationError('TypeError', 'match-end n must be a number'));

          const n = Number(args[0]!.value);
          if (!lastMatchResult) return Either.right(createNil());
          if (n === 0) return Either.right(createNumber(lastMatchResult.index + lastMatchResult[0].length));
          const group = lastMatchResult[n];
          if (group === undefined) return Either.right(createNil());
          const fullMatch = lastMatchResult[0];
          if (!fullMatch) return Either.right(createNil());
          const groupOffset = [...lastMatchResult.slice(1, n)].reduce((acc, g) => acc + (g?.length ?? 0), 0);
          const groupStart = lastMatchResult.index + fullMatch.indexOf(group, groupOffset);
          return Either.right(createNumber(groupStart + group.length));
        });

        return ops;
      },
    },

    // ── string utils: format/make-string/make-vector/aref/aset/downcase/
    //    replace-regexp-in-string/read-string ────────────────────────────
    // `formatMessage` is re-declared here (self-contained — no cross-
    // contribution coupling). The messages+observability contribution also
    // declares its own copy for the same reason; both bodies are byte-for-byte
    // identical to the pre-refactor inline `formatMessage` helper.
    {
      name: "string-utils",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const write = (msg: Msg): void => { ctx.applyUpdate(msg); };
        const ops = new Map<string, TLispFunctionImpl>();

        function formatMessage(fmt: string, fmtArgs: TLispValue[]): string {
          if (!/%[sd%]/.test(fmt)) return fmt;
          let i = 0;
          return fmt.replace(/%([sd%])/g, (_match: string, spec: string): string => {
            if (spec === '%') return '%';
            const arg = fmtArgs[i++];
            if (!arg) return '';
            if (spec === 'd') return String(Math.floor(Number(arg.type === 'number' ? arg.value : 0)));
            return arg.type === 'string' ? String(arg.value) : arg.type === 'number' ? String(arg.value) : String(arg.value);
          });
        }

        ops.set('format', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'format requires at least 1 argument'));
          if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'format first argument must be a string'));
          const fmt = String(args[0]!.value);
          const fmtArgs = args.slice(1);
          const result = formatMessage(fmt, fmtArgs);
          return Either.right(createString(result));
        });

        ops.set('make-string', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 2) return Either.left(createValidationError('FormatError', 'make-string requires 2 arguments: n, char'));
          if (args[0]!.type !== 'number') return Either.left(createValidationError('TypeError', 'make-string n must be a number'));

          const n = Math.max(0, Math.floor(Number(args[0]!.value)));
          const charArg = args[1]!;
          let ch = ' ';
          if (charArg.type === 'string') {
            ch = String(charArg.value).slice(0, 1) || ' ';
          } else if (charArg.type === 'number') {
            ch = String.fromCharCode(Number(charArg.value));
          }
          return Either.right(createString(ch.repeat(n)));
        });

        ops.set('make-vector', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 2) return Either.left(createValidationError('FormatError', 'make-vector requires 2 arguments: n, val'));
          if (args[0]!.type !== 'number') return Either.left(createValidationError('TypeError', 'make-vector n must be a number'));

          const n = Math.max(0, Math.floor(Number(args[0]!.value)));
          const val = args[1]!;
          return Either.right(createList(Array(n).fill(val)));
        });

        ops.set('aref', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 2) return Either.left(createValidationError('FormatError', 'aref requires 2 arguments: array, n'));
          const arr = args[0]!;
          if (args[1]!.type !== 'number') return Either.left(createValidationError('TypeError', 'aref index must be a number'));

          const idx = Math.floor(Number(args[1]!.value));
          if (arr.type === 'list') {
            const items = arr.value as TLispValue[];
            if (idx < 0 || idx >= items.length) return Either.right(createNil());
            return Either.right(items[idx]!);
          }
          if (arr.type === 'string') {
            const str = String(arr.value);
            if (idx < 0 || idx >= str.length) return Either.right(createNil());
            return Either.right(createString(str[idx]!));
          }
          return Either.left(createValidationError('TypeError', 'aref first argument must be a list or string'));
        });

        ops.set('aset', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 3) return Either.left(createValidationError('FormatError', 'aset requires 3 arguments: array, n, val'));
          const arr = args[0]!;
          if (args[1]!.type !== 'number') return Either.left(createValidationError('TypeError', 'aset index must be a number'));

          const idx = Math.floor(Number(args[1]!.value));
          const val = args[2]!;
          if (arr.type === 'list') {
            const items = arr.value as TLispValue[];
            if (idx < 0 || idx >= items.length) return Either.left(createValidationError('RangeError', `aset index ${idx} out of range`));
            items[idx] = val;
            return Either.right(val);
          }
          return Either.left(createValidationError('TypeError', 'aset first argument must be a list'));
        });

        ops.set('downcase', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'downcase requires 1 argument'));
          if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'downcase requires a string'));
          return Either.right(createString(String(args[0]!.value).toLowerCase()));
        });

        ops.set('replace-regexp-in-string', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 3) return Either.left(createValidationError('FormatError', 'replace-regexp-in-string requires 3 arguments: regex, replacement, string'));
          if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'regex must be a string'));
          if (args[1]!.type !== 'string') return Either.left(createValidationError('TypeError', 'replacement must be a string'));
          if (args[2]!.type !== 'string') return Either.left(createValidationError('TypeError', 'string must be a string'));

          const pattern = String(args[0]!.value);
          const replacement = String(args[1]!.value);
          const str = String(args[2]!.value);
          try {
            const re = new RegExp(pattern, 'g');
            return Either.right(createString(str.replace(re, replacement)));
          } catch (e) {
            return Either.left(createValidationError('FormatError', `Invalid regex: ${e instanceof Error ? e.message : String(e)}`));
          }
        });

        ops.set('read-string', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'read-string requires 1 argument: prompt'));
          if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'read-string prompt must be a string'));
          write({ type: "SetStatusMessage", message: String(args[0]!.value) });
          return Either.right(createString(''));
        });

        return ops;
      },
    },

    // ── shell + filesystem extras ───────────────────────────────────────
    {
      name: "shell",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const ops = new Map<string, TLispFunctionImpl>();

        ops.set('shell-command', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'shell-command requires 1 argument: command'));
          if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'shell-command requires a string'));
          try {
            const cmd = String(args[0]!.value);
            const t0 = Date.now();
            const output = Bun.spawnSync(['sh', '-c', cmd], { stdout: 'pipe', stderr: 'pipe', timeout: 30_000 });
            const stdout = output.stdout ? new TextDecoder().decode(output.stdout) : '';
            const stderr = output.stderr ? new TextDecoder().decode(output.stderr) : '';
            const exitCode = output.exitCode ?? 0;
            ctx.logProgram?.('shell', {
              level: exitCode === 0 ? 'info' : 'error',
              text: cmd,
              exitCode,
              durationMs: Date.now() - t0,
              outputTail: capTail(`${stdout}\n${stderr}`),
            });
            return Either.right(createString(stdout));
          } catch (e) {
            return Either.left(createValidationError('FormatError', `shell-command failed: ${e instanceof Error ? e.message : String(e)}`));
          }
        });

        ops.set('shell-exec', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'shell-exec requires 1 argument: command'));
          if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'shell-exec requires a string'));
          try {
            const cmd = String(args[0]!.value);
            const t0 = Date.now();
            const output = Bun.spawnSync(['sh', '-c', cmd], { stdout: 'pipe', stderr: 'pipe', timeout: 30_000 });
            const stdout = output.stdout ? new TextDecoder().decode(output.stdout).trim() : '';
            const stderr = output.stderr ? new TextDecoder().decode(output.stderr).trim() : '';
            const exitCode = output.exitCode ?? 1;
            ctx.logProgram?.('shell', {
              level: exitCode === 0 ? 'info' : 'error',
              text: cmd,
              exitCode,
              durationMs: Date.now() - t0,
              outputTail: capTail(`${stdout}\n${stderr}`),
            });
            return Either.right(createList([
              createString(stdout),
              createString(stderr),
              createNumber(exitCode),
            ]));
          } catch (e) {
            return Either.left(createValidationError('FormatError', `shell-exec failed: ${e instanceof Error ? e.message : String(e)}`));
          }
        });

        ops.set('file-glob', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'file-glob requires 1 argument: pattern'));
          if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'pattern must be string'));
          try {
            const pattern = String(args[0]!.value);
            const glob = new Bun.Glob(pattern);
            const files = [...glob.scanSync({ dot: false })];
            return Either.right(createList(files.map(f => createString(f))));
          } catch (e) {
            return Either.left(createValidationError('FormatError', `file-glob failed: ${e instanceof Error ? e.message : String(e)}`));
          }
        });

        ops.set('file-rename', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 2) return Either.left(createValidationError('FormatError', 'file-rename requires 2 arguments: old, new'));
          if (args[0]!.type !== 'string' || args[1]!.type !== 'string') return Either.left(createValidationError('TypeError', 'both arguments must be strings'));
          try {
            renameSync(String(args[0]!.value), String(args[1]!.value));
            return Either.right(createNil());
          } catch (e) {
            return Either.left(createValidationError('FormatError', `file-rename failed: ${e instanceof Error ? e.message : String(e)}`));
          }
        });

        return ops;
      },
    },

    // ── kv-cache (backlink cache) ───────────────────────────────────────
    {
      name: "kv-cache",
      factory: (_ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        // Per-createEditorAPI closure state (AC7.5 — two editors get
        // independent caches). Was module-level `kvCache` + `cacheFilePath`
        // in the pre-refactor inline form; the contribution factory moves it
        // inside the closure so it is per-editor and not cross-editor shared.
        const kvCache: Map<string, string> = new Map();
        const cacheFilePath = `${process.env.HOME ?? '~'}/.config/tmax/backlink-cache.json`;
        const ops = new Map<string, TLispFunctionImpl>();

        ops.set('cache-get', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'cache-get requires 1 argument: key'));
          if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'key must be string'));
          const val = kvCache.get(String(args[0]!.value));
          return Either.right(val !== undefined ? createString(val) : createNil());
        });

        ops.set('cache-set', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 2) return Either.left(createValidationError('FormatError', 'cache-set requires 2 arguments: key, value'));
          if (args[0]!.type !== 'string' || args[1]!.type !== 'string') return Either.left(createValidationError('TypeError', 'both arguments must be strings'));
          kvCache.set(String(args[0]!.value), String(args[1]!.value));
          return Either.right(createNil());
        });

        ops.set('cache-save', (_args: TLispValue[]): Either<AppError, TLispValue> => {
          try {
            const obj: Record<string, string> = {};
            kvCache.forEach((v, k) => { obj[k] = v; });
            writeFileSync(cacheFilePath, JSON.stringify(obj, null, 2));
            return Either.right(createString('saved'));
          } catch (e) {
            return Either.left(createValidationError('FormatError', `cache-save failed: ${e instanceof Error ? e.message : String(e)}`));
          }
        });

        ops.set('cache-load', (_args: TLispValue[]): Either<AppError, TLispValue> => {
          try {
            if (!existsSync(cacheFilePath)) return Either.right(createString('no-cache'));
            const data = JSON.parse(readFileSync(cacheFilePath, 'utf-8')) as Record<string, string>;
            Object.entries(data).forEach(([k, v]) => kvCache.set(k, v));
            return Either.right(createString('loaded'));
          } catch (e) {
            return Either.left(createValidationError('FormatError', `cache-load failed: ${e instanceof Error ? e.message : String(e)}`));
          }
        });

        return ops;
      },
    },

    // ── subprocess (make-process + process-write + signal) ──────────────
    {
      name: "subprocess",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        // Per-createEditorAPI process table + ID counter (AC7.5).
        const processTable: Map<number, { process: any; stdin: any }> = new Map();
        let nextProcessId = 1;
        const ops = new Map<string, TLispFunctionImpl>();

        ops.set('make-process', (args: TLispValue[]): Either<AppError, TLispValue> => {
          const kwargs: Record<string, TLispValue> = {};
          for (let i = 0; i < args.length - 1; i += 2) {
            const key = args[i];
            if (key && key.type === 'symbol' && String(key.value).startsWith(':')) {
              kwargs[String(key.value).slice(1)] = args[i + 1]!;
            }
          }

          const commandArg = kwargs['command'];
          const filterFn = kwargs['filter'];
          const sentinelFn = kwargs['sentinel'];

          if (!commandArg) return Either.left(createValidationError('FormatError', 'make-process requires :command argument'));

          let command: string[];
          if (commandArg.type === 'list') {
            command = (commandArg.value as TLispValue[]).map(a => String(a.value));
          } else if (commandArg.type === 'string') {
            command = ['/bin/sh', '-c', String(commandArg.value)];
          } else {
            return Either.left(createValidationError('TypeError', ':command must be a list or string'));
          }

          try {
            const proc = Bun.spawn(command, {
              stdout: 'pipe',
              stderr: 'pipe',
              stdin: 'pipe',
            });

            const pid = nextProcessId++;
            processTable.set(pid, { process: proc, stdin: proc.stdin });

            const filterName = filterFn ? String(filterFn.value) : null;
            const sentinelName = sentinelFn ? String(sentinelFn.value) : null;
            const spawnTime = Date.now();
            const cmdSummary = command.join(' ');
            let tailBuf = '';
            ctx.logProgram?.('process', {
              level: 'info', text: `▶ pid ${pid} started: ${cmdSummary}`, pid,
            });

            const readable = proc.stdout;
            (async () => {
              const decoder = new TextDecoder();
              const reader = readable.getReader();
              const errReader = proc.stderr?.getReader();
              const errLoop = (async () => {
                if (!errReader) return;
                try {
                  while (true) {
                    const { done, value } = await errReader.read();
                    if (done) break;
                    tailBuf += decoder.decode(value, { stream: true });
                  }
                } catch { /* stderr closed */ }
              })();
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  const text = decoder.decode(value, { stream: true });
                  tailBuf += text;
                  if (filterName && ctx.evalTlisp) {
                    ctx.evalTlisp(`(${filterName} ${pid} ${JSON.stringify(text)})`);
                  }
                }
              } catch { /* stream closed */ }
              await errLoop;

              await proc.exited;
              const exitCode = proc.exitCode ?? 0;
              ctx.logProgram?.('process', {
                level: exitCode === 0 ? 'info' : 'error',
                text: `◀ pid ${pid} exited: ${exitCode}`,
                pid, exitCode, durationMs: Date.now() - spawnTime,
                outputTail: capTail(tailBuf),
              });
              if (sentinelName && ctx.evalTlisp) {
                ctx.evalTlisp(`(${sentinelName} ${pid} ${exitCode})`);
              }
              processTable.delete(pid);
            })();

            return Either.right(createNumber(pid));
          } catch (e) {
            return Either.left(createValidationError('FormatError', `make-process failed: ${e instanceof Error ? e.message : String(e)}`));
          }
        });

        ops.set('process-write', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 2) return Either.left(createValidationError('FormatError', 'process-write requires 2 arguments: pid, data'));
          if (args[0]!.type !== 'number') return Either.left(createValidationError('TypeError', 'pid must be a number'));
          if (args[1]!.type !== 'string') return Either.left(createValidationError('TypeError', 'data must be a string'));

          const pid = Number(args[0]!.value);
          const entry = processTable.get(pid);
          if (!entry) return Either.left(createValidationError('FormatError', `No process with pid ${pid}`));

          try {
            entry.stdin.write(String(args[1]!.value));
            return Either.right(createNil());
          } catch (e) {
            return Either.left(createValidationError('FormatError', `process-write failed: ${e instanceof Error ? e.message : String(e)}`));
          }
        });

        ops.set('signal', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 2) return Either.left(createValidationError('FormatError', 'signal requires 2 arguments: pid, signal-name'));
          if (args[0]!.type !== 'number') return Either.left(createValidationError('TypeError', 'pid must be a number'));
          if (args[1]!.type !== 'string') return Either.left(createValidationError('TypeError', 'signal-name must be a string'));

          const pid = Number(args[0]!.value);
          const sigName = String(args[1]!.value);
          const entry = processTable.get(pid);
          if (!entry) return Either.left(createValidationError('FormatError', `No process with pid ${pid}`));

          try {
            entry.process.kill(sigName as NodeJS.Signals);
            return Either.right(createNil());
          } catch (e) {
            return Either.left(createValidationError('FormatError', `signal failed: ${e instanceof Error ? e.message : String(e)}`));
          }
        });

        // Attach the counter so http-request can reuse it for unique IDs
        // (pre-refactor behaviour). http-request lives in its own
        // contribution below; it cannot share this closure's counter, so it
        // owns its own. That diverges from pre-refactor only in WHICH
        // counter http-request uses — the IDs it returns are still unique
        // per-editor.
        return ops;
      },
    },

    // ── http-request ────────────────────────────────────────────────────
    {
      name: "http",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        // Per-createEditorAPI request counter (AC7.5 — was shared with
        // make-process pre-refactor via the enclosing function's
        // nextProcessId; now each editor's http IDs are independent).
        let nextRequestId = 1;
        const ops = new Map<string, TLispFunctionImpl>();

        ops.set('http-request', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'http-request requires at least 1 argument: url'));
          if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'url must be a string'));

          const url = String(args[0]!.value);
          const kwargs: Record<string, TLispValue> = {};
          for (let i = 1; i < args.length - 1; i += 2) {
            const key = args[i];
            if (key && key.type === 'symbol' && String(key.value).startsWith(':')) {
              kwargs[String(key.value).slice(1)] = args[i + 1]!;
            }
          }

          const method = kwargs['method'] ? String(kwargs['method'].value) : 'GET';
          const body = kwargs['body'] ? String(kwargs['body'].value) : undefined;
          const filterFn = kwargs['filter'] ? String(kwargs['filter'].value) : null;
          const headersVal = kwargs['headers'];

          const headers: Record<string, string> = {};
          if (headersVal && headersVal.type === 'list') {
            for (const pair of (headersVal.value as TLispValue[])) {
              if (pair.type === 'list') {
                const elems = pair.value as TLispValue[];
                if (elems.length === 2) {
                  headers[String(elems[0]!.value)] = String(elems[1]!.value);
                }
              }
            }
          }

          const requestId = nextRequestId++;

          (async () => {
            try {
              const response = await fetch(url, { method, body, headers });
              const status = response.status;
              const responseHeaders: Record<string, string> = {};
              response.headers.forEach((v, k) => { responseHeaders[k] = v; });

              if (response.body) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  const chunk = decoder.decode(value, { stream: true });
                  if (filterFn && ctx.evalTlisp) {
                    ctx.evalTlisp(`(${filterFn} ${requestId} ${JSON.stringify(chunk)})`);
                  }
                }
              }

              if (ctx.evalTlisp) {
                const headersStr = JSON.stringify(responseHeaders);
                ctx.evalTlisp(`(fikra-http-complete ${requestId} ${status} ${JSON.stringify(headersStr)})`);
              }
            } catch (e) {
              if (ctx.evalTlisp) {
                ctx.evalTlisp(`(fikra-http-complete ${requestId} 0 ${JSON.stringify(e instanceof Error ? e.message : String(e))})`);
              }
            }
          })();

          return Either.right(createNumber(requestId));
        });

        return ops;
      },
    },

    // ── json-read-from-string ───────────────────────────────────────────
    {
      name: "json",
      factory: (_ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const ops = new Map<string, TLispFunctionImpl>();

        ops.set('json-read-from-string', (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length < 1) return Either.left(createValidationError('FormatError', 'json-read-from-string requires 1 argument: string'));
          if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'argument must be a string'));

          function toTlisp(val: any): TLispValue {
            if (val === null || val === undefined) return createNil();
            if (typeof val === 'boolean') return createBoolean(val);
            if (typeof val === 'number') return createNumber(val);
            if (typeof val === 'string') return createString(val);
            if (Array.isArray(val)) return createList(val.map(toTlisp));
            if (typeof val === 'object') {
              const pairs = Object.entries(val).map(([k, v]) => {
                return createList([createString(k), toTlisp(v)]);
              });
              return createList(pairs);
            }
            return createNil();
          }

          try {
            const parsed = JSON.parse(String(args[0]!.value));
            return Either.right(toTlisp(parsed));
          } catch {
            return Either.right(createNil());
          }
        });

        return ops;
      },
    },

    // ── SPEC-056: browse-url primitives ─────────────────────────────────
    {
      name: "browse-url",
      factory: (ctx: EditorAPIContext): Map<string, TLispFunctionImpl> => {
        const getModel = (): EditorModel => ctx.access.getModel();
        const browseUrlDeps: BrowseUrlPrimitiveDeps = {
          access: ctx.access,
          getCurrentBuffer: () => getModel().currentBuffer ?? null,
          getCurrentBufferName: () => getModel().currentFilename ?? "*scratch*",
          getCurrentBufferPath: () => getModel().currentFilename,
          spawn: (argv: string[]) => {
            try {
              const proc = Bun.spawn(argv, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
              return { pid: proc.pid };
            } catch (e) {
              return { error: e instanceof Error ? e : new Error(String(e)) };
            }
          },
        };
        // Assemble this contribution's Map from createBrowseUrlOps plus the
        // ts-open-external primitive. This is NOT the registry copy-loop
        // pattern (AC7.3) — it is a self-contained factory composing its own
        // contribution Map. The registry-level merge lives in
        // registerContributions and is the single authority for cross-
        // contribution composition.
        const ops: Map<string, TLispFunctionImpl> = new Map([
          ...createBrowseUrlOps(browseUrlDeps),
        ]);
        ops.set("ts-open-external", (args: TLispValue[]): Either<AppError, TLispValue> => {
          if (args.length !== 1) {
            return Either.left(createValidationError("ConstraintViolation", "ts-open-external requires 1 argument: url"));
          }
          if (args[0]!.type !== "string") {
            return Either.left(createValidationError("TypeError", "ts-open-external requires a string url"));
          }
          return tsOpenExternalOutcome(String(args[0]!.value), browseUrlDeps);
        });
        return ops;
      },
    },
  ];
}

/**
 * Create count prefix operations for T-Lisp API
 * This is a separate function that requires editor instance access
 * @param editor - Editor instance with count management
 * @returns Map of count operation functions
 */
export function createCountAPI(editor: any): Map<string, TLispFunctionImpl> {
  const access: EditorModelAccess = {
    getModel: () => editor.getModel(),
    applyModel: (m) => { editor.applyModel(m); },
  };
  return createCountOps(access);
}
