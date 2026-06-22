import { describe, expect, test } from 'bun:test';
import { connectWithTimeout, forceShutdown, sweepTestSockets } from '../fixtures/server-test-helpers.ts';

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

  describe('sweepTestSockets', () => {
    test('does not throw when /tmp has no matching files', () => {
      expect(() => sweepTestSockets()).not.toThrow();
    });
  });
});
