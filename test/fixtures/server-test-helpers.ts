/**
 * @file server-test-helpers.ts
 * @description Shared lifecycle helpers for server-test files.
 *
 * These helpers prevent the cumulative resource leak (orphaned Unix sockets,
 * wedged connect() calls, dangling timers) that historically made the full
 * unit suite hang mid-run. See docs/specs/BUG-16-unit-suite-server-socket-leak.md.
 */

import { Socket } from 'net';
import { existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { TmaxServer } from '../../src/server/server.ts';

const DEFAULT_CONNECT_TIMEOUT_MS = 2000;

const SOCKET_PREFIXES = [
  'tmax-test-',
  'tmax-observability-',
  'tmax-harden-',
  'tmax-save-',
  'tmax-server-client-',
  'tmax-server-daemon-test-',
  'tmax-capture-parity-',
];

/**
 * Wraps net.connect() with a connection-phase timeout. A healthy local Unix
 * socket connects in <10ms; if connect() hasn't fired within timeoutMs, the
 * socket is destroyed and the promise rejects. This prevents a wedged socket
 * from blocking the test forever (invisible to bun's per-test timeout because
 * the connect callback simply never fires).
 */
export function connectWithTimeout(socketPath: string, timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS): Promise<Socket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new Socket();

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`connect to ${socketPath} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onError = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const onConnect = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(socket);
    };

    // Attach listeners BEFORE calling connect() so we never miss a synchronous
    // error emission (Bun can fire 'error' during the connect syscall).
    socket.on('connect', onConnect);
    socket.on('error', onError);
    socket.connect(socketPath);
  });
}

/**
 * Idempotent, best-effort shutdown of a TmaxServer. Captures the socket path
 * before shutdown so we can still unlink the file if shutdown() throws.
 *
 * Use in afterEach so cleanup runs even when a test assertion throws or times
 * out (bun still runs afterEach in those cases; an inline try/finally would not).
 */
export async function forceShutdown(server: TmaxServer | null): Promise<void> {
  if (!server) return;

  let socketPath: string | undefined;
  try {
    socketPath = server.getSocketPath();
  } catch {
    // best-effort: if we can't even read the path, skip the post-shutdown unlink
  }

  try {
    await server.shutdown();
  } catch (error) {
    // Swallow: rely on the post-shutdown unlink below as the safety net.
    console.error('Best-effort server.shutdown() threw:', error);
  }

  if (socketPath) {
    try {
      if (existsSync(socketPath)) {
        unlinkSync(socketPath);
      }
    } catch {
      // best-effort
    }
  }
}

/**
 * Best-effort sweep of orphaned tmax server-test socket files in /tmp.
 * Intended as a one-shot safety net in a global beforeAll/afterAll — it does
 * NOT replace per-test forceShutdown, just defends against historical
 * accumulation (e.g. orphans left by a prior crashed run).
 */
export function sweepTestSockets(): void {
  let entries: string[];
  try {
    entries = readdirSync('/tmp');
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.sock')) continue;
    if (!SOCKET_PREFIXES.some((prefix) => entry.startsWith(prefix))) continue;

    const fullPath = join('/tmp', entry);
    try {
      unlinkSync(fullPath);
    } catch {
      // Swallow ENOENT and any other errors — best-effort.
    }
  }
}
