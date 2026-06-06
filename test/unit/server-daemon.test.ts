import { test, expect } from 'bun:test';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

test('should start tmax server daemon', async () => {
  const socket = `/tmp/tmax-server-daemon-test-${process.pid}-${Date.now()}.sock`;
  const { stdout, stderr } = await execAsync(`TMAX_SOCKET=${socket} timeout 8s bun run src/main.tsx --daemon || true`);
  const output = `${stdout}\n${stderr}`;
  expect(output).toContain("tmax server listening");
  expect(output).not.toContain("error:");
}, 15000);

test('should have tmaxclient executable', async () => {
  const { stdout } = await execAsync('bin/tmaxclient --help');
  expect(stdout).toContain('tmaxclient - Client for tmax server');
});

test('should have updated main.tsx with daemon support', async () => {
  // Read the main.tsx file and verify it contains daemon support
  const { stdout } = await execAsync('grep -c "daemonMode" src/main.tsx');
  expect(parseInt(stdout.trim())).toBeGreaterThan(0);
});
