import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connect, Socket } from 'net';
import { promisify } from 'util';
import { exec } from 'child_process';
import { TmaxServer } from '../../src/server/server.ts';

const execAsync = promisify(exec);

function request(method: string, params: any = {}, id: number = Date.now()): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
}

async function sendRequest(socketPath: string, method: string, params: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Request timeout'));
    }, 5000);
    socket.on('connect', () => socket.write(request(method, params)));
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
      const timer = setTimeout(() => {
        this.socket.off('data', onData);
        reject(new Error('Request timeout'));
      }, 5000);
      const onData = (data: Buffer) => {
        const response = JSON.parse(data.toString().trim());
        if (response.id !== id) return;
        clearTimeout(timer);
        this.socket.off('data', onData);
        resolve(response);
      };
      this.socket.on('data', onData);
      this.socket.write(request(method, params, id));
    });
  }

  notify(method: string, params: any = {}): void {
    const id = this.nextId++;
    this.socket.write(request(method, params, id));
  }

  close(): void {
    this.socket.destroy();
  }
}

describe('Server observability', () => {
  let server: TmaxServer | null = null;
  let socketPath: string;

  beforeEach(async () => {
    socketPath = `/tmp/tmax-observability-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
    await execAsync(`rm -f "${socketPath}"`);
    server = new TmaxServer(socketPath, true);
    await server.start();
    await new Promise(resolve => setTimeout(resolve, 250));
  });

  afterEach(async () => {
    if (server) {
      await server.shutdown();
      server = null;
    }
    await execAsync(`rm -f "${socketPath}"`);
  });

  test('status returns daemon metadata and no frames before TUI connects', async () => {
    const response = await sendRequest(socketPath, 'status');

    expect(response.error).toBeUndefined();
    expect(response.result.daemonReady).toBe(true);
    expect(response.result.socketPath).toBe(socketPath);
    expect(response.result.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(response.result.frameCount).toBe(0);
    expect(response.result.frames).toEqual([]);
    expect(response.result.editor.mode).toBe('normal');
  });

  test('connect-frame registers TUI client and frame metadata', async () => {
    const conn = await RpcConnection.connect(socketPath);
    const connectResponse = await conn.send('connect-frame', {
      clientType: 'tui',
      clientName: 'test-tui',
    });

    expect(connectResponse.result.clientId).toBeString();
    expect(connectResponse.result.frameId).toBeString();

    const status = await sendRequest(socketPath, 'status');
    const frame = status.result.frames.find((f: any) => f.id === connectResponse.result.frameId);

    expect(frame.clientType).toBe('tui');
    expect(frame.ready).toBe(false);
    expect(frame.renderCount).toBe(0);

    conn.close();
  });

  test('client lifecycle events update readiness and render metadata', async () => {
    const conn = await RpcConnection.connect(socketPath);
    const connectResponse = await conn.send('connect-frame', {
      clientType: 'tui',
      clientName: 'test-tui',
    });
    const frameId = connectResponse.result.frameId;

    await conn.send('client-event', {
      event: 'first-render',
      terminalSize: { width: 100, height: 30 },
    });
    await conn.send('client-event', {
      event: 'raw-mode-ready',
      terminalSize: { width: 100, height: 30 },
    });

    const status = await sendRequest(socketPath, 'status');
    const frame = status.result.frames.find((f: any) => f.id === frameId);

    expect(frame.ready).toBe(true);
    expect(frame.firstRenderAt).toBeString();
    expect(frame.rawModeReady).toBe(true);
    expect(frame.renderCount).toBeGreaterThanOrEqual(1);
    expect(frame.terminalSize).toEqual({ width: 100, height: 30 });

    conn.close();
  });

  test('daemon eval mutations sync editor state to connected frames', async () => {
    const conn = await RpcConnection.connect(socketPath);
    const connectResponse = await conn.send('connect-frame', {
      clientType: 'tui',
      clientName: 'test-tui',
    });
    const frameId = connectResponse.result.frameId;

    await sendRequest(socketPath, 'eval', { code: '(editor-set-mode "insert")' });

    const status = await sendRequest(socketPath, 'status');
    const frame = status.result.frames.find((f: any) => f.id === frameId);

    expect(status.result.editor.mode).toBe('insert');
    expect(frame.mode).toBe('insert');
    expect(frame.lastSyncDirection).toBe('editor-to-frame');
    expect(frame.lastSyncAt).toBeString();

    conn.close();
  });

  test('recent errors are bounded and included in status', async () => {
    await sendRequest(socketPath, 'client-event', {
      event: 'error',
      message: 'observability error',
    });

    const status = await sendRequest(socketPath, 'status');

    expect(status.result.recentErrors.length).toBeLessThanOrEqual(50);
    expect(status.result.recentErrors.at(-1).message).toBe('observability error');
  });
});
