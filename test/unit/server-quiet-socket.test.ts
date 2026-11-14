/**
 * @file server-quiet-socket.test.ts
 * @description #252 — the embedded editor calls startSocket fire-and-forget;
 *   the async "tmax server listening" console.log lands at the hardware
 *   cursor AFTER the TUI's first frame (cursor at L1 C1) and clobbers the
 *   first rendered line. startSocket(quiet) suppresses the banner for that
 *   path; foreground --daemon keeps it (it owns the terminal).
 */
import { test, expect } from 'bun:test';
import { createEditorFixture } from '../helpers/editor-fixture.ts';
import { TmaxServer } from '../../src/server/server.ts';
import { sweepTestSockets, testSocketPath } from '../fixtures/server-test-helpers.ts';

test('startSocket(quiet) suppresses the listening banner; daemon mode keeps it', async () => {
  sweepTestSockets();
  const fixture = await createEditorFixture();

  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };

  let quiet: TmaxServer | undefined;
  let loud: TmaxServer | undefined;
  try {
    quiet = new TmaxServer(testSocketPath('quiet'), true, fixture.editor, undefined, true);
    await quiet.startSocket(true);
    expect(logs.filter((l) => l.includes('listening'))).toHaveLength(0);
    await quiet.shutdown();

    loud = new TmaxServer(testSocketPath('loud'), true, fixture.editor, undefined, true);
    await loud.startSocket(false);
    expect(logs.filter((l) => l.includes('listening'))).toHaveLength(1);
  } finally {
    console.log = origLog;
    try { await quiet?.shutdown(); } catch { /* already down */ }
    try { await loud?.shutdown(); } catch { /* already down */ }
  }
}, 30_000);
