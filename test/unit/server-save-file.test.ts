import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connect } from 'net';
import { promisify } from 'util';
import { exec } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TmaxServer } from '../../src/server/server.ts';

const execAsync = promisify(exec);
const RPC_TIMEOUT = 20000;

function rpcEnvelope(method: string, params: any, id: number): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
}

async function sendRequest(socketPath: string, method: string, params: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Request timeout'));
    }, RPC_TIMEOUT);
    socket.on('connect', () => socket.write(rpcEnvelope(method, params, Date.now())));
    socket.on('data', (data) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(JSON.parse(data.toString().trim()));
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}

async function startServer(): Promise<{ server: TmaxServer; socketPath: string }> {
  const socketPath = `/tmp/tmax-save-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
  await execAsync(`rm -f "${socketPath}"`);
  const server = new TmaxServer(socketPath, true);
  await server.start();
  await new Promise(resolve => setTimeout(resolve, 250));
  return { server, socketPath };
}

async function stopServer(server: TmaxServer | null, socketPath: string): Promise<void> {
  if (server) {
    await server.shutdown();
  }
  await execAsync(`rm -f "${socketPath}"`);
}

describe('SPEC-032: save-file RPC', () => {
  let server: TmaxServer | null = null;
  let socketPath: string;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tmax-save-'));
  });

  afterEach(async () => {
    await stopServer(server, socketPath);
    server = null;
    rmSync(tempDir, { recursive: true, force: true });
  }, RPC_TIMEOUT);

  test('save-file writes buffer content to the current file', async () => {
    const started = await startServer();
    server = started.server;
    socketPath = started.socketPath;

    const testFile = join(tempDir, 'test.txt');
    writeFileSync(testFile, 'original content');

    // Open the file
    await sendRequest(socketPath, 'open', { filepath: testFile });

    // Move cursor to line 0 col 0, then insert
    await sendRequest(socketPath, 'eval', { code: '(cursor-move 0 0)' });
    await sendRequest(socketPath, 'eval', { code: '(buffer-insert " MODIFIED")' });

    // Save via save-file RPC
    const saveResponse = await sendRequest(socketPath, 'save-file');

    expect(saveResponse.error).toBeUndefined();
    expect(saveResponse.result.success).toBe(true);

    // Verify file on disk has the new content
    const diskContent = readFileSync(testFile, 'utf-8');
    expect(diskContent).toContain('MODIFIED');
  }, RPC_TIMEOUT);

  test('save-file with filename param saves to a new path (save-as)', async () => {
    const started = await startServer();
    server = started.server;
    socketPath = started.socketPath;

    const originalFile = join(tempDir, 'original.txt');
    const targetFile = join(tempDir, 'saved-as.txt');
    writeFileSync(originalFile, 'hello world');

    // Open the original
    await sendRequest(socketPath, 'open', { filepath: originalFile });

    // Save-as to a new path
    const saveResponse = await sendRequest(socketPath, 'save-file', { filename: targetFile });

    expect(saveResponse.error).toBeUndefined();
    expect(saveResponse.result.success).toBe(true);

    // Verify the new file exists with the content
    const diskContent = readFileSync(targetFile, 'utf-8');
    expect(diskContent).toBe('hello world');
  }, RPC_TIMEOUT);

  test('save-file returns error when no filename is set and none provided', async () => {
    // Fresh server with no file opened — scratch buffer only.
    // Use an isolated HOME so no persisted workspace leaks in.
    const fakeHome = mkdtempSync(join(tmpdir(), 'tmax-home-'));
    const oldHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      const started = await startServer();
      server = started.server;
      socketPath = started.socketPath;

      const saveResponse = await sendRequest(socketPath, 'save-file');

      expect(saveResponse.error).toBeDefined();
    } finally {
      process.env.HOME = oldHome;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  }, RPC_TIMEOUT);
});
