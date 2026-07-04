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
import type { Msg, CommandOwner } from "./messages.ts";
// Re-export so the barrel (`index.ts`) can continue to surface CommandOwner
// from this module; the canonical definition lives in `messages.ts` to keep
// the owner union shared without an import cycle.
export type { CommandOwner } from "./messages.ts";
import type { EditorRuntime } from "./runtime.ts";

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
 *
 * Effect-level success/failure is reported as a follow-up Msg (e.g.
 * `SaveFileSucceeded` / `SaveFileFailed`) carrying the originating
 * `commandId`. `Left<AppError>` is reserved for drain-level failures (the
 * drain then dispatches `CmdFailed`); a handled filesystem error is a Right
 * containing a `*Failed` Msg so the awaiting owner can settle without a
 * rejection.
 */
export function runCmd(cmd: Cmd, runtime: EditorRuntime): TaskEither<AppError, readonly Msg[]> {
  switch (cmd.tag) {
    case "SaveFile":
      return TaskEither.from(async () => {
        const result = await runtime.writeFile(cmd.filename, cmd.content);
        if (result._tag === "Left") {
          return { _tag: "Right" as const, right: [{ type: "SaveFileFailed", commandId: cmd.commandId, filename: cmd.filename, error: result.left }] as Msg[] };
        }
        return { _tag: "Right" as const, right: [{ type: "SaveFileSucceeded", commandId: cmd.commandId, filename: cmd.filename }] as Msg[] };
      });
    case "OpenFile":
      return TaskEither.from(async () => {
        const result = await runtime.readFile(cmd.filename);
        if (result._tag === "Left") {
          return { _tag: "Right" as const, right: [{ type: "OpenFileFailed", commandId: cmd.commandId, filename: cmd.filename, error: result.left }] as Msg[] };
        }
        return { _tag: "Right" as const, right: [{ type: "OpenFileSucceeded", commandId: cmd.commandId, filename: cmd.filename, content: result.right }] as Msg[] };
      });
    case "EvalTlisp": {
      const result = runtime.evalTlisp(cmd.expr);
      if (result._tag === "Left") {
        return TaskEither.right<readonly Msg[], AppError>([{ type: "EvalTlispFailed", commandId: cmd.commandId, expr: cmd.expr, error: result.left }]);
      }
      return TaskEither.right<readonly Msg[], AppError>([{ type: "EvalTlispSucceeded", commandId: cmd.commandId, result: result.right }]);
    }
    case "EvalTlispAsync":
      return TaskEither.from(async () => {
        const result = await runtime.evalTlispAsync(cmd.expr);
        if (result._tag === "Left") {
          return { _tag: "Right" as const, right: [{ type: "EvalTlispFailed", commandId: cmd.commandId, expr: cmd.expr, error: result.left }] as Msg[] };
        }
        return { _tag: "Right" as const, right: [{ type: "EvalTlispSucceeded", commandId: cmd.commandId, result: result.right }] as Msg[] };
      });
    case "LogMessage":
      try {
        runtime.logMessage(cmd.message, cmd.level);
        return TaskEither.right<readonly Msg[], AppError>([]);
      } catch (e) {
        return TaskEither.right<readonly Msg[], AppError>([{ type: "BackgroundCommandFailed", commandId: cmd.commandId, error: runtime.toAppError(e) }]);
      }
    case "LogProgram":
      try {
        runtime.logProgram(cmd.category, cmd.entry);
        return TaskEither.right<readonly Msg[], AppError>([]);
      } catch (e) {
        return TaskEither.right<readonly Msg[], AppError>([{ type: "BackgroundCommandFailed", commandId: cmd.commandId, error: runtime.toAppError(e) }]);
      }
    default: {
      // Exhaustiveness guard
      const _exhaustive: never = cmd;
      void _exhaustive;
      return TaskEither.right<readonly Msg[], AppError>([]);
    }
  }
}
