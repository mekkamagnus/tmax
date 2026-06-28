/**
 * @file update.ts
 * @description Elm Architecture "update" — a pure direct reducer.
 *
 * `update(model, msg): UpdateResult` is pure: no IO, no T-Lisp eval. Each
 * `case` returns a fresh model via immutable object/collection helpers (the
 * `patch()` helper runs the `State.modify` monadic pattern from
 * src/utils/state.ts), plus any requested Cmds. It does NOT return or expose
 * `State`; the State-monad requirement applies to editor API primitives in
 * `src/editor/api/*.ts` and the `tlisp-api.ts` adapter, not to this reducer.
 */

import type { Window, Tab, HighlightSpan } from "../../core/types.ts";
import { State } from "../../utils/state.ts";
import type { EditorModel } from "./model.ts";
import type { Msg } from "./messages.ts";
import type { Cmd } from "./cmd.ts";

export interface UpdateResult {
  readonly model: EditorModel;
  readonly cmds: readonly Cmd[];
}

const noCmds: readonly Cmd[] = Object.freeze([]);

/**
 * Return a new model with `fields` merged in, via the `State.modify` monadic
 * pattern from src/utils/state.ts.
 */
function patch(model: EditorModel, fields: Partial<EditorModel>): EditorModel {
  return State.modify<EditorModel>(m => ({ ...m, ...fields })).exec(model);
}

/** Immutable map entry upsert: returns a fresh Map. */
function withMapEntry<K, V>(map: Map<K, V>, key: K, value: V): Map<K, V> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

/** Pure reducer. Same (model, msg) always yields the same UpdateResult. */
export function update(model: EditorModel, msg: Msg): UpdateResult {
  switch (msg.type) {
    case "SetMode":
      return { model: patch(model, { mode: msg.mode }), cmds: noCmds };
    case "SetCurrentMajorMode":
      return { model: patch(model, { currentMajorMode: msg.mode }), cmds: noCmds };
    case "SetActiveMinorModes":
      return { model: patch(model, { activeMinorModes: [...msg.modes] }), cmds: noCmds };

    case "SetStatusMessage":
      return { model: patch(model, { statusMessage: msg.message }), cmds: noCmds };

    case "SetCommandLine":
      return { model: patch(model, { commandLine: msg.value }), cmds: noCmds };
    case "AppendCommandLine":
      return { model: patch(model, { commandLine: model.commandLine + msg.char }), cmds: noCmds };
    case "ClearCommandLine":
      return { model: patch(model, { commandLine: "" }), cmds: noCmds };
    case "SetMxCommand":
      return { model: patch(model, { mxCommand: msg.value }), cmds: noCmds };
    case "AppendMxCommand":
      return { model: patch(model, { mxCommand: model.mxCommand + msg.char }), cmds: noCmds };
    case "ClearMxCommand":
      return { model: patch(model, { mxCommand: "" }), cmds: noCmds };
    case "SetLastCommand":
      return { model: patch(model, { lastCommand: msg.command }), cmds: noCmds };

    case "SetCursorPosition":
      return { model: patch(model, { cursorPosition: { ...msg.position } }), cmds: noCmds };
    case "SetViewport":
      return { model: patch(model, { viewportTop: msg.top, viewportLeft: msg.left }), cmds: noCmds };
    case "SetViewportTop":
      return { model: patch(model, { viewportTop: msg.top }), cmds: noCmds };
    case "SetViewportLeft":
      return { model: patch(model, { viewportLeft: msg.left }), cmds: noCmds };
    case "SetCursorFocus":
      return { model: patch(model, { cursorFocus: msg.focus }), cmds: noCmds };

    case "UpsertBuffer":
      return { model: patch(model, { buffers: withMapEntry(model.buffers ?? new Map(), msg.name, msg.buffer) }), cmds: noCmds };
    case "SetCurrentBuffer":
      return { model: patch(model, { currentBuffer: msg.buffer }), cmds: noCmds };
    case "SetBuffers":
      return { model: patch(model, { buffers: new Map(msg.buffers) }), cmds: noCmds };
    case "SetCurrentFilename":
      return { model: patch(model, { currentFilename: msg.filename }), cmds: noCmds };
    case "SetBufferModified":
      return { model: patch(model, { bufferModified: msg.modified }), cmds: noCmds };

    case "SetWhichKeyActive":
      return { model: patch(model, { whichKeyActive: msg.active }), cmds: noCmds };
    case "SetWhichKeyPrefix":
      return { model: patch(model, { whichKeyPrefix: msg.prefix }), cmds: noCmds };
    case "SetWhichKeyBindings":
      return { model: patch(model, { whichKeyBindings: [...msg.bindings] }), cmds: noCmds };
    case "SetWhichKeyTimeout":
      return { model: patch(model, { whichKeyTimeout: msg.timeout }), cmds: noCmds };

    case "SetLspDiagnostics":
      return { model: patch(model, { lspDiagnostics: [...msg.diagnostics] }), cmds: noCmds };

    case "SetWindows":
      return { model: patch(model, { windows: msg.windows.map((w: Window) => ({ ...w })) }), cmds: noCmds };
    case "SetCurrentWindowIndex":
      return { model: patch(model, { currentWindowIndex: msg.index }), cmds: noCmds };
    case "SetTabs":
      return { model: patch(model, { tabs: msg.tabs.map((t: Tab) => ({ ...t })) }), cmds: noCmds };
    case "SetCurrentTabIndex":
      return { model: patch(model, { currentTabIndex: msg.index }), cmds: noCmds };

    case "SetHighlightSpans":
      return { model: patch(model, { highlightSpans: msg.spans.map((s: HighlightSpan[]) => [...s]) }), cmds: noCmds };
    case "SetSearchMatches":
      return { model: patch(model, { searchMatches: msg.matches ? [...msg.matches] : undefined }), cmds: noCmds };
    case "SetFoldRanges":
      return { model: patch(model, { foldRanges: new Map(msg.ranges) }), cmds: noCmds };

    case "SetDescribeKeyPending":
      return { model: patch(model, { describeKeyPending: msg.pending }), cmds: noCmds };
    case "SetDescribeFunctionPending":
      return { model: patch(model, { describeFunctionPending: msg.pending }), cmds: noCmds };
    case "SetAproposCommandPending":
      return { model: patch(model, { aproposCommandPending: msg.pending }), cmds: noCmds };

    case "SetMinibufferState":
      return { model: patch(model, { minibufferState: msg.state }), cmds: noCmds };
    case "SetMinibufferView":
      return { model: patch(model, { minibufferView: msg.view }), cmds: noCmds };

    case "SetConfig":
      return { model: patch(model, { config: { ...msg.config, keyBindings: { ...msg.config.keyBindings } } }), cmds: noCmds };

    case "SetEditorStateExternal":
      return { model: patch(model, { ...msg.patch }), cmds: noCmds };

    case "CmdFailed": {
      const message = `${msg.commandTag} failed: ${describeError(msg.error)}`;
      return {
        model: patch(model, { statusMessage: message }),
        cmds: noCmds,
      };
    }

    default: {
      // Exhaustiveness guard: adding a Msg variant without a case fails typecheck.
      const _exhaustive: never = msg;
      void _exhaustive;
      return { model, cmds: noCmds };
    }
  }
}

function describeError(error: { message?: unknown } | unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return String(error);
}
