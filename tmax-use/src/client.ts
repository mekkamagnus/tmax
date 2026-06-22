/**
 * @file client.ts
 * @description Thin TaskEither wrapper around (a) the `bin/tmaxclient` CLI for
 *   user-facing operations and (b) a direct JSON-RPC 2.0 helper for methods
 *   that need structured results (capture, ping, open).
 *
 * The CLI's `--capture`/`--capture-html` paths intentionally print only the
 * rendered artifact (discarding `width` and `height`). For metadata-bearing
 * operations, use `request(method, params)` which speaks JSON-RPC directly to
 * the daemon socket.
 */

import { Socket } from 'net';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { existsSync } from 'fs';
import { TaskEither, Either } from '../../src/utils/task-either.ts';
import { TmaxUseError, rightE, leftE } from './errors.ts';

/** Injectable subprocess dependency so unit tests can mock the CLI. */
export interface TmaxClientDeps {
  /** Spawn `bin/tmaxclient` with the given args, return trimmed stdout. */
  readonly runClient: (args: readonly string[]) => TaskEither<TmaxUseError, string>;
  /** Connect to the daemon socket and send a single JSON-RPC request. */
  readonly request: (method: string, params: Record<string, unknown>) => TaskEither<TmaxUseError, unknown>;
}

export interface ClientOptions {
  /** Path to the daemon's Unix socket file. */
  readonly socketPath: string;
  /** Optional override of the tmaxclient binary path (defaults to PROJECT_ROOT/bin/tmaxclient). */
  readonly clientPath?: string;
  /** Optional cwd for daemon/tmaxclient subprocesses (defaults to project root). */
  readonly cwd?: string;
}

/** Default socket discovery (mirrors `bin/tmaxclient` and `bin/tmax`). */
export function defaultSocketPath(): string {
  if (process.env.TMAX_SOCKET) return process.env.TMAX_SOCKET;
  const uid = process.getuid?.() ?? 501;
  return `/tmp/tmax-${uid}/server`;
}

// ---------------------------------------------------------------------------
// Real subprocess implementation
// ---------------------------------------------------------------------------

function streamToText(stream: NodeJS.ReadableStream | null): Promise<string> {
  return new Promise((resolve) => {
    if (!stream) {
      resolve('');
      return;
    }
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

function waitForExit(proc: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve) => {
    proc.on('close', (code) => resolve(code));
    proc.on('error', () => resolve(-1));
  });
}

/**
 * Spawn `tmaxclient` with the given socket + args and return trimmed stdout.
 * Maps a non-zero exit code (or ERROR/Failed in stderr) into a SubprocessFailed
 * error so callers can branch on Either without try/catch.
 */
export function runClientReal(opts: ClientOptions): (args: readonly string[]) => TaskEither<TmaxUseError, string> {
  return (args) => TaskEither.tryCatch(
    async () => {
      const clientPath = opts.clientPath ?? defaultClientPath();
      const fullArgs = ['--socket', opts.socketPath, ...args];
      const proc = spawn(clientPath, fullArgs, {
        stdio: 'pipe',
        cwd: opts.cwd ?? process.cwd(),
      });
      const stdout = await streamToText(proc.stdout);
      const stderr = await streamToText(proc.stderr);
      const code = await waitForExit(proc);
      if (code !== 0 || /ERROR|Failed/i.test(stderr)) {
        throw new Error(`tmaxclient ${args.join(' ')} exited ${code}: ${stderr.trim() || stdout.trim()}`);
      }
      return stdout;
    },
    (err): TmaxUseError => TmaxUseError.subprocessFailed(
      err instanceof Error ? err.message : String(err),
      'tmaxclient',
    ),
  );
}

function defaultClientPath(): string {
  // Resolve relative to this file: tmax-use/src/client.ts → ../../bin/tmaxclient
  const url = new URL('../..', import.meta.url);
  return new URL('bin/tmaxclient', url).pathname;
}

// ---------------------------------------------------------------------------
// Real JSON-RPC implementation
// ---------------------------------------------------------------------------

interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly result?: unknown;
  readonly error?: { code: number; message: string; data?: unknown };
}

/**
 * Open a single-shot JSON-RPC connection to the daemon socket. Sends one
 * newline-delimited request, waits for the matching response id, returns the
 * result. Used by capture / ping / open where the CLI drops metadata.
 *
 * Mirrors the small request/response shape in `bin/tmaxclient` but without the
 * global state, so it's safe to call concurrently from many tests.
 */
export function requestReal(opts: ClientOptions): (method: string, params: Record<string, unknown>) => TaskEither<TmaxUseError, unknown> {
  return (method, params) => TaskEither.tryCatch(
    async () => {
      if (!existsSync(opts.socketPath)) {
        throw new Error(`socket not present: ${opts.socketPath}`);
      }
      const id = ++requestCounter;
      const request = { jsonrpc: '2.0' as const, id, method, params };
      return await new Promise<unknown>((resolve, reject) => {
        const sock = new Socket();
        let buffer = '';
        const cleanup = () => {
          sock.removeAllListeners();
          try { sock.destroy(); } catch { /* noop */ }
        };
        const fail = (err: Error) => {
          cleanup();
          reject(err);
        };
        sock.on('error', fail);
        sock.on('connect', () => {
          sock.write(JSON.stringify(request) + '\n');
        });
        sock.on('data', (data: Buffer) => {
          buffer += data.toString('utf-8');
          // Frame-split on newlines; check each frame for a matching response.
          let nl: number;
          while ((nl = buffer.indexOf('\n')) !== -1) {
            const frame = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (frame.trim() === '') continue;
            let parsed: JsonRpcResponse | null = null;
            try {
              parsed = JSON.parse(frame) as JsonRpcResponse;
            } catch {
              // Could be a partial frame or a notification we don't care about.
              continue;
            }
            if (parsed.id !== id) continue;
            cleanup();
            if (parsed.error) {
              reject(new Error(`${parsed.error.code}: ${parsed.error.message}`));
              return;
            }
            resolve(parsed.result);
            return;
          }
        });
        // 10s hard timeout — daemon is local; anything slower is a hang.
        const timer = setTimeout(() => fail(new Error(`JSON-RPC ${method} timed out after 10s`)), 10_000);
        sock.on('close', () => {
          clearTimeout(timer);
        });
        try {
          sock.connect(opts.socketPath);
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    (err): TmaxUseError => {
      const msg = err instanceof Error ? err.message : String(err);
      // Capture errors come back as JSON-RPC errors with a message; surface them
      // as CaptureFailed for ergonomic branching in the assert layer.
      if (method === 'capture') {
        return TmaxUseError.captureFailed(msg);
      }
      return TmaxUseError.subprocessFailed(msg, method);
    },
  );
}

let requestCounter = 0;

// ---------------------------------------------------------------------------
// Public client facade
// ---------------------------------------------------------------------------

/**
 * `TmaxClient` exposes both the CLI-wrapping methods (eval, keys, status) and
 * the JSON-RPC passthrough (`request`). The injectable `deps` field is the seam
 * for unit tests: real callers use `createRealClient`, tests pass stubs.
 */
export class TmaxClient {
  readonly deps: TmaxClientDeps;
  readonly socketPath: string;

  constructor(deps: TmaxClientDeps, socketPath: string) {
    this.deps = deps;
    this.socketPath = socketPath;
  }

  /** Direct JSON-RPC request (capture, ping, open). */
  request(method: string, params: Record<string, unknown>): TaskEither<TmaxUseError, unknown> {
    return this.deps.request(method, params);
  }

  /**
   * Evaluate a T-Lisp expression on the daemon (NOT JavaScript `eval`).
   *
   * This is the project's Lisp-dialect RPC: `expr` is shipped to the tmax
   * daemon over JSON-RPC, where the T-Lisp interpreter evaluates it under its
   * sandboxed environment (separate from this Node/Bun process). It is the
   * same primitive `bin/tmaxclient --eval` invokes; safe to expose — the
   * daemon's T-Lisp interpreter is the trusted control surface for the editor.
   */
  eval(expr: string): TaskEither<TmaxUseError, string> {
    return this.deps.runClient(['--eval', expr]).map((s) => s.trim());
  }

  /**
   * Send a sequence of keypress values to the daemon. Each value is one
   * JSON-RPC `keypress` call so multi-character semantic names (`Up`,
   * `S-Up`, …) reach the editor intact — the CLI's `--keys` consumer
   * splits multi-byte sequences into per-byte keypresses, which breaks
   * arrow keys entirely.
   *
   * Use `parseKeys()` + `headlessValues()` (or `compileHeadless()`) to turn a
   * source sequence like `i hello<Escape>` into the values list.
   */
  keys(values: readonly string[]): TaskEither<TmaxUseError, void> {
    if (values.length === 0) return TaskEither.right<void, TmaxUseError>(undefined);
    return TaskEither.from(async () => {
      for (const value of values) {
        const r = await this.deps.request('keypress', { key: value }).run();
        if (Either.isLeft(r)) return leftE<void>(r.left);
      }
      return rightE<void>(undefined);
    });
  }

  /** Open a file by positional argument (CLI parity). */
  open(filePath: string): TaskEither<TmaxUseError, void> {
    return this.deps.runClient([filePath]).map(() => undefined);
  }

  /** Daemon status (CLI parity). Returns trimmed stdout. */
  status(): TaskEither<TmaxUseError, string> {
    return this.deps.runClient(['--status', '--json']);
  }

  /** Daemon ping (JSON-RPC `ping`). */
  ping(): TaskEither<TmaxUseError, void> {
    return this.deps.request('ping', {}).map(() => undefined);
  }
}

/** Real client backed by spawning `bin/tmaxclient` and a Unix socket. */
export function createRealClient(opts: ClientOptions): TmaxClient {
  return new TmaxClient(
    {
      runClient: runClientReal(opts),
      request: requestReal(opts),
    },
    opts.socketPath,
  );
}

/** Construct a fully-stubbed client for unit tests. */
export function createStubClient(deps: TmaxClientDeps, socketPath = '/tmp/test-socket'): TmaxClient {
  return new TmaxClient(deps, socketPath);
}

/** Re-exported for tests that need to assert on response parsing. */
export const __testInternals = {
  requestReal,
  runClientReal,
  isLeft: Either.isLeft,
};
