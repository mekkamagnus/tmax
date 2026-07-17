/**
 * @file command-runtime.ts
 * @description CHORE-44 Change 3 — command-queue / effect-drain collaborator
 * delegated by `Editor`.
 *
 * Owns the live effect layer ingress: the Cmd queue, the drain loop, the
 * per-command-id ownership waiters, and the runCmd-result → outcome
 * classification. `Editor` constructs one `CommandRuntime` and delegates
 * `enqueueCmd` / `drainCommands` / `trackCommand` / `classifyCommand` here
 * (AC3.4: no command-queue loop implementation in `Editor`). Each follow-up
 * Msg is committed back through the injected `commitMsg` callback — which is
 * `Editor.applyUpdate` — so the notification-once-per-committed-change
 * invariant (AC3.5) is preserved (commitMsg fires notifyStateChange exactly
 * once per follow-up Msg, exactly as the inlined drain did before).
 *
 * This module imports only the pure functional core (`runCmd`, `Cmd`,
 * `EditorRuntime`, `Msg`) and the `Either` helper; it never imports the
 * concrete `Editor` class (AC3.3).
 */

import type { AppError } from "../../error/types.ts";
import type { TLispValue } from "../../tlisp/types.ts";
import { Either } from "../../utils/task-either.ts";
import { runCmd } from "../functional/cmd.ts";
import type { Cmd, EditorRuntime, Msg } from "../functional/index.ts";

/**
 * Outcome the drain reports to an awaiting public method (CHORE-42).
 * `content` is populated for `OpenFile`, `result` for `EvalTlisp`; effect-level
 * failure carries the typed `AppError` so the caller can mirror prior log
 * behavior without rejecting the public method.
 */
export type CommandOutcome =
  | { readonly status: "succeeded"; readonly content?: string; readonly result?: TLispValue }
  | { readonly status: "failed"; readonly error: AppError };

/** Dependencies supplied by `Editor` (the composition root). */
export interface CommandRuntimeDeps {
  /** Returns the capability surface used by Cmd runners (built by `Editor`). */
  getRuntime: () => EditorRuntime;
  /**
   * Commit a Msg through the editor's reducer (Editor.applyUpdate). Used for
   * `CmdFailed` and for each follow-up Msg. Each call fires notifyStateChange
   * exactly once, preserving the notification-once invariant (AC3.5).
   */
  commitMsg: (msg: Msg) => void;
}

/**
 * Live effect-layer ingress: a FIFO queue of Cmds drained serially. The drain
 * runs `runCmd(cmd, runtime)`, commits any `Left<AppError>` as `CmdFailed`, and
 * commits each follow-up Msg. The awaiting owner (if any) is settled from the
 * classified outcome once the matching Cmd's drain completes.
 */
export class CommandRuntime {
  private cmdQueue: Cmd[] = [];
  private cmdDraining = false;
  private readonly commandWaiters = new Map<string, { resolve: (outcome: CommandOutcome) => void }>();

  constructor(private readonly deps: CommandRuntimeDeps) {}

  /** Enqueue a Cmd and kick the drain. */
  enqueueCmd(cmd: Cmd): void {
    this.cmdQueue.push(cmd);
    void this.drainCommands();
  }

  /**
   * Register an ownership waiter so a public method can `await` the drain's
   * settlement for `commandId`. Must be called BEFORE dispatching the
   * initiating Msg so the waiter is present when the drain settles it.
   */
  trackCommand(commandId: string): Promise<CommandOutcome> {
    return new Promise<CommandOutcome>(resolve => {
      this.commandWaiters.set(commandId, { resolve });
    });
  }

  /**
   * Map a settled Cmd's `runCmd` result to the outcome the awaiting owner
   * sees. Effect-level success/failure is read from the follow-up Msgs (a
   * handled filesystem error is a `*Failed` Msg, not a Left); a drain-level
   * `Left` is a failure carrying the `AppError`.
   */
  classifyCommand(result: Either<AppError, readonly Msg[]>): CommandOutcome {
    if (result._tag === "Left") {
      return { status: "failed", error: result.left };
    }
    for (const m of result.right) {
      switch (m.type) {
        case "OpenFileSucceeded": return { status: "succeeded", content: m.content };
        case "OpenFileFailed": return { status: "failed", error: m.error };
        case "SaveFileSucceeded": return { status: "succeeded" };
        case "SaveFileFailed": return { status: "failed", error: m.error };
        case "EvalTlispSucceeded": return { status: "succeeded", result: m.result };
        case "EvalTlispFailed": return { status: "failed", error: m.error };
        case "BackgroundCommandFailed": return { status: "failed", error: m.error };
        default: break;
      }
    }
    return { status: "succeeded" };
  }

  /** Drain queued Cmds sequentially; follow-up Msgs commit via commitMsg. */
  async drainCommands(): Promise<void> {
    if (this.cmdDraining) return;
    this.cmdDraining = true;
    try {
      while (this.cmdQueue.length > 0) {
        const cmd = this.cmdQueue.shift()!;
        const result = await runCmd(cmd, this.deps.getRuntime()).run();
        if (Either.isLeft(result)) {
          this.deps.commitMsg({ type: "CmdFailed", commandTag: cmd.tag, commandId: cmd.commandId, error: result.left });
        } else {
          for (const followUp of result.right) {
            this.deps.commitMsg(followUp);
          }
        }
        // Settle the awaiting owner (if any) for this command id.
        const waiter = this.commandWaiters.get(cmd.commandId);
        if (waiter) {
          this.commandWaiters.delete(cmd.commandId);
          waiter.resolve(this.classifyCommand(result));
        }
      }
    } finally {
      this.cmdDraining = false;
    }
  }
}
