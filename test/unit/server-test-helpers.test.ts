import { describe, expect, test } from 'bun:test';
import { Socket } from 'net';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { connectWithTimeout, forceShutdown, sweepTestSockets, destroyRejectedServer, testSocketPath, testWorkerToken } from '../fixtures/server-test-helpers.ts';

describe('server-test-helpers', () => {
  describe('connectWithTimeout', () => {
    test('rejects within timeoutMs+100ms when given a non-existent socket path', async () => {
      const bogusPath = `/tmp/tmax-no-such-socket-${process.pid}-${Date.now()}.sock`;
      const timeoutMs = 500;
      const start = Date.now();

      await expect(connectWithTimeout(bogusPath, timeoutMs)).rejects.toThrow();

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(timeoutMs + 100);
    });

    test('timeout branch: rejects with timeout message when connect() hangs (no connect/error event)', async () => {
      // To exercise the setTimeout branch in connectWithTimeout (lines 39-44),
      // we need a connect() that neither fires 'connect' nor 'error'. The most
      // reliable way without real network resources: spy on the socket's
      // connect method and prevent the events from firing. We do this by
      // intercepting the Socket constructor to return a socket whose connect()
      // is a no-op (never calls the real syscall, so no events ever fire).
      //
      // This directly tests the timeout branch — the helper must destroy the
      // dummy socket and reject within timeoutMs+100ms.
      const timeoutMs = 400;

      // Monkey-patch Socket.connect to create a genuinely hanging socket.
      const originalConnect = Socket.prototype.connect;
      Socket.prototype.connect = function (this: Socket, ...args: any[]): Socket {
        // Do NOT call the real connect — no events fire, simulating a wedged
        // connection. Return this for chainability.
        return this;
      };

      try {
        const start = Date.now();
        await expect(connectWithTimeout('/tmp/dummy-hang-test.sock', timeoutMs)).rejects.toThrow(/timed out/i);
        const elapsed = Date.now() - start;
        // Must wait at least timeoutMs (the timeout fired) and remain bounded.
        // Full-suite event-loop contention can delay timer delivery by >500ms.
        expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 50);
        expect(elapsed).toBeLessThan(timeoutMs + 2_000);
      } finally {
        Socket.prototype.connect = originalConnect;
      }
    });
  });

  describe('forceShutdown', () => {
    test('forceShutdown(null) resolves without throwing', async () => {
      await expect(forceShutdown(null)).resolves.toBeUndefined();
    });
  });

  describe('destroyRejectedServer (BUG-16)', () => {
    test('destroyRejectedServer(null) does not throw', () => {
      expect(() => destroyRejectedServer(null)).not.toThrow();
    });

    test('destroyRejectedServer does not throw for a minimal server shape', () => {
      // A fake object with the expected shape — close/unref should be called
      // without error. The real use is on a rejected TmaxServer whose start()
      // failed; here we just verify the helper is safe to call.
      let closed = false;
      let unrefed = false;
      const fake: unknown = { server: { close: () => { closed = true; }, unref: () => { unrefed = true; } } };
      destroyRejectedServer(fake);
      expect(closed).toBe(true);
      expect(unrefed).toBe(true);
    });
  });

  describe('sweepTestSockets (#239 worker scoping)', () => {
    test('does not throw when /tmp has no matching files', () => {
      expect(() => sweepTestSockets()).not.toThrow();
    });

    test('unlinks OWN-worker sockets but never a sibling worker\'s live socket', () => {
      // A socket whose name carries a FOREIGN worker token (another --parallel
      // worker's live server) must survive our sweep; our own stale entry must
      // not. This is the #239 parallel-safety pin: the old prefix-based sweep
      // killed siblings mid-test (connect ENOENT).
      const own = `/tmp/tmax-pin-${testWorkerToken()}-1-abc.sock`;
      const foreignWorker = `/tmp/tmax-pin-p999999w7-1-abc.sock`;
      writeFileSync(own, '');
      writeFileSync(foreignWorker, '');
      try {
        sweepTestSockets();
        expect(existsSync(own)).toBe(false);
        expect(existsSync(foreignWorker)).toBe(true);
      } finally {
        for (const f of [own, foreignWorker]) {
          try { unlinkSync(f); } catch { /* best-effort */ }
        }
      }
    });

    test('ignores non-tmax .sock files', () => {
      const other = `/tmp/some-other-app-${Date.now()}.sock`;
      writeFileSync(other, '');
      try {
        sweepTestSockets();
        expect(existsSync(other)).toBe(true);
      } finally {
        try { unlinkSync(other); } catch { /* best-effort */ }
      }
    });
  });

  describe('testSocketPath (#239)', () => {
    test('embeds label, worker token, and tmax- prefix', () => {
      const p = testSocketPath('label-x');
      expect(p.startsWith('/tmp/tmax-label-x-')).toBe(true);
      expect(p.includes(`-${testWorkerToken()}-`)).toBe(true);
      expect(p.endsWith('.sock')).toBe(true);
    });

    test('two derivations never collide', () => {
      expect(testSocketPath('a')).not.toBe(testSocketPath('a'));
    });
  });
});
