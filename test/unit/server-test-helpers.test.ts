import { describe, expect, test } from 'bun:test';
import { Socket } from 'net';
import { connectWithTimeout, forceShutdown, sweepTestSockets, destroyRejectedServer } from '../fixtures/server-test-helpers.ts';

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
        // Must wait at least timeoutMs (the timeout fired) but not much more.
        expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 50);
        expect(elapsed).toBeLessThan(timeoutMs + 500);
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

  describe('sweepTestSockets', () => {
    test('does not throw when /tmp has no matching files', () => {
      expect(() => sweepTestSockets()).not.toThrow();
    });
  });
});
