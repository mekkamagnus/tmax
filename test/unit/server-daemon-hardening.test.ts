import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connect, Socket } from 'net';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { TmaxServer } from '../../src/server/server.ts';

function uniqueSocket(): string {
  return `/tmp/tmax-harden-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
}

function request(method: string, params: any = {}, id: number = Date.now()): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
}

class RpcConnection {
  private socket: Socket;
  private nextId = 1;

  private constructor(socket: Socket) {
    this.socket = socket;
  }

  static connect(socketPath: string): Promise<RpcConnection> {
    return new Promise((resolve, reject) => {
      const socket = connect(socketPath);
      socket.on('connect', () => resolve(new RpcConnection(socket)));
      socket.on('error', reject);
    });
  }

  send(method: string, params: any = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let responseBuffer = '';
      const timer = setTimeout(() => {
        this.socket.off('data', onData);
        reject(new Error(`Request timeout: ${method}`));
      }, 5000);
      const onData = (data: Buffer) => {
        responseBuffer += data.toString();
        const newline = responseBuffer.indexOf('\n');
        if (newline < 0) return;
        const response = JSON.parse(responseBuffer.slice(0, newline));
        if (response.id === id) {
          clearTimeout(timer);
          this.socket.off('data', onData);
          resolve(response);
        }
      };
      this.socket.on('data', onData);
      this.socket.write(request(method, params, id));
    });
  }

  sendRaw(data: string): void {
    this.socket.write(data);
  }

  collectResponses(count: number, timeoutMs = 5000): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const responses: any[] = [];
      let buffer = '';
      const timer = setTimeout(() => {
        this.socket.off('data', onData);
        reject(new Error(`Only collected ${responses.length}/${count} responses`));
      }, timeoutMs);
      const onData = (data: Buffer) => {
        buffer += data.toString();
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          responses.push(JSON.parse(line));
          if (responses.length >= count) {
            clearTimeout(timer);
            this.socket.off('data', onData);
            resolve(responses);
          }
        }
      };
      this.socket.on('data', onData);
    });
  }

  close(): void {
    this.socket.destroy();
  }
}

describe('Daemon hardening', () => {
  let server: TmaxServer | null = null;
  let socketPath: string;

  beforeEach(() => {
    socketPath = uniqueSocket();
  });

  afterEach(async () => {
    if (server) {
      await server.shutdown();
      server = null;
    }
    // Clean up any remaining files
    try { unlinkSync(socketPath); } catch {}
    try { unlinkSync(socketPath + '.lock'); } catch {}
  });

  test('starting a second server on the same socket rejects', async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();

    const second = new TmaxServer(socketPath, true);
    await expect(second.start()).rejects.toThrow(/already running/i);
  });

  test('starting a second server does not steal the first daemon socket', async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();

    const second = new TmaxServer(socketPath, true);
    await expect(second.start()).rejects.toThrow();

    // First daemon should still respond to pings
    const conn = await RpcConnection.connect(socketPath);
    const ping = await conn.send('ping');
    expect(ping.result.status).toBe('running');
    conn.close();
  });

  test('a stale socket file is removed and the daemon starts', async () => {
    writeFileSync(socketPath, 'stale');

    server = new TmaxServer(socketPath, true);
    await server.start();

    const conn = await RpcConnection.connect(socketPath);
    const ping = await conn.send('ping');
    expect(ping.result.status).toBe('running');
    conn.close();
  });

  test('shutdown removes socket and lock files', async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();

    expect(existsSync(socketPath)).toBe(true);
    expect(existsSync(socketPath + '.lock')).toBe(true);

    await server.shutdown();
    server = null;

    expect(existsSync(socketPath)).toBe(false);
    expect(existsSync(socketPath + '.lock')).toBe(false);
  });

  test('shutdown is idempotent', async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();

    await server.shutdown();
    await server.shutdown();
    server = null;

    expect(existsSync(socketPath)).toBe(false);
  });

  test('start resolves only after socket is listening', async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();

    const conn = await RpcConnection.connect(socketPath);
    const ping = await conn.send('ping');
    expect(ping.result.status).toBe('running');
    conn.close();
  });

  test('fragmented request split across two writes receives one response', async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();

    const conn = await RpcConnection.connect(socketPath);
    const fullRequest = JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'ping', params: {} }) + '\n';
    const mid = Math.floor(fullRequest.length / 2);

    conn.sendRaw(fullRequest.slice(0, mid));
    await new Promise(r => setTimeout(r, 50));
    conn.sendRaw(fullRequest.slice(mid));

    const responses = await conn.collectResponses(1);
    expect(responses[0].id).toBe(42);
    expect(responses[0].result.status).toBe('running');
    conn.close();
  });

  test('two requests in one write each receive a response', async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();

    const conn = await RpcConnection.connect(socketPath);
    conn.sendRaw(
      JSON.stringify({ jsonrpc: '2.0', id: 100, method: 'ping', params: {} }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 101, method: 'status', params: {} }) + '\n'
    );

    const responses = await conn.collectResponses(2);
    const ids = responses.map((r: any) => r.id).sort();
    expect(ids).toEqual([100, 101]);
    conn.close();
  });

  test('malformed JSON returns a parse error', async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();

    const conn = await RpcConnection.connect(socketPath);
    conn.sendRaw('{not valid json}\n');

    const responses = await conn.collectResponses(1);
    expect(responses[0].error.code).toBe(-32700);
    conn.close();
  });

  test('stale lock from dead process is removed and daemon starts', async () => {
    // Write a lock pointing to a PID that cannot be alive
    const lockData = JSON.stringify({
      pid: 999999999,
      socketPath,
      startedAt: new Date().toISOString(),
      cwd: process.cwd(),
    });
    writeFileSync(socketPath + '.lock', lockData);

    server = new TmaxServer(socketPath, true);
    await server.start();

    const conn = await RpcConnection.connect(socketPath);
    const ping = await conn.send('ping');
    expect(ping.result.status).toBe('running');
    conn.close();
  });

  test('failed server shutdown does not remove live daemon lock', async () => {
    // Start first server
    server = new TmaxServer(socketPath, true);
    await server.start();

    // Create a second server that fails to start (socket taken)
    const second = new TmaxServer(socketPath, true);
    await expect(second.start()).rejects.toThrow();

    // Second server's shutdown must not remove the first server's lock
    await second.shutdown();

    // First server's lock should still exist
    expect(existsSync(socketPath + '.lock')).toBe(true);

    // First server should still be reachable
    const conn = await RpcConnection.connect(socketPath);
    const ping = await conn.send('ping');
    expect(ping.result.status).toBe('running');
    conn.close();
  });

  test('frame render-state includes split windows after split-window command', async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();

    const conn = await RpcConnection.connect(socketPath);
    const frameResp = await conn.send('connect-frame', { clientType: 'tui' });
    const frameId = frameResp.result.frameId;

    await conn.send('eval', { code: '(split-window "horizontal")' });

    const stateResp = await conn.send('render-state', { frameId });
    const state = stateResp.result;

    expect(Array.isArray(state.windows)).toBe(true);
    expect(state.windows.length).toBe(2);
    conn.close();
  });

  test('frame render-state includes tabs after tab-new command', async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();

    const conn = await RpcConnection.connect(socketPath);
    const frameResp = await conn.send('connect-frame', { clientType: 'tui' });
    const frameId = frameResp.result.frameId;

    await conn.send('eval', { code: '(tab-new "review-tab")' });

    const stateResp = await conn.send('render-state', { frameId });
    const state = stateResp.result;

    expect(Array.isArray(state.tabs)).toBe(true);
    expect(state.tabs.length).toBeGreaterThanOrEqual(1);
    const labels = state.tabs.map((t: any) => t.label);
    expect(labels).toContain('review-tab');
    conn.close();
  });
});
