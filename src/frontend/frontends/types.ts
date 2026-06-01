import type { Editor } from "../../editor/editor.ts";
import type { EditorState } from "../../core/types.ts";

export interface TerminalDims {
  width: number;
  height: number;
}

export interface KeyMsg {
  key: string;
  raw?: string;
  escape?: boolean;
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

export interface Frontend {
  run(editor: Editor, initialState: EditorState, filename?: string): Promise<void>;
}
