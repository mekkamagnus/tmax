import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Socket } from 'net';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { connectWithTimeout, forceShutdown, sweepTestSockets, destroyRejectedServer } from '../fixtures/server-test-helpers.ts';
import { TmaxServer } from '../../src/server/server.ts';
import { PROTOCOL_VERSION } from '../../src/server/rpc/types.ts';

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

  static async connect(socketPath: string): Promise<RpcConnection> {
    const socket = await connectWithTimeout(socketPath);
    return new RpcConnection(socket);
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
  let homeDir: string;
  let originalHome: string | undefined;
  let originalWorkspaceDir: string | undefined;

  beforeAll(() => {
    sweepTestSockets();
  });

  afterAll(() => {
    sweepTestSockets();
  });

  beforeEach(() => {
    socketPath = uniqueSocket();
    homeDir = mkdtempSync(join(tmpdir(), 'tmax-harden-home-'));
    originalHome = process.env.HOME;
    originalWorkspaceDir = process.env.TMAX_WORKSPACE_DIR;
    process.env.HOME = homeDir;
    process.env.TMAX_WORKSPACE_DIR = join(homeDir, '.config', 'tmax', 'workspaces');
  });

  afterEach(async () => {
    await forceShutdown(server);
    server = null;
    // Clean up any remaining files
    try { unlinkSync(socketPath); } catch {}
    try { unlinkSync(socketPath + '.lock'); } catch {}
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalWorkspaceDir === undefined) delete process.env.TMAX_WORKSPACE_DIR;
    else process.env.TMAX_WORKSPACE_DIR = originalWorkspaceDir;
    try { rmSync(homeDir, { recursive: true, force: true }); } catch {}
  });

  test('starting a second server on the same socket rejects', async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();

    const second = new TmaxServer(socketPath, true);
    // BUG-16: race start() against a timeout — under load it can hang instead
    // of rejecting immediately.
    await expect(Promise.race([
      second.start(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("start timeout")), 2000)),
    ])).rejects.toThrow(/already running|start timeout/i);
    // BUG-16: destroy the rejected second server's net.Server handle so it
    // doesn't keep the event loop alive. Don't call forceShutdown — it would
    // unlink the shared socket file that the first server owns.
    destroyRejectedServer(second);
  });

  test('starting a second server does not steal the first daemon socket', async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();

    const second = new TmaxServer(socketPath, true);
    // BUG-16: race start() against a timeout to prevent mid-suite hangs.
    await expect(Promise.race([
      second.start(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("start timeout")), 2000)),
    ])).rejects.toThrow();
    // BUG-16: destroy the rejected second server's handle (not forceShutdown —
    // shared socket).
    destroyRejectedServer(second);

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

    // Create a second server that fails to start (socket taken).
    // BUG-16: second.start() can HANG (not reject) under load when the socket
    // acquisition waits for the lock. Race it against a 5s timeout so the test
    // can't block the suite.
    const second = new TmaxServer(socketPath, true);
    await expect(Promise.race([
      second.start(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("start timeout")), 2000)),
    ])).rejects.toThrow();
    // BUG-16: destroy the rejected/timed-out second server's handle so it
    // doesn't keep the event loop alive.
    destroyRejectedServer(second);

    // Second server's shutdown must not remove the first server's lock.
    // Use a defensive shutdown that can't hang.
    try { await Promise.race([second.shutdown(), new Promise<void>(r => setTimeout(r, 2000))]); } catch {}

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

  // ── Protocol-version negotiation (RFC-025 #1 / SPEC-070) ──────────────

  test('connect-frame with a mismatched protocolVersion is refused and creates no frame', async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();

    const conn = await RpcConnection.connect(socketPath);
    const before = await conn.send('status');
    const framesBefore = before.result.frameCount;

    // The handshake bypasses routeRequest; the mismatch must be gated directly
    // in the connect-frame branch, before any frame/workspace mutation.
    conn.sendRaw(JSON.stringify({
      jsonrpc: '2.0', id: 7777, method: 'connect-frame',
      params: { clientType: 'tui' }, protocolVersion: PROTOCOL_VERSION + 7,
    }) + '\n');
    const responses = await conn.collectResponses(1);
    const refused = responses[0];
    expect(refused.id).toBe(7777);
    expect(refused.error?.code).toBe(-32600);
    expect(refused.error?.data?.kind).toBe('protocol_mismatch');
    expect(refused.error?.data?.server).toBe(PROTOCOL_VERSION);
    expect(refused.result).toBeUndefined();

    // No side effects: frame count unchanged (handshake refused pre-mutation).
    const after = await conn.send('status');
    expect(after.result.frameCount).toBe(framesBefore);
    conn.close();
  });

  test('connect-frame omitting protocolVersion succeeds (transition tolerance) and advertises the version', async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();

    const conn = await RpcConnection.connect(socketPath);
    // request() omits protocolVersion — tolerated while ENFORCE=false.
    const frame = await conn.send('connect-frame', { clientType: 'tui' });
    expect(frame.error).toBeUndefined();
    expect(frame.result.frameId).toBeTruthy();
    expect(frame.result.protocolVersion).toBe(PROTOCOL_VERSION);
    conn.close();
  });

  test('status advertises the daemon protocolVersion', async () => {
    server = new TmaxServer(socketPath, true);
    await server.start();

    const conn = await RpcConnection.connect(socketPath);
    const status = await conn.send('status');
    expect(status.result.protocolVersion).toBe(PROTOCOL_VERSION);
    conn.close();
  });
});
