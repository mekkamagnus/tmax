import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Socket } from 'net';
import { connectWithTimeout, forceShutdown, sweepTestSockets } from '../fixtures/server-test-helpers.ts';
import { TmaxServer } from '../../src/server/server.ts';

const SERVER_OBSERVABILITY_TIMEOUT_MS = 20000;
const RPC_REQUEST_TIMEOUT_MS = 20000;

function request(method: string, params: any = {}, id: number = Date.now()): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
}

async function sendRequest(socketPath: string, method: string, params: any = {}): Promise<any> {
  const socket = await connectWithTimeout(socketPath);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Request timeout'));
    }, RPC_REQUEST_TIMEOUT_MS);
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
    socket.write(request(method, params));
  });
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
        reject(new Error(`Request timeout: ${method} ${JSON.stringify(params)}`));
      }, RPC_REQUEST_TIMEOUT_MS);
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

  beforeAll(() => {
    sweepTestSockets();
  });

  beforeEach(async () => {
    socketPath = `/tmp/tmax-observability-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
    server = new TmaxServer(socketPath, true);
    await server.start();
    await new Promise(resolve => setTimeout(resolve, 250));
  }, SERVER_OBSERVABILITY_TIMEOUT_MS);

  afterEach(async () => {
    await forceShutdown(server);
    server = null;
  }, SERVER_OBSERVABILITY_TIMEOUT_MS);

  test('status returns daemon metadata and no frames before TUI connects', async () => {
    const response = await sendRequest(socketPath, 'status');

    expect(response.error).toBeUndefined();
    expect(response.result.daemonReady).toBe(true);
    expect(response.result.socketPath).toBe(socketPath);
    expect(response.result.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(response.result.frameCount).toBe(0);
    expect(response.result.frames).toEqual([]);
    expect(response.result.editor.mode).toBe('normal');
  }, SERVER_OBSERVABILITY_TIMEOUT_MS);

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
  }, SERVER_OBSERVABILITY_TIMEOUT_MS);

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
  }, SERVER_OBSERVABILITY_TIMEOUT_MS);

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
  }, SERVER_OBSERVABILITY_TIMEOUT_MS);

  // TODO: Requires T-Lisp per-frame state isolation (deferred to separate spec)
  test.skip('frames keep independent opaque minibuffer sessions and views', async () => {
    const first = await RpcConnection.connect(socketPath);
    const second = await RpcConnection.connect(socketPath);
    await first.send('connect-frame', { clientType: 'tui', clientName: 'first' });
    await second.send('connect-frame', { clientType: 'tui', clientName: 'second' });

    await first.send('keypress', { key: ' ' });
    await first.send('keypress', { key: ';' });
    await first.send('keypress', { key: 'b' });

    await second.send('keypress', { key: '\x18' });
    await second.send('keypress', { key: 'b' });

    const firstState = (await first.send('render-state')).result;
    const secondState = (await second.send('render-state')).result;

    expect(firstState.minibufferView.prompt).toBe('M-x ');
    expect(firstState.minibufferView.input).toBe('b');
    expect(secondState.minibufferView.prompt).toBe('Switch to buffer: ');
    expect(secondState.minibufferView.input).toBe('');
    expect(firstState.minibufferState).not.toEqual(secondState.minibufferState);
    expect(firstState.cursorFocus).toBe('command');
    expect(secondState.cursorFocus).toBe('command');

    await first.send('keypress', { key: 'Escape' });
    const firstClosed = (await first.send('render-state')).result;
    const secondStillOpen = (await second.send('render-state')).result;

    expect(firstClosed.cursorFocus).toBe('buffer');
    expect(firstClosed.minibufferState).toBeUndefined();
    expect(secondStillOpen.cursorFocus).toBe('command');
    expect(secondStillOpen.minibufferView.prompt).toBe('Switch to buffer: ');

    first.close();
    second.close();
  }, SERVER_OBSERVABILITY_TIMEOUT_MS);

  test('recent errors are bounded and included in status', async () => {
    await sendRequest(socketPath, 'client-event', {
      event: 'error',
      message: 'observability error',
    });

    const status = await sendRequest(socketPath, 'status');

    expect(status.result.recentErrors.length).toBeLessThanOrEqual(50);
    expect(status.result.recentErrors.at(-1).message).toBe('observability error');
  }, SERVER_OBSERVABILITY_TIMEOUT_MS);
});
