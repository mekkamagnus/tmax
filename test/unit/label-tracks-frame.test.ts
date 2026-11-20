/**
 * @file label-tracks-frame.test.ts
 * @description #300 A — the mode-line buffer label reflects the CURRENT
 * buffer on EVERY rendered frame (frame state, not latched at switch).
 * Headless frame harness: a real TmaxServer in test mode driven through
 * processRequest (no socket); after each buffer switch the render-state
 * frame's label source (currentFilename ?? currentBufferName → the
 * status line's basename) must name the buffer the frame renders.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { testSocketPath } from '../fixtures/server-test-helpers.ts';
import { TmaxServer } from '../../src/server/server.ts';
import { jsonToEditorState } from '../../src/server/serialize.ts';
import { renderStatusLine } from '../../src/frontend/render/status-line.ts';
import type { JSONRPCRequest } from '../../src/server/rpc/router.ts';

let server: TmaxServer;
let frameId = '';
let nextId = 1;

async function req(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const anyServer = server as unknown as { processRequest: (r: JSONRPCRequest) => Promise<any> };
  return anyServer.processRequest({ jsonrpc: '2.0', id: nextId++, method, params });
}

/** The label the CLIENT renders for a frame: the real round-trip —
 * jsonToEditorState (the deserializer) + renderStatusLine (the mode
 * line). Verify-gate r1: a hand-rolled helper stayed green while the
 * client symptom persisted. */
function frameLabel(render: any): string {
  const state = jsonToEditorState(render);
  const line = renderStatusLine(state, 100);
  return line.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('#300 A — mode-line label tracks the frame', () => {
  beforeEach(async () => {
    server = new TmaxServer(testSocketPath('label-tracks'), true);
    await server.start();
    // connect-frame bypasses processRequest (socket-layer handshake) —
    // create the frame via the direct API instead.
    frameId = (server as unknown as { createFrame: (id: string | undefined, t: string) => string }).createFrame(undefined, 'tui');
  });
  afterEach(async () => {
    await (server as unknown as { shutdown: () => Promise<void> }).shutdown?.();
  });

  test('#300 B — the fikra lighter survives 3 client restarts (disconnect + reconnect)', async () => {
    const anyEditor = server as unknown as { editor: { interpreter: { execute: (s: string) => unknown } } };
    const ev = (s: string) => anyEditor.editor.interpreter.execute(s);
    const sync = () => (server as unknown as { syncEditorToAllFrames: () => void }).syncEditorToAllFrames();
    const del = (id: string) => (server as unknown as { deleteFrame: (id: string) => void }).deleteFrame(id);

    ev('(progn (require-module fikra/mode) (require-module fikra/thread) (buffer-create "*Fikra*") (buffer-switch "*Fikra*") (fikra-start))');
    sync();
    await req('keypress', { key: 'j', frameId });
    let render: any = await req('render-state', { frameId });
    expect(String(render.result.currentBufferName ?? '')).toBe('*Fikra*');
    expect(frameLabel(render.result)).toContain('fikra');

    // 3 restarts: disconnect (frame deleted) + reconnect (new frame on the
    // same daemon+workspace). The lighter is derived from the buffer's
    // minor-mode registration per frame — it must persist every time.
    for (let i = 1; i <= 3; i++) {
      del(frameId);
      frameId = (server as unknown as { createFrame: (id: string | undefined, t: string) => string }).createFrame(undefined, 'tui');
      await req('keypress', { key: 'j', frameId });
      render = await req('render-state', { frameId });
      expect(frameLabel(render.result), `restart ${i} label`).toContain('*Fikra*');
      expect(frameLabel(render.result), `restart ${i} lighter`).toContain('fikra');
    }
  });

  test('switch sequence *Fikra* → *scratch* → *Fikra*: every frame names its buffer', async () => {
    const anyEditor = server as unknown as { editor: { executeTlisp?: (s: string) => unknown; handleKey: (k: string) => Promise<void>; interpreter: { execute: (s: string) => { _tag?: string } } } };
    const ev = (s: string) => anyEditor.editor.interpreter.execute(s);
    // Direct editor mutations must be pushed to frames (AC5.5) BEFORE any
    // keypress — syncFrameToEditor otherwise restores the latched frame
    // buffer over them.
    const sync = () => (server as unknown as { syncEditorToAllFrames: () => void }).syncEditorToAllFrames();

    // Open a special *Fikra*-style buffer and switch among them.
    ev('(progn (require-module fikra/thread) (buffer-create "*Fikra*") (buffer-switch "*Fikra*"))');
    sync();
    // One keypress round-trip per switch — the sync point the client's
    // next render actually paints from (render-state itself is read-only,
    // AC5.3, so it shows the frame as last synced).
    await req('keypress', { key: 'j', frameId });
    let render: any = await req('render-state', { frameId });
    expect(frameLabel(render.result)).toContain('*Fikra*');

    ev('(buffer-switch "*scratch*")');
    sync();
    await req('keypress', { key: 'j', frameId });
    render = await req('render-state', { frameId });
    expect(frameLabel(render.result)).toContain('*scratch*');

    ev('(buffer-switch "*Fikra*")');
    sync();
    await req('keypress', { key: 'j', frameId });
    render = await req('render-state', { frameId });
    expect(frameLabel(render.result)).toContain('*Fikra*');
  });
});
