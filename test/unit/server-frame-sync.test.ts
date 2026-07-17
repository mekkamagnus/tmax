/**
 * @file server-frame-sync.test.ts
 * @description CHORE-44 Change 5 — direct unit coverage for the daemon's
 * frame/editor sync invariants (AC5.3/AC5.4/AC5.5 + the workspaceOverride
 * exception).
 *
 *   AC5.3: render-state NEVER calls frame→editor or editor→frame sync.
 *   AC5.4: frame keypress syncs frame→editor exactly once before AND
 *          editor→frame exactly once after.
 *   AC5.5: stateless mutations sync editor→all frames after handling.
 *
 * Strategy: construct a real `TmaxServer` in test mode, replace the three
 * sync helpers (`syncFrameToEditor`, `syncEditorToFrame`, `syncEditorToAllFrames`)
 * with spies via prototype swap, stub `editor.handleKey` so keypresses don't
 * need real bindings, then drive `processRequest` directly (no socket). The
 * spies record every sync call so we can assert exact direction + count.
 *
 * BUG-16 caution: no `process.removeAllListeners` / socket `removeAllListeners`.
 * The server is constructed with `testMode=true` (no SIGTERM/SIGINT, no
 * process.exit) and never binds a socket — `processRequest` is called directly.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TmaxServer } from '../../src/server/server.ts';
import type { JSONRPCRequest } from '../../src/server/rpc/router.ts';

// ── Spies ────────────────────────────────────────────────────────────────

type Spy = { calls: number };

interface SyncSpies {
  frameToEditor: Spy;
  editorToFrame: Spy;
  editorToAllFrames: Spy;
}

/** Install spies on the three sync helpers of a TmaxServer instance. */
function installSyncSpies(server: TmaxServer): SyncSpies {
  const spies: SyncSpies = {
    frameToEditor: { calls: 0 },
    editorToFrame: { calls: 0 },
    editorToAllFrames: { calls: 0 },
  };
  const anyServer = server as unknown as {
    syncFrameToEditor: () => void;
    syncEditorToFrame: () => void;
    syncEditorToAllFrames: () => void;
  };
  anyServer.syncFrameToEditor = () => { spies.frameToEditor.calls++; };
  anyServer.syncEditorToFrame = () => { spies.editorToFrame.calls++; };
  anyServer.syncEditorToAllFrames = () => { spies.editorToAllFrames.calls++; };
  return spies;
}

/** Reset all spy counters to zero (between assertions in the same test). */
function reset(spies: SyncSpies): void {
  spies.frameToEditor.calls = 0;
  spies.editorToFrame.calls = 0;
  spies.editorToAllFrames.calls = 0;
}

// ── Test fixture ─────────────────────────────────────────────────────────

async function startTestServer(): Promise<{ server: TmaxServer; socketPath: string; homeDir: string }> {
  // Isolate HOME so no persisted workspace state leaks in (the daemon reads
  // last-workspace on startEditor). mkdtemp gives us a clean per-test home.
  const homeDir = mkdtempSync(join(tmpdir(), 'tmax-sync-home-'));
  const oldHome = process.env.HOME;
  process.env.HOME = homeDir;
  const socketPath = `/tmp/tmax-sync-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
  const server = new TmaxServer(socketPath, true);
  // startEditor loads workspaces + bindings. Socket is never bound — we call
  // processRequest directly. (startSocket is intentionally NOT called.)
  await server.startEditor();
  process.env.HOME = oldHome;
  return { server, socketPath, homeDir };
}

async function send(server: TmaxServer, method: string, params?: unknown, id: string | number = 1): Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }> {
  const request: JSONRPCRequest = { jsonrpc: '2.0', id, method, params };
  const anyServer = server as unknown as { processRequest: (r: JSONRPCRequest) => Promise<unknown> };
  return (await anyServer.processRequest(request)) as { result?: unknown; error?: { code: number; message: string; data?: unknown } };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('CHORE-44 Change 5 — frame/editor sync invariants (AC5.3–AC5.5)', () => {
  let server: TmaxServer | null = null;
  let homeDir: string;

  beforeEach(async () => {
    const started = await startTestServer();
    server = started.server;
    homeDir = started.homeDir;
  });

  afterEach(() => {
    // BUG-16: no broad listener removal. testMode=true means shutdown() never
    // calls process.exit and the auto-save timer is unref'd. We simply drop
    // the reference; the editor has no socket bound.
    server = null;
    rmSync(homeDir, { recursive: true, force: true });
  });

  test('AC5.3: render-state is read-only — never syncs frame→editor nor editor→frame', async () => {
    if (!server) throw new Error('server not started');
    const spies = installSyncSpies(server);

    // Create a frame so render-state has a frameId to target.
    const frameId = server.createFrame('client-1', 'tui');

    reset(spies);
    // render-state with a frameId returns the frame's own state directly.
    const response = await send(server, 'render-state', { frameId });
    expect(response.error).toBeUndefined();

    // AC5.3: zero sync calls in either direction.
    expect(spies.frameToEditor.calls).toBe(0);
    expect(spies.editorToFrame.calls).toBe(0);
    expect(spies.editorToAllFrames.calls).toBe(0);
  });

  test('AC5.3: render-state with no frameId is also read-only', async () => {
    if (!server) throw new Error('server not started');
    const spies = installSyncSpies(server);
    server.createFrame('client-1', 'tui');

    reset(spies);
    const response = await send(server, 'render-state');
    expect(response.error).toBeUndefined();
    expect(spies.frameToEditor.calls).toBe(0);
    expect(spies.editorToFrame.calls).toBe(0);
    expect(spies.editorToAllFrames.calls).toBe(0);
  });

  test('AC5.4: frame keypress syncs frame→editor exactly once before AND editor→frame exactly once after', async () => {
    if (!server) throw new Error('server not started');
    const spies = installSyncSpies(server);

    // Stub editor.handleKey so we don't need real key bindings. The keypress
    // handler still runs the full frame-scoped sync wrapper around it.
    const anyServer = server as unknown as {
      editor: { handleKey: (key: string) => Promise<void> };
    };
    anyServer.editor.handleKey = async (_key: string) => { /* no-op stub */ };

    const frameId = server.createFrame('client-1', 'tui');

    reset(spies);
    const response = await send(server, 'keypress', { key: 'x', frameId });
    expect(response.error).toBeUndefined();

    // AC5.4: exactly one frame→editor sync before, exactly one editor→frame
    // sync after. No editor→all-frames on the frame path (no override).
    expect(spies.frameToEditor.calls).toBe(1);
    expect(spies.editorToFrame.calls).toBe(1);
    expect(spies.editorToAllFrames.calls).toBe(0);
  });

  test('AC5.5: stateless keypress (no frameId) syncs editor→all-frames after handling', async () => {
    if (!server) throw new Error('server not started');
    const spies = installSyncSpies(server);

    const anyServer = server as unknown as {
      editor: { handleKey: (key: string) => Promise<void> };
      activeFrameId: string | null;
    };
    anyServer.editor.handleKey = async (_key: string) => { /* no-op stub */ };
    // No active frame → keypress takes the stateless branch.
    anyServer.activeFrameId = null;

    reset(spies);
    const response = await send(server, 'keypress', { key: 'x' });
    expect(response.error).toBeUndefined();

    // AC5.5: stateless keypress updates the editor directly, then syncs
    // editor→all-frames. No frame→editor (no frame), no editor→single-frame.
    expect(spies.frameToEditor.calls).toBe(0);
    expect(spies.editorToFrame.calls).toBe(0);
    expect(spies.editorToAllFrames.calls).toBe(1);
  });

  test('AC5.5: stateless open (with a frame) syncs editor→frame (no override); open with no frame syncs editor→all-frames', async () => {
    if (!server) throw new Error('server not started');
    const spies = installSyncSpies(server);

    const frameId = server.createFrame('client-1', 'tui');

    reset(spies);
    // open is a stateless mutation: it mutates the shared editor, then syncs.
    // With a frame and no workspace override, it syncs editor→frame.
    const response = await send(server, 'open', { filepath: '/tmp/tmax-sync-nonexistent.txt', frameId });
    expect(response.error).toBeUndefined();

    // AC5.5 (stateless with frame): editor→frame, NOT editor→all-frames.
    // open has NO pre-sync frame→editor (matches the original handler).
    expect(spies.frameToEditor.calls).toBe(0);
    expect(spies.editorToFrame.calls).toBe(1);
    expect(spies.editorToAllFrames.calls).toBe(0);
  });

  test('AC5.5: stateless open (no frame) syncs editor→all-frames', async () => {
    if (!server) throw new Error('server not started');
    const spies = installSyncSpies(server);

    const anyServer = server as unknown as { activeFrameId: string | null };
    anyServer.activeFrameId = null;

    reset(spies);
    const response = await send(server, 'open', { filepath: '/tmp/tmax-sync-other.txt' });
    expect(response.error).toBeUndefined();

    // No frame → stateless open falls through to editor→all-frames.
    expect(spies.frameToEditor.calls).toBe(0);
    expect(spies.editorToFrame.calls).toBe(0);
    expect(spies.editorToAllFrames.calls).toBe(1);
  });

  test('AC5.5: stateless eval (no frame) syncs editor→all-frames after handling', async () => {
    if (!server) throw new Error('server not started');
    const spies = installSyncSpies(server);

    const anyServer = server as unknown as { activeFrameId: string | null };
    anyServer.activeFrameId = null;

    reset(spies);
    const response = await send(server, 'eval', { code: '(+ 1 2)' });
    expect(response.error).toBeUndefined();

    // Stateles eval with no frame: editor→all-frames after handling.
    expect(spies.frameToEditor.calls).toBe(0);
    expect(spies.editorToFrame.calls).toBe(0);
    expect(spies.editorToAllFrames.calls).toBe(1);
  });

  test('readonly ping never syncs', async () => {
    if (!server) throw new Error('server not started');
    const spies = installSyncSpies(server);
    server.createFrame('client-1', 'tui');

    reset(spies);
    const response = await send(server, 'ping');
    expect(response.error).toBeUndefined();
    expect(spies.frameToEditor.calls).toBe(0);
    expect(spies.editorToFrame.calls).toBe(0);
    expect(spies.editorToAllFrames.calls).toBe(0);
  });

  test('readonly status never syncs', async () => {
    if (!server) throw new Error('server not started');
    const spies = installSyncSpies(server);
    server.createFrame('client-1', 'tui');

    reset(spies);
    const response = await send(server, 'status');
    expect(response.error).toBeUndefined();
    expect(spies.frameToEditor.calls).toBe(0);
    expect(spies.editorToFrame.calls).toBe(0);
    expect(spies.editorToAllFrames.calls).toBe(0);
  });
});
