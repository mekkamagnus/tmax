import type { EditorState } from "../../core/types.ts";
import { style } from "../frontends/steep/style.ts";
import { renderMinibuffer } from "./minibuffer.ts";

export function renderCommandInput(state: EditorState, width: number): string {
  if (state.minibufferView) {
    return renderMinibuffer(state.minibufferView, width).lines.at(-1) ?? "";
  }
  const input = state.mode === "mx" ? `M-x ${state.mxCommand}` : `:${state.commandLine}`;
  const clipped = input.length >= width ? input.slice(0, Math.max(0, width - 1)) : input;
  const padded = clipped.padEnd(Math.max(0, width - 1), " ");

  return `${style(padded, { fg: "white" })}${style(" ", { fg: "black", bg: "white" })}`;
}
