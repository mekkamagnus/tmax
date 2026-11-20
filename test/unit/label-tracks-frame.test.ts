/**
 * @file label-tracks-frame.test.ts
 * @description #300 — (A) the mode-line buffer label reflects the CURRENT
 * buffer on EVERY rendered frame, asserted on the frames the CLIENT
 * actually renders (keypress responses + render-state, through the real
 * client pipeline jsonToEditorState + renderStatusLine); (B) the fikra
 * lighter renders on every *Fikra* frame across 3 REAL client
 * disconnect/reconnect cycles (socket-level handshake), with the lighter
 * TOGGLED between renders to prove per-frame derivation.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { testSocketPath, connectWithTimeout } from '../fixtures/server-test-helpers.ts';
import { TmaxServer } from '../../src/server/server.ts';
import { jsonToEditorState } from '../../src/server/serialize.ts';
import { renderStatusLine } from '../../src/frontend/render/status-line.ts';
import type { Socket } from 'node:net';

let server: TmaxServer;
let nextId = 1;

// Workspace isolation (codex r1 fix 3): suppress the daemon's workspace
// autosave entirely for the test's lifetime — no reads/writes of any
// persisted workspace can race the assertions.
const SAVED_ENV = { ...process.env };

/** A real client connection: connect-frame handshake over a real socket. */
async function connectClient(sockPath: string): Promise<{ socket: Socket; frameId: string; send: (m: string, p?: Record<string, unknown>) => Promise<any> }> {
  const socket = await connectWithTimeout(sockPath);
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 10_000);
      const onData = (d: Buffer) => {
        buf += d.toString();
        const nl = buf.indexOf('\n');
        if (nl < 0) return;
        const resp = JSON.parse(buf.slice(0, nl));
        if (resp.id === id) { clearTimeout(timer); socket.off('data', onData); resolve(resp); }
      };
      socket.on('data', onData);
      socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const conn = await send('connect-frame', { clientType: 'tui', clientName: 'label-test' });
  return { socket, frameId: conn.result.frameId, send };
}

/** The label/lighter the CLIENT renders for a frame: the real round-trip. */
function frameLine(frame: any, width = 100): string {
  const state = jsonToEditorState(frame);
  return renderStatusLine(state, width).replace(/\u001b\[[0-9;]*m/g, '');
}

describe('#300 — label tracks the frame; lighter survives restarts', () => {
  beforeEach(async () => {
    process.env.TMAX_WORKSPACE_AUTOSAVE_MS = '2147483647';
    process.env.TMAX_WORKSPACE_DEBOUNCE_MS = '2147483647';
    process.env.TMAX_WORKSPACE_MAX_DIRTY_MS = '2147483647';
    server = new TmaxServer(testSocketPath('label-tracks'), true);
    await server.start();
  });
  afterEach(async () => {
    await (server as unknown as { shutdown: () => Promise<void> }).shutdown?.();
    Object.assign(process.env, SAVED_ENV);
  });

  test('A: every rendered frame names its buffer — keypress responses AND render-state', async () => {
    const sockPath = (server as unknown as { socketPath: string }).socketPath;
    const { socket, frameId, send } = await connectClient(sockPath);
    const ev = (s: string) => (server as unknown as { editor: { interpreter: { execute: (x: string) => unknown } } }).editor.interpreter.execute(s);
    // Direct editor mutations must be pushed to the frame (AC5.5) BEFORE
    // the next keypress — syncFrameToEditor otherwise restores the frame's
    // latched state over them (the latching these tests pin).
    const sync = () => (server as unknown as { syncEditorToAllFrames: () => void }).syncEditorToAllFrames();
    try {
      ev('(progn (buffer-create "*LabelT1*") (buffer-create "*LabelT2*"))');
      // The switch sequence *LabelT1* → *LabelT2* → *LabelT1* (uniquely
      // named — fikra internals own *Fikra* variants), label
      // asserted on EVERY frame the client renders: the keypress RESPONSE
      // (what RemoteEditor.handleKey applies) and the render-state refresh.
      for (const target of ['*LabelT1*', '*LabelT2*', '*LabelT1*']) {
        ev(`(buffer-switch "${target}")`);
        sync();
        const kp = await send('keypress', { key: 'j', frameId });
        expect(frameLine(kp.result), `keypress response after switching to ${target}`).toContain(target);
        const rs = await send('render-state', { frameId });
        expect(frameLine(rs.result), `render-state after switching to ${target}`).toContain(target);
      }
    } finally {
      socket.destroy();
    }
  });

  test('B: the lighter survives 3 real reconnects and is DERIVED per frame', async () => {
    const sockPath = (server as unknown as { socketPath: string }).socketPath;
    const ev = (s: string) => (server as unknown as { editor: { interpreter: { execute: (x: string) => unknown } } }).editor.interpreter.execute(s);
    const sync = () => (server as unknown as { syncEditorToAllFrames: () => void }).syncEditorToAllFrames();
    ev('(progn (require-module fikra/mode) (require-module fikra/thread) (buffer-create "*Fikra*") (buffer-switch "*Fikra*") (fikra-start))');
    sync();

    for (let cycle = 0; cycle <= 3; cycle++) {
      if (cycle > 0) await new Promise((r) => setTimeout(r, 150)); // disconnect lands
      const { socket, frameId, send } = await connectClient(sockPath);
      try {
        // The INITIAL reconnect frame (no keypress yet)...
        const initial = await send('render-state', { frameId });
        expect(frameLine(initial.result), `cycle ${cycle} initial frame label`).toContain('*Fikra*');
        expect(frameLine(initial.result, 160), `cycle ${cycle} initial lighter`).toContain('fikra');
        // ...and a frame after input.
        const kp = await send('keypress', { key: 'j', frameId });
        expect(frameLine(kp.result), `cycle ${cycle} post-keypress label`).toContain('*Fikra*');
        expect(frameLine(kp.result, 160), `cycle ${cycle} post-keypress lighter`).toContain('fikra');
      } finally {
        socket.destroy(); // the disconnect
      }
    }

    // Per-frame DERIVATION proof: toggle the minor mode OFF — the very next
    // frame must lose the lighter (a cached/persistent value would not).
    const { socket, frameId, send } = await connectClient(sockPath);
    try {
      ev('(minor-mode-set "fikra" nil)');
      sync();
      const off = await send('keypress', { key: 'j', frameId });
      expect(frameLine(off.result, 160)).not.toContain('fikra');
      ev('(minor-mode-set "fikra" t)');
      sync();
      const on = await send('keypress', { key: 'j', frameId });
      expect(frameLine(on.result, 160)).toContain('fikra');
    } finally {
      socket.destroy();
    }
  });
});
