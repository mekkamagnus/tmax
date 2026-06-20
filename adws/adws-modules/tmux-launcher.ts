/**
 * tmux-launcher.ts — run adw pipeline scripts in a detached tmux window.
 *
 * Provides session/window management so long-running pipelines (30-90 min)
 * survive terminal disconnects and agent session timeouts. Injectable
 * subprocess deps (TmuxLauncherDeps) make the logic unit-testable with
 * mocked tmux calls.
 *
 * No CLI, no argv — the caller (adw-launch.ts) handles arg parsing.
 */
import { Either, TaskEither } from "../../src/utils/task-either.ts";

/** Injectable subprocess helper (shape matches run() in the dispatchers). */
export interface TmuxLauncherDeps {
  run: (cmd: string, args: string[], opts?: { cwd?: string }) => TaskEither<string, string>;
}

/** Confirm tmux is installed and runnable. */
export function ensureTmux(deps: TmuxLauncherDeps): TaskEither<string, void> {
  return deps.run("tmux", ["-V"], {})
    .mapLeft(() => "tmux is not installed. Install it first (brew install tmux).")
    .map(() => undefined);
}

/**
 * Ensure a tmux session exists. If `tmux has-session` fails, create it.
 * Returns Right<undefined> on success (session exists or was created).
 *
 * Note: TaskEither.flatMap in src/utils/task-either.ts only accepts an
 * `onRight` callback — there is no (onRight, onLeft) overload. To branch on
 * has-session success vs failure while preserving TaskEither<string, void>,
 * we run the underlying TaskEither and inspect its Either result inside a
 * TaskEither.from(() => ... .run().then(...)).
 */
export function ensureSession(deps: TmuxLauncherDeps, session: string): TaskEither<string, void> {
  return TaskEither.from<string, void>(() =>
    deps.run("tmux", ["has-session", "-t", session], {}).run().then((existing) => {
      if (Either.isRight(existing)) {
        return Either.right(undefined);
      }

      return deps.run("tmux", ["new-session", "-d", "-s", session], {}).run().then((created) => {
        if (Either.isLeft(created)) {
          return Either.left(`failed to create tmux session '${session}': ${created.left}`);
        }
        return Either.right(undefined);
      });
    }),
  );
}

export interface LaunchOptions {
  session: string;
  windowName: string;
  command: string;
}

export interface LaunchResult {
  session: string;
  window: string;
}

/**
 * Create a new window in the session running the given command.
 *
 * `-t <session>:` (note the colon) is the canonical tmux idiom: `new-window`'s
 * `-t` is a target-window reference, so a bare session name is ambiguous and
 * tmux tries to interpret it as a window index — failing with "index N in use"
 * on sessions with renumbering enabled. Appending `:` disambiguates: target =
 * the session, no specific window; tmux inserts the new window at the session's
 * next slot.
 */
export function launchInWindow(deps: TmuxLauncherDeps, opts: LaunchOptions): TaskEither<string, LaunchResult> {
  const target = `${opts.session}:`;
  return deps.run("tmux", ["new-window", "-t", target, "-n", opts.windowName, opts.command], {})
    .map(() => ({ session: opts.session, window: opts.windowName }));
}
