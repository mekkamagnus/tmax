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

/**
 * #239: identity of the current bun-test worker. Under `--parallel` each file
 * runs in its own worker PROCESS (Bun sets BUN_TEST_WORKER_ID); serially it is
 * undefined and we pin '0'. Combined with process.pid this token uniquely
 * identifies every concurrent test-worker in a run — and lets the sweep below
 * unlink only OUR OWN sockets, never a sibling worker's live ones.
 */
export function testWorkerToken(): string {
  return `p${process.pid}w${process.env.BUN_TEST_WORKER_ID ?? '0'}`;
}

/**
 * #239: canonical derivation for server-test socket paths. Embeds the worker
 * token + timestamp + random so (a) two concurrent workers can never derive
 * the same path, and (b) sweepTestSockets can recognize our own entries.
 * Replaces the per-file hand-rolled `/tmp/tmax-<label>-<pid>-<ts>.sock` variants.
 */
export function testSocketPath(label: string): string {
  return `/tmp/tmax-${label}-${testWorkerToken()}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
}

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
 *
 * BUG-16: `server.shutdown()` awaits `server.close()` which can wedge when
 * active client connections refuse to drain (common under the cumulative load
 * of a full unit-suite run). We cap shutdown() at 3s — if it hasn't resolved by
 * then, we stop waiting, unlink the socket anyway, and let the process move on.
 * This prevents one slow server teardown from hanging the whole suite.
 */
export async function forceShutdown(server: TmaxServer | null): Promise<void> {
  if (!server) return;

  let socketPath: string | undefined;
  try {
    socketPath = server.getSocketPath();
  } catch {
    // best-effort: if we can't even read the path, skip the post-shutdown unlink
  }

  // Race shutdown against a hard cap so a wedged close() can't block us.
  const SHUTDOWN_CAP_MS = 3000;
  let resolved = false;
  await Promise.race([
    (async () => {
      try {
        await server.shutdown();
      } catch (error) {
        // Swallow: rely on the post-shutdown unlink below as the safety net.
        console.error('Best-effort server.shutdown() threw:', error);
      } finally {
        resolved = true;
      }
    })(),
    new Promise<void>((r) => setTimeout(() => {
      if (!resolved) {
        console.error(`forceShutdown: server.shutdown() exceeded ${SHUTDOWN_CAP_MS}ms cap — abandoning wait (BUG-16)`);
      }
      r();
    }, SHUTDOWN_CAP_MS)),
  ]);

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
 * BUG-16: Destroy a rejected second-server's net.Server handle WITHOUT
 * removing the shared socket file. When two TmaxServer instances share the
 * same socketPath and the second's start() rejects (address in use), the
 * second's constructor still created a net.Server handle that can keep the
 * event loop alive. Calling forceShutdown(second) would be wrong — it unlinks
 * the socket file that the FIRST server owns. This helper destroys only the
 * rejected server's handle, leaving the live server's socket intact.
 */
export function destroyRejectedServer(server: unknown): void {
  if (!server) return;
  try {
    // Access the private net.Server via a defensive cast. We intentionally do
    // NOT call shutdown() (which removes the shared socket). Just close + unref
    // the handle so the process can exit.
    const s = server as { server?: { close: () => void; unref: () => void } };
    s.server?.close();
    s.server?.unref();
  } catch {
    // best-effort — if the shape is wrong, nothing we can do.
  }
}

/**
 * Best-effort sweep of orphaned tmax server-test socket files in /tmp —
 * scoped to THIS worker's own entries (#239). Intended as a one-shot safety
 * net in a global beforeAll/afterAll; it does NOT replace per-test
 * forceShutdown.
 *
 * #239 (parallel suite): the old prefix-based sweep unlinked EVERY matching
 * /tmp/*.sock, including sockets belonging to sibling workers' LIVE servers —
 * under `bun test --parallel` a sibling file's beforeEach sweep would rip
 * another file's listening socket mid-test (observed: connect ENOENT on
 * /tmp/tmax-test-<pid>-<ts>.sock). Matching the worker token instead makes
 * cross-worker kills impossible. Trade-off: a crashed run's stale sockets are
 * no longer cleaned by later runs (cosmetic only — unique name derivation
 * means stale files can never collide with a new bind; the OS reaps /tmp).
 */
export function sweepTestSockets(): void {
  const token = testWorkerToken();
  let entries: string[];
  try {
    entries = readdirSync('/tmp');
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.startsWith('tmax-') || !entry.endsWith('.sock')) continue;
    if (!entry.includes(`-${token}-`)) continue;

    const fullPath = join('/tmp', entry);
    try {
      unlinkSync(fullPath);
    } catch {
      // Swallow ENOENT and any other errors — best-effort.
    }
  }
}
