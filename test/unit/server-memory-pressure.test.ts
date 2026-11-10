/**
 * @file server-memory-pressure.test.ts
 * @description #243 — the daemon reacts to Bun 1.4's OS memory-pressure
 *   notification: `process.on("memoryPressure")` (registered in startSocket,
 *   removed in shutdown) clears the interpreter parse cache (#234), the one
 *   large re-derivable allocation. Persisted user state (workspace/buffer
 *   snapshots) is never touched.
 */
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Editor } from '../../src/editor/editor.ts';
import { createEditorFixture } from '../helpers/editor-fixture.ts';
import { TmaxServer } from '../../src/server/server.ts';
import { sweepTestSockets, testSocketPath } from '../fixtures/server-test-helpers.ts';

let savedHome: string | undefined;
let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-mempress-'));
  savedHome = process.env.HOME;
  process.env.HOME = fakeHome;
});

afterEach(() => {
  process.env.HOME = savedHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

async function startedServer(): Promise<{ editor: Editor; server: TmaxServer }> {
  // Real socket path (so startSocket runs and registers the listener) plus a
  // fixture editor the test can reach (#228 createEditorFixture convention;
  // teardown handled by the fixture).
  const fixture = await createEditorFixture();
  const server = new TmaxServer(testSocketPath('mempress'), true, fixture.editor, undefined, true);
  await server.start();
  return { editor: fixture.editor, server };
}

test('memoryPressure clears the interpreter parse cache (real wiring)', async () => {
  sweepTestSockets();
  const { editor, server } = await startedServer();
  try {
    const interp = editor.getInterpreter();
    // Prime the parse cache with distinct sources (keyed by source text).
    for (let i = 0; i < 8; i++) {
      interp.execute(`(+ ${i} ${i})`);
    }
    const before = interp.parseCacheSize();
    expect(before).toBeGreaterThan(0);

    // Fire the OS notification through the real registered listener.
    process.emit('memoryPressure', 'critical');
    expect(interp.parseCacheSize()).toBe(0);
  } finally {
    try { await server.shutdown(); } catch {}
  }
}, 30_000);

test('shutdown removes the memoryPressure listener', async () => {
  sweepTestSockets();
  const baseline = process.listenerCount('memoryPressure');
  const { server } = await startedServer();
  try {
    expect(process.listenerCount('memoryPressure')).toBe(baseline + 1);
  } finally {
    try { await server.shutdown(); } catch {}
  }
  expect(process.listenerCount('memoryPressure')).toBe(baseline);
}, 30_000);

test('handleMemoryPressure never throws (warning level, empty caches, fresh server)', async () => {
  const fixture = await createEditorFixture();
  const server = new TmaxServer(testSocketPath('mempress2'), true, fixture.editor, undefined, true);
  // Deliberately NOT started — the handler must be safe in every state.
  // shutdown() below calls process.off for an unregistered listener — a
  // no-op by Node/Bun contract.
  expect(() => server.handleMemoryPressure('warning')).not.toThrow();
  expect(() => server.handleMemoryPressure('critical')).not.toThrow();
  try { await server.shutdown(); } catch {}
}, 30_000);
