import { afterAll, beforeAll, test, expect } from 'bun:test';
import { exec, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { createConnection } from 'net';
import { existsSync } from 'fs';
import { sweepTestSockets } from '../fixtures/server-test-helpers.ts';

const execAsync = promisify(exec);

beforeAll(() => {
  sweepTestSockets();
});

afterAll(() => {
  sweepTestSockets();
});

/**
 * Spawn `bun src/main.ts --daemon` and resolve once it prints "tmax server
 * listening" (readiness), then tear the daemon down (SIGTERM → bounded SIGKILL
 * → await exit). Replaces the prior GNU `timeout 8s ... || true` shell form,
 * which is absent on stock macOS and left this test tolerated-red. Bun-native:
 * no coreutils dependency, works on macOS + Linux, guarantees owned-process
 * cleanup. (#79 / CHORE-69 Issue D.)
 */
function startDaemonUntilListening(socket: string, deadlineMs = 10_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // detached: true -> the child leads its own process group, so teardown can
    // reap the daemon AND any descendant bun/runtime process it forks (without
    // detached, child.kill() only signals the launcher and the real daemon
    // survives as an orphan). Matches the BUG-25 process-supervisor pattern.
    const child = spawn('bun', ['src/main.ts', '--daemon'], {
      cwd: process.cwd(),
      env: { ...process.env, TMAX_SOCKET: socket },
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (outcome: 'resolve' | 'reject', value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      teardown(child, socket).finally(() => {
        if (outcome === 'resolve') resolve(value as { stdout: string; stderr: string });
        else reject(value as unknown);
      });
    };

    const timer = setTimeout(() => {
      finish('reject', new Error(`daemon did not print "tmax server listening" within ${deadlineMs}ms.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`));
    }, deadlineMs);

    const onChunk = (buf: Buffer | string, sink: 'stdout' | 'stderr') => {
      const text = buf.toString();
      if (sink === 'stdout') stdout += text; else stderr += text;
      if (`${stdout}\n${stderr}`.includes('tmax server listening')) {
        finish('resolve', { stdout, stderr });
      }
    };
    child.stdout?.on('data', (d) => onChunk(d, 'stdout'));
    child.stderr?.on('data', (d) => onChunk(d, 'stderr'));
    child.on('error', (err) => finish('reject', err));
  });
}

/** Signal the whole detached process group (child + descendants). */
function killGroup(child: ChildProcess, sig: NodeJS.Signals): void {
  if (child.pid !== undefined) {
    try { process.kill(-child.pid, sig); return; } catch { /* group already gone */ }
  }
  try { child.kill(sig); } catch { /* already gone */ }
}

/** Graceful shutdown via the daemon's own socket (the proven stopDaemonReal
 *  pattern): send `(editor-quit)`, then poll the socket file away. */
function sendQuit(socketPath: string): Promise<void> {
  return new Promise((resolve) => {
    const sock = createConnection(socketPath, () => {
      sock.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eval', params: { code: '(editor-quit)' } }) + '\n');
    });
    const t = setTimeout(() => { sock.destroy(); resolve(); }, 1_000);
    sock.on('data', () => { clearTimeout(t); sock.destroy(); resolve(); });
    sock.on('error', () => { clearTimeout(t); resolve(); });
  });
}

/** Graceful `(editor-quit)` → poll socket away → SIGTERM → bounded SIGKILL.
 *  Deterministically reaps the daemon + its group. Never rejects. */
function teardown(child: ChildProcess, socketPath: string): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const settle = () => { if (!done) { done = true; clearTimeout(killForce); clearTimeout(hardCap); resolve(); } };
    if (child.exitCode !== null || child.signalCode) return settle();
    // 1. Graceful: ask the daemon to quit via its socket, then poll the file away.
    sendQuit(socketPath).then(async () => {
      for (let i = 0; i < 20; i++) {
        if (!existsSync(socketPath)) return settle();
        await new Promise((r) => setTimeout(r, 50));
      }
      // 2. Still alive: SIGTERM the group, then bounded SIGKILL.
      killGroup(child, 'SIGTERM');
    });
    const killForce = setTimeout(() => { killGroup(child, 'SIGKILL'); }, 3_000);
    const hardCap = setTimeout(settle, 3_500);
    child.on('exit', settle);
  });
}

test('should start tmax server daemon', async () => {
  const socket = `/tmp/tmax-server-daemon-test-${process.pid}-${Date.now()}.sock`;
  try {
    const { stdout, stderr } = await startDaemonUntilListening(socket);
    const output = `${stdout}\n${stderr}`;
    expect(output).toContain('tmax server listening');
    expect(output).not.toContain('error:');
  } finally {
    // The spawned daemon is reaped in startDaemonUntilListening's teardown;
    // sweep our prefix to defend against any accumulated socket orphans.
    sweepTestSockets();
  }
}, 20_000);

test('should have tmaxclient executable', async () => {
  const { stdout } = await execAsync('bin/tmaxclient --help');
  expect(stdout).toContain('tmaxclient - Client for tmax server');
});

test('should have updated main.ts with daemon support', async () => {
  // Read the main.ts file and verify it contains daemon support
  const { stdout } = await execAsync('grep -c "daemonMode" src/main.ts');
  expect(parseInt(stdout.trim())).toBeGreaterThan(0);
});
