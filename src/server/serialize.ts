import { FunctionalTextBufferImpl } from "../core/buffer.ts";
import type { EditorState } from "../core/types.ts";

export function editorStateToJson(state: EditorState): Record<string, unknown> {
  const buffer = state.currentBuffer;
  let bufferContent = "";
  if (buffer) {
    const contentResult = buffer.getContent();
    if (contentResult._tag === "Right") {
      bufferContent = contentResult.right;
    }
  }

  return {
    cursorPosition: state.cursorPosition,
    mode: state.mode,
    statusMessage: state.statusMessage,
    viewportTop: state.viewportTop,
    config: state.config,
    commandLine: state.commandLine,
    mxCommand: state.mxCommand,
    currentFilename: state.currentFilename,
    bufferContent,
  };
}

export function jsonToEditorState(json: Record<string, unknown>): EditorState {
  return {
    currentBuffer: FunctionalTextBufferImpl.create((json.bufferContent as string) || ""),
    cursorPosition: json.cursorPosition as EditorState["cursorPosition"],
    mode: json.mode as EditorState["mode"],
    statusMessage: json.statusMessage as string,
    viewportTop: json.viewportTop as number,
    config: json.config as EditorState["config"],
    commandLine: json.commandLine as string,
    mxCommand: json.mxCommand as string,
    currentFilename: json.currentFilename as string | undefined,
    buffers: new Map(),
    cursorFocus: "buffer",
  };
}
