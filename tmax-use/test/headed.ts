/**
 * @file headed.ts
 * @description Optional headed (tmux) mode for cases where headless `capture`
 *   does not exercise the real TUI rendering path.
 *
 * When `--headed` is requested, the runner spawns a tmax client inside a tmux
 * pane and uses `tmux capture-pane -p -e` for screen snapshots. Headless mode
 * is the default and is always preferred for CI.
 *
 * Availability decision tree (per spec Step 12a):
 *
 *   ┌─────────────┬───────────────┬──────────────────────────────────────┐
 *   │ --headed    │ tmux present? │ Action                               │
 *   ├─────────────┼───────────────┼──────────────────────────────────────┤
 *   │ not set     │ n/a           │ headless                             │
 *   │ set, strict │ yes           │ launch headed                        │
 *   │ set, strict │ no            │ fail (Left)                          │
 *   │ set, local  │ yes           │ launch headed                        │
 *   │ set, local  │ no            │ warn + fallback to headless          │
 *   │ set, CI     │ yes           │ launch headed                        │
 *   │ set, CI     │ no            │ skip (return empty suite)            │
 *   └─────────────┴───────────────┴──────────────────────────────────────┘
 *
 * This module shells out to `tmux` only when headed mode is requested, so the
 * dependency is opt-in. Unit tests inject a fake `TmuxRunner` to avoid needing
 * tmux installed.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
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
  /** Daemon socket the TUI client should connect to (sets TMAX_SOCKET). */
  readonly socketPath?: string;
  readonly width?: number;
  readonly height?: number;
  /** File to open in the editor. */
  readonly openFile?: string;
  /**
   * When set, create a window inside this existing tmux session instead of a
   * new detached session. The window is cleaned up after the test (kill-window),
   * leaving the session intact.
   */
  readonly existingSession?: string;
}

/** Outcome of `resolveHeadedMode` — drives the runner's headed decision. */
export type HeadedDecision =
  | { readonly kind: 'launch' }
  | { readonly kind: 'fallback'; readonly reason: string }
  | { readonly kind: 'skip'; readonly reason: string }
  | { readonly kind: 'fail'; readonly reason: string };

/** True if running in a CI environment (best-effort heuristic via env vars). */
export function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.JENKINS_URL ||
    process.env.BUILDKITE ||
    process.env.TF_BUILD
  );
}

/**
 * Resolve the headed-mode decision per the availability rules. Inputs:
 *
 *   - `requested`: did the user pass `--headed` (or `--headed=strict`)?
 *   - `strict`: was it `--headed=strict`?
 *
 * Returns the action the runner should take. `tmuxAvailable()` is consulted
 * here so callers don't need to shell out themselves.
 */
export function resolveHeadedMode(requested: boolean, strict: boolean): HeadedDecision {
  if (!requested) return { kind: 'launch' }; // headless path; nothing to decide
  if (tmuxAvailable()) return { kind: 'launch' };
  const reason = 'tmux not found on PATH (headed mode requires tmux)';
  if (strict) return { kind: 'fail', reason };
  if (isCI()) return { kind: 'skip', reason };
  return { kind: 'fallback', reason };
}

/**
 * Spawn a tmux session (or window in an existing session) with a tmax TUI
 * client inside. Sets `TMAX_SOCKET` so the client connects to the same daemon
 * the runner launched.
 *
 * When `existingSession` is set, creates a new window inside that session
 * (visible to the user) instead of a detached session. The window is cleaned
 * up via `kill-window` after the test, leaving the session intact.
 *
 * Dimension pinning: `new-session -d -x W -y H` alone does NOT guarantee the
 * pane ends up WxH. tmux's `window-size` option defaults to `latest`, which
 * resizes the window to match the most-recently-attached client's terminal.
 * When this runs inside an outer tmux session (e.g. tests launched from an
 * existing tmux), the new session's window is immediately resized to the outer
 * client's size — so pane_dimensions reports the outer size, not the requested
 * WxH. Pin the size by switching to `window-size manual` and calling
 * `resize-window -x W -y H` after creation; that combination holds regardless
 * of outer-client presence.
 */
export function startHeadedSession(opts: HeadedOptions): TaskEither<TmaxUseError, TmuxSession> {
  const windowName = opts.windowName ?? 'tmax';
  const width = opts.width ?? 80;
  const height = opts.height ?? 24;
  const existingSession = opts.existingSession;
  // The session name to target for subsequent tmux commands.
  const sessionName = existingSession ?? opts.sessionName;

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.socketPath) env.TMAX_SOCKET = opts.socketPath;

  // Build the command to run in the pane. For existing sessions, pass it
  // directly to new-window as a shell-command (avoids unreliable send-keys
  // on uninitialised panes). Include TMAX_SOCKET in the command prefix.
  const openArg = opts.openFile ? ` "${opts.openFile}"` : '';
  const socketPrefix = opts.socketPath ? `TMAX_SOCKET=${opts.socketPath} ` : '';
  const cmd = `${socketPrefix}bin/tmaxclient --tui${openArg}`;

  // Step 1: Create session or window with the command passed directly
  // (avoids send-keys which doesn't work reliably on uninitialised panes).
  const create = existingSession
    ? execTmux(['new-window', '-t', `${existingSession}:`, '-n', windowName, cmd])
    : execTmux(['new-session', '-d', '-s', sessionName, '-n', windowName, '-x', String(width), '-y', String(height)]);

  // For standalone sessions, launch the command via the pane once we have
  // its ID (new-session doesn't accept a shell-command in all tmux versions).
  // We chain this after list-panes so we have the real pane ID.
  const needsLaunch = !existingSession;

  // 2. Switch the session to manual window-size so later clients can't resize.
  // 3. resize-window -x/-y forces the window to the requested size now that
  //    window-size=manual will respect it.
  return create
    .flatMap(() => execTmux(['set-option', '-t', sessionName, 'window-size', 'manual']))
    .flatMap(() => execTmux(['resize-window', '-t', `${sessionName}:${windowName}`, '-x', String(width), '-y', String(height)]))
    .flatMap(() => execTmux(['list-panes', '-t', `${sessionName}:${windowName}`, '-F', '#{pane_id}']).flatMap((out) => {
      const paneId = out.trim().split('\n')[0] ?? '';
      if (!paneId) {
        return leftT<TmuxSession>(TmaxUseError.subprocessFailed('tmux returned no pane id'));
      }
      return rightT<TmuxSession>({ sessionName, windowName, paneId });
    }))
    .flatMap((session) => {
      if (!needsLaunch) return rightT<TmuxSession>(session);
      // Launch the TUI client in the standalone session's pane.
      return sendKeys(session, cmd, true)
        .flatMap(() => sendKeys(session, 'Enter'))
        .flatMap(() => rightT<TmuxSession>(session));
    });
}

/** Send keys to the tmux pane. Use `literal: true` for exact-string input. */
export function sendKeys(session: TmuxSession, keys: string, literal = false): TaskEither<TmaxUseError, void> {
  const args = ['send-keys', '-t', session.paneId];
  if (literal) args.push('-l');
  args.push(keys);
  return execTmux(args).map(() => undefined);
}

/**
 * Capture the visible pane content. With `ansi: true` (default), preserves
 * escape sequences via `-e` — required for HTML rendering through `ansiToHtml`.
 */
export function capturePane(
  session: TmuxSession,
  opts: { start?: number; end?: number; ansi?: boolean } = {},
): TaskEither<TmaxUseError, string> {
  const args = ['capture-pane', '-t', session.paneId, '-p'];
  if (opts.ansi !== false) args.push('-e');
  if (opts.start !== undefined) args.push('-S', String(opts.start));
  if (opts.end !== undefined) args.push('-E', String(opts.end));
  return execTmux(args);
}

/** Query pane dimensions via `tmux display-message`. Returns `{ width, height }`. */
export function paneDimensions(session: TmuxSession): TaskEither<TmaxUseError, { width: number; height: number }> {
  return execTmux(['display-message', '-t', session.paneId, '-p', '#{pane_width} #{pane_height}']).flatMap((out) => {
    const m = out.trim().match(/^(\d+)\s+(\d+)$/);
    if (!m) {
      return leftT<{ width: number; height: number }>(
        TmaxUseError.subprocessFailed(`tmux display-message returned unexpected output: ${JSON.stringify(out)}`),
      );
    }
    return rightT<{ width: number; height: number }>({ width: Number(m[1]!), height: Number(m[2]!) });
  });
}

/**
 * Wait until the TUI client has attached to the daemon. Polls
 * `bin/tmaxclient --frames` (lists connected frames); resolves once it shows
 * at least one frame, or rejects after `iterations` × 100ms.
 */
export function waitForAttachedFrame(socketPath: string | undefined, iterations = 30): TaskEither<TmaxUseError, void> {
  return TaskEither.from(async () => {
    let last: TmaxUseError | null = null;
    for (let i = 0; i < iterations; i++) {
      const r = await listFrames(socketPath).run();
      if (Either.isRight(r) && r.right.length > 0) return rightE<void>(undefined);
      if (Either.isLeft(r)) last = r.left;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return leftE<void>(last ?? TmaxUseError.timeout(iterations * 100, 'attached frame'));
  });
}

/** Ask the daemon for the list of connected frame ids. */
function listFrames(socketPath: string | undefined): TaskEither<TmaxUseError, string[]> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (socketPath) env.TMAX_SOCKET = socketPath;
  return TaskEither.tryCatch(
    () =>
      new Promise<string>((resolve, reject) => {
        const child = spawn('bin/tmaxclient', ['--frames'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (c) => (stdout += c.toString()));
        child.stderr.on('data', (c) => (stderr += c.toString()));
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve(stdout);
          else reject(new Error(`tmaxclient --frames exited ${code}: ${stderr.trim()}`));
        });
      }),
    (err): TmaxUseError => TmaxUseError.subprocessFailed(`--frames failed: ${err instanceof Error ? err.message : String(err)}`),
  ).map((out) => out.split('\n').map((l) => l.trim()).filter((l) => l.length > 0));
}

/** Kill the tmux session (best-effort cleanup). Always returns Right. */
export function killHeadedSession(session: TmuxSession): TaskEither<TmaxUseError, void> {
  return execTmux(['kill-session', '-t', session.sessionName]).mapLeft((): TmaxUseError =>
    // Killing a session that already exited is a no-op in our model.
    TmaxUseError.subprocessFailed(`tmux kill-session failed for ${session.sessionName}`),
  ).map(() => undefined);
}

/**
 * Kill the tmux window created for headed testing (best-effort cleanup).
 * Safe for both standalone sessions and windows in existing sessions.
 * Always returns Right.
 */
export function killHeadedWindow(session: TmuxSession): TaskEither<TmaxUseError, void> {
  return execTmux(['kill-window', '-t', `${session.sessionName}:${session.windowName}`]).mapLeft((): TmaxUseError =>
    TmaxUseError.subprocessFailed(`tmux kill-window failed for ${session.sessionName}:${session.windowName}`),
  ).map(() => undefined);
}

/**
 * Clean up a headed session: kills just the window when the session was
 * pre-existing (`--session`), or the whole session when it was created
 * by the runner.
 */
export function cleanupHeadedSession(session: TmuxSession, isExisting: boolean): TaskEither<TmaxUseError, void> {
  return isExisting ? killHeadedWindow(session) : killHeadedSession(session);
}

/**
 * Quick check whether tmux is available on this system. Synchronous spawn of
 * `tmux -V`; returns true if the child started (pid assigned) without throwing.
 */
export function tmuxAvailable(): boolean {
  try {
    const result = spawn('tmux', ['-V'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return result.pid !== undefined;
  } catch {
    return false;
  }
}

/** Wrap a `tmux` invocation with proper error reporting. */
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

// Test-only exports.
export const __headedInternals = { execTmux, listFrames, rightE, leftE };
export type { ChildProcessWithoutNullStreams };
