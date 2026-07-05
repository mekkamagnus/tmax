import { describe, expect, test } from 'bun:test';
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
