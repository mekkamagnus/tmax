/**
 * @file instance.ts
 * @description TmaxInstance — daemon lifecycle management.
 *
 * Two ways to obtain an instance:
 *   - `TmaxInstance.launch(opts)` — spawn a fresh daemon from a clean slate,
 *     poll readiness, hand back a connected instance. Mirrors the proven
 *     spawn+poll pattern from `adws/adw-run-e2e.ts:startDaemon`.
 *   - `TmaxInstance.connect(opts)` — attach to a daemon already running on
 *     `socketPath`, verifying it responds to `(+ 1 1)`.
 *
 * Both are TaskEither chains so failures compose with the rest of the
 * control library. `close()` is idempotent and swallows teardown errors.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { existsSync, promises as fs, realpathSync, unlinkSync } from 'fs';
import { join } from 'path';
import { TaskEither, Either, TaskEitherUtils } from '../../src/utils/task-either.ts';
import { TmaxUseError, leftT, rightT, rightE, leftE } from './errors.ts';
import { Frame } from './frame.ts';
import { createRealClient, TmaxClient, ClientOptions } from './client.ts';

const PROJECT_ROOT = realpathSync(join(new URL('..', import.meta.url).pathname, '..'));

/** Path to `src/server/server.ts` resolved from the project root. */
export const DEFAULT_SERVER_PATH = join(PROJECT_ROOT, 'src', 'server', 'server.ts');

export interface InstanceOptions {
  /** Socket path the daemon will listen on. Defaults to defaultSocketPath(). */
  readonly socketPath?: string;
  /** Override the daemon script (defaults to src/server/server.ts). */
  readonly serverPath?: string;
  /** Override the cwd for the daemon subprocess (defaults to project root). */
  readonly cwd?: string;
  /** Extra env vars passed to the daemon. TMAX_SOCKET is always set. */
  readonly env?: Record<string, string>;
}

/**
 * Injectable subprocess hooks so unit tests don't actually spawn a daemon.
 * Real callers use the defaults; tests pass stubs.
 */
export interface InstanceDeps {
  /** Spawn the daemon subprocess. Return the child handle (do not await exit). */
  readonly spawnDaemon: (spec: SpawnSpec) => TaskEither<TmaxUseError, ChildProcessWithoutNullStreams>;
  /** Stop a previously spawned daemon: best-effort `(editor-quit)`, poll, SIGKILL. */
  readonly stopDaemon: (child: ChildProcessWithoutNullStreams | null, socketPath: string) => TaskEither<TmaxUseError, void>;
  /** Construct a client bound to this socket (real or stub). */
  readonly makeClient: (opts: ClientOptions) => TmaxClient;
}

export interface SpawnSpec {
  readonly socketPath: string;
  readonly serverPath: string;
  readonly cwd: string;
  readonly env: Record<string, string>;
}

/** Real spawn that starts `bun src/server/server.ts` with `TMAX_SOCKET` set. */
function spawnDaemonReal(spec: SpawnSpec): TaskEither<TmaxUseError, ChildProcessWithoutNullStreams> {
  return TaskEither.from(async () => {
    try {
      const child = spawn('bun', [spec.serverPath], {
        cwd: spec.cwd,
        stdio: 'ignore',
        env: { ...process.env, TMAX_SOCKET: spec.socketPath, ...spec.env },
      }) as ChildProcessWithoutNullStreams;
      child.on('error', () => { /* surfaced via readiness poll */ });
      return rightE<ChildProcessWithoutNullStreams>(child);
    } catch (err) {
      return leftE<ChildProcessWithoutNullStreams>(
        TmaxUseError.daemonNotResponsive(spec.socketPath, `spawn failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  });
}

/** Real teardown: send `(editor-quit)`, poll the socket away, SIGKILL fallback. */
function stopDaemonReal(child: ChildProcessWithoutNullStreams | null, socketPath: string): TaskEither<TmaxUseError, void> {
  return TaskEither.from(async () => {
    if (child) {
      // Best-effort: send editor-quit via the CLI. Swallow all errors.
      try {
        const { runClientReal } = await import('./client.ts');
        await runClientReal({ socketPath, cwd: PROJECT_ROOT })(['--eval', '(editor-quit)']).run();
      } catch { /* daemon may already be down */ }
    }
    // Poll for the socket file to disappear (up to 3s).
    for (let i = 0; i < 30; i++) {
      if (!existsSync(socketPath)) {
        if (child && !child.killed) {
          try { child.kill('SIGKILL'); } catch { /* noop */ }
        }
        return rightE<void>(undefined);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    // Force-kill any orphan we spawned.
    if (child && !child.killed) {
      try { child.kill('SIGKILL'); } catch { /* noop */ }
    }
    try { unlinkSync(socketPath); } catch { /* already gone */ }
    return rightE<void>(undefined);
  });
}

/**
 * tmax-use daemon handle. Owns (or attaches to) the daemon subprocess and
 * produces `Frame` instances bound to its socket.
 */
export class TmaxInstance {
  private constructor(
    readonly socketPath: string,
    readonly client: TmaxClient,
    private readonly deps: InstanceDeps,
    private readonly spawnedChild: ChildProcessWithoutNullStreams | null,
    private readonly attached: boolean,
  ) {}

  /** Spawn a fresh daemon and wait for it to be responsive. */
  static launch(opts: InstanceOptions = {}, deps?: Partial<InstanceDeps>): TaskEither<TmaxUseError, TmaxInstance> {
    const socketPath = opts.socketPath ?? defaultSocketPath();
    const serverPath = opts.serverPath ?? DEFAULT_SERVER_PATH;
    const cwd = opts.cwd ?? PROJECT_ROOT;
    const env = opts.env ?? {};
    const fullDeps: InstanceDeps = {
      spawnDaemon: deps?.spawnDaemon ?? spawnDaemonReal,
      stopDaemon: deps?.stopDaemon ?? stopDaemonReal,
      makeClient: deps?.makeClient ?? ((c) => createRealClient(c)),
    };

    const spec: SpawnSpec = { socketPath, serverPath, cwd, env };

    // 1. Tear down any stale daemon squatting on the socket, then 2. remove a
    //    lingering socket file. Both are best-effort cleanup.
    const preCleanup: TaskEither<TmaxUseError, void> = TaskEither.from(async () => {
      try { await fullDeps.stopDaemon(null, socketPath).run(); } catch { /* fine */ }
      try { await fs.unlink(socketPath); } catch { /* fine */ }
      return rightE<void>(undefined);
    });

    // 3. Spawn the daemon.
    return preCleanup
      .flatMap(() => fullDeps.spawnDaemon(spec))
      .flatMap((child) => {
        // 4. Poll the socket file (50 × 100ms = 5s).
        const socketReady: TaskEither<TmaxUseError, void> = TaskEitherUtils.retry(
          () => TaskEither.from(async () =>
            existsSync(socketPath)
              ? rightE<void>(undefined)
              : leftE<void>(TmaxUseError.daemonNotResponsive(socketPath, 'socket not yet present')),
          ),
          50,
          100,
        );
        // 5. Poll eval responsiveness (20 × 100ms = 2s).
        const evalReady = (client: TmaxClient): TaskEither<TmaxUseError, void> => TaskEitherUtils.retry(
          () => client.eval('(+ 1 1)').flatMap((v) =>
            v.trim() === '2'
              ? rightT<void>(undefined)
              : leftT<void>(TmaxUseError.daemonNotResponsive(socketPath, `(+ 1 1) returned ${JSON.stringify(v)}`)),
          ),
          20,
          100,
        );
        const client = fullDeps.makeClient({ socketPath, cwd, clientPath: undefined });
        return socketReady.flatMap(() =>
          evalReady(client).map(() => new TmaxInstance(socketPath, client, fullDeps, child, false)),
        );
      });
  }

  /** Attach to an already-running daemon. Verifies `(+ 1 1)` responds. */
  static connect(opts: InstanceOptions = {}, deps?: Partial<InstanceDeps>): TaskEither<TmaxUseError, TmaxInstance> {
    const socketPath = opts.socketPath ?? defaultSocketPath();
    const cwd = opts.cwd ?? PROJECT_ROOT;
    const fullDeps: InstanceDeps = {
      spawnDaemon: deps?.spawnDaemon ?? spawnDaemonReal,
      stopDaemon: deps?.stopDaemon ?? stopDaemonReal,
      makeClient: deps?.makeClient ?? ((c) => createRealClient(c)),
    };
    if (!existsSync(socketPath)) {
      return leftT<TmaxInstance>(TmaxUseError.daemonNotResponsive(socketPath, 'socket not present'));
    }
    const client = fullDeps.makeClient({ socketPath, cwd, clientPath: undefined });
    return client.eval('(+ 1 1)').flatMap((v) =>
      v.trim() === '2'
        ? rightT<TmaxInstance>(new TmaxInstance(socketPath, client, fullDeps, null, true))
        : leftT<TmaxInstance>(TmaxUseError.daemonNotResponsive(socketPath, `(+ 1 1) returned ${JSON.stringify(v)}`)),
    );
  }

  /** Create a `Frame` bound to this instance's daemon socket. */
  frame(name?: string): Frame {
    return new Frame(this.client, name);
  }

  /** Tear down the daemon (only if we spawned it). Idempotent. */
  close(): TaskEither<TmaxUseError, void> {
    if (this.attached || this.spawnedChild === null) {
      // We attached; do not kill the daemon the caller owns.
      return rightT<void>(undefined);
    }
    return this.deps.stopDaemon(this.spawnedChild, this.socketPath);
  }
}

/** Default socket path (mirrors `bin/tmaxclient`). */
export function defaultSocketPath(): string {
  if (process.env.TMAX_SOCKET) return process.env.TMAX_SOCKET;
  const uid = process.getuid?.() ?? 501;
  return `/tmp/tmax-${uid}/server`;
}
