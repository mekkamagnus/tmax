/**
 * @file headed.ts
 * @description Optional headed (tmux) mode for cases where headless `capture`
 *   does not exercise the real TUI rendering path.
 *
 * When a playbook declares `headed: true` on a step (or the runner is invoked
 * with `--headed`), the runner spawns a tmax client inside a tmux pane and
 * uses `tmux capture-pane` for screen assertions. Headless mode is the
 * default and is always preferred for CI — headed is an escape hatch for
 * verifying terminal-specific rendering (cursor visibility, alternate screen
 * switching, color codes that the headless renderer strips).
 *
 * This module is intentionally lazy: it shells out to `tmux` only when
 * `--headed` is requested, so the dependency on tmux is opt-in.
 */

import { spawn } from 'child_process';
import { TaskEither, Either } from '../../src/utils/task-either.ts';
import { TmaxUseError, rightT, leftT, rightE, leftE } from '../src/errors.ts';

export interface TmuxSession {
  readonly sessionName: string;
  readonly windowName: string;
  readonly paneId: string;
}

export interface HeadedOptions {
  readonly sessionName: string;
  readonly windowName?: string;
  readonly socketPath?: string;
  readonly width?: number;
  readonly height?: number;
  /** File to open in the editor. */
  readonly openFile?: string;
}

/** Spawn a tmux session with a tmax client inside, return its handle. */
export function startHeadedSession(opts: HeadedOptions): TaskEither<TmaxUseError, TmuxSession> {
  const sessionName = opts.sessionName;
  const windowName = opts.windowName ?? 'tmax';
  const width = opts.width ?? 94;
  const height = opts.height ?? 29;

  return execTmux(['new-session', '-d', '-s', sessionName, '-n', windowName, '-x', String(width), '-y', String(height)])
    .flatMap(() => execTmux(['list-panes', '-t', sessionName, '-F', '#{pane_id}']).flatMap((out) => {
      const paneId = out.trim().split('\n')[0] ?? '';
      if (!paneId) {
        return leftT<TmuxSession>(TmaxUseError.subprocessFailed('tmux returned no pane id'));
      }
      return rightT<TmuxSession>({ sessionName, windowName, paneId });
    }))
    .flatMap((session) => {
      // Launch the tmax client inside the pane.
      const openArg = opts.openFile ? ` "${opts.openFile}"` : '';
      const socketArg = opts.socketPath ? ` --socket "${opts.socketPath}"` : '';
      const cmd = `bun run start${socketArg}${openArg}`;
      return sendKeys(session, cmd).flatMap(() => rightT<TmuxSession>(session));
    });
}

/** Send keys to the tmux pane using tmux's key-name syntax. */
export function sendKeys(session: TmuxSession, keys: string, literal = false): TaskEither<TmaxUseError, void> {
  const args = ['send-keys', '-t', session.paneId];
  if (literal) args.push('-l');
  args.push(keys);
  return execTmux(args).map(() => undefined);
}

/** Capture the visible pane content as plain text. */
export function capturePane(session: TmuxSession, opts: { start?: number; end?: number } = {}): TaskEither<TmaxUseError, string> {
  const args = ['capture-pane', '-t', session.paneId, '-p'];
  if (opts.start !== undefined) args.push('-S', String(opts.start));
  if (opts.end !== undefined) args.push('-E', String(opts.end));
  return execTmux(args);
}

/** Kill the tmux session (best-effort cleanup). */
export function killHeadedSession(session: TmuxSession): TaskEither<TmaxUseError, void> {
  return execTmux(['kill-session', '-t', session.sessionName]).mapLeft((): TmaxUseError =>
    // Killing a session that already exited is a no-op in our model; surface as Right.
    TmaxUseError.subprocessFailed(`tmux kill-session failed for ${session.sessionName}`),
  ).map(() => undefined);
}

/** Wrap `tmux` invocation with proper error reporting. */
function execTmux(args: readonly string[]): TaskEither<TmaxUseError, string> {
  return TaskEither.tryCatch(
    () =>
      new Promise<string>((resolve, reject) => {
        const child = spawn('tmux', [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (c) => (stdout += c.toString()));
        child.stderr.on('data', (c) => (stderr += c.toString()));
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve(stdout);
          else reject(new Error(`tmux ${args.join(' ')} exited ${code}: ${stderr.trim()}`));
        });
      }),
    (err): TmaxUseError => TmaxUseError.subprocessFailed(`tmux error: ${err instanceof Error ? err.message : String(err)}`),
  );
}

/** Quick check whether tmux is available on this system. */
export function tmuxAvailable(): boolean {
  try {
    const result = spawn('tmux', ['-V'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return result.pid !== undefined;
  } catch {
    return false;
  }
}

// Test-only exports.
export const __headedInternals = { execTmux, rightE, leftE };
