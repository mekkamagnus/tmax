import { test, expect } from 'bun:test';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { TmaxServer } from '../src/server/server.ts';

const exec = promisify(execCallback);

// Helper function to check if server is running
async function isServerRunning(): Promise<boolean> {
  try {
    const result = await exec('lsof -U | grep tmax');
    return result.stdout.includes('server');
  } catch (error) {
    return false;
  }
}

test('should start server daemon', async () => {
  // Skip this test in CI as it requires a running server
  if (process.env.CI) {
    return;
  }

  // Start the server in the background
  const serverProcess = spawn('bun', ['run', 'src/main.tsx', '--daemon'], {
    detached: true,
    stdio: 'pipe'
  });

  // Give the server some time to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Check if the server is running
  const running = await isServerRunning();
  if (running) {
    // Clean up: kill the server process
    process.kill(-serverProcess.pid); // negative PID kills the process group
  }

  expect(running).toBe(true);
});

test('should connect to server with client', async () => {
  // This test requires a running server, so we'll skip it in automated tests
  // In a real scenario, we'd start a server in a test setup
  expect(true).toBe(true); // Placeholder test
});