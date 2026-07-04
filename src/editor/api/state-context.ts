/**
 * @file state-context.ts
 * @description CHORE-39 Phase 4 — shared State-monad bridge for editor API
 * primitives.
 *
 * Each `src/editor/api/*.ts` factory migrates from closing over mutable state
 * callbacks toward returning/running `State<EditorModel, A>` computations
 * (synchronous) or `StateTaskEither<EditorModel, AppError, A>` (async). This
 * module provides the capability handle + genuine `State.gets`/`stateUtils`
 * helpers the factories use to read and update the editor model immutably.
 *
 * The editor runtime (Editor.applyUpdate) is the single committer of model
 * changes; `runModel` runs a computation against a model snapshot and
 * commits the resulting model back through the access handle.
 */

import { State, stateUtils } from "../../utils/state.ts";
import type { EditorModel } from "../functional/model.ts";

/**
 * Capability each ops factory receives to run State computations against the
 * live editor model. `getModel` returns the current immutable snapshot;
 * `applyModel` commits a fresh model produced by a State computation.
 */
export interface EditorModelAccess {
  getModel: () => EditorModel;
  applyModel: (m: EditorModel) => void;
}

/**
 * Read a field from the model as a `State` computation (genuine `State.gets`).
 * Factories use this in place of a read callback.
 */
export const readModelField = <K extends keyof EditorModel>(key: K): State<EditorModel, EditorModel[K]> =>
  State.gets((m: EditorModel) => m[key]);

/**
 * Atomically set a scalar model field via `stateUtils.updateProperty`.
 */
export const setModelField = stateUtils.updateProperty;

/**
 * Run a `State<EditorModel, A>` against the current model and commit the
 * resulting model. Returns the computation's value.
 */
export function runModel<A>(access: EditorModelAccess, computation: State<EditorModel, A>): A {
  const [value, nextModel] = computation.run(access.getModel());
  access.applyModel(nextModel);
  return value;
}
