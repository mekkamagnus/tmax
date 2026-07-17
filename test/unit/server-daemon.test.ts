import { afterAll, beforeAll, test, expect } from 'bun:test';
import { exec } from 'child_process';
import { promisify } from 'util';
import { sweepTestSockets } from '../fixtures/server-test-helpers.ts';

const execAsync = promisify(exec);

beforeAll(() => {
  sweepTestSockets();
});

afterAll(() => {
  sweepTestSockets();
});

test('should start tmax server daemon', async () => {
  const socket = `/tmp/tmax-server-daemon-test-${process.pid}-${Date.now()}.sock`;
  try {
    const { stdout, stderr } = await execAsync(`TMAX_SOCKET=${socket} timeout 8s bun run src/main.ts --daemon || true`);
    const output = `${stdout}\n${stderr}`;
    expect(output).toContain("tmax server listening");
    expect(output).not.toContain("error:");
  } finally {
    // Shell `timeout 8s` kills the daemon, but doesn't guarantee socket unlink.
    // Sweep our prefix to defend against accumulated orphans across runs.
    sweepTestSockets();
  }
}, 15000);

test('should have tmaxclient executable', async () => {
  const { stdout } = await execAsync('bin/tmaxclient --help');
  expect(stdout).toContain('tmaxclient - Client for tmax server');
});

test('should have updated main.ts with daemon support', async () => {
  // Read the main.ts file and verify it contains daemon support
  const { stdout } = await execAsync('grep -c "daemonMode" src/main.ts');
  expect(parseInt(stdout.trim())).toBeGreaterThan(0);
});
