/**
 * @file index.ts
 * @description Barrel for the functional editor core (Elm Architecture).
 */

export type { EditorModel } from "./model.ts";
export { initialModel, modelToEditorState, editorStateToModelPatch } from "./model.ts";
export type { Msg } from "./messages.ts";
export type { UpdateResult } from "./update.ts";
export { update } from "./update.ts";
export type { Cmd, CommandOwner } from "./cmd.ts";
export { runCmd } from "./cmd.ts";
export type { EditorRuntime } from "./runtime.ts";
