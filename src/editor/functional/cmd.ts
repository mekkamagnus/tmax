/**
 * @file cmd.ts
 * @description Cmd<Msg> — effects initiated by `update` (Elm Architecture "Cmd").
 *
 * `NotifyStateChange` is intentionally NOT a Cmd: listener notification is
 * synchronous in `applyUpdate` only, so there is exactly one notification per
 * committed model change.
 *
 * Every queued Cmd carries a stable `commandId` and an `owner`
 * (`'openFile' | 'saveFile' | 'handler' | 'background'`). `runCmd` returns
 * either follow-up Msgs for that command id or a typed `AppError`; the drain
 * dispatches `CmdFailed` for every `Left(error)` so failure is visible in the
 * model. Public async methods (`openFile`, `saveFile`) correlate on the
 * command id / owner to preserve their pre-rewrite reject semantics; a failed
 * background log write never rejects an unrelated `saveFile`.
 */

import { TaskEither } from "../../utils/task-either.ts";
import type { AppError } from "../../error/types.ts";
import type { Msg } from "./messages.ts";
import type { EditorRuntime } from "./runtime.ts";

export type CommandOwner = "openFile" | "saveFile" | "handler" | "background";

interface CmdBase {
  readonly commandId: string;
  readonly owner: CommandOwner;
}

export type Cmd<M extends Msg = Msg> =
  | (CmdBase & { readonly tag: "SaveFile"; readonly filename: string; readonly content: string })
  | (CmdBase & { readonly tag: "OpenFile"; readonly filename: string })
  | (CmdBase & { readonly tag: "EvalTlisp"; readonly expr: string })
  | (CmdBase & { readonly tag: "EvalTlispAsync"; readonly expr: string })
  | (CmdBase & { readonly tag: "LogMessage"; readonly message: string; readonly level?: "info" | "warn" | "error" })
  | (CmdBase & { readonly tag: "LogProgram"; readonly category: string; readonly entry: { text: string; stream?: "stdout" | "stderr" } });

/**
 * Execute a Cmd against the runtime, yielding follow-up Msgs (possibly empty).
 * Returns `Left<AppError>` on failure; the drain converts that into `CmdFailed`.
 */
export function runCmd(cmd: Cmd, runtime: EditorRuntime): TaskEither<AppError, readonly Msg[]> {
  switch (cmd.tag) {
    case "SaveFile":
      return TaskEither.from(async () => {
        const result = await runtime.writeFile(cmd.filename, cmd.content);
        if (result._tag === "Left") return result;
        const msgs: Msg[] = [
          { type: "SetStatusMessage", message: `Saved ${cmd.filename}` },
          { type: "SetBufferModified", modified: false },
        ];
        return { _tag: "Right" as const, right: msgs };
      });
    case "OpenFile":
      return TaskEither.from(async () => {
        const result = await runtime.readFile(cmd.filename);
        if (result._tag === "Left") return result;
        return { _tag: "Right" as const, right: [{ type: "SetStatusMessage", message: `Loaded ${cmd.filename}` }] as Msg[] };
      });
    case "EvalTlisp": {
      const result = runtime.evalTlisp(cmd.expr);
      if (result._tag === "Left") {
        return TaskEither.left<AppError, readonly Msg[]>(result.left);
      }
      return TaskEither.right<readonly Msg[], AppError>([]);
    }
    case "EvalTlispAsync":
      return TaskEither.from(async () => {
        const result = await runtime.evalTlispAsync(cmd.expr);
        if (result._tag === "Left") return result;
        return { _tag: "Right" as const, right: [] as Msg[] };
      });
    case "LogMessage":
      runtime.logMessage(cmd.message, cmd.level);
      return TaskEither.right<readonly Msg[], AppError>([]);
    case "LogProgram":
      runtime.logProgram(cmd.category, cmd.entry);
      return TaskEither.right<readonly Msg[], AppError>([]);
    default: {
      // Exhaustiveness guard
      const _exhaustive: never = cmd;
      void _exhaustive;
      return TaskEither.right<readonly Msg[], AppError>([]);
    }
  }
}
